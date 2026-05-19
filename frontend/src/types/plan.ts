export interface Plan {
  id: string;
  name: string;
  description?: string;
  price: number;
  discount_pct?: number | null;
  currency: string;
  duration_type: 'monthly' | 'annual' | 'perpetual' | 'custom';
  duration_days?: number;
  max_reservations_per_week?: number;
  max_reservations_per_month?: number;
  is_active: boolean;
  is_featured: boolean;
  is_trial?: boolean;
  auto_renew: boolean;
  created_at: string;
}
