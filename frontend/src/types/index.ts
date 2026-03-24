/* ─── Auth ───────────────────────────────────────────────────── */

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user: User;
}

export interface RegisterGymRequest {
  gym_name: string;
  slug: string;
  email: string;
  phone?: string;
  address?: string;
  city?: string;
  country: string;
  timezone: string;
  currency: string;
  license_type: string;
  owner_first_name: string;
  owner_last_name: string;
  owner_email: string;
  owner_password: string;
}

export interface SaaSPlan {
  key: string;
  name: string;
  description: string;
  license_type: 'monthly' | 'annual' | 'perpetual';
  currency: string;
  price: number;
  billing_interval: 'month' | 'year' | 'manual';
  trial_days: number;
  max_members: number;
  max_branches: number;
  features: string[];
  highlighted: boolean;
  checkout_enabled: boolean;
}

export interface SaaSSignupRequest extends RegisterGymRequest {
  plan_key: string;
  success_url?: string;
  cancel_url?: string;
}

export interface AdminSaaSPlan extends SaaSPlan {
  id: string;
  stripe_price_id?: string;
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
  license_type: 'monthly' | 'annual' | 'perpetual';
  currency: string;
  price: number;
  billing_interval: 'month' | 'year' | 'manual';
  trial_days: number;
  max_members: number;
  max_branches: number;
  features: string[];
  stripe_price_id?: string | null;
  highlighted: boolean;
  is_active: boolean;
  is_public: boolean;
  sort_order: number;
}

export interface AdminSaaSPlanUpdateRequest {
  name?: string;
  description?: string;
  license_type?: 'monthly' | 'annual' | 'perpetual';
  currency?: string;
  price?: number;
  billing_interval?: 'month' | 'year' | 'manual';
  trial_days?: number;
  max_members?: number;
  max_branches?: number;
  features?: string[];
  stripe_price_id?: string | null;
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
  next_action: string;
  message: string;
}

export interface TenantBilling {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  status: 'active' | 'trial' | 'suspended' | 'expired' | 'cancelled';
  license_type: 'monthly' | 'annual' | 'perpetual';
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
  features: string[];
  owner_email?: string;
  owner_name?: string;
  created_at: string;
}

export interface AdminTenantBilling extends TenantBilling {
  owner_user_id?: string;
}

/* ─── User ───────────────────────────────────────────────────── */

export interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone?: string;
  avatar_url?: string;
  role: UserRole;
  is_active: boolean;
  is_verified: boolean;
  created_at: string;
  date_of_birth?: string;
  gender?: string;
  emergency_contact?: string;
  emergency_phone?: string;
  medical_notes?: string;
  tags?: string;
  internal_notes?: string;
  last_login_at?: string;
}

export type UserRole = 'superadmin' | 'owner' | 'admin' | 'reception' | 'trainer' | 'marketing' | 'client';

/* ─── Tenant ─────────────────────────────────────────────────── */

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  email: string;
  status: 'active' | 'suspended' | 'trial' | 'expired' | 'cancelled';
  license_type: 'monthly' | 'annual' | 'perpetual';
  is_active: boolean;
  created_at: string;
}

/* ─── Branch ─────────────────────────────────────────────────── */

export interface Branch {
  id: string;
  name: string;
  address?: string;
  city?: string;
  phone?: string;
  is_active: boolean;
  created_at: string;
}

/* ─── Plan ───────────────────────────────────────────────────── */

export interface Plan {
  id: string;
  name: string;
  description?: string;
  price: number;
  currency: string;
  duration_type: 'monthly' | 'annual' | 'perpetual' | 'custom';
  duration_days?: number;
  max_reservations_per_week?: number;
  is_active: boolean;
  is_featured: boolean;
  auto_renew: boolean;
  created_at: string;
}

/* ─── GymClass ───────────────────────────────────────────────── */

export interface GymClass {
  id: string;
  name: string;
  description?: string;
  class_type?: string;
  modality: 'in_person' | 'online' | 'hybrid';
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  instructor_id?: string;
  branch_id?: string;
  start_time: string;
  end_time: string;
  max_capacity: number;
  current_bookings: number;
  waitlist_enabled: boolean;
  online_link?: string;
  color?: string;
  created_at: string;
}

/* ─── Reservation ────────────────────────────────────────────── */

export interface Reservation {
  id: string;
  user_id: string;
  gym_class_id: string;
  status: 'confirmed' | 'waitlisted' | 'cancelled' | 'no_show' | 'attended';
  waitlist_position?: number;
  created_at: string;
}

/* ─── CheckIn ────────────────────────────────────────────────── */

export interface CheckIn {
  id: string;
  user_id: string;
  gym_class_id?: string;
  check_type: string;
  checked_in_at: string;
}

/* ─── Payment ────────────────────────────────────────────────── */

export interface Payment {
  id: string;
  user_id: string;
  amount: number;
  currency: string;
  status: 'pending' | 'completed' | 'failed' | 'refunded' | 'cancelled';
  method: string;
  description?: string;
  paid_at?: string;
  created_at: string;
}

/* ─── Campaign ───────────────────────────────────────────────── */

export interface Campaign {
  id: string;
  name: string;
  subject?: string;
  content?: string;
  channel: 'email' | 'whatsapp' | 'sms';
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled';
  total_recipients: number;
  total_sent: number;
  total_opened: number;
  total_clicked: number;
  segment_filter?: {
    status?: 'all' | 'active' | 'inactive';
    search?: string;
  };
  notification_type: 'info' | 'warning' | 'success' | 'error';
  action_url?: string;
  send_push: boolean;
  scheduled_at?: string;
  sent_at?: string;
  last_dispatch_trigger?: 'manual' | 'scheduled';
  last_dispatch_attempted_at?: string;
  last_dispatch_finished_at?: string;
  last_dispatch_error?: string;
  dispatch_attempts: number;
  created_at: string;
}

export interface CampaignOverview {
  total_campaigns: number;
  scheduled_pending: number;
  sending_now: number;
  sent_total: number;
  opened_total: number;
  clicked_total: number;
  manual_runs: number;
  scheduler_runs: number;
  scheduler_failures: number;
  pending_push_receipts: number;
  failed_push_receipts: number;
  open_rate: number;
  click_rate: number;
}

/* ─── Dashboard ──────────────────────────────────────────────── */

export interface DashboardMetrics {
  revenue_today: number;
  revenue_week: number;
  revenue_month: number;
  active_members: number;
  total_members: number;
  classes_today: number;
  reservations_today: number;
  checkins_today: number;
  pending_payments: number;
  expiring_memberships: number;
  occupancy_rate: number;
  churn_rate: number;
  recent_checkins: CheckIn[];
  revenue_chart: { label: string; value: number }[];
  class_occupancy_chart: { name: string; occupancy: number }[];
}

export interface Membership {
  id: string;
  user_id: string;
  plan_id: string;
  status: 'active' | 'expired' | 'cancelled' | 'frozen' | 'pending';
  starts_at: string;
  expires_at?: string;
  auto_renew: boolean;
  frozen_until?: string;
  stripe_subscription_id?: string;
  created_at: string;
  user_name?: string;
  plan_name?: string;
}

export interface SupportInteraction {
  id: string;
  user_id?: string;
  channel: 'whatsapp' | 'email' | 'phone' | 'in_person';
  subject?: string;
  notes?: string;
  resolved: boolean;
  handled_by?: string;
  created_at: string;
  client_name?: string;
  handler_name?: string;
}

export interface TrainingProgram {
  id: string;
  name: string;
  description?: string;
  trainer_id?: string;
  trainer_name?: string;
  program_type?: string;
  duration_weeks?: number;
  schedule: Array<Record<string, unknown>>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TenantBranding {
  logo_url?: string;
  primary_color?: string;
  custom_domain?: string;
  support_email?: string;
  support_phone?: string;
  marketplace_headline?: string;
  marketplace_description?: string;
}

export interface TenantSettings {
  gym_name: string;
  email: string;
  phone?: string;
  city?: string;
  address?: string;
  primary_color?: string;
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
  branding: TenantBranding;
}

export interface PaymentProviderAccount {
  id: string;
  provider: 'stripe' | 'mercadopago' | 'webpay' | 'manual';
  status: 'pending' | 'connected' | 'disabled';
  account_label?: string;
  public_identifier?: string;
  checkout_base_url?: string;
  metadata: Record<string, unknown>;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface AppNotification {
  id: string;
  campaign_id?: string;
  title: string;
  message?: string;
  type: 'info' | 'warning' | 'success' | 'error';
  is_read: boolean;
  opened_at?: string;
  clicked_at?: string;
  action_url?: string;
  created_at: string;
}

export interface PushDelivery {
  subscription_id: string;
  expo_push_token: string;
  status: string;
  is_active: boolean;
  ticket_id?: string;
  message?: string;
  error?: string;
  receipt_status?: string;
  receipt_message?: string;
  receipt_error?: string;
  receipt_checked_at?: string;
}

export interface NotificationDispatchResponse {
  notification: AppNotification;
  push_deliveries: PushDelivery[];
}

export interface NotificationBroadcastRecipient {
  user_id: string;
  user_name?: string;
  notification: AppNotification;
  push_deliveries: PushDelivery[];
}

export interface NotificationBroadcastResponse {
  total_recipients: number;
  total_notifications: number;
  total_push_deliveries: number;
  accepted_push_deliveries: number;
  errored_push_deliveries: number;
  campaign_id?: string;
  recipients: NotificationBroadcastRecipient[];
}

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
  }>;
  upcoming_classes: Array<{
    id: string;
    name: string;
    class_type?: string;
    start_time: string;
    modality: string;
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

export interface PlatformLead {
  id: string;
  tenant_id?: string;
  owner_name: string;
  gym_name: string;
  email: string;
  phone?: string;
  request_type: 'lead' | 'demo' | 'import';
  source: string;
  status: 'new' | 'contacted' | 'qualified' | 'won' | 'lost';
  desired_plan_key?: string;
  notes?: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface MobileWallet {
  tenant_slug: string;
  tenant_name: string;
  plan_name?: string;
  membership_status?: string;
  expires_at?: string;
  next_class?: {
    id: string;
    name: string;
    start_time: string;
    modality: string;
  };
  qr_payload?: string;
}

/* ─── Paginated ──────────────────────────────────────────────── */

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
}

/* ─── Navigation ─────────────────────────────────────────────── */

export interface NavItem {
  label: string;
  path: string;
  icon: string;
  roles?: UserRole[];
  children?: NavItem[];
}
