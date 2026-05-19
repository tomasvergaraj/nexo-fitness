import type { RegisterGymRequest } from './auth';
import type { Tenant } from './tenant';
import type { User } from './user';

export interface SaaSPlan {
  key: string;
  name: string;
  description: string;
  license_type: 'monthly' | 'quarterly' | 'semi_annual' | 'annual' | 'perpetual';
  currency: string;
  price: number;
  discount_pct?: number | null;
  tax_rate: number;
  tax_amount: number;
  total_price: number;
  billing_interval: 'month' | 'quarter' | 'semi_annual' | 'year' | 'manual';
  trial_days: number;
  max_members: number;
  max_branches: number;
  features: string[];
  highlighted: boolean;
  checkout_enabled: boolean;
  checkout_provider?: 'stripe' | 'fintoc' | 'webpay' | null;
}

export interface SaaSSignupRequest extends RegisterGymRequest {
  plan_key: string;
  success_url?: string;
  cancel_url?: string;
}

export interface AdminSaaSPlan extends SaaSPlan {
  id: string;
  stripe_price_id?: string;
  fintoc_enabled: boolean;
  webpay_enabled: boolean;
  is_active: boolean;
  is_public: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface AdminSaaSPlanCreateRequest {
  key: string;
  name: string;
  description: string;
  license_type: 'monthly' | 'quarterly' | 'semi_annual' | 'annual' | 'perpetual';
  currency: string;
  price: number;
  discount_pct?: number | null;
  billing_interval: 'month' | 'quarter' | 'semi_annual' | 'year' | 'manual';
  trial_days: number;
  max_members: number;
  max_branches: number;
  features: string[];
  stripe_price_id?: string | null;
  fintoc_enabled: boolean;
  webpay_enabled: boolean;
  highlighted: boolean;
  is_active: boolean;
  is_public: boolean;
  sort_order: number;
}

export interface AdminSaaSPlanUpdateRequest {
  name?: string;
  description?: string;
  license_type?: 'monthly' | 'quarterly' | 'semi_annual' | 'annual' | 'perpetual';
  currency?: string;
  price?: number;
  discount_pct?: number | null;
  billing_interval?: 'month' | 'quarter' | 'semi_annual' | 'year' | 'manual';
  trial_days?: number;
  max_members?: number;
  max_branches?: number;
  features?: string[];
  stripe_price_id?: string | null;
  fintoc_enabled?: boolean;
  webpay_enabled?: boolean;
  highlighted?: boolean;
  is_active?: boolean;
  is_public?: boolean;
  sort_order?: number;
}

export interface SaaSSignupResponse {
  tenant: Tenant;
  user: User;
  access_token: string;
  refresh_token: string;
  token_type: string;
  plan: SaaSPlan;
  billing_status: string;
  checkout_required: boolean;
  checkout_url?: string;
  checkout_session_id?: string;
  checkout_provider?: 'stripe' | 'fintoc' | 'webpay' | null;
  widget_token?: string;
  next_action: string;
  message: string;
}

export interface TenantBilling {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  status: 'active' | 'trial' | 'suspended' | 'expired' | 'cancelled';
  license_type: 'monthly' | 'quarterly' | 'semi_annual' | 'annual' | 'perpetual';
  plan_key: string;
  plan_name: string;
  currency: string;
  trial_ends_at?: string;
  license_expires_at?: string;
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
  checkout_enabled: boolean;
  is_active: boolean;
  max_members?: number;
  max_branches?: number;
  usage_active_clients: number;
  usage_active_branches: number;
  remaining_client_slots: number;
  remaining_branch_slots: number;
  over_client_limit: boolean;
  over_branch_limit: boolean;
  features: string[];
  owner_email?: string;
  owner_name?: string;
  created_at: string;
  next_plan_key?: string;
  next_plan_name?: string;
  next_plan_starts_at?: string;
  next_plan_paid?: boolean;
}

export interface HealthFactor {
  key: string;
  label: string;
  delta: number;
  kind: 'critical' | 'warn' | 'info' | 'ok';
}

export interface AdminTenantBilling extends TenantBilling {
  owner_user_id?: string;
  health_score?: number | null;
  health_level?: 'healthy' | 'watch' | 'at_risk' | 'critical' | null;
  health_factors?: HealthFactor[] | null;
  feature_flags_full?: Record<string, unknown> | null;
}

export interface OwnerPaymentItem {
  id: string;
  plan_key: string;
  plan_name: string;
  base_amount: number;
  promo_discount_amount: number;
  tax_rate: number;
  tax_amount: number;
  total_amount: number;
  currency: string;
  payment_method: string;
  external_reference?: string;
  paid_at?: string;
  starts_at: string;
  expires_at?: string;
  created_at: string;
}

export interface ReactivateResponse {
  scheduled: boolean;
  checkout_url?: string;
  next_plan_key?: string;
  next_plan_name?: string;
  next_plan_starts_at?: string;
}

export interface BillingQuote {
  valid: boolean;
  reason?: string | null;
  plan_key?: string | null;
  plan_name?: string | null;
  currency?: string | null;
  promo_code_id?: string | null;
  base_price?: number | null;
  promo_discount_amount?: number | null;
  taxable_subtotal?: number | null;
  tax_rate?: number | null;
  tax_amount?: number | null;
  total_amount?: number | null;
}

export interface PlatformPromoCode {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
  max_uses?: number | null;
  uses_count: number;
  expires_at?: string | null;
  is_active: boolean;
  plan_keys?: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface PlatformBillingPayment {
  id: string;
  tenant_id: string;
  plan_key: string;
  plan_name: string;
  promo_code_id?: string | null;
  base_amount: number;
  promo_discount_amount: number;
  tax_rate: number;
  tax_amount: number;
  total_amount: number;
  currency: string;
  payment_method: 'stripe' | 'fintoc' | 'webpay' | 'tuu' | 'transfer' | 'cash' | 'mercadopago' | 'debit_card' | 'credit_card' | 'other';
  external_reference?: string | null;
  notes?: string | null;
  paid_at?: string | null;
  starts_at: string;
  expires_at?: string | null;
  created_by?: string | null;
  created_at: string;
  folio_number?: number | null;
  invoice_status?: string | null;
  invoice_date?: string | null;
  refunded_amount?: number | null;
  refunded_at?: string | null;
  refund_reason?: string | null;
  refund_external_reference?: string | null;
  refund_status?: 'refunded' | 'partial' | 'manual' | 'failed' | null;
}

export interface AdminTenantManualPaymentRequest {
  plan_key: string;
  starts_at: string;
  payment_method: 'transfer';
  promo_code_id?: string | null;
  transfer_reference: string;
  notes?: string;
}

export interface AdminTenantManualPaymentResponse {
  tenant_id: string;
  tenant_status: string;
  plan_key: string;
  plan_name: string;
  license_expires_at?: string | null;
  payment: PlatformBillingPayment;
}
