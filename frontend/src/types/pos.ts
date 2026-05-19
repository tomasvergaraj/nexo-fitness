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
}

export interface POSTransaction {
  id: string;
  branch_id?: string | null;
  cashier_id?: string | null;
  cashier_name?: string | null;
  subtotal: number;
  discount_amount: number;
  total: number;
  payment_method: string;
  status: 'completed' | 'cancelled' | 'refunded';
  notes?: string | null;
  items: POSTransactionItem[];
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
  created_by?: string | null;
  created_at: string;
}
