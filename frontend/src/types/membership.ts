import type { Payment } from './payment';
import type { PlanKind } from './plan';

export interface Membership {
  id: string;
  user_id: string;
  plan_id: string;
  status: 'active' | 'expired' | 'cancelled' | 'frozen' | 'pending';
  starts_at: string;
  expires_at?: string;
  auto_renew: boolean;
  uses_remaining?: number | null;
  frozen_until?: string;
  stripe_subscription_id?: string;
  previous_membership_id?: string | null;
  sale_source?: string | null;
  payment_id?: string | null;
  payment_amount?: number | null;
  payment_currency?: string | null;
  payment_method?: string | null;
  payment_status?: string | null;
  paid_at?: string | null;
  created_at: string;
  user_name?: string;
  plan_name?: string;
  plan_kind?: PlanKind | null;
}

export interface MembershipManualSaleRequest {
  user_id: string;
  plan_id: string;
  starts_at: string;
  expires_at?: string | null;
  payment_method: 'cash' | 'transfer' | 'debit_card' | 'credit_card';
  amount?: number | null;
  currency: string;
  description?: string | null;
  notes?: string | null;
  auto_renew?: boolean;
}

export interface MembershipManualSaleResult {
  membership: Membership;
  payment: Payment;
  replaced_membership_ids: string[];
  effective_membership?: Membership | null;
  scheduled_membership?: Membership | null;
  scheduled: boolean;
}
