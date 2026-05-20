export type PlanKind = 'subscription' | 'punch_pass' | 'drop_in';

export const PLAN_KIND_LABELS: Record<PlanKind, string> = {
  subscription: 'Suscripción',
  punch_pass: 'Pack de clases',
  drop_in: 'Pase del día',
};

export interface Plan {
  id: string;
  name: string;
  description?: string;
  price: number;
  discount_pct?: number | null;
  currency: string;
  duration_type: 'monthly' | 'annual' | 'perpetual' | 'custom';
  duration_days?: number;
  plan_kind?: PlanKind;
  total_uses?: number | null;
  max_reservations_per_week?: number;
  max_reservations_per_month?: number;
  is_active: boolean;
  is_featured: boolean;
  is_trial?: boolean;
  auto_renew: boolean;
  created_at: string;
}
