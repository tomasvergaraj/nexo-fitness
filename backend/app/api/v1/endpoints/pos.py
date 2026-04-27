"""POS (Point of Sale) API endpoints."""

from datetime import datetime, timezone
from decimal import Decimal
from typing import List, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.dependencies import TenantContext, get_tenant_context, require_roles
from app.models.pos import (
    Expense,
    Inventory,
    InventoryMovement,
    InventoryMovementType,
    POSTransaction,
    POSTransactionItem,
    POSTransactionStatus,
    Product,
    ProductCategory,
    PurchaseOrder,
    PurchaseOrderItem,
    PurchaseOrderStatus,
    Supplier,
)
from app.models.user import User
from app.schemas.pos import (
    ExpenseCreate,
    ExpenseResponse,
    ExpenseUpdate,
    InventoryMovementResponse,
    InventoryResponse,
    POSTransactionCreate,
    POSTransactionResponse,
    ProductCategoryCreate,
    ProductCategoryResponse,
    ProductCategoryUpdate,
    ProductCreate,
    ProductResponse,
    ProductUpdate,
    PurchaseOrderCreate,
    PurchaseOrderReceiveIn,
    PurchaseOrderResponse,
    StockAdjustIn,
    SupplierCreate,
    SupplierResponse,
    SupplierUpdate,
)

pos_router = APIRouter(prefix="/pos", tags=["POS"])

# ─── helpers ──────────────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _get_product_or_404(db: AsyncSession, product_id: UUID, tenant_id: UUID) -> Product:
    result = await db.execute(
        select(Product).where(Product.id == product_id, Product.tenant_id == tenant_id)
    )
    product = result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    return product


# ─── Categories ───────────────────────────────────────────────────────────────

@pos_router.get("/categories", response_model=List[ProductCategoryResponse])
async def list_categories(
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception")),
):
    result = await db.execute(
        select(ProductCategory)
        .where(ProductCategory.tenant_id == ctx.tenant_id)
        .order_by(ProductCategory.name)
    )
    return result.scalars().all()


@pos_router.post("/categories", response_model=ProductCategoryResponse, status_code=201)
async def create_category(
    body: ProductCategoryCreate,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    cat = ProductCategory(
        id=uuid4(),
        tenant_id=ctx.tenant_id,
        name=body.name,
        color=body.color,
        icon=body.icon,
        created_at=_now(),
    )
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    return cat


@pos_router.put("/categories/{category_id}", response_model=ProductCategoryResponse)
async def update_category(
    category_id: UUID,
    body: ProductCategoryUpdate,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    result = await db.execute(
        select(ProductCategory).where(
            ProductCategory.id == category_id,
            ProductCategory.tenant_id == ctx.tenant_id,
        )
    )
    cat = result.scalar_one_or_none()
    if not cat:
        raise HTTPException(status_code=404, detail="Categoría no encontrada")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(cat, field, value)
    await db.commit()
    await db.refresh(cat)
    return cat


@pos_router.delete("/categories/{category_id}", status_code=204)
async def delete_category(
    category_id: UUID,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    result = await db.execute(
        select(ProductCategory).where(
            ProductCategory.id == category_id,
            ProductCategory.tenant_id == ctx.tenant_id,
        )
    )
    cat = result.scalar_one_or_none()
    if not cat:
        raise HTTPException(status_code=404, detail="Categoría no encontrada")
    await db.delete(cat)
    await db.commit()


# ─── Products ─────────────────────────────────────────────────────────────────

@pos_router.get("/products", response_model=List[ProductResponse])
async def list_products(
    category_id: Optional[UUID] = None,
    active: Optional[bool] = None,
    search: Optional[str] = None,
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception")),
):
    q = select(Product).where(Product.tenant_id == ctx.tenant_id)
    if category_id:
        q = q.where(Product.category_id == category_id)
    if active is not None:
        q = q.where(Product.is_active == active)
    if search:
        term = f"%{search}%"
        q = q.where(
            Product.name.ilike(term) | Product.sku.ilike(term) | Product.barcode.ilike(term)
        )
    q = q.order_by(Product.name).offset((page - 1) * size).limit(size)
    products = (await db.execute(q)).scalars().all()

    # batch-load inventory quantities
    product_ids = [p.id for p in products]
    inv_rows = (
        await db.execute(
            select(Inventory).where(
                Inventory.product_id.in_(product_ids),
                Inventory.branch_id.is_(None),  # stock global
            )
        )
    ).scalars().all()
    stock_by_product = {inv.product_id: inv.quantity for inv in inv_rows}

    # load category names
    cat_ids = list({p.category_id for p in products if p.category_id})
    cats_by_id = {}
    if cat_ids:
        cat_rows = (
            await db.execute(select(ProductCategory).where(ProductCategory.id.in_(cat_ids)))
        ).scalars().all()
        cats_by_id = {c.id: c.name for c in cat_rows}

    result = []
    for p in products:
        data = ProductResponse.model_validate(p)
        data.stock = stock_by_product.get(p.id)
        data.category_name = cats_by_id.get(p.category_id) if p.category_id else None
        result.append(data)
    return result


@pos_router.post("/products", response_model=ProductResponse, status_code=201)
async def create_product(
    body: ProductCreate,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    # check SKU uniqueness
    if body.sku:
        existing = (
            await db.execute(
                select(Product).where(
                    Product.tenant_id == ctx.tenant_id,
                    Product.sku == body.sku,
                )
            )
        ).scalar_one_or_none()
        if existing:
            raise HTTPException(status_code=400, detail=f"SKU '{body.sku}' ya existe")

    now = _now()
    product = Product(
        id=uuid4(),
        tenant_id=ctx.tenant_id,
        name=body.name,
        description=body.description,
        sku=body.sku,
        barcode=body.barcode,
        price=body.price,
        cost=body.cost,
        unit=body.unit,
        category_id=body.category_id,
        image_url=body.image_url,
        is_active=True,
        created_at=now,
        updated_at=now,
    )
    db.add(product)

    # create inventory row (stock global = 0)
    inventory = Inventory(
        id=uuid4(),
        tenant_id=ctx.tenant_id,
        product_id=product.id,
        branch_id=None,
        quantity=0,
        min_stock=0,
        updated_at=now,
    )
    db.add(inventory)

    await db.commit()
    await db.refresh(product)
    data = ProductResponse.model_validate(product)
    data.stock = 0
    return data


@pos_router.get("/products/{product_id}", response_model=ProductResponse)
async def get_product(
    product_id: UUID,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception")),
):
    product = await _get_product_or_404(db, product_id, ctx.tenant_id)
    inv = (
        await db.execute(
            select(Inventory).where(
                Inventory.product_id == product_id,
                Inventory.branch_id.is_(None),
            )
        )
    ).scalar_one_or_none()
    data = ProductResponse.model_validate(product)
    data.stock = inv.quantity if inv else None
    return data


@pos_router.put("/products/{product_id}", response_model=ProductResponse)
async def update_product(
    product_id: UUID,
    body: ProductUpdate,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    product = await _get_product_or_404(db, product_id, ctx.tenant_id)
    updates = body.model_dump(exclude_unset=True)
    if "sku" in updates and updates["sku"] and updates["sku"] != product.sku:
        existing = (
            await db.execute(
                select(Product).where(
                    Product.tenant_id == ctx.tenant_id,
                    Product.sku == updates["sku"],
                    Product.id != product_id,
                )
            )
        ).scalar_one_or_none()
        if existing:
            raise HTTPException(status_code=400, detail=f"SKU '{updates['sku']}' ya existe")
    for field, value in updates.items():
        setattr(product, field, value)
    product.updated_at = _now()
    await db.commit()
    await db.refresh(product)
    inv = (
        await db.execute(
            select(Inventory).where(
                Inventory.product_id == product_id,
                Inventory.branch_id.is_(None),
            )
        )
    ).scalar_one_or_none()
    data = ProductResponse.model_validate(product)
    data.stock = inv.quantity if inv else None
    return data


@pos_router.delete("/products/{product_id}", status_code=204)
async def delete_product(
    product_id: UUID,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    product = await _get_product_or_404(db, product_id, ctx.tenant_id)
    product.is_active = False
    product.updated_at = _now()
    await db.commit()


# ─── Inventory ────────────────────────────────────────────────────────────────

@pos_router.get("/inventory", response_model=List[InventoryResponse])
async def list_inventory(
    branch_id: Optional[UUID] = None,
    low_stock: bool = False,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception")),
):
    q = select(Inventory).where(Inventory.tenant_id == ctx.tenant_id)
    if branch_id:
        q = q.where(Inventory.branch_id == branch_id)
    else:
        q = q.where(Inventory.branch_id.is_(None))
    if low_stock:
        q = q.where(Inventory.quantity <= Inventory.min_stock)
    inv_rows = (await db.execute(q)).scalars().all()

    product_ids = [i.product_id for i in inv_rows]
    products_by_id = {}
    if product_ids:
        prods = (
            await db.execute(select(Product).where(Product.id.in_(product_ids)))
        ).scalars().all()
        products_by_id = {p.id: p.name for p in prods}

    return [
        InventoryResponse(
            id=inv.id,
            product_id=inv.product_id,
            product_name=products_by_id.get(inv.product_id, ""),
            branch_id=inv.branch_id,
            quantity=inv.quantity,
            min_stock=inv.min_stock,
            low_stock=inv.quantity <= inv.min_stock,
            updated_at=inv.updated_at,
        )
        for inv in inv_rows
    ]


@pos_router.get("/inventory/movements", response_model=List[InventoryMovementResponse])
async def list_movements(
    product_id: Optional[UUID] = None,
    branch_id: Optional[UUID] = None,
    from_date: Optional[datetime] = None,
    to_date: Optional[datetime] = None,
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception")),
):
    q = select(InventoryMovement).where(InventoryMovement.tenant_id == ctx.tenant_id)
    if product_id:
        q = q.where(InventoryMovement.product_id == product_id)
    if branch_id:
        q = q.where(InventoryMovement.branch_id == branch_id)
    if from_date:
        q = q.where(InventoryMovement.created_at >= from_date)
    if to_date:
        q = q.where(InventoryMovement.created_at <= to_date)
    q = q.order_by(InventoryMovement.created_at.desc()).offset((page - 1) * size).limit(size)
    movements = (await db.execute(q)).scalars().all()

    prod_ids = list({m.product_id for m in movements})
    prod_names = {}
    if prod_ids:
        rows = (await db.execute(select(Product).where(Product.id.in_(prod_ids)))).scalars().all()
        prod_names = {p.id: p.name for p in rows}

    return [
        InventoryMovementResponse(
            id=m.id,
            product_id=m.product_id,
            product_name=prod_names.get(m.product_id),
            branch_id=m.branch_id,
            movement_type=m.movement_type.value if hasattr(m.movement_type, "value") else m.movement_type,
            quantity=m.quantity,
            unit_cost=m.unit_cost,
            reference_type=m.reference_type,
            notes=m.notes,
            created_by=m.created_by,
            created_at=m.created_at,
        )
        for m in movements
    ]


@pos_router.put("/inventory/{product_id}", response_model=InventoryResponse)
async def adjust_stock(
    product_id: UUID,
    body: StockAdjustIn,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    user=Depends(require_roles("owner", "admin")),
):
    product = await _get_product_or_404(db, product_id, ctx.tenant_id)

    inv = (
        await db.execute(
            select(Inventory).where(
                Inventory.product_id == product_id,
                Inventory.branch_id == body.branch_id if body.branch_id else Inventory.branch_id.is_(None),
            ).with_for_update()
        )
    ).scalar_one_or_none()

    now = _now()
    if not inv:
        inv = Inventory(
            id=uuid4(),
            tenant_id=ctx.tenant_id,
            product_id=product_id,
            branch_id=body.branch_id,
            quantity=body.quantity,
            min_stock=body.min_stock or 0,
            updated_at=now,
        )
        db.add(inv)
        delta = body.quantity
    else:
        delta = body.quantity - inv.quantity
        inv.quantity = body.quantity
        if body.min_stock is not None:
            inv.min_stock = body.min_stock
        inv.updated_at = now

    # record adjustment movement
    movement = InventoryMovement(
        id=uuid4(),
        tenant_id=ctx.tenant_id,
        product_id=product_id,
        branch_id=body.branch_id,
        movement_type=InventoryMovementType.ADJUSTMENT,
        quantity=delta,
        unit_cost=None,
        reference_type="manual",
        notes=body.notes,
        created_by=user.id,
        created_at=now,
    )
    db.add(movement)
    await db.commit()
    await db.refresh(inv)

    return InventoryResponse(
        id=inv.id,
        product_id=inv.product_id,
        product_name=product.name,
        branch_id=inv.branch_id,
        quantity=inv.quantity,
        min_stock=inv.min_stock,
        low_stock=inv.quantity <= inv.min_stock,
        updated_at=inv.updated_at,
    )


# ─── Suppliers ────────────────────────────────────────────────────────────────

@pos_router.get("/suppliers", response_model=List[SupplierResponse])
async def list_suppliers(
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    result = await db.execute(
        select(Supplier)
        .where(Supplier.tenant_id == ctx.tenant_id, Supplier.is_active == True)
        .order_by(Supplier.name)
    )
    return result.scalars().all()


@pos_router.post("/suppliers", response_model=SupplierResponse, status_code=201)
async def create_supplier(
    body: SupplierCreate,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    now = _now()
    supplier = Supplier(
        id=uuid4(),
        tenant_id=ctx.tenant_id,
        name=body.name,
        contact_name=body.contact_name,
        email=body.email,
        phone=body.phone,
        notes=body.notes,
        is_active=True,
        created_at=now,
        updated_at=now,
    )
    db.add(supplier)
    await db.commit()
    await db.refresh(supplier)
    return supplier


@pos_router.put("/suppliers/{supplier_id}", response_model=SupplierResponse)
async def update_supplier(
    supplier_id: UUID,
    body: SupplierUpdate,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    result = await db.execute(
        select(Supplier).where(Supplier.id == supplier_id, Supplier.tenant_id == ctx.tenant_id)
    )
    supplier = result.scalar_one_or_none()
    if not supplier:
        raise HTTPException(status_code=404, detail="Proveedor no encontrado")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(supplier, field, value)
    supplier.updated_at = _now()
    await db.commit()
    await db.refresh(supplier)
    return supplier


@pos_router.delete("/suppliers/{supplier_id}", status_code=204)
async def delete_supplier(
    supplier_id: UUID,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    result = await db.execute(
        select(Supplier).where(Supplier.id == supplier_id, Supplier.tenant_id == ctx.tenant_id)
    )
    supplier = result.scalar_one_or_none()
    if not supplier:
        raise HTTPException(status_code=404, detail="Proveedor no encontrado")
    supplier.is_active = False
    supplier.updated_at = _now()
    await db.commit()


# ─── Purchase Orders ──────────────────────────────────────────────────────────

async def _build_po_response(db: AsyncSession, po: PurchaseOrder) -> PurchaseOrderResponse:
    """Load items + names and build response."""
    items_rows = (
        await db.execute(
            select(PurchaseOrderItem).where(PurchaseOrderItem.purchase_order_id == po.id)
        )
    ).scalars().all()

    prod_ids = [i.product_id for i in items_rows]
    prods_by_id = {}
    if prod_ids:
        prods = (await db.execute(select(Product).where(Product.id.in_(prod_ids)))).scalars().all()
        prods_by_id = {p.id: p.name for p in prods}

    supplier_name = None
    if po.supplier_id:
        sup = (await db.execute(select(Supplier).where(Supplier.id == po.supplier_id))).scalar_one_or_none()
        supplier_name = sup.name if sup else None

    from app.schemas.pos import PurchaseOrderItemResponse
    return PurchaseOrderResponse(
        id=po.id,
        supplier_id=po.supplier_id,
        supplier_name=supplier_name,
        branch_id=po.branch_id,
        status=po.status.value if hasattr(po.status, "value") else po.status,
        total_cost=po.total_cost,
        notes=po.notes,
        ordered_at=po.ordered_at,
        received_at=po.received_at,
        items=[
            PurchaseOrderItemResponse(
                id=i.id,
                product_id=i.product_id,
                product_name=prods_by_id.get(i.product_id),
                quantity_ordered=i.quantity_ordered,
                quantity_received=i.quantity_received,
                unit_cost=i.unit_cost,
            )
            for i in items_rows
        ],
        created_at=po.created_at,
    )


@pos_router.get("/purchase-orders", response_model=List[PurchaseOrderResponse])
async def list_purchase_orders(
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    pos = (
        await db.execute(
            select(PurchaseOrder)
            .where(PurchaseOrder.tenant_id == ctx.tenant_id)
            .order_by(PurchaseOrder.created_at.desc())
        )
    ).scalars().all()
    return [await _build_po_response(db, po) for po in pos]


@pos_router.post("/purchase-orders", response_model=PurchaseOrderResponse, status_code=201)
async def create_purchase_order(
    body: PurchaseOrderCreate,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    now = _now()
    po = PurchaseOrder(
        id=uuid4(),
        tenant_id=ctx.tenant_id,
        supplier_id=body.supplier_id,
        branch_id=body.branch_id,
        status=PurchaseOrderStatus.DRAFT,
        notes=body.notes,
        created_by=_user.id,
        created_at=now,
        updated_at=now,
    )
    db.add(po)
    await db.flush()

    for item_in in body.items:
        await _get_product_or_404(db, item_in.product_id, ctx.tenant_id)
        db.add(
            PurchaseOrderItem(
                id=uuid4(),
                purchase_order_id=po.id,
                product_id=item_in.product_id,
                quantity_ordered=item_in.quantity_ordered,
                unit_cost=item_in.unit_cost,
            )
        )

    await db.commit()
    await db.refresh(po)
    return await _build_po_response(db, po)


@pos_router.get("/purchase-orders/{po_id}", response_model=PurchaseOrderResponse)
async def get_purchase_order(
    po_id: UUID,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    po = (
        await db.execute(
            select(PurchaseOrder).where(
                PurchaseOrder.id == po_id,
                PurchaseOrder.tenant_id == ctx.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not po:
        raise HTTPException(status_code=404, detail="Orden de compra no encontrada")
    return await _build_po_response(db, po)


@pos_router.post("/purchase-orders/{po_id}/receive", response_model=PurchaseOrderResponse)
async def receive_purchase_order(
    po_id: UUID,
    body: PurchaseOrderReceiveIn,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    user=Depends(require_roles("owner", "admin")),
):
    po = (
        await db.execute(
            select(PurchaseOrder).where(
                PurchaseOrder.id == po_id,
                PurchaseOrder.tenant_id == ctx.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not po:
        raise HTTPException(status_code=404, detail="Orden de compra no encontrada")
    if po.status == PurchaseOrderStatus.RECEIVED:
        raise HTTPException(status_code=400, detail="La orden ya fue recibida")
    if po.status == PurchaseOrderStatus.CANCELLED:
        raise HTTPException(status_code=400, detail="La orden está cancelada")

    items_rows = (
        await db.execute(
            select(PurchaseOrderItem).where(PurchaseOrderItem.purchase_order_id == po_id)
        )
    ).scalars().all()
    items_by_product = {str(i.product_id): i for i in items_rows}

    receive_map = {str(r["product_id"]): r["quantity_received"] for r in body.items}

    now = _now()
    total_cost = Decimal("0")

    for item in items_rows:
        qty_received = receive_map.get(str(item.product_id), item.quantity_ordered)
        item.quantity_received = qty_received
        cost = item.unit_cost * qty_received
        total_cost += cost

        # update inventory (SELECT FOR UPDATE)
        inv = (
            await db.execute(
                select(Inventory).where(
                    Inventory.product_id == item.product_id,
                    Inventory.branch_id == po.branch_id if po.branch_id else Inventory.branch_id.is_(None),
                ).with_for_update()
            )
        ).scalar_one_or_none()

        if inv:
            inv.quantity += qty_received
            inv.updated_at = now
        else:
            db.add(
                Inventory(
                    id=uuid4(),
                    tenant_id=ctx.tenant_id,
                    product_id=item.product_id,
                    branch_id=po.branch_id,
                    quantity=qty_received,
                    min_stock=0,
                    updated_at=now,
                )
            )

        db.add(
            InventoryMovement(
                id=uuid4(),
                tenant_id=ctx.tenant_id,
                product_id=item.product_id,
                branch_id=po.branch_id,
                movement_type=InventoryMovementType.PURCHASE,
                quantity=qty_received,
                unit_cost=item.unit_cost,
                reference_id=po.id,
                reference_type="purchase_order",
                notes=body.notes,
                created_by=user.id,
                created_at=now,
            )
        )

    po.status = PurchaseOrderStatus.RECEIVED
    po.received_at = now
    po.total_cost = total_cost
    po.updated_at = now

    await db.commit()
    await db.refresh(po)
    return await _build_po_response(db, po)


@pos_router.delete("/purchase-orders/{po_id}", status_code=204)
async def delete_purchase_order(
    po_id: UUID,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    po = (
        await db.execute(
            select(PurchaseOrder).where(
                PurchaseOrder.id == po_id,
                PurchaseOrder.tenant_id == ctx.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not po:
        raise HTTPException(status_code=404, detail="Orden de compra no encontrada")
    if po.status not in (PurchaseOrderStatus.DRAFT, PurchaseOrderStatus.CANCELLED):
        raise HTTPException(status_code=400, detail="Solo se pueden eliminar órdenes en estado borrador")
    await db.delete(po)
    await db.commit()


# ─── POS Transactions ─────────────────────────────────────────────────────────

async def _build_tx_response(db: AsyncSession, tx: POSTransaction) -> POSTransactionResponse:
    items_rows = (
        await db.execute(
            select(POSTransactionItem).where(POSTransactionItem.transaction_id == tx.id)
        )
    ).scalars().all()
    cashier = None
    if tx.cashier_id:
        cashier = (await db.execute(select(User).where(User.id == tx.cashier_id))).scalar_one_or_none()

    from app.schemas.pos import POSTransactionItemResponse
    return POSTransactionResponse(
        id=tx.id,
        branch_id=tx.branch_id,
        cashier_id=tx.cashier_id,
        cashier_name=f"{cashier.first_name} {cashier.last_name}" if cashier else None,
        subtotal=tx.subtotal,
        discount_amount=tx.discount_amount,
        total=tx.total,
        payment_method=tx.payment_method,
        status=tx.status.value if hasattr(tx.status, "value") else tx.status,
        notes=tx.notes,
        items=[POSTransactionItemResponse.model_validate(i) for i in items_rows],
        sold_at=tx.sold_at,
    )


@pos_router.post("/transactions", response_model=POSTransactionResponse, status_code=201)
async def create_transaction(
    body: POSTransactionCreate,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    user=Depends(require_roles("owner", "admin", "reception")),
):
    now = _now()

    # ── validate and lock inventory rows ──────────────────────────────────────
    product_ids = [item.product_id for item in body.items]
    products = {
        p.id: p
        for p in (
            await db.execute(
                select(Product).where(
                    Product.id.in_(product_ids),
                    Product.tenant_id == ctx.tenant_id,
                    Product.is_active == True,
                )
            )
        ).scalars().all()
    }

    for item_in in body.items:
        if item_in.product_id not in products:
            raise HTTPException(status_code=404, detail=f"Producto {item_in.product_id} no encontrado o inactivo")

    inventories = {
        inv.product_id: inv
        for inv in (
            await db.execute(
                select(Inventory).where(
                    Inventory.product_id.in_(product_ids),
                    Inventory.branch_id == body.branch_id if body.branch_id else Inventory.branch_id.is_(None),
                ).with_for_update()
            )
        ).scalars().all()
    }

    # check stock
    for item_in in body.items:
        inv = inventories.get(item_in.product_id)
        available = inv.quantity if inv else 0
        if available < item_in.quantity:
            prod = products[item_in.product_id]
            raise HTTPException(
                status_code=400,
                detail=f"Stock insuficiente para '{prod.name}': disponible {available}, solicitado {item_in.quantity}",
            )

    # ── build transaction ─────────────────────────────────────────────────────
    subtotal = sum(
        products[i.product_id].price * i.quantity for i in body.items
    )
    discount = body.discount_amount
    total = subtotal - discount

    tx = POSTransaction(
        id=uuid4(),
        tenant_id=ctx.tenant_id,
        branch_id=body.branch_id,
        cashier_id=user.id,
        subtotal=subtotal,
        discount_amount=discount,
        total=total,
        payment_method=body.payment_method,
        status=POSTransactionStatus.COMPLETED,
        notes=body.notes,
        sold_at=now,
        created_at=now,
    )
    db.add(tx)
    await db.flush()

    # ── create items + update inventory ───────────────────────────────────────
    for item_in in body.items:
        prod = products[item_in.product_id]
        item_subtotal = prod.price * item_in.quantity

        db.add(
            POSTransactionItem(
                id=uuid4(),
                transaction_id=tx.id,
                product_id=prod.id,
                product_name=prod.name,
                quantity=item_in.quantity,
                unit_price=prod.price,
                unit_cost=prod.cost,
                subtotal=item_subtotal,
            )
        )

        inv = inventories.get(prod.id)
        if inv:
            inv.quantity -= item_in.quantity
            inv.updated_at = now

        db.add(
            InventoryMovement(
                id=uuid4(),
                tenant_id=ctx.tenant_id,
                product_id=prod.id,
                branch_id=body.branch_id,
                movement_type=InventoryMovementType.SALE,
                quantity=-item_in.quantity,
                unit_cost=prod.cost,
                reference_id=tx.id,
                reference_type="pos_transaction",
                created_by=user.id,
                created_at=now,
            )
        )

    await db.commit()
    await db.refresh(tx)
    return await _build_tx_response(db, tx)


@pos_router.get("/transactions", response_model=List[POSTransactionResponse])
async def list_transactions(
    from_date: Optional[datetime] = None,
    to_date: Optional[datetime] = None,
    cashier_id: Optional[UUID] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception")),
):
    q = select(POSTransaction).where(POSTransaction.tenant_id == ctx.tenant_id)
    if from_date:
        q = q.where(POSTransaction.sold_at >= from_date)
    if to_date:
        q = q.where(POSTransaction.sold_at <= to_date)
    if cashier_id:
        q = q.where(POSTransaction.cashier_id == cashier_id)
    if status_filter:
        q = q.where(POSTransaction.status == status_filter)
    q = q.order_by(POSTransaction.sold_at.desc()).offset((page - 1) * size).limit(size)
    txs = (await db.execute(q)).scalars().all()
    return [await _build_tx_response(db, tx) for tx in txs]


@pos_router.get("/transactions/{tx_id}", response_model=POSTransactionResponse)
async def get_transaction(
    tx_id: UUID,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception")),
):
    tx = (
        await db.execute(
            select(POSTransaction).where(
                POSTransaction.id == tx_id,
                POSTransaction.tenant_id == ctx.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not tx:
        raise HTTPException(status_code=404, detail="Transacción no encontrada")
    return await _build_tx_response(db, tx)


@pos_router.post("/transactions/{tx_id}/refund", response_model=POSTransactionResponse)
async def refund_transaction(
    tx_id: UUID,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    user=Depends(require_roles("owner", "admin")),
):
    tx = (
        await db.execute(
            select(POSTransaction).where(
                POSTransaction.id == tx_id,
                POSTransaction.tenant_id == ctx.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not tx:
        raise HTTPException(status_code=404, detail="Transacción no encontrada")
    if tx.status != POSTransactionStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="Solo se pueden reembolsar transacciones completadas")

    items_rows = (
        await db.execute(
            select(POSTransactionItem).where(POSTransactionItem.transaction_id == tx_id)
        )
    ).scalars().all()

    now = _now()
    product_ids = [i.product_id for i in items_rows]
    inventories = {
        inv.product_id: inv
        for inv in (
            await db.execute(
                select(Inventory).where(
                    Inventory.product_id.in_(product_ids),
                    Inventory.branch_id == tx.branch_id if tx.branch_id else Inventory.branch_id.is_(None),
                ).with_for_update()
            )
        ).scalars().all()
    }

    for item in items_rows:
        inv = inventories.get(item.product_id)
        if inv:
            inv.quantity += item.quantity
            inv.updated_at = now

        db.add(
            InventoryMovement(
                id=uuid4(),
                tenant_id=ctx.tenant_id,
                product_id=item.product_id,
                branch_id=tx.branch_id,
                movement_type=InventoryMovementType.RETURN,
                quantity=item.quantity,
                unit_cost=item.unit_cost,
                reference_id=tx.id,
                reference_type="pos_transaction",
                created_by=user.id,
                created_at=now,
            )
        )

    tx.status = POSTransactionStatus.REFUNDED
    await db.commit()
    await db.refresh(tx)
    return await _build_tx_response(db, tx)


# ─── Expenses ─────────────────────────────────────────────────────────────────

@pos_router.get("/expenses", response_model=List[ExpenseResponse])
async def list_expenses(
    category: Optional[str] = None,
    branch_id: Optional[UUID] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    from datetime import date as date_type
    q = select(Expense).where(Expense.tenant_id == ctx.tenant_id)
    if category:
        q = q.where(Expense.category == category)
    if branch_id:
        q = q.where(Expense.branch_id == branch_id)
    if from_date:
        q = q.where(Expense.expense_date >= from_date)
    if to_date:
        q = q.where(Expense.expense_date <= to_date)
    q = q.order_by(Expense.expense_date.desc()).offset((page - 1) * size).limit(size)
    return (await db.execute(q)).scalars().all()


@pos_router.post("/expenses", response_model=ExpenseResponse, status_code=201)
async def create_expense(
    body: ExpenseCreate,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    user=Depends(require_roles("owner", "admin")),
):
    now = _now()
    expense = Expense(
        id=uuid4(),
        tenant_id=ctx.tenant_id,
        branch_id=body.branch_id,
        category=body.category,
        amount=body.amount,
        description=body.description,
        receipt_url=body.receipt_url,
        expense_date=body.expense_date,
        created_by=user.id,
        created_at=now,
        updated_at=now,
    )
    db.add(expense)
    await db.commit()
    await db.refresh(expense)
    return expense


@pos_router.put("/expenses/{expense_id}", response_model=ExpenseResponse)
async def update_expense(
    expense_id: UUID,
    body: ExpenseUpdate,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    result = await db.execute(
        select(Expense).where(Expense.id == expense_id, Expense.tenant_id == ctx.tenant_id)
    )
    expense = result.scalar_one_or_none()
    if not expense:
        raise HTTPException(status_code=404, detail="Gasto no encontrado")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(expense, field, value)
    expense.updated_at = _now()
    await db.commit()
    await db.refresh(expense)
    return expense


@pos_router.delete("/expenses/{expense_id}", status_code=204)
async def delete_expense(
    expense_id: UUID,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    result = await db.execute(
        select(Expense).where(Expense.id == expense_id, Expense.tenant_id == ctx.tenant_id)
    )
    expense = result.scalar_one_or_none()
    if not expense:
        raise HTTPException(status_code=404, detail="Gasto no encontrado")
    await db.delete(expense)
    await db.commit()
