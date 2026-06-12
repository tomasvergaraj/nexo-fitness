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


class POSPaymentSplitIn(BaseModel):
    method: str
    amount: Decimal = Field(gt=0)


class POSTransactionCreate(BaseModel):
    items: List[POSTransactionItemIn] = Field(min_length=1)
    payment_method: str = "cash"
    discount_amount: Decimal = Decimal("0")
    gift_card_code: Optional[str] = None
    branch_id: Optional[UUID] = None
    notes: Optional[str] = None
    # Socio al que se fía la venta. Obligatorio si payment_method='credit'.
    client_id: Optional[UUID] = None
    # Pago mixto: desglose por método. Si se envía (≥1 línea), la venta es mixta;
    # la suma debe igualar el total. No combinable con fiado ni gift card.
    payments: Optional[List[POSPaymentSplitIn]] = None


class POSTransactionItemResponse(BaseModel):
    id: UUID
    product_id: UUID
    product_name: str
    quantity: int
    unit_price: Decimal
    unit_cost: Decimal
    subtotal: Decimal
    refunded_quantity: int = 0
    model_config = {"from_attributes": True}


class POSRefundItemIn(BaseModel):
    item_id: UUID
    quantity: int = Field(ge=1)


class POSRefundRequest(BaseModel):
    """Devolución. Sin items = devolución total (lo no devuelto aún)."""
    items: Optional[List[POSRefundItemIn]] = None
    notes: Optional[str] = Field(default=None, max_length=1000)


class POSPaymentSplitResponse(BaseModel):
    method: str
    label: str
    amount: Decimal


class POSTransactionResponse(BaseModel):
    id: UUID
    branch_id: Optional[UUID] = None
    cashier_id: Optional[UUID] = None
    cashier_name: Optional[str] = None
    client_id: Optional[UUID] = None
    client_name: Optional[str] = None
    subtotal: Decimal
    discount_amount: Decimal
    gift_card_amount: Decimal = Decimal("0")
    total: Decimal
    refunded_amount: Decimal = Decimal("0")
    payment_method: str
    status: str
    notes: Optional[str] = None
    items: List[POSTransactionItemResponse] = []
    payments: List[POSPaymentSplitResponse] = []   # solo ventas mixtas
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
    paid_from_cash: bool = False   # pagado con efectivo de la caja → entra al arqueo


class ExpenseUpdate(BaseModel):
    category: Optional[str] = None
    amount: Optional[Decimal] = Field(default=None, ge=0)
    description: Optional[str] = Field(default=None, min_length=1, max_length=500)
    expense_date: Optional[date] = None
    branch_id: Optional[UUID] = None
    receipt_url: Optional[str] = None
    paid_from_cash: Optional[bool] = None


class ExpenseResponse(BaseModel):
    id: UUID
    branch_id: Optional[UUID] = None
    category: str
    amount: Decimal
    description: str
    receipt_url: Optional[str] = None
    expense_date: date
    paid_from_cash: bool = False
    session_id: Optional[UUID] = None
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
    # Arqueo detallado (Etapa 1)
    membership_cash: Decimal = Decimal("0")    # efectivo de membresías imputado a la caja
    cash_refunds: Decimal = Decimal("0")       # devoluciones POS en efectivo
    cash_expenses: Decimal = Decimal("0")      # gastos pagados de caja
    cash_credit_payments: Decimal = Decimal("0")  # abonos de fiados en efectivo
    by_method: List[PaymentMethodBreakdownRow] = []


class SalesBreakdownResponse(BaseModel):
    from_date: datetime
    to_date: datetime
    total: Decimal
    transaction_count: int
    by_method: List[PaymentMethodBreakdownRow] = []


# ─── Reportería del dueño (Etapa 0, solo lectura) ───────────────────────────────

class SalesSummaryResponse(BaseModel):
    """KPIs del período: ventas, COGS, margen y resultado tras gastos."""
    from_date: datetime
    to_date: datetime
    gross_sales: Decimal = Decimal("0")        # suma de subtotales (antes de descuento)
    discounts: Decimal = Decimal("0")          # descuentos otorgados
    gift_card: Decimal = Decimal("0")          # cubierto por gift cards
    net_sales: Decimal = Decimal("0")          # total cobrado (subtotal - descuento - gift card)
    cogs: Decimal = Decimal("0")               # costo de lo vendido (unit_cost * cantidad)
    gross_margin: Decimal = Decimal("0")       # gross_sales - cogs
    margin_pct: float = 0.0                     # gross_margin / gross_sales * 100
    transaction_count: int = 0
    units_sold: int = 0
    avg_ticket: Decimal = Decimal("0")         # net_sales / transaction_count
    refund_count: int = 0
    refund_total: Decimal = Decimal("0")       # total de transacciones reembolsadas
    expenses_total: Decimal = Decimal("0")     # gastos del período
    net_profit: Decimal = Decimal("0")         # gross_margin - expenses_total
    # Fiados (cuentas por cobrar). Informativo: las ventas fiadas YA cuentan en
    # net_sales/margen al venderse; aquí se ven los cobros y la deuda viva.
    credit_charged: Decimal = Decimal("0")     # fiado otorgado en el período (cargos)
    credit_collected: Decimal = Decimal("0")   # abonos cobrados en el período
    credit_outstanding: Decimal = Decimal("0") # saldo total por cobrar (snapshot actual)
    by_method: List[PaymentMethodBreakdownRow] = []


class SalesReportRow(BaseModel):
    """Fila de un desglose por dimensión (categoría / producto / cajero)."""
    key: Optional[str] = None                  # id de la dimensión (None = sin categoría)
    label: str
    sku: Optional[str] = None                  # solo productos
    units: int = 0                             # unidades vendidas
    transaction_count: int = 0                 # transacciones distintas
    revenue: Decimal = Decimal("0")            # ingreso bruto (subtotal de ítems)
    cost: Decimal = Decimal("0")               # COGS
    margin: Decimal = Decimal("0")             # revenue - cost
    margin_pct: float = 0.0


class SalesReportResponse(BaseModel):
    from_date: datetime
    to_date: datetime
    dimension: str                             # 'category' | 'product' | 'cashier'
    rows: List[SalesReportRow] = []
    total_revenue: Decimal = Decimal("0")
    total_cost: Decimal = Decimal("0")
    total_margin: Decimal = Decimal("0")


class SalesTimeseriesPoint(BaseModel):
    period: date                               # día/semana/mes (zona horaria del tenant)
    revenue: Decimal = Decimal("0")
    cost: Decimal = Decimal("0")
    margin: Decimal = Decimal("0")
    transaction_count: int = 0


class SalesTimeseriesResponse(BaseModel):
    from_date: datetime
    to_date: datetime
    granularity: str                           # 'day' | 'week' | 'month'
    points: List[SalesTimeseriesPoint] = []


# ─── Fiados / cuenta corriente de socios (Etapa 2) ──────────────────────────────

class AccountPaymentCreate(BaseModel):
    """Registrar un abono (pago de deuda) de un socio."""
    amount: Decimal = Field(gt=0)
    payment_method: str = "cash"
    branch_id: Optional[UUID] = None
    notes: Optional[str] = Field(default=None, max_length=1000)


class ClientDebtorRow(BaseModel):
    client_id: UUID
    client_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    charges_total: Decimal = Decimal("0")
    payments_total: Decimal = Decimal("0")
    balance: Decimal = Decimal("0")            # charges − payments (deuda vigente)
    last_entry_at: Optional[datetime] = None


class DebtorsResponse(BaseModel):
    rows: List[ClientDebtorRow] = []
    total_outstanding: Decimal = Decimal("0")  # suma de saldos positivos


class ClientAccountEntryResponse(BaseModel):
    id: UUID
    kind: str                                  # 'charge' | 'payment'
    amount: Decimal
    payment_method: Optional[str] = None
    pos_transaction_id: Optional[UUID] = None
    notes: Optional[str] = None
    created_by: Optional[UUID] = None
    created_by_name: Optional[str] = None
    created_at: datetime
    balance_after: Decimal = Decimal("0")      # saldo acumulado tras este movimiento
    model_config = {"from_attributes": True}


class ClientAccountStatementResponse(BaseModel):
    client_id: UUID
    client_name: str
    balance: Decimal = Decimal("0")
    entries: List[ClientAccountEntryResponse] = []
