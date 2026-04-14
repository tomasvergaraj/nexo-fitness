"""Pydantic schemas for POS domain."""

from datetime import datetime, date
from decimal import Decimal
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


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
    is_active: bool
    stock: Optional[int] = None   # inyectado desde inventory al listar
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


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
    cashier_id: UUID
    cashier_name: Optional[str] = None
    subtotal: Decimal
    discount_amount: Decimal
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
