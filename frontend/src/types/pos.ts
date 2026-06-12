export interface ProductCategory {
  id: string;
  name: string;
  color?: string | null;
  icon?: string | null;
  created_at: string;
}

export interface Product {
  id: string;
  name: string;
  description?: string | null;
  sku?: string | null;
  barcode?: string | null;
  price: number;
  cost: number;
  unit: string;
  category_id?: string | null;
  category_name?: string | null;
  image_url?: string | null;
  thumb_url?: string | null;
  is_active: boolean;
  stock?: number | null;
  created_at: string;
  updated_at: string;
}

export interface InventoryItem {
  id: string;
  product_id: string;
  product_name: string;
  branch_id?: string | null;
  quantity: number;
  min_stock: number;
  low_stock: boolean;
  updated_at: string;
}

export interface InventoryMovement {
  id: string;
  product_id: string;
  product_name?: string | null;
  branch_id?: string | null;
  movement_type: 'purchase' | 'sale' | 'adjustment' | 'return' | 'loss' | 'transfer';
  quantity: number;
  unit_cost?: number | null;
  reference_type?: string | null;
  notes?: string | null;
  created_by?: string | null;
  created_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  is_active: boolean;
  created_at: string;
}

export interface PurchaseOrderItem {
  id: string;
  product_id: string;
  product_name?: string | null;
  quantity_ordered: number;
  quantity_received?: number | null;
  unit_cost: number;
}

export interface PurchaseOrder {
  id: string;
  supplier_id?: string | null;
  supplier_name?: string | null;
  branch_id?: string | null;
  status: 'draft' | 'ordered' | 'received' | 'cancelled';
  total_cost?: number | null;
  notes?: string | null;
  ordered_at?: string | null;
  received_at?: string | null;
  items: PurchaseOrderItem[];
  created_at: string;
}

export interface POSTransactionItem {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  unit_cost: number;
  subtotal: number;
  refunded_quantity?: number;
}

export interface POSTransaction {
  id: string;
  branch_id?: string | null;
  cashier_id?: string | null;
  cashier_name?: string | null;
  client_id?: string | null;
  client_name?: string | null;
  subtotal: number;
  discount_amount: number;
  total: number;
  refunded_amount?: number;
  payment_method: string;
  status: 'completed' | 'cancelled' | 'refunded';
  notes?: string | null;
  items: POSTransactionItem[];
  payments?: { method: string; label: string; amount: number }[];
  sold_at: string;
}

export interface Expense {
  id: string;
  branch_id?: string | null;
  category: string;
  amount: number;
  description: string;
  receipt_url?: string | null;
  expense_date: string;
  paid_from_cash?: boolean;
  session_id?: string | null;
  created_by?: string | null;
  created_at: string;
}

export interface PaymentMethodBreakdownRow {
  payment_method: string;
  label: string;
  count: number;
  subtotal: number;
  discount: number;
  total: number;
}

export interface CashSession {
  id: string;
  branch_id?: string | null;
  status: 'open' | 'closed';
  opened_by?: string | null;
  opened_by_name?: string | null;
  opened_at: string;
  opening_amount: number;
  closed_by?: string | null;
  closed_by_name?: string | null;
  closed_at?: string | null;
  closing_amount?: number | null;
  expected_cash?: number | null;
  difference?: number | null;
  notes?: string | null;
  sales_total: number;
  sales_count: number;
  cash_sales: number;
  membership_cash: number;
  cash_refunds: number;
  cash_expenses: number;
  cash_credit_payments: number;
  by_method: PaymentMethodBreakdownRow[];
}

export interface SalesBreakdown {
  from_date: string;
  to_date: string;
  total: number;
  transaction_count: number;
  by_method: PaymentMethodBreakdownRow[];
}

// ─── Reportería del dueño (Etapa 0) ────────────────────────────────────────────
// La API serializa Decimal como string; usar parseApiNumber al consumir.

export interface PosSalesSummary {
  from_date: string;
  to_date: string;
  gross_sales: number;
  discounts: number;
  gift_card: number;
  net_sales: number;
  cogs: number;
  gross_margin: number;
  margin_pct: number;
  transaction_count: number;
  units_sold: number;
  avg_ticket: number;
  refund_count: number;
  refund_total: number;
  expenses_total: number;
  net_profit: number;
  credit_charged: number;
  credit_collected: number;
  credit_outstanding: number;
  by_method: PaymentMethodBreakdownRow[];
}

export interface PosSalesReportRow {
  key: string | null;
  label: string;
  sku?: string | null;
  units: number;
  transaction_count: number;
  revenue: number;
  cost: number;
  margin: number;
  margin_pct: number;
}

export interface PosSalesReport {
  from_date: string;
  to_date: string;
  dimension: 'category' | 'product' | 'cashier';
  rows: PosSalesReportRow[];
  total_revenue: number;
  total_cost: number;
  total_margin: number;
}

export interface PosSalesTimeseriesPoint {
  period: string;
  revenue: number;
  cost: number;
  margin: number;
  transaction_count: number;
}

export interface PosSalesTimeseries {
  from_date: string;
  to_date: string;
  granularity: 'day' | 'week' | 'month';
  points: PosSalesTimeseriesPoint[];
}

// ─── Fiados / cuenta corriente de socios (Etapa 2) ──────────────────────────────

export interface ClientDebtor {
  client_id: string;
  client_name: string;
  email?: string | null;
  phone?: string | null;
  charges_total: number;
  payments_total: number;
  balance: number;
  last_entry_at?: string | null;
}

export interface DebtorsResponse {
  rows: ClientDebtor[];
  total_outstanding: number;
}

export interface ClientAccountEntry {
  id: string;
  kind: 'charge' | 'payment';
  amount: number;
  payment_method?: string | null;
  pos_transaction_id?: string | null;
  notes?: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
  created_at: string;
  balance_after: number;
}

export interface ClientAccountStatement {
  client_id: string;
  client_name: string;
  balance: number;
  entries: ClientAccountEntry[];
}
