export interface ReportsOverview {
  revenue_total: number;
  active_members: number;
  renewal_rate: number;
  churn_rate: number;
  revenue_series: { label: string; value: number }[];
  members_series: { label: string; value: number }[];
  revenue_by_plan: { name: string; value: number; color: string }[];
  attendance_by_day: { label: string; value: number }[];
  occupancy_by_class: { name: string; occupancy: number }[];
  // POS & P&L fields
  pos_revenue: number;
  pos_revenue_series: { label: string; value: number }[];
  pos_cogs: number;
  pos_gross_profit: number;
  pos_gross_margin_pct: number;
  top_products: { name: string; revenue: number; units_sold: number }[];
  total_expenses: number;
  expenses_by_category: { category: string; label: string; amount: number }[];
  expense_series: { label: string; value: number }[];
  total_revenue: number;
  net_profit: number;
  net_margin_pct: number;
}
