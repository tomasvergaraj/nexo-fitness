"""Pydantic schemas for POS domain."""

from datetime import datetime, date
from decimal import Decimal
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


# ─── ProductCategory ──────────────────────────────────────────────────────────

class ProductCategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    color: Optional[str] = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    icon: Optional[str] = Field(default=None, max_length=50)


class ProductCategoryUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    color: Optional[str] = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    icon: Optional[str] = Field(default=None, max_length=50)


class ProductCategoryResponse(BaseModel):
    id: UUID
    name: str
    color: Optional[str] = None
    icon: Optional[str] = None
    created_at: datetime
    model_config = {"from_attributes": True}


# ─── Product ──────────────────────────────────────────────────────────────────

class ProductCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    sku: Optional[str] = Field(default=None, max_length=100)
    barcode: Optional[str] = Field(default=None, max_length=100)
    price: Decimal = Field(ge=0)
    cost: Decimal = Field(ge=0)
    unit: str = "unit"
    category_id: Optional[UUID] = None
    image_url: Optional[str] = None
    initial_stock: Optional[int] = Field(default=None, ge=0, description="Stock inicial; crea el row de inventario con esta cantidad")
    min_stock: Optional[int] = Field(default=None, ge=0, description="Stock mínimo para alertas")


class ProductUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = None
    sku: Optional[str] = Field(default=None, max_length=100)
    barcode: Optional[str] = Field(default=None, max_length=100)
    price: Optional[Decimal] = Field(default=None, ge=0)
    cost: Optional[Decimal] = Field(default=None, ge=0)
    unit: Optional[str] = None
    category_id: Optional[UUID] = None
    image_url: Optional[str] = None
    is_active: Optional[bool] = None


class ProductResponse(BaseModel):
    id: UUID
    name: str
    description: Optional[str] = None
    sku: Optional[str] = None
    barcode: Optional[str] = None
    price: Decimal
    cost: Decimal
    unit: str
    category_id: Optional[UUID] = None
    category_name: Optional[str] = None
    image_url: Optional[str] = None
    thumb_url: Optional[str] = None
    is_active: bool
    stock: Optional[int] = None   # inyectado desde inventory al listar
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}

    @model_validator(mode="after")
    def _populate_thumb_url(self) -> "ProductResponse":
        if self.image_url and not self.thumb_url and self.image_url.endswith(".webp"):
            self.thumb_url = self.image_url[: -len(".webp")] + "_thumb.webp"
        return self


# ─── Inventory ────────────────────────────────────────────────────────────────

class StockAdjustIn(BaseModel):
    quantity: int = Field(description="Stock absoluto a establecer (no delta)")
    min_stock: Optional[int] = Field(default=None, ge=0)
    branch_id: Optional[UUID] = None
    notes: Optional[str] = None


class InventoryResponse(BaseModel):
    id: UUID
    product_id: UUID
    product_name: str
    branch_id: Optional[UUID] = None
    quantity: int
    min_stock: int
    low_stock: bool
    updated_at: datetime
    model_config = {"from_attributes": True}


class InventoryMovementResponse(BaseModel):
    id: UUID
    product_id: UUID
    product_name: Optional[str] = None
    branch_id: Optional[UUID] = None
    movement_type: str
    quantity: int
    unit_cost: Optional[Decimal] = None
    reference_type: Optional[str] = None
    notes: Optional[str] = None
    created_by: Optional[UUID] = None
    created_at: datetime
    model_config = {"from_attributes": True}


# ─── Supplier ─────────────────────────────────────────────────────────────────

class SupplierCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    contact_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    notes: Optional[str] = None


class SupplierUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    contact_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class SupplierResponse(BaseModel):
    id: UUID
    name: str
    contact_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    notes: Optional[str] = None
    is_active: bool
    created_at: datetime
    model_config = {"from_attributes": True}


# ─── PurchaseOrder ────────────────────────────────────────────────────────────

class PurchaseOrderItemIn(BaseModel):
    product_id: UUID
    quantity_ordered: int = Field(ge=1)
    unit_cost: Decimal = Field(ge=0)


class PurchaseOrderCreate(BaseModel):
    supplier_id: Optional[UUID] = None
    branch_id: Optional[UUID] = None
    notes: Optional[str] = None
    items: List[PurchaseOrderItemIn] = Field(min_length=1)


class PurchaseOrderReceiveIn(BaseModel):
    items: List[dict]  # [{product_id, quantity_received}]
    notes: Optional[str] = None


class PurchaseOrderItemResponse(BaseModel):
    id: UUID
    product_id: UUID
    product_name: Optional[str] = None
    quantity_ordered: int
    quantity_received: Optional[int] = None
    unit_cost: Decimal
    model_config = {"from_attributes": True}


class PurchaseOrderResponse(BaseModel):
    id: UUID
    supplier_id: Optional[UUID] = None
    supplier_name: Optional[str] = None
    branch_id: Optional[UUID] = None
    status: str
    total_cost: Optional[Decimal] = None
    notes: Optional[str] = None
    ordered_at: Optional[datetime] = None
    received_at: Optional[datetime] = None
    items: List[PurchaseOrderItemResponse] = []
    created_at: datetime
    model_config = {"from_attributes": True}


# ─── POSTransaction ───────────────────────────────────────────────────────────

class POSTransactionItemIn(BaseModel):
    product_id: UUID
    quantity: int = Field(ge=1)


class POSTransactionCreate(BaseModel):
    items: List[POSTransactionItemIn] = Field(min_length=1)
    payment_method: str = "cash"
    discount_amount: Decimal = Decimal("0")
    gift_card_code: Optional[str] = None
    branch_id: Optional[UUID] = None
    notes: Optional[str] = None


class POSTransactionItemResponse(BaseModel):
    id: UUID
    product_id: UUID
    product_name: str
    quantity: int
    unit_price: Decimal
    unit_cost: Decimal
    subtotal: Decimal
    model_config = {"from_attributes": True}


class POSTransactionResponse(BaseModel):
    id: UUID
    branch_id: Optional[UUID] = None
    cashier_id: Optional[UUID] = None
    cashier_name: Optional[str] = None
    subtotal: Decimal
    discount_amount: Decimal
    gift_card_amount: Decimal = Decimal("0")
    total: Decimal
    payment_method: str
    status: str
    notes: Optional[str] = None
    items: List[POSTransactionItemResponse] = []
    sold_at: datetime
    model_config = {"from_attributes": True}


# ─── Expense ──────────────────────────────────────────────────────────────────

class ExpenseCreate(BaseModel):
    category: str
    amount: Decimal = Field(ge=0)
    description: str = Field(min_length=1, max_length=500)
    expense_date: date
    branch_id: Optional[UUID] = None
    receipt_url: Optional[str] = None


class ExpenseUpdate(BaseModel):
    category: Optional[str] = None
    amount: Optional[Decimal] = Field(default=None, ge=0)
    description: Optional[str] = Field(default=None, min_length=1, max_length=500)
    expense_date: Optional[date] = None
    branch_id: Optional[UUID] = None
    receipt_url: Optional[str] = None


class ExpenseResponse(BaseModel):
    id: UUID
    branch_id: Optional[UUID] = None
    category: str
    amount: Decimal
    description: str
    receipt_url: Optional[str] = None
    expense_date: date
    created_by: Optional[UUID] = None
    created_at: datetime
    model_config = {"from_attributes": True}


# ─── CashRegisterSession (turno de caja) ────────────────────────────────────────

class CashSessionOpenIn(BaseModel):
    opening_amount: Decimal = Field(default=Decimal("0"), ge=0)
    branch_id: Optional[UUID] = None
    notes: Optional[str] = Field(default=None, max_length=1000)


class CashSessionCloseIn(BaseModel):
    closing_amount: Decimal = Field(ge=0)   # efectivo contado al cierre
    notes: Optional[str] = Field(default=None, max_length=1000)


class PaymentMethodBreakdownRow(BaseModel):
    payment_method: str
    label: str
    count: int
    subtotal: Decimal
    discount: Decimal
    total: Decimal


class CashSessionResponse(BaseModel):
    id: UUID
    branch_id: Optional[UUID] = None
    status: str
    opened_by: Optional[UUID] = None
    opened_by_name: Optional[str] = None
    opened_at: datetime
    opening_amount: Decimal
    closed_by: Optional[UUID] = None
    closed_by_name: Optional[str] = None
    closed_at: Optional[datetime] = None
    closing_amount: Optional[Decimal] = None
    expected_cash: Optional[Decimal] = None
    difference: Optional[Decimal] = None
    notes: Optional[str] = None
    # agregados calculados sobre las ventas del turno
    sales_total: Decimal = Decimal("0")
    sales_count: int = 0
    cash_sales: Decimal = Decimal("0")
    by_method: List[PaymentMethodBreakdownRow] = []


class SalesBreakdownResponse(BaseModel):
    from_date: datetime
    to_date: datetime
    total: Decimal
    transaction_count: int
    by_method: List[PaymentMethodBreakdownRow] = []
