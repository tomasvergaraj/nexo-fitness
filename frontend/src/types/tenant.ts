export interface Tenant {
  id: string;
  name: string;
  slug: string;
  email: string;
  status: 'active' | 'suspended' | 'trial' | 'expired' | 'cancelled';
  license_type: 'monthly' | 'quarterly' | 'semi_annual' | 'annual' | 'perpetual';
  is_active: boolean;
  created_at: string;
}

export interface TenantBranding {
  logo_url?: string;
  primary_color?: string;
  secondary_color?: string;
  custom_domain?: string;
  support_email?: string;
  support_phone?: string;
  marketplace_headline?: string;
  marketplace_description?: string;
}

export interface TenantSettings {
  slug: string;
  gym_name: string;
  email: string;
  phone?: string;
  city?: string;
  address?: string;
  primary_color?: string;
  secondary_color?: string;
  logo_url?: string;
  custom_domain?: string;
  billing_email?: string;
  support_email?: string;
  support_phone?: string;
  public_api_key?: string;
  marketplace_headline?: string;
  marketplace_description?: string;
  reminder_emails: boolean;
  reminder_whatsapp: boolean;
  staff_can_edit_plans: boolean;
  two_factor_required: boolean;
  public_checkout_enabled: boolean;
  referral_reward_enabled: boolean;
  referral_reward_days: number;
  branding: TenantBranding;
}

export interface PaymentProviderAccount {
  id: string;
  provider: 'stripe' | 'mercadopago' | 'webpay' | 'fintoc' | 'tuu' | 'manual';
  status: 'pending' | 'connected' | 'disabled';
  account_label?: string;
  public_identifier?: string;
  checkout_base_url?: string;
  metadata: Record<string, unknown>;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface TenantPublicProfile {
  tenant_id: string;
  tenant_slug: string;
  tenant_name: string;
  city?: string;
  address?: string;
  phone?: string;
  email?: string;
  branding: TenantBranding;
  branches: Array<{ id: string; name: string; city?: string; address?: string; phone?: string }>;
  featured_plans: Array<{
    id: string;
    name: string;
    description?: string;
    price: number;
    currency: string;
    duration_type: string;
    duration_days?: number;
    is_featured: boolean;
    discount_pct?: number | null;
  }>;
  upcoming_classes: Array<{
    id: string;
    name: string;
    class_type?: string;
    start_time: string;
    modality: string;
    branch_id?: string;
    branch_name?: string;
    capacity: number;
    bookings: number;
  }>;
  checkout_enabled: boolean;
}

export interface PublicCheckoutSession {
  provider: string;
  status: string;
  checkout_url: string;
  payment_link_url: string;
  qr_payload: string;
  session_reference: string;
}
