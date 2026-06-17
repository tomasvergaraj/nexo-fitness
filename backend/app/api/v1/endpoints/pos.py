"""POS (Point of Sale) API endpoints."""

import json
from datetime import datetime, timezone
from decimal import Decimal
from typing import List, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.dependencies import TenantContext, get_tenant_context, require_roles
from app.integrations.storage.r2_client import R2ConfigError
from app.services.image_service import (
    ImageTooLargeError,
    InvalidImageError,
    delete_expense_receipt,
    delete_product_image,
    upload_expense_receipt,
    upload_product_image,
)
from app.models.pos import (
    CashRegisterSession,
    CashSessionStatus,
    ClientAccountEntry,
    Expense,
    Inventory,
    InventoryMovement,
    InventoryMovementType,
    POSTransaction,
    POSTransactionItem,
    POSTransactionPayment,
    POSTransactionStatus,
    Product,
    ProductCategory,
    PurchaseOrder,
    PurchaseOrderItem,
    PurchaseOrderStatus,
    Supplier,
)
from app.models.user import User, UserRole
from app.models.business import Payment, PaymentMethod, PaymentStatus
from app.schemas.pos import (
    AccountPaymentCreate,
    CashSessionCloseIn,
    CashSessionOpenIn,
    CashSessionResponse,
    ClientAccountEntryResponse,
    ClientAccountStatementResponse,
    ClientDebtorRow,
    CreditLimitUpdate,
    CreditPaymentRow,
    DebtorsResponse,
    ExpenseCreate,
    ExpenseResponse,
    ExpenseUpdate,
    InventoryReportResponse,
    InventoryReportRow,
    PaymentMethodBreakdownRow,
    PurchaseSupplierRow,
    PurchasesReportResponse,
    POSRefundRequest,
    SalesBreakdownResponse,
    SalesReportResponse,
    SalesReportRow,
    SalesSummaryResponse,
    SalesTimeseriesPoint,
    SalesTimeseriesResponse,
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

PAYMENT_METHOD_LABELS = {
    "cash": "Efectivo",
    "debit_card": "Débito",
    "credit_card": "Crédito",
    "transfer": "Transferencia",
    "credit": "Fiado",
    "refund": "Devolución",
    "mixed": "Mixto",
    "other": "Otro",
    "stripe": "Stripe",
    "webpay": "WebPay",
    "tuu": "TUU",
    "mercadopago": "MercadoPago",
    "fintoc": "Fintoc",
}


def _payment_label(method: str) -> str:
    return PAYMENT_METHOD_LABELS.get(method, method.replace("_", " ").title())


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ─── Pure helpers (testeables sin DB) ───────────────────────────────────────────

def is_stock_sufficient(available: int, requested: int) -> bool:
    """True si hay stock para vender `requested` unidades. Bloquea la venta si no."""
    return available >= requested


def sale_movement_quantity(quantity: int) -> int:
    """Cantidad del InventoryMovement de una venta: negativa = salida del stock."""
    return -quantity


def compute_expected_cash(
    opening: Decimal,
    cash_sales: Decimal,
    membership_cash: Decimal,
    cash_credit_payments: Decimal,
    cash_refunds: Decimal,
    cash_expenses: Decimal,
) -> Decimal:
    """Efectivo esperado en el cajón al cierre del turno.

    fondo de apertura + ventas POS en efectivo + membresías en efectivo
    + abonos de fiado en efectivo − devoluciones en efectivo − gastos pagados de caja.
    """
    return (
        opening
        + cash_sales
        + membership_cash
        + cash_credit_payments
        - cash_refunds
        - cash_expenses
    )


def cash_difference(counted: Decimal, expected: Decimal) -> Decimal:
    """Descuadre: positivo = sobra efectivo, negativo = falta."""
    return counted - expected


# Medios válidos para un abono o un abono al momento (fiado parcial):
# cualquier medio real de cobro, nunca 'credit'/'mixed'/'refund'.
CREDIT_PAYMENT_METHODS = {
    "cash", "debit_card", "credit_card", "transfer", "other",
    "stripe", "webpay", "tuu", "mercadopago", "fintoc",
}


def is_valid_credit_payment_method(method: str) -> bool:
    """True si `method` puede usarse para cobrar un abono o el pie de un fiado."""
    return method in CREDIT_PAYMENT_METHODS


def credit_limit_exceeded(
    current_balance: Decimal, charge_amount: Decimal, credit_limit: Optional[Decimal]
) -> bool:
    """True si sumar `charge_amount` a la deuda dejaría al socio sobre su tope.

    credit_limit None = sin límite → nunca se excede.
    """
    if credit_limit is None:
        return False
    return (current_balance + charge_amount) > credit_limit


def _credit_limit_mode(ctx: TenantContext) -> str:
    """Modo de aplicación del tope de crédito del tenant: 'off' | 'warn' | 'block'."""
    tenant = getattr(ctx, "tenant", None)
    if tenant is None or not tenant.features:
        return "warn"
    try:
        mode = json.loads(tenant.features).get("credit_limit_mode", "warn")
    except (ValueError, TypeError):
        return "warn"
    return mode if mode in ("off", "warn", "block") else "warn"


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


@pos_router.get("/products/by-barcode/{barcode}", response_model=ProductResponse)
async def get_product_by_barcode(
    barcode: str,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception")),
):
    """Lookup exacto por código de barras (para escáner en el POS)."""
    p = (
        await db.execute(
            select(Product).where(
                Product.tenant_id == ctx.tenant_id,
                Product.barcode == barcode,
                Product.is_active == True,
            ).limit(1)
        )
    ).scalar_one_or_none()
    if not p:
        raise HTTPException(status_code=404, detail="Producto no encontrado")

    inv = (
        await db.execute(
            select(Inventory).where(
                Inventory.product_id == p.id,
                Inventory.branch_id.is_(None),
            )
        )
    ).scalar_one_or_none()
    data = ProductResponse.model_validate(p)
    data.stock = inv.quantity if inv else None
    if p.category_id:
        cat = (await db.execute(select(ProductCategory).where(ProductCategory.id == p.category_id))).scalar_one_or_none()
        data.category_name = cat.name if cat else None
    return data


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

    # create inventory row (stock global, opcionalmente con stock inicial)
    initial_quantity = body.initial_stock or 0
    initial_min_stock = body.min_stock or 0
    inventory = Inventory(
        id=uuid4(),
        tenant_id=ctx.tenant_id,
        product_id=product.id,
        branch_id=None,
        quantity=initial_quantity,
        min_stock=initial_min_stock,
        updated_at=now,
    )
    db.add(inventory)

    await db.commit()
    await db.refresh(product)
    data = ProductResponse.model_validate(product)
    data.stock = initial_quantity
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


# ─── Product image upload (Cloudflare R2) ─────────────────────────────────────

_ALLOWED_IMAGE_MIME = {"image/jpeg", "image/png", "image/webp"}


@pos_router.post("/products/{product_id}/image", response_model=ProductResponse)
async def upload_product_image_endpoint(
    product_id: UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    if file.content_type not in _ALLOWED_IMAGE_MIME:
        raise HTTPException(status_code=400, detail="Formato no soportado. Use JPG, PNG o WebP.")

    product = await _get_product_or_404(db, product_id, ctx.tenant_id)
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Archivo vacío")

    previous_url = product.image_url

    try:
        urls = await run_in_threadpool(upload_product_image, ctx.tenant_id, product_id, raw)
    except ImageTooLargeError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except InvalidImageError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except R2ConfigError as exc:
        raise HTTPException(status_code=503, detail=f"Almacenamiento no configurado: {exc}") from exc

    product.image_url = urls["image_url"]
    product.updated_at = _now()
    await db.commit()
    await db.refresh(product)

    if previous_url and previous_url != product.image_url:
        await run_in_threadpool(delete_product_image, previous_url)

    return ProductResponse.model_validate(product)


@pos_router.delete("/products/{product_id}/image", response_model=ProductResponse)
async def delete_product_image_endpoint(
    product_id: UUID,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    product = await _get_product_or_404(db, product_id, ctx.tenant_id)
    previous_url = product.image_url
    product.image_url = None
    product.updated_at = _now()
    await db.commit()
    await db.refresh(product)

    if previous_url:
        await run_in_threadpool(delete_product_image, previous_url)

    return ProductResponse.model_validate(product)


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
    client = None
    if tx.client_id:
        client = (await db.execute(select(User).where(User.id == tx.client_id))).scalar_one_or_none()

    payment_rows = []
    if tx.payment_method == "mixed":
        payment_rows = (
            await db.execute(
                select(POSTransactionPayment).where(POSTransactionPayment.transaction_id == tx.id)
            )
        ).scalars().all()

    from app.schemas.pos import POSPaymentSplitResponse, POSTransactionItemResponse
    return POSTransactionResponse(
        id=tx.id,
        branch_id=tx.branch_id,
        cashier_id=tx.cashier_id,
        cashier_name=f"{cashier.first_name} {cashier.last_name}" if cashier else None,
        client_id=tx.client_id,
        client_name=f"{client.first_name} {client.last_name}" if client else None,
        subtotal=tx.subtotal,
        discount_amount=tx.discount_amount,
        gift_card_amount=tx.gift_card_amount,
        total=tx.total,
        refunded_amount=tx.refunded_amount or Decimal("0"),
        payment_method=tx.payment_method,
        status=tx.status.value if hasattr(tx.status, "value") else tx.status,
        notes=tx.notes,
        items=[POSTransactionItemResponse.model_validate(i) for i in items_rows],
        payments=[
            POSPaymentSplitResponse(method=p.method, label=_payment_label(p.method), amount=p.amount)
            for p in payment_rows
        ],
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

    # ── require an open cash session for this branch ──────────────────────────
    session = await _open_session_for_branch(db, ctx.tenant_id, body.branch_id)
    if not session:
        raise HTTPException(
            status_code=409,
            detail="No hay un turno de caja abierto. Abre la caja antes de registrar ventas.",
        )

    # ── pago mixto: validar exclusividad y métodos ────────────────────────────
    is_mixed = bool(body.payments)
    if is_mixed:
        if body.payment_method == "credit" or any(p.method == "credit" for p in body.payments):
            raise HTTPException(status_code=400, detail="El pago mixto no admite fiado.")
        if body.gift_card_code and body.gift_card_code.strip():
            raise HTTPException(status_code=400, detail="El pago mixto no admite gift card.")
        for p in body.payments:
            if p.method not in PAYMENT_METHOD_LABELS or p.method in ("credit", "mixed", "refund"):
                raise HTTPException(status_code=400, detail=f"Método de pago inválido: {p.method}")

    # ── socio asociado: opcional en cualquier venta, obligatorio si es fiado ───
    is_credit = body.payment_method == "credit" and not is_mixed
    if is_credit and not body.client_id:
        raise HTTPException(status_code=400, detail="Selecciona el socio para una venta a crédito (fiado).")
    selected_client = None
    if body.client_id:
        selected_client = (await db.execute(
            select(User).where(
                User.id == body.client_id,
                User.tenant_id == ctx.tenant_id,
                User.role == UserRole.CLIENT,
            )
        )).scalar_one_or_none()
        if not selected_client:
            raise HTTPException(status_code=404, detail="Socio no encontrado")
    if is_credit and body.gift_card_code and body.gift_card_code.strip():
        raise HTTPException(status_code=400, detail="No se puede usar gift card en una venta a crédito.")

    # ── fiado parcial: validar el método del abono al momento ─────────────────
    down_payment = body.credit_down_payment or Decimal("0")
    if not is_credit and down_payment > 0:
        raise HTTPException(status_code=400, detail="El abono al momento solo aplica a ventas a crédito (fiado).")
    if is_credit and down_payment < 0:
        raise HTTPException(status_code=400, detail="El abono al momento no puede ser negativo.")
    if is_credit and down_payment > 0 and not is_valid_credit_payment_method(body.credit_down_payment_method):
        raise HTTPException(status_code=400, detail=f"Método de abono inválido: {body.credit_down_payment_method}")

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
        if not is_stock_sufficient(available, item_in.quantity):
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

    # ── fiado: validar abono al momento y tope de crédito sobre el total ──────
    credit_debt = Decimal("0")
    if is_credit:
        if down_payment > total:
            raise HTTPException(
                status_code=400,
                detail=f"El abono al momento (${down_payment}) supera el total (${total}).",
            )
        if down_payment == total:
            raise HTTPException(
                status_code=400,
                detail="El abono cubre el total: registra una venta normal, no un fiado.",
            )
        credit_debt = total - down_payment  # lo que realmente queda como deuda
        mode = _credit_limit_mode(ctx)
        if mode == "block" and selected_client is not None:
            # Lock de la fila del socio para serializar fiados concurrentes. El saldo
            # es un SUM sobre el ledger (no hay fila que candar), así que dos cajas
            # podrían leer el mismo saldo viejo, validar OK y ambas insertar el cargo,
            # saltándose el límite. Lockeando la fila dueña de la cuenta, la segunda
            # venta espera al commit de la primera y revalida contra el saldo fresco.
            await db.execute(
                select(User.id).where(User.id == selected_client.id).with_for_update()
            )
            current_balance = await _client_balance(db, ctx.tenant_id, selected_client.id)
            if credit_limit_exceeded(current_balance, credit_debt, selected_client.credit_limit):
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"La venta deja la deuda de {selected_client.first_name} en "
                        f"${current_balance + credit_debt}, sobre su límite de ${selected_client.credit_limit}."
                    ),
                )

    if is_mixed:
        paid = sum((p.amount for p in body.payments), Decimal("0"))
        if paid != total:
            raise HTTPException(
                status_code=400,
                detail=f"La suma de los pagos ({paid}) no coincide con el total ({total}).",
            )

    tx = POSTransaction(
        id=uuid4(),
        tenant_id=ctx.tenant_id,
        branch_id=body.branch_id,
        cashier_id=user.id,
        client_id=selected_client.id if selected_client else None,
        session_id=session.id,
        subtotal=subtotal,
        discount_amount=discount,
        total=total,
        payment_method="mixed" if is_mixed else body.payment_method,
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
                quantity=sale_movement_quantity(item_in.quantity),
                unit_cost=prod.cost,
                reference_id=tx.id,
                reference_type="pos_transaction",
                created_by=user.id,
                created_at=now,
            )
        )

    # ── pago mixto: guarda el desglose por método ─────────────────────────────
    if is_mixed:
        for p in body.payments:
            db.add(
                POSTransactionPayment(
                    id=uuid4(),
                    transaction_id=tx.id,
                    method=p.method,
                    amount=p.amount,
                )
            )

    # ── gift card: descuenta saldo del total (Fase 6.6) ───────────────────────
    if body.gift_card_code and body.gift_card_code.strip() and tx.total > 0:
        from app.services import gift_card_service

        try:
            redemption = await gift_card_service.redeem(
                db,
                tenant_id=ctx.tenant_id,
                code=body.gift_card_code,
                total=tx.total,
                context="pos",
                redeemed_by=user.id,
                pos_transaction_id=tx.id,
            )
        except gift_card_service.GiftCardError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        tx.gift_card_amount = redemption.amount
        tx.total = tx.total - redemption.amount

    # ── fiado: registra el cargo (y el abono al momento si lo hubo) ───────────
    if is_credit:
        db.add(
            ClientAccountEntry(
                id=uuid4(),
                tenant_id=ctx.tenant_id,
                branch_id=body.branch_id,
                client_id=body.client_id,
                kind="charge",
                amount=tx.total,
                pos_transaction_id=tx.id,
                session_id=session.id,   # enlaza el turno → "fiado otorgado" del arqueo
                notes=body.notes,
                created_by=user.id,
                created_at=now,
            )
        )
        # Fiado parcial: el abono al momento se registra como un abono más. Si es
        # en efectivo, entra al arqueo del turno (cash_credit_payments).
        if down_payment > 0:
            db.add(
                ClientAccountEntry(
                    id=uuid4(),
                    tenant_id=ctx.tenant_id,
                    branch_id=body.branch_id,
                    client_id=body.client_id,
                    kind="payment",
                    amount=down_payment,
                    payment_method=body.credit_down_payment_method,
                    pos_transaction_id=tx.id,
                    session_id=session.id,
                    notes="Abono al momento de la venta",
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
    body: Optional[POSRefundRequest] = None,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    user=Depends(require_roles("owner", "admin")),
):
    """Devuelve una venta. Sin `items` → devolución total de lo no devuelto aún.
    Con `items` → devolución parcial (ítems/cantidades sueltas). El descuento y
    la gift card se prorratean; el inventario se restaura por ítem; en ventas
    fiadas se reduce la deuda del socio."""
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
        raise HTTPException(status_code=400, detail="Solo se pueden devolver ventas completadas")

    items_rows = (
        await db.execute(
            select(POSTransactionItem).where(POSTransactionItem.transaction_id == tx_id)
        )
    ).scalars().all()
    items_by_id = {i.id: i for i in items_rows}

    # ── determinar qué cantidad se devuelve por ítem ──────────────────────────
    to_refund: dict[UUID, int] = {}
    if body and body.items:
        for ref in body.items:
            item = items_by_id.get(ref.item_id)
            if item is None:
                raise HTTPException(status_code=404, detail="Ítem no pertenece a la venta")
            remaining = item.quantity - (item.refunded_quantity or 0)
            if ref.quantity > remaining:
                raise HTTPException(
                    status_code=400,
                    detail=f"'{item.product_name}': solo quedan {remaining} por devolver",
                )
            to_refund[item.id] = to_refund.get(item.id, 0) + ref.quantity
    else:
        # devolución total: todo lo que no se ha devuelto
        for item in items_rows:
            remaining = item.quantity - (item.refunded_quantity or 0)
            if remaining > 0:
                to_refund[item.id] = remaining

    if not to_refund or sum(to_refund.values()) == 0:
        raise HTTPException(status_code=400, detail="No hay unidades por devolver")

    now = _now()
    product_ids = [items_by_id[i].product_id for i in to_refund]
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

    # factor de prorrateo: total cobrado / subtotal bruto (reparte descuento + gift card)
    factor = (tx.total / tx.subtotal) if tx.subtotal and tx.subtotal > 0 else Decimal("1")
    refund_value = Decimal("0")
    for item_id, qty in to_refund.items():
        item = items_by_id[item_id]
        inv = inventories.get(item.product_id)
        if inv:
            inv.quantity += qty
            inv.updated_at = now
        item.refunded_quantity = (item.refunded_quantity or 0) + qty
        refund_value += (item.unit_price * qty) * factor

        db.add(
            InventoryMovement(
                id=uuid4(),
                tenant_id=ctx.tenant_id,
                product_id=item.product_id,
                branch_id=tx.branch_id,
                movement_type=InventoryMovementType.RETURN,
                quantity=qty,
                unit_cost=item.unit_cost,
                reference_id=tx.id,
                reference_type="pos_transaction",
                created_by=user.id,
                created_at=now,
            )
        )

    refund_value = refund_value.quantize(Decimal("1"))  # CLP sin decimales
    # no exceder el total cobrado
    prev_refunded = tx.refunded_amount or Decimal("0")
    refund_value = min(refund_value, tx.total - prev_refunded)
    tx.refunded_amount = prev_refunded + refund_value

    # ¿quedó todo devuelto? → status REFUNDED
    fully = all((i.refunded_quantity or 0) >= i.quantity for i in items_rows)
    if fully or tx.refunded_amount >= tx.total:
        tx.status = POSTransactionStatus.REFUNDED

    # ── fiado: la devolución reduce la deuda del socio ────────────────────────
    if tx.payment_method == "credit" and tx.client_id and refund_value > 0:
        db.add(
            ClientAccountEntry(
                id=uuid4(),
                tenant_id=ctx.tenant_id,
                branch_id=tx.branch_id,
                client_id=tx.client_id,
                kind="payment",
                amount=refund_value,
                payment_method="refund",          # excluido del arqueo y de "cobrado"
                pos_transaction_id=tx.id,
                notes=(body.notes if body and body.notes else "Devolución de venta"),
                created_by=user.id,
                created_at=now,
            )
        )

    await db.commit()
    await db.refresh(tx)
    return await _build_tx_response(db, tx)


# ─── Cash register sessions (turnos de caja) ────────────────────────────────────

async def _breakdown_rows(
    db: AsyncSession,
    tenant_id: UUID,
    *,
    from_dt: Optional[datetime] = None,
    to_dt: Optional[datetime] = None,
    session_id: Optional[UUID] = None,
    branch_id: Optional[UUID] = None,
) -> tuple[list[PaymentMethodBreakdownRow], Decimal, int]:
    """Desglose de ventas COMPLETED por método de pago.

    Ventas de un solo método se agregan por POSTransaction.payment_method; las
    mixtas (payment_method='mixed') se descomponen por sus líneas de pago en
    pos_transaction_payments. Así el efectivo/tarjeta de una venta mixta cae en
    su método real (clave para el arqueo)."""
    conditions = [
        POSTransaction.tenant_id == tenant_id,
        POSTransaction.status == POSTransactionStatus.COMPLETED,
    ]
    if session_id is not None:
        conditions.append(POSTransaction.session_id == session_id)
    if from_dt is not None:
        conditions.append(POSTransaction.sold_at >= from_dt)
    if to_dt is not None:
        conditions.append(POSTransaction.sold_at <= to_dt)
    if branch_id is not None:
        conditions.append(POSTransaction.branch_id == branch_id)

    # acumulador por método: [count, subtotal, discount, total]
    acc: dict[str, list[Decimal]] = {}

    def _add(method: str, count: int, subtotal: Decimal, discount: Decimal, total: Decimal) -> None:
        row = acc.setdefault(method, [0, Decimal("0"), Decimal("0"), Decimal("0")])
        row[0] += count
        row[1] += Decimal(subtotal)
        row[2] += Decimal(discount)
        row[3] += Decimal(total)

    # A) ventas de un solo método (excluye mixtas)
    rows_a = (await db.execute(
        select(
            POSTransaction.payment_method,
            func.count(POSTransaction.id),
            func.coalesce(func.sum(POSTransaction.subtotal), 0),
            func.coalesce(func.sum(POSTransaction.discount_amount), 0),
            func.coalesce(func.sum(POSTransaction.total), 0),
        )
        .where(*conditions, POSTransaction.payment_method != "mixed")
        .group_by(POSTransaction.payment_method)
    )).all()
    for method, count, subtotal, discount, total in rows_a:
        _add(method, count, subtotal, discount, total)

    # B) líneas de pago de ventas mixtas
    rows_b = (await db.execute(
        select(
            POSTransactionPayment.method,
            func.count(func.distinct(POSTransactionPayment.transaction_id)),
            func.coalesce(func.sum(POSTransactionPayment.amount), 0),
        )
        .select_from(POSTransactionPayment)
        .join(POSTransaction, POSTransactionPayment.transaction_id == POSTransaction.id)
        .where(*conditions, POSTransaction.payment_method == "mixed")
        .group_by(POSTransactionPayment.method)
    )).all()
    for method, count, total in rows_b:
        # en mixtas el subtotal/descuento por método no aplica: subtotal=monto, descuento=0
        _add(method, count, Decimal(total), Decimal("0"), Decimal(total))

    out: list[PaymentMethodBreakdownRow] = []
    grand_total = Decimal("0")
    for method, (count, subtotal, discount, total) in sorted(acc.items(), key=lambda kv: kv[1][3], reverse=True):
        out.append(
            PaymentMethodBreakdownRow(
                payment_method=method,
                label=_payment_label(method),
                count=int(count),
                subtotal=subtotal,
                discount=discount,
                total=total,
            )
        )
        grand_total += total

    # # de transacciones distintas (no líneas de pago)
    grand_count = int((await db.execute(
        select(func.count(POSTransaction.id)).where(*conditions)
    )).scalar_one())
    return out, grand_total, grand_count


async def _user_name(db: AsyncSession, user_id: Optional[UUID]) -> Optional[str]:
    if not user_id:
        return None
    u = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    return f"{u.first_name} {u.last_name}" if u else None


async def _session_cash_live(db: AsyncSession, tenant_id: UUID, session_id: UUID) -> dict:
    """Componentes de efectivo de una sesión, calculados en vivo sobre las tablas."""
    by_method, sales_total, sales_count = await _breakdown_rows(db, tenant_id, session_id=session_id)

    # Efectivo recibido por ventas del turno, INDEPENDIENTE de devoluciones
    # posteriores: el efectivo entró al cajón al vender. Las devoluciones se
    # restan aparte en cash_refunds; así una venta devuelta en el mismo turno
    # neta a cero (y no se resta dos veces como cuando cash_sales era solo
    # 'completed'). Incluye la parte efectivo de ventas mixtas.
    cash_sales_nonmixed = Decimal(
        (await db.execute(
            select(func.coalesce(func.sum(POSTransaction.total), 0)).where(
                POSTransaction.tenant_id == tenant_id,
                POSTransaction.session_id == session_id,
                POSTransaction.payment_method == "cash",
                POSTransaction.status != POSTransactionStatus.CANCELLED,
            )
        )).scalar_one()
    )
    cash_sales_mixed = Decimal(
        (await db.execute(
            select(func.coalesce(func.sum(POSTransactionPayment.amount), 0))
            .select_from(POSTransactionPayment)
            .join(POSTransaction, POSTransactionPayment.transaction_id == POSTransaction.id)
            .where(
                POSTransaction.tenant_id == tenant_id,
                POSTransaction.session_id == session_id,
                POSTransaction.payment_method == "mixed",
                POSTransaction.status != POSTransactionStatus.CANCELLED,
                POSTransactionPayment.method == "cash",
            )
        )).scalar_one()
    )
    cash_sales = cash_sales_nonmixed + cash_sales_mixed

    membership_cash = Decimal(
        (await db.execute(
            select(func.coalesce(func.sum(Payment.amount), 0)).where(
                Payment.tenant_id == tenant_id,
                Payment.session_id == session_id,
                Payment.method == PaymentMethod.CASH,
                Payment.status == PaymentStatus.COMPLETED,
            )
        )).scalar_one()
    )
    cash_refunds = Decimal(
        (await db.execute(
            select(func.coalesce(func.sum(POSTransaction.refunded_amount), 0)).where(
                POSTransaction.tenant_id == tenant_id,
                POSTransaction.session_id == session_id,
                POSTransaction.refunded_amount > 0,
                POSTransaction.payment_method == "cash",
            )
        )).scalar_one()
    )
    # parte efectivo (prorrateada) de devoluciones de ventas mixtas
    cash_pay_subq = (
        select(
            POSTransactionPayment.transaction_id.label("tid"),
            func.sum(POSTransactionPayment.amount).label("cash_amt"),
        )
        .where(POSTransactionPayment.method == "cash")
        .group_by(POSTransactionPayment.transaction_id)
        .subquery()
    )
    mixed_cash_refund = Decimal(
        (await db.execute(
            select(func.coalesce(func.sum(
                POSTransaction.refunded_amount * cash_pay_subq.c.cash_amt / POSTransaction.total
            ), 0))
            .select_from(POSTransaction)
            .join(cash_pay_subq, cash_pay_subq.c.tid == POSTransaction.id)
            .where(
                POSTransaction.tenant_id == tenant_id,
                POSTransaction.session_id == session_id,
                POSTransaction.payment_method == "mixed",
                POSTransaction.refunded_amount > 0,
            )
        )).scalar_one()
    ).quantize(Decimal("0.01"))
    cash_refunds = cash_refunds + mixed_cash_refund
    cash_expenses = Decimal(
        (await db.execute(
            select(func.coalesce(func.sum(Expense.amount), 0)).where(
                Expense.tenant_id == tenant_id,
                Expense.session_id == session_id,
                Expense.paid_from_cash.is_(True),
            )
        )).scalar_one()
    )
    cash_credit_payments = Decimal(
        (await db.execute(
            select(func.coalesce(func.sum(ClientAccountEntry.amount), 0)).where(
                ClientAccountEntry.tenant_id == tenant_id,
                ClientAccountEntry.session_id == session_id,
                ClientAccountEntry.kind == "payment",
                ClientAccountEntry.payment_method == "cash",
            )
        )).scalar_one()
    )
    return {
        "by_method": by_method,
        "sales_total": sales_total,
        "sales_count": sales_count,
        "cash_sales": cash_sales,
        "membership_cash": membership_cash,
        "cash_refunds": cash_refunds,
        "cash_expenses": cash_expenses,
        "cash_credit_payments": cash_credit_payments,
    }


async def _session_credit_breakdown(db: AsyncSession, tenant_id: UUID, session_id: UUID) -> dict:
    """Fiados del turno: total otorgado (cargos) y abonos recibidos por medio.

    Los entries de cuenta corriente son inmutables, así que esto se recalcula
    igual para turnos abiertos o cerrados (no necesita snapshot).
    """
    credit_given = Decimal(
        (await db.execute(
            select(func.coalesce(func.sum(ClientAccountEntry.amount), 0)).where(
                ClientAccountEntry.tenant_id == tenant_id,
                ClientAccountEntry.session_id == session_id,
                ClientAccountEntry.kind == "charge",
            )
        )).scalar_one()
    )
    rows = (await db.execute(
        select(
            ClientAccountEntry.payment_method,
            func.count().label("count"),
            func.coalesce(func.sum(ClientAccountEntry.amount), 0).label("amount"),
        )
        .where(
            ClientAccountEntry.tenant_id == tenant_id,
            ClientAccountEntry.session_id == session_id,
            ClientAccountEntry.kind == "payment",
        )
        .group_by(ClientAccountEntry.payment_method)
    )).all()
    by_method = [
        CreditPaymentRow(
            method=r.payment_method or "other",
            label=_payment_label(r.payment_method or "other"),
            count=r.count,
            amount=Decimal(r.amount),
        )
        for r in rows
    ]
    by_method.sort(key=lambda x: x.method)
    return {"credit_given": credit_given, "credit_payments_by_method": by_method}


async def _build_session_response(db: AsyncSession, s: CashRegisterSession) -> CashSessionResponse:
    if s.status == CashSessionStatus.OPEN:
        c = await _session_cash_live(db, s.tenant_id, s.id)
        by_method = c["by_method"]
        sales_total, sales_count = c["sales_total"], c["sales_count"]
        cash_sales = c["cash_sales"]
        membership_cash, cash_refunds, cash_expenses = c["membership_cash"], c["cash_refunds"], c["cash_expenses"]
        cash_credit_payments = c["cash_credit_payments"]
    else:
        # Sesión cerrada: usar el snapshot guardado al cierre (sin recalcular).
        by_method = []
        if s.by_method_json:
            try:
                by_method = [PaymentMethodBreakdownRow(**r) for r in json.loads(s.by_method_json)]
            except (ValueError, TypeError):
                by_method = []
        if not by_method:
            by_method, _, _ = await _breakdown_rows(db, s.tenant_id, session_id=s.id)
        sales_total = sum((r.total for r in by_method), Decimal("0"))
        sales_count = sum((r.count for r in by_method), 0)
        cash_sales = s.cash_sales if s.cash_sales is not None else next(
            (r.total for r in by_method if r.payment_method == "cash"), Decimal("0")
        )
        membership_cash = s.membership_cash or Decimal("0")
        cash_refunds = s.cash_refunds or Decimal("0")
        cash_expenses = s.cash_expenses or Decimal("0")
        cash_credit_payments = s.cash_credit_payments or Decimal("0")

    credit = await _session_credit_breakdown(db, s.tenant_id, s.id)

    return CashSessionResponse(
        id=s.id,
        branch_id=s.branch_id,
        status=s.status.value if hasattr(s.status, "value") else s.status,
        opened_by=s.opened_by,
        opened_by_name=await _user_name(db, s.opened_by),
        opened_at=s.opened_at,
        opening_amount=s.opening_amount or Decimal("0"),
        closed_by=s.closed_by,
        closed_by_name=await _user_name(db, s.closed_by),
        closed_at=s.closed_at,
        closing_amount=s.closing_amount,
        expected_cash=s.expected_cash,
        difference=s.difference,
        notes=s.notes,
        sales_total=sales_total,
        sales_count=sales_count,
        cash_sales=cash_sales,
        membership_cash=membership_cash,
        cash_refunds=cash_refunds,
        cash_expenses=cash_expenses,
        cash_credit_payments=cash_credit_payments,
        by_method=by_method,
        credit_given=credit["credit_given"],
        credit_payments_by_method=credit["credit_payments_by_method"],
    )


async def _open_session_for_branch(
    db: AsyncSession, tenant_id: UUID, branch_id: Optional[UUID]
) -> Optional[CashRegisterSession]:
    q = select(CashRegisterSession).where(
        CashRegisterSession.tenant_id == tenant_id,
        CashRegisterSession.status == CashSessionStatus.OPEN,
    )
    q = q.where(
        CashRegisterSession.branch_id == branch_id
        if branch_id is not None
        else CashRegisterSession.branch_id.is_(None)
    )
    q = q.order_by(CashRegisterSession.opened_at.desc()).limit(1)
    return (await db.execute(q)).scalar_one_or_none()


@pos_router.get("/cash-sessions/current", response_model=Optional[CashSessionResponse])
async def get_current_cash_session(
    branch_id: Optional[UUID] = None,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception")),
):
    s = await _open_session_for_branch(db, ctx.tenant_id, branch_id)
    if not s:
        return None
    return await _build_session_response(db, s)


@pos_router.post("/cash-sessions/open", response_model=CashSessionResponse, status_code=201)
async def open_cash_session(
    body: CashSessionOpenIn,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    user=Depends(require_roles("owner", "admin", "reception")),
):
    existing = await _open_session_for_branch(db, ctx.tenant_id, body.branch_id)
    if existing:
        raise HTTPException(status_code=409, detail="Ya hay un turno de caja abierto para esta sucursal")

    now = _now()
    s = CashRegisterSession(
        id=uuid4(),
        tenant_id=ctx.tenant_id,
        branch_id=body.branch_id,
        status=CashSessionStatus.OPEN,
        opened_by=user.id,
        opened_at=now,
        opening_amount=body.opening_amount,
        notes=body.notes,
        created_at=now,
    )
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return await _build_session_response(db, s)


@pos_router.post("/cash-sessions/{session_id}/close", response_model=CashSessionResponse)
async def close_cash_session(
    session_id: UUID,
    body: CashSessionCloseIn,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    user=Depends(require_roles("owner", "admin", "reception")),
):
    s = (
        await db.execute(
            select(CashRegisterSession).where(
                CashRegisterSession.id == session_id,
                CashRegisterSession.tenant_id == ctx.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not s:
        raise HTTPException(status_code=404, detail="Turno de caja no encontrado")
    if s.status != CashSessionStatus.OPEN:
        raise HTTPException(status_code=400, detail="El turno de caja ya está cerrado")

    c = await _session_cash_live(db, ctx.tenant_id, s.id)
    cash_sales = c["cash_sales"]
    membership_cash = c["membership_cash"]
    cash_refunds = c["cash_refunds"]
    cash_expenses = c["cash_expenses"]
    cash_credit_payments = c["cash_credit_payments"]
    expected = compute_expected_cash(
        s.opening_amount or Decimal("0"),
        cash_sales,
        membership_cash,
        cash_credit_payments,
        cash_refunds,
        cash_expenses,
    )

    now = _now()
    s.status = CashSessionStatus.CLOSED
    s.closed_by = user.id
    s.closed_at = now
    s.closing_amount = body.closing_amount
    s.expected_cash = expected
    s.difference = cash_difference(body.closing_amount, expected)
    # Snapshot del arqueo (Etapa 1): congela los componentes al momento del cierre.
    s.cash_sales = cash_sales
    s.membership_cash = membership_cash
    s.cash_refunds = cash_refunds
    s.cash_expenses = cash_expenses
    s.cash_credit_payments = cash_credit_payments
    s.by_method_json = json.dumps([
        {
            "payment_method": r.payment_method,
            "label": r.label,
            "count": r.count,
            "subtotal": str(r.subtotal),
            "discount": str(r.discount),
            "total": str(r.total),
        }
        for r in c["by_method"]
    ])
    if body.notes:
        s.notes = f"{s.notes}\n{body.notes}" if s.notes else body.notes
    await db.commit()
    await db.refresh(s)
    return await _build_session_response(db, s)


@pos_router.get("/cash-sessions", response_model=List[CashSessionResponse])
async def list_cash_sessions(
    from_date: Optional[datetime] = None,
    to_date: Optional[datetime] = None,
    branch_id: Optional[UUID] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    q = select(CashRegisterSession).where(CashRegisterSession.tenant_id == ctx.tenant_id)
    if from_date:
        q = q.where(CashRegisterSession.opened_at >= from_date)
    if to_date:
        q = q.where(CashRegisterSession.opened_at <= to_date)
    if branch_id:
        q = q.where(CashRegisterSession.branch_id == branch_id)
    if status_filter:
        q = q.where(CashRegisterSession.status == status_filter)
    q = q.order_by(CashRegisterSession.opened_at.desc()).offset((page - 1) * size).limit(size)
    sessions = (await db.execute(q)).scalars().all()
    return [await _build_session_response(db, s) for s in sessions]


@pos_router.get("/cash-sessions/{session_id}", response_model=CashSessionResponse)
async def get_cash_session(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception")),
):
    s = (
        await db.execute(
            select(CashRegisterSession).where(
                CashRegisterSession.id == session_id,
                CashRegisterSession.tenant_id == ctx.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not s:
        raise HTTPException(status_code=404, detail="Turno de caja no encontrado")
    return await _build_session_response(db, s)


@pos_router.get("/sales-breakdown", response_model=SalesBreakdownResponse)
async def sales_breakdown(
    from_date: datetime,
    to_date: datetime,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception")),
):
    by_method, total, count = await _breakdown_rows(db, ctx.tenant_id, from_dt=from_date, to_dt=to_date)
    return SalesBreakdownResponse(
        from_date=from_date,
        to_date=to_date,
        total=total,
        transaction_count=count,
        by_method=by_method,
    )


# ─── Fiados / cuenta corriente de socios (Etapa 2) ──────────────────────────────

async def _client_or_404(db: AsyncSession, tenant_id: UUID, client_id: UUID) -> User:
    u = (await db.execute(
        select(User).where(
            User.id == client_id,
            User.tenant_id == tenant_id,
            User.role == UserRole.CLIENT,
        )
    )).scalar_one_or_none()
    if not u:
        raise HTTPException(status_code=404, detail="Socio no encontrado")
    return u


def _signed(kind: str, amount: Decimal) -> Decimal:
    """Cargo suma a la deuda, abono la resta."""
    return amount if kind == "charge" else -amount


async def _client_balance(db: AsyncSession, tenant_id: UUID, client_id: UUID) -> Decimal:
    """Saldo deudor vigente del socio: Σ cargos − Σ abonos."""
    return Decimal(
        (await db.execute(
            select(func.coalesce(func.sum(
                case((ClientAccountEntry.kind == "charge", ClientAccountEntry.amount),
                     else_=-ClientAccountEntry.amount)
            ), 0)).where(
                ClientAccountEntry.tenant_id == tenant_id,
                ClientAccountEntry.client_id == client_id,
            )
        )).scalar_one()
    )


@pos_router.get("/account/debtors", response_model=DebtorsResponse)
async def list_debtors(
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception")),
):
    """Socios con saldo deudor (cargos − abonos > 0)."""
    charges = func.coalesce(
        func.sum(
            case((ClientAccountEntry.kind == "charge", ClientAccountEntry.amount), else_=0)
        ), 0,
    )
    payments = func.coalesce(
        func.sum(
            case((ClientAccountEntry.kind == "payment", ClientAccountEntry.amount), else_=0)
        ), 0,
    )
    balance = charges - payments
    q = (
        select(
            ClientAccountEntry.client_id,
            User.first_name,
            User.last_name,
            User.email,
            User.phone,
            User.credit_limit,
            charges.label("charges_total"),
            payments.label("payments_total"),
            balance.label("balance"),
            func.max(ClientAccountEntry.created_at).label("last_entry_at"),
            func.min(
                case((ClientAccountEntry.kind == "charge", ClientAccountEntry.created_at))
            ).label("oldest_charge_at"),
        )
        .join(User, User.id == ClientAccountEntry.client_id)
        .where(ClientAccountEntry.tenant_id == ctx.tenant_id)
        .group_by(
            ClientAccountEntry.client_id,
            User.first_name, User.last_name, User.email, User.phone, User.credit_limit,
        )
        .having(balance > 0)
        .order_by(balance.desc())
    )
    rows = (await db.execute(q)).all()
    out: list[ClientDebtorRow] = []
    total_outstanding = Decimal("0")
    for r in rows:
        bal = Decimal(r.balance)
        total_outstanding += bal
        out.append(ClientDebtorRow(
            client_id=r.client_id,
            client_name=f"{r.first_name} {r.last_name}",
            email=r.email,
            phone=r.phone,
            charges_total=Decimal(r.charges_total),
            payments_total=Decimal(r.payments_total),
            balance=bal,
            credit_limit=r.credit_limit,
            last_entry_at=r.last_entry_at,
            oldest_charge_at=r.oldest_charge_at,
        ))
    return DebtorsResponse(rows=out, total_outstanding=total_outstanding)


@pos_router.get("/account/{client_id}/statement", response_model=ClientAccountStatementResponse)
async def client_account_statement(
    client_id: UUID,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin", "reception")),
):
    """Estado de cuenta del socio: movimientos en orden cronológico + saldo corriente."""
    client = await _client_or_404(db, ctx.tenant_id, client_id)
    entries = (await db.execute(
        select(ClientAccountEntry)
        .where(
            ClientAccountEntry.tenant_id == ctx.tenant_id,
            ClientAccountEntry.client_id == client_id,
        )
        .order_by(ClientAccountEntry.created_at.asc())
    )).scalars().all()

    creators = {e.created_by for e in entries if e.created_by}
    names: dict[UUID, str] = {}
    if creators:
        for u in (await db.execute(select(User).where(User.id.in_(creators)))).scalars().all():
            names[u.id] = f"{u.first_name} {u.last_name}"

    running = Decimal("0")
    rows: list[ClientAccountEntryResponse] = []
    for e in entries:
        running += _signed(e.kind, e.amount)
        rows.append(ClientAccountEntryResponse(
            id=e.id,
            kind=e.kind,
            amount=e.amount,
            payment_method=e.payment_method,
            pos_transaction_id=e.pos_transaction_id,
            notes=e.notes,
            created_by=e.created_by,
            created_by_name=names.get(e.created_by) if e.created_by else None,
            created_at=e.created_at,
            balance_after=running,
        ))
    rows.reverse()  # más reciente primero para la UI
    return ClientAccountStatementResponse(
        client_id=client.id,
        client_name=f"{client.first_name} {client.last_name}",
        balance=running,
        credit_limit=client.credit_limit,
        entries=rows,
    )


@pos_router.post("/account/{client_id}/payment", response_model=ClientAccountEntryResponse, status_code=201)
async def register_account_payment(
    client_id: UUID,
    body: AccountPaymentCreate,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    user=Depends(require_roles("owner", "admin", "reception")),
):
    """Registrar un abono (pago de deuda) de un socio. Si es en efectivo y hay
    una caja abierta en la sucursal, se imputa a su arqueo."""
    client = await _client_or_404(db, ctx.tenant_id, client_id)

    if not is_valid_credit_payment_method(body.payment_method):
        raise HTTPException(status_code=400, detail=f"Método de abono inválido: {body.payment_method}")

    # El abono se imputa al turno abierto de la sucursal (si existe), sea cual sea
    # el medio: así el cierre lo muestra separado por medio. Solo el efectivo entra
    # al efectivo esperado (cash_credit_payments filtra method='cash').
    open_session = await _open_session_for_branch(db, ctx.tenant_id, body.branch_id)
    session_id = open_session.id if open_session else None

    now = _now()
    entry = ClientAccountEntry(
        id=uuid4(),
        tenant_id=ctx.tenant_id,
        branch_id=body.branch_id,
        client_id=client_id,
        kind="payment",
        amount=body.amount,
        payment_method=body.payment_method,
        session_id=session_id,
        notes=body.notes,
        created_by=user.id,
        created_at=now,
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)

    # saldo vigente tras el abono
    balance = Decimal(
        (await db.execute(
            select(func.coalesce(func.sum(
                case((ClientAccountEntry.kind == "charge", ClientAccountEntry.amount),
                          else_=-ClientAccountEntry.amount)
            ), 0)).where(
                ClientAccountEntry.tenant_id == ctx.tenant_id,
                ClientAccountEntry.client_id == client_id,
            )
        )).scalar_one()
    )
    return ClientAccountEntryResponse(
        id=entry.id,
        kind=entry.kind,
        amount=entry.amount,
        payment_method=entry.payment_method,
        pos_transaction_id=entry.pos_transaction_id,
        notes=entry.notes,
        created_by=entry.created_by,
        created_by_name=f"{user.first_name} {user.last_name}",
        created_at=entry.created_at,
        balance_after=balance,
    )


@pos_router.patch("/account/{client_id}/credit-limit", response_model=ClientAccountStatementResponse)
async def set_client_credit_limit(
    client_id: UUID,
    body: CreditLimitUpdate,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    """Fijar / quitar el tope de deuda de un socio (None = sin límite)."""
    client = await _client_or_404(db, ctx.tenant_id, client_id)
    client.credit_limit = body.credit_limit
    await db.commit()
    # devuelve el estado de cuenta actualizado para refrescar la UI
    return await client_account_statement(client_id, db, ctx, _user)


# ─── Reportería del dueño (Etapa 0, solo lectura) ───────────────────────────────

_REPORT_DIMENSIONS = ("category", "product", "cashier")
_REPORT_GRANULARITIES = ("day", "week", "month")


def _margin_pct(revenue: Decimal, margin: Decimal) -> float:
    return float(round(margin / revenue * 100, 2)) if revenue else 0.0


def _tenant_tz_name(ctx: TenantContext) -> str:
    return ctx.tenant.timezone if ctx.tenant and ctx.tenant.timezone else "UTC"


def _report_row(key, label, sku, units, txc, revenue, cost) -> SalesReportRow:
    rev = Decimal(revenue)
    cst = Decimal(cost)
    margin = rev - cst
    return SalesReportRow(
        key=key,
        label=label,
        sku=sku,
        units=int(units),
        transaction_count=int(txc),
        revenue=rev,
        cost=cst,
        margin=margin,
        margin_pct=_margin_pct(rev, margin),
    )


@pos_router.get("/reports/summary", response_model=SalesSummaryResponse)
async def sales_report_summary(
    from_date: datetime,
    to_date: datetime,
    branch_id: Optional[UUID] = None,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    """KPIs del período: ventas, COGS, margen, devoluciones, gastos y utilidad."""
    tenant_id = ctx.tenant_id
    completed = [
        POSTransaction.tenant_id == tenant_id,
        POSTransaction.status == POSTransactionStatus.COMPLETED,
        POSTransaction.sold_at >= from_date,
        POSTransaction.sold_at <= to_date,
    ]
    if branch_id is not None:
        completed.append(POSTransaction.branch_id == branch_id)

    gross, discounts, gift_card, net, tx_count = (
        await db.execute(
            select(
                func.coalesce(func.sum(POSTransaction.subtotal), 0),
                func.coalesce(func.sum(POSTransaction.discount_amount), 0),
                func.coalesce(func.sum(POSTransaction.gift_card_amount), 0),
                func.coalesce(func.sum(POSTransaction.total), 0),
                func.count(POSTransaction.id),
            ).where(*completed)
        )
    ).one()

    cogs, units = (
        await db.execute(
            select(
                func.coalesce(func.sum(POSTransactionItem.unit_cost * POSTransactionItem.quantity), 0),
                func.coalesce(func.sum(POSTransactionItem.quantity), 0),
            )
            .select_from(POSTransactionItem)
            .join(POSTransaction, POSTransactionItem.transaction_id == POSTransaction.id)
            .where(*completed)
        )
    ).one()

    # Honestidad del margen: líneas vendidas sin costo registrado (unit_cost=0).
    units_without_cost, products_without_cost = (
        await db.execute(
            select(
                func.coalesce(func.sum(POSTransactionItem.quantity), 0),
                func.count(func.distinct(POSTransactionItem.product_id)),
            )
            .select_from(POSTransactionItem)
            .join(POSTransaction, POSTransactionItem.transaction_id == POSTransaction.id)
            .where(*completed, POSTransactionItem.unit_cost == 0)
        )
    ).one()

    # Devoluciones (totales + parciales) imputadas al período de la venta original.
    refund_conditions = [
        POSTransaction.tenant_id == tenant_id,
        POSTransaction.refunded_amount > 0,
        POSTransaction.sold_at >= from_date,
        POSTransaction.sold_at <= to_date,
    ]
    if branch_id is not None:
        refund_conditions.append(POSTransaction.branch_id == branch_id)
    refund_count, refund_total = (
        await db.execute(
            select(
                func.count(POSTransaction.id),
                func.coalesce(func.sum(POSTransaction.refunded_amount), 0),
            ).where(*refund_conditions)
        )
    ).one()

    exp_conditions = [
        Expense.tenant_id == tenant_id,
        Expense.expense_date >= from_date.date(),
        Expense.expense_date <= to_date.date(),
    ]
    if branch_id is not None:
        exp_conditions.append(Expense.branch_id == branch_id)
    expenses_total = (
        await db.execute(
            select(func.coalesce(func.sum(Expense.amount), 0)).where(*exp_conditions)
        )
    ).scalar_one()

    gross_d = Decimal(gross)
    cogs_d = Decimal(cogs)
    net_d = Decimal(net)
    margin = gross_d - cogs_d
    expenses_d = Decimal(expenses_total)
    by_method, _, _ = await _breakdown_rows(
        db, tenant_id, from_dt=from_date, to_dt=to_date, branch_id=branch_id
    )

    # Fiados (cuentas por cobrar). Cargos/abonos del período + deuda viva actual.
    credit_period_conditions = [
        ClientAccountEntry.tenant_id == tenant_id,
        ClientAccountEntry.created_at >= from_date,
        ClientAccountEntry.created_at <= to_date,
    ]
    if branch_id is not None:
        credit_period_conditions.append(ClientAccountEntry.branch_id == branch_id)
    credit_charged, credit_collected = (
        await db.execute(
            select(
                func.coalesce(func.sum(
                    case((ClientAccountEntry.kind == "charge", ClientAccountEntry.amount), else_=0)
                ), 0),
                func.coalesce(func.sum(
                    case(
                        ((ClientAccountEntry.kind == "payment") & (ClientAccountEntry.payment_method != "refund"),
                         ClientAccountEntry.amount),
                        else_=0,
                    )
                ), 0),
            ).where(*credit_period_conditions)
        )
    ).one()
    # Saldo por cobrar = snapshot actual de toda la deuda del tenant (no acotado al período).
    credit_outstanding = (
        await db.execute(
            select(func.coalesce(func.sum(
                case((ClientAccountEntry.kind == "charge", ClientAccountEntry.amount),
                     else_=-ClientAccountEntry.amount)
            ), 0)).where(ClientAccountEntry.tenant_id == tenant_id)
        )
    ).scalar_one()

    return SalesSummaryResponse(
        from_date=from_date,
        to_date=to_date,
        gross_sales=gross_d,
        discounts=Decimal(discounts),
        gift_card=Decimal(gift_card),
        net_sales=net_d,
        cogs=cogs_d,
        gross_margin=margin,
        margin_pct=_margin_pct(gross_d, margin),
        transaction_count=int(tx_count),
        units_sold=int(units),
        avg_ticket=(net_d / tx_count) if tx_count else Decimal("0"),
        units_without_cost=int(units_without_cost),
        products_without_cost=int(products_without_cost),
        refund_count=int(refund_count),
        refund_total=Decimal(refund_total),
        expenses_total=expenses_d,
        net_profit=margin - expenses_d,
        credit_charged=Decimal(credit_charged),
        credit_collected=Decimal(credit_collected),
        credit_outstanding=Decimal(credit_outstanding),
        by_method=by_method,
    )


@pos_router.get("/reports/by-dimension", response_model=SalesReportResponse)
async def sales_report_by_dimension(
    dimension: str,
    from_date: datetime,
    to_date: datetime,
    branch_id: Optional[UUID] = None,
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    """Desglose de ventas por categoría, producto (más vendidos) o cajero, con margen."""
    if dimension not in _REPORT_DIMENSIONS:
        raise HTTPException(
            status_code=422, detail=f"dimension debe ser uno de {_REPORT_DIMENSIONS}"
        )
    tenant_id = ctx.tenant_id

    units_e = func.coalesce(func.sum(POSTransactionItem.quantity), 0)
    txc_e = func.count(func.distinct(POSTransaction.id))
    revenue_e = func.coalesce(func.sum(POSTransactionItem.subtotal), 0)
    cost_e = func.coalesce(func.sum(POSTransactionItem.unit_cost * POSTransactionItem.quantity), 0)

    conditions = [
        POSTransaction.tenant_id == tenant_id,
        POSTransaction.status == POSTransactionStatus.COMPLETED,
        POSTransaction.sold_at >= from_date,
        POSTransaction.sold_at <= to_date,
    ]
    if branch_id is not None:
        conditions.append(POSTransaction.branch_id == branch_id)

    base = (
        select()
        .select_from(POSTransactionItem)
        .join(POSTransaction, POSTransactionItem.transaction_id == POSTransaction.id)
        .where(*conditions)
        .order_by(revenue_e.desc())
        .limit(limit)
    )

    rows: list[SalesReportRow] = []
    if dimension == "category":
        q = base.add_columns(
            ProductCategory.id, ProductCategory.name, units_e, txc_e, revenue_e, cost_e
        ).join(
            Product, POSTransactionItem.product_id == Product.id
        ).join(
            ProductCategory, Product.category_id == ProductCategory.id, isouter=True
        ).group_by(ProductCategory.id, ProductCategory.name)
        for cid, cname, u, t, r, c in (await db.execute(q)).all():
            rows.append(_report_row(str(cid) if cid else None, cname or "Sin categoría", None, u, t, r, c))

    elif dimension == "product":
        q = base.add_columns(
            Product.id, Product.name, Product.sku, units_e, txc_e, revenue_e, cost_e
        ).join(
            Product, POSTransactionItem.product_id == Product.id
        ).group_by(Product.id, Product.name, Product.sku)
        for pid, pname, sku, u, t, r, c in (await db.execute(q)).all():
            rows.append(_report_row(str(pid), pname, sku, u, t, r, c))

    else:  # cashier
        q = base.add_columns(
            POSTransaction.cashier_id, units_e, txc_e, revenue_e, cost_e
        ).group_by(POSTransaction.cashier_id)
        raw = (await db.execute(q)).all()
        ids = [cid for cid, *_ in raw if cid]
        names: dict = {}
        if ids:
            for u in (await db.execute(select(User).where(User.id.in_(ids)))).scalars().all():
                names[u.id] = f"{u.first_name} {u.last_name}"
        for cid, un, t, r, c in raw:
            label = names.get(cid, "Sin cajero") if cid else "Sin cajero"
            rows.append(_report_row(str(cid) if cid else None, label, None, un, t, r, c))

    total_rev = sum((r.revenue for r in rows), Decimal("0"))
    total_cost = sum((r.cost for r in rows), Decimal("0"))
    return SalesReportResponse(
        from_date=from_date,
        to_date=to_date,
        dimension=dimension,
        rows=rows,
        total_revenue=total_rev,
        total_cost=total_cost,
        total_margin=total_rev - total_cost,
    )


@pos_router.get("/reports/timeseries", response_model=SalesTimeseriesResponse)
async def sales_report_timeseries(
    from_date: datetime,
    to_date: datetime,
    granularity: str = "day",
    branch_id: Optional[UUID] = None,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    """Serie temporal de ventas y margen, agrupada en la zona horaria del tenant."""
    if granularity not in _REPORT_GRANULARITIES:
        raise HTTPException(
            status_code=422, detail=f"granularity debe ser uno de {_REPORT_GRANULARITIES}"
        )
    tenant_id = ctx.tenant_id
    tz_name = _tenant_tz_name(ctx)

    # date_trunc sobre la hora local del tenant (timestamptz → wall time local)
    bucket = func.date_trunc(granularity, func.timezone(tz_name, POSTransaction.sold_at))

    conditions = [
        POSTransaction.tenant_id == tenant_id,
        POSTransaction.status == POSTransactionStatus.COMPLETED,
        POSTransaction.sold_at >= from_date,
        POSTransaction.sold_at <= to_date,
    ]
    if branch_id is not None:
        conditions.append(POSTransaction.branch_id == branch_id)

    q = (
        select(
            bucket,
            func.coalesce(func.sum(POSTransactionItem.subtotal), 0),
            func.coalesce(func.sum(POSTransactionItem.unit_cost * POSTransactionItem.quantity), 0),
            func.count(func.distinct(POSTransaction.id)),
        )
        .select_from(POSTransactionItem)
        .join(POSTransaction, POSTransactionItem.transaction_id == POSTransaction.id)
        .where(*conditions)
        .group_by(bucket)
        .order_by(bucket)
    )
    points: list[SalesTimeseriesPoint] = []
    for period, revenue, cost, txc in (await db.execute(q)).all():
        rev = Decimal(revenue)
        cst = Decimal(cost)
        points.append(
            SalesTimeseriesPoint(
                period=period.date() if hasattr(period, "date") else period,
                revenue=rev,
                cost=cst,
                margin=rev - cst,
                transaction_count=int(txc),
            )
        )
    return SalesTimeseriesResponse(
        from_date=from_date,
        to_date=to_date,
        granularity=granularity,
        points=points,
    )


@pos_router.get("/reports/inventory", response_model=InventoryReportResponse)
async def inventory_report(
    branch_id: Optional[UUID] = None,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    """Stock actual valorizado (stock × costo) + bajo stock / quiebre.

    Valorización con el costo VIGENTE del producto (es stock de hoy, no ventas
    pasadas). Productos sin costo se marcan (has_cost=False) y NO se valorizan
    en total_value en vez de asumir cero.
    """
    tenant_id = ctx.tenant_id
    q = (
        select(Inventory, Product, ProductCategory.name)
        .join(Product, Product.id == Inventory.product_id)
        .outerjoin(ProductCategory, ProductCategory.id == Product.category_id)
        .where(Inventory.tenant_id == tenant_id, Product.is_active == True)  # noqa: E712
    )
    if branch_id is not None:
        q = q.where(Inventory.branch_id == branch_id)
    else:
        q = q.where(Inventory.branch_id.is_(None))
    q = q.order_by(Product.name)

    rows: list[InventoryReportRow] = []
    total_value = Decimal("0")
    total_units = 0
    low_count = out_count = without_cost = 0
    for inv, prod, cat_name in (await db.execute(q)).all():
        qty = int(inv.quantity)
        cost = Decimal(prod.cost or 0)
        has_cost = cost > 0
        out_of_stock = qty <= 0
        low_stock = (not out_of_stock) and qty <= int(inv.min_stock)
        value = (cost * qty) if (has_cost and qty > 0) else Decimal("0")
        if has_cost and qty > 0:
            total_value += value
        total_units += max(qty, 0)
        if out_of_stock:
            out_count += 1
        elif low_stock:
            low_count += 1
        if not has_cost and qty > 0:
            without_cost += 1
        rows.append(InventoryReportRow(
            product_id=prod.id,
            product_name=prod.name,
            sku=prod.sku,
            category=cat_name,
            quantity=qty,
            min_stock=int(inv.min_stock),
            unit_cost=cost,
            stock_value=value,
            low_stock=low_stock,
            out_of_stock=out_of_stock,
            has_cost=has_cost,
        ))
    return InventoryReportResponse(
        branch_id=branch_id,
        rows=rows,
        total_value=total_value,
        total_units=total_units,
        low_stock_count=low_count,
        out_of_stock_count=out_count,
        items_without_cost=without_cost,
    )


@pos_router.get("/reports/purchases", response_model=PurchasesReportResponse)
async def purchases_report(
    from_date: datetime,
    to_date: datetime,
    branch_id: Optional[UUID] = None,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    """Total comprado a proveedores en el período, por proveedor.

    Cuenta órdenes RECIBIDAS (el stock entró) por su received_at en el rango.
    """
    tenant_id = ctx.tenant_id
    conditions = [
        PurchaseOrder.tenant_id == tenant_id,
        PurchaseOrder.status == PurchaseOrderStatus.RECEIVED,
        PurchaseOrder.received_at >= from_date,
        PurchaseOrder.received_at <= to_date,
    ]
    if branch_id is not None:
        conditions.append(PurchaseOrder.branch_id == branch_id)

    q = (
        select(
            PurchaseOrder.supplier_id,
            Supplier.name,
            func.count(PurchaseOrder.id).label("orders_count"),
            func.coalesce(func.sum(PurchaseOrder.total_cost), 0).label("total"),
        )
        .outerjoin(Supplier, Supplier.id == PurchaseOrder.supplier_id)
        .where(*conditions)
        .group_by(PurchaseOrder.supplier_id, Supplier.name)
        .order_by(func.coalesce(func.sum(PurchaseOrder.total_cost), 0).desc())
    )
    rows: list[PurchaseSupplierRow] = []
    grand_total = Decimal("0")
    orders_count = 0
    for supplier_id, supplier_name, oc, total in (await db.execute(q)).all():
        t = Decimal(total)
        grand_total += t
        orders_count += int(oc)
        rows.append(PurchaseSupplierRow(
            supplier_id=supplier_id,
            supplier_name=supplier_name or "Sin proveedor",
            orders_count=int(oc),
            total=t,
        ))
    return PurchasesReportResponse(
        from_date=from_date,
        to_date=to_date,
        rows=rows,
        grand_total=grand_total,
        orders_count=orders_count,
    )


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
    # Si se paga de caja, imputarlo a la sesión abierta de esa sucursal (si la hay).
    session_id = None
    if body.paid_from_cash:
        open_session = await _open_session_for_branch(db, ctx.tenant_id, body.branch_id)
        session_id = open_session.id if open_session else None
    expense = Expense(
        id=uuid4(),
        tenant_id=ctx.tenant_id,
        branch_id=body.branch_id,
        category=body.category,
        amount=body.amount,
        description=body.description,
        receipt_url=body.receipt_url,
        expense_date=body.expense_date,
        paid_from_cash=body.paid_from_cash,
        session_id=session_id,
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
    data = body.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(expense, field, value)
    # Reconciliar el enlace a la caja si cambió paid_from_cash.
    if "paid_from_cash" in data:
        if expense.paid_from_cash and expense.session_id is None:
            open_session = await _open_session_for_branch(db, ctx.tenant_id, expense.branch_id)
            expense.session_id = open_session.id if open_session else None
        elif not expense.paid_from_cash:
            expense.session_id = None
    expense.updated_at = _now()
    await db.commit()
    await db.refresh(expense)
    return expense


@pos_router.get("/expenses/export")
async def export_expenses(
    category: Optional[str] = None,
    branch_id: Optional[UUID] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    """Exporta los gastos filtrados como CSV."""
    import csv
    from io import StringIO

    q = select(Expense).where(Expense.tenant_id == ctx.tenant_id)
    if category:
        q = q.where(Expense.category == category)
    if branch_id:
        q = q.where(Expense.branch_id == branch_id)
    if from_date:
        q = q.where(Expense.expense_date >= from_date)
    if to_date:
        q = q.where(Expense.expense_date <= to_date)
    q = q.order_by(Expense.expense_date.desc()).limit(10000)
    rows = (await db.execute(q)).scalars().all()

    if not rows:
        raise HTTPException(status_code=404, detail="No hay gastos para exportar con esos filtros")

    buf = StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(["Fecha", "Categoría", "Descripción", "Monto", "Recibo", "Sucursal"])
    for e in rows:
        writer.writerow([
            e.expense_date.isoformat() if e.expense_date else "",
            e.category or "",
            (e.description or "").replace("\n", " "),
            str(e.amount or 0),
            e.receipt_url or "",
            str(e.branch_id) if e.branch_id else "",
        ])

    today = datetime.now(timezone.utc).date().isoformat()
    body = "﻿" + buf.getvalue()  # BOM for Excel
    return Response(
        content=body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="gastos_nexo_{today}.csv"'},
    )


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
    receipt_url = expense.receipt_url
    await db.delete(expense)
    await db.commit()
    if receipt_url:
        await run_in_threadpool(delete_expense_receipt, receipt_url)


# ─── Expense receipt upload (Cloudflare R2) ──────────────────────────────────


@pos_router.post("/expenses/{expense_id}/receipt", response_model=ExpenseResponse)
async def upload_expense_receipt_endpoint(
    expense_id: UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    ctx: TenantContext = Depends(get_tenant_context),
    _user=Depends(require_roles("owner", "admin")),
):
    if file.content_type not in _ALLOWED_IMAGE_MIME:
        raise HTTPException(status_code=400, detail="Formato no soportado. Use JPG, PNG o WebP.")

    result = await db.execute(
        select(Expense).where(Expense.id == expense_id, Expense.tenant_id == ctx.tenant_id)
    )
    expense = result.scalar_one_or_none()
    if not expense:
        raise HTTPException(status_code=404, detail="Gasto no encontrado")

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Archivo vacío")

    previous_url = expense.receipt_url

    try:
        url = await run_in_threadpool(upload_expense_receipt, ctx.tenant_id, expense_id, raw)
    except ImageTooLargeError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except InvalidImageError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except R2ConfigError as exc:
        raise HTTPException(status_code=503, detail=f"Almacenamiento no configurado: {exc}") from exc

    expense.receipt_url = url
    expense.updated_at = _now()
    await db.commit()
    await db.refresh(expense)

    if previous_url and previous_url != expense.receipt_url:
        await run_in_threadpool(delete_expense_receipt, previous_url)

    return expense


@pos_router.delete("/expenses/{expense_id}/receipt", response_model=ExpenseResponse)
async def delete_expense_receipt_endpoint(
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
    previous_url = expense.receipt_url
    expense.receipt_url = None
    expense.updated_at = _now()
    await db.commit()
    await db.refresh(expense)

    if previous_url:
        await run_in_threadpool(delete_expense_receipt, previous_url)

    return expense
