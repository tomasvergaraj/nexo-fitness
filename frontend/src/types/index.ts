/* ─── Auth ───────────────────────────────────────────────────── */

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  access_token?: string;
  refresh_token?: string;
  token_type: string;
  user?: User;
  billing_status?: string;
  next_action?: string | null;
  checkout_url?: string | null;
  widget_token?: string | null;
  checkout_provider?: string | null;
  billing_detail?: string | null;
  // 2FA
  mfa_token?: string;
  mfa_attempts_remaining?: number;
  trusted_device_token?: string;
}

export interface TrustedDevice {
  id: string;
  label?: string | null;
  user_agent?: string | null;
  ip_address?: string | null;
  created_at: string;
  last_used_at?: string | null;
  expires_at: string;
}

export interface TwoFactorStatus {
  enabled: boolean;
  verified_at?: string | null;
  backup_codes_remaining: number;
}

export interface TwoFactorSetupResponse {
  secret: string;
  provisioning_uri: string;
  issuer: string;
  account: string;
}

export interface TwoFactorVerifySetupResponse {
  detail: string;
  backup_codes: string[];
}

export interface MfaForcedSetupResponse extends AuthResponse {
  backup_codes: string[];
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
  // Membership summary (present when fetched from client list endpoint)
  membership_id?: string;
  membership_status?: string;
  membership_expires_at?: string;
  membership_notes?: string;
  plan_name?: string;
  churn_risk?: 'low' | 'medium' | 'high';
}

export type UserRole = 'superadmin' | 'owner' | 'admin' | 'reception' | 'trainer' | 'marketing' | 'client';

/* ─── Tenant ─────────────────────────────────────────────────── */

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
  payment_method: 'stripe' | 'fintoc' | 'webpay' | 'tuu' | 'transfer' | 'cash' | 'mercadopago' | 'other';
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

/* ─── Branch ─────────────────────────────────────────────────── */

export interface Branch {
  id: string;
  name: string;
  address?: string;
  city?: string;
  phone?: string;
  email?: string;
  opening_time?: string; // "HH:MM:SS"
  closing_time?: string; // "HH:MM:SS"
  capacity?: number;
  is_active: boolean;
  created_at: string;
}

/* ─── Plan ───────────────────────────────────────────────────── */

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

/* ─── GymClass ───────────────────────────────────────────────── */

export interface GymClass {
  id: string;
  name: string;
  description?: string;
  class_type?: string;
  modality: 'in_person' | 'online' | 'hybrid';
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  instructor_id?: string;
  instructor_name?: string;
  branch_id?: string;
  branch_name?: string;
  start_time: string;
  end_time: string;
  max_capacity: number;
  current_bookings: number;
  waitlist_enabled: boolean;
  online_link?: string;
  cancellation_deadline_hours?: number;
  reservation_closes_minutes_before?: number;
  color?: string;
  program_id?: string;
  restricted_plan_id?: string;
  restricted_plan_name?: string;
  repeat_type: 'none' | 'daily' | 'weekly' | 'monthly';
  repeat_until?: string;
  recurrence_group_id?: string;
  created_at: string;
}

export interface BulkClassCancelRequest {
  date_from: string;
  date_to: string;
  time_from: string;
  time_to: string;
  branch_id?: string;
  instructor_id?: string;
  cancel_reason?: string;
  notify_members: boolean;
}

export interface BulkCancelableClassItem {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  branch_name?: string;
  instructor_name?: string;
  current_bookings: number;
}

export interface BulkClassCancelPreviewResponse {
  matched_classes: number;
  confirmed_reservations: number;
  waitlisted_reservations: number;
  notified_users: number;
  items: BulkCancelableClassItem[];
}

export interface BulkClassCancelResponse extends BulkClassCancelPreviewResponse {
  cancelled_classes: number;
  cancelled_reservations: number;
  notification_failures: number;
  skipped_classes: number;
}

/* ─── Reservation ────────────────────────────────────────────── */

export interface Reservation {
  id: string;
  user_id: string;
  gym_class_id: string;
  status: 'confirmed' | 'waitlisted' | 'cancelled' | 'no_show' | 'attended';
  waitlist_position?: number;
  cancel_reason?: string;
  cancelled_at?: string;
  attended_at?: string;
  created_at: string;
}

export interface ClassReservationDetail {
  id: string;
  user_id: string;
  user_name?: string;
  user_email?: string;
  user_phone?: string;
  gym_class_id: string;
  status: 'confirmed' | 'waitlisted' | 'cancelled' | 'no_show' | 'attended';
  reservation_origin: 'individual' | 'program';
  program_booking_id?: string | null;
  program_booking_status?: 'active' | 'cancelled' | null;
  program_name?: string | null;
  waitlist_position?: number;
  cancel_reason?: string;
  cancelled_at?: string;
  attended_at?: string;
  created_at: string;
}

/* ─── CheckIn ────────────────────────────────────────────────── */

export interface CheckIn {
  id: string;
  user_id: string;
  user_name?: string;
  gym_class_id?: string;
  reservation_id?: string;
  attendance_resolution: 'linked' | 'already_attended' | 'none';
  resolved_gym_class_name?: string;
  check_type: string;
  checked_in_at: string;
}

export interface CheckInHistoryItem {
  id: string;
  user_id: string;
  user_name?: string;
  branch_id?: string;
  branch_name?: string;
  gym_class_id?: string;
  gym_class_name?: string;
  reservation_id?: string;
  attendance_resolution?: string;
  check_type: string;
  checked_in_at: string;
  checked_in_by?: string;
  checked_in_by_name?: string;
}

export interface CheckInContext {
  tenant_name: string;
  tenant_slug: string;
  timezone: string;
  logo_url?: string;
  primary_color?: string;
  secondary_color?: string;
  branches: Branch[];
}

export interface CheckInInvestigationCase {
  id: string;
  user_id: string;
  user_name?: string;
  user_email?: string;
  status: 'open' | 'dismissed' | 'confirmed';
  rule_code: string;
  local_day: string;
  first_triggered_at: string;
  last_triggered_at: string;
  daily_qr_count: number;
  window_qr_count: number;
  review_notes?: string | null;
  reviewed_by?: string | null;
  reviewed_by_name?: string | null;
  reviewed_at?: string | null;
  trigger_checkin_id?: string | null;
}

export interface CheckInInvestigationCaseDetail extends CheckInInvestigationCase {
  related_checkins: CheckInHistoryItem[];
}

/* ─── Payment ────────────────────────────────────────────────── */

export interface Payment {
  id: string;
  user_id: string;
  membership_id?: string;
  amount: number;
  currency: string;
  status: 'pending' | 'completed' | 'failed' | 'refunded' | 'cancelled';
  method: string;
  description?: string;
  paid_at?: string;
  created_at: string;
  plan_id_snapshot?: string | null;
  plan_name_snapshot?: string | null;
  membership_starts_at_snapshot?: string | null;
  membership_expires_at_snapshot?: string | null;
  membership_status_snapshot?: string | null;
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

export interface DayPanelClass {
  id: string;
  name: string;
  class_type?: string;
  start_time: string;
  end_time: string;
  instructor_name?: string;
  current_bookings: number;
  max_capacity: number;
  status: string;
}

export interface DayPanelPayment {
  id: string;
  user_name?: string;
  amount: number;
  method: string;
  paid_at?: string;
  plan_name?: string;
}

export interface DayPanelBirthday {
  id: string;
  full_name: string;
  email: string;
}

export interface DayPanel {
  date: string;
  classes: DayPanelClass[];
  payments: DayPanelPayment[];
  birthdays: DayPanelBirthday[];
  checkins_count: number;
  revenue_today: number;
}

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
}

export interface MembershipManualSaleRequest {
  user_id: string;
  plan_id: string;
  starts_at: string;
  expires_at?: string | null;
  payment_method: 'cash' | 'transfer';
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

export type FeedbackCategory = 'suggestion' | 'improvement' | 'problem' | 'other';

export interface FeedbackSubmission {
  id: string;
  category: FeedbackCategory;
  message: string;
  image_url?: string | null;
  created_at: string;
  created_by?: string | null;
  created_by_name?: string | null;
}

export interface PlatformFeedbackSubmission extends FeedbackSubmission {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  created_by_email?: string | null;
}

export interface ProgramExerciseLibraryItem {
  id: string;
  name: string;
  group: string;
}

export interface ProgramScheduleExercise {
  exercise_id: string;
  name: string;
  group?: string;
}

export type ProgramClassModality = 'in_person' | 'online' | 'hybrid';
export type ProgramScheduleConfigMode = 'inherit' | 'custom';

export type ProgramScheduleDayConfigValueMap = {
  branch_id: string | null;
  instructor_id: string | null;
  modality: ProgramClassModality;
  max_capacity: number;
  online_link: string | null;
  cancellation_deadline_hours: number;
  restricted_plan_id: string | null;
  color: string | null;
  class_type: string | null;
};

export type ProgramScheduleDayConfigField<
  Key extends keyof ProgramScheduleDayConfigValueMap = keyof ProgramScheduleDayConfigValueMap,
> = {
  mode: ProgramScheduleConfigMode;
  value?: ProgramScheduleDayConfigValueMap[Key];
};

export type ProgramScheduleDayConfig = {
  [Key in keyof ProgramScheduleDayConfigValueMap]?: ProgramScheduleDayConfigField<Key>;
};

export interface ProgramScheduleDay {
  day: string;
  focus: string;
  exercises: ProgramScheduleExercise[];
  class_config?: ProgramScheduleDayConfig | null;
}

export interface TrainingProgram {
  id: string;
  name: string;
  description?: string;
  trainer_id?: string;
  trainer_name?: string;
  program_type?: string;
  duration_weeks: number; // 0 = indefinido (sin límite)
  schedule: ProgramScheduleDay[];
  is_active: boolean;
  enrolled_count: number;
  linked_class_count: number;
  is_enrolled: boolean;
  enrollment_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProgramBooking {
  id: string;
  user_id: string;
  program_id?: string | null;
  user_name?: string | null;
  user_email?: string | null;
  user_phone?: string | null;
  program_name?: string | null;
  recurrence_group_id: string;
  status: 'active' | 'cancelled';
  total_classes: number;
  reserved_classes: number;
  waitlisted_classes: number;
  failed_classes: number;
  cancel_reason?: string | null;
  cancelled_at?: string | null;
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
  provider: 'expo' | 'webpush' | string;
  delivery_target: string;
  expo_push_token?: string;
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

export interface PushSubscriptionRecord {
  id: string;
  tenant_id: string;
  user_id: string;
  provider: 'expo' | 'webpush' | string;
  device_type: string;
  device_name?: string;
  expo_push_token?: string;
  web_endpoint?: string;
  user_agent?: string;
  is_active: boolean;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

export interface WebPushConfig {
  enabled: boolean;
  public_vapid_key?: string;
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

export interface WalletMembershipSummary {
  membership_id: string;
  plan_id: string;
  plan_name?: string | null;
  membership_status: string;
  starts_at: string;
  expires_at?: string | null;
  auto_renew: boolean;
  sale_source?: string | null;
}

export interface MobileWallet {
  tenant_slug: string;
  tenant_name: string;
  membership_id?: string;
  plan_id?: string;
  plan_name?: string;
  membership_status?: string;
  starts_at?: string;
  expires_at?: string;
  auto_renew?: boolean;
  current_membership?: WalletMembershipSummary | null;
  next_membership?: WalletMembershipSummary | null;
  next_class?: {
    id: string;
    name: string;
    start_time: string;
    modality: string;
    program_id?: string | null;
  };
  next_program_class?: {
    id: string;
    name: string;
    start_time: string;
    modality: string;
    program_id?: string | null;
  };
  qr_payload?: string;
  max_reservations_per_week?: number | null;
  max_reservations_per_month?: number | null;
  weekly_reservations_used?: number | null;
  monthly_reservations_used?: number | null;
}

export interface MobilePaymentHistoryItem {
  id: string;
  user_id: string;
  membership_id?: string;
  amount: number;
  currency: string;
  status: 'pending' | 'completed' | 'failed' | 'refunded' | 'cancelled';
  method: string;
  description?: string;
  paid_at?: string;
  created_at: string;
  receipt_url?: string;
  external_id?: string;
  plan_name?: string;
  plan_id_snapshot?: string | null;
  plan_name_snapshot?: string | null;
  membership_starts_at_snapshot?: string | null;
  membership_expires_at_snapshot?: string | null;
  membership_status_snapshot?: string | null;
}

/* ─── Progress / Body Measurements ──────────────────────────── */

export interface BodyMeasurement {
  id: string;
  user_id: string;
  tenant_id: string;
  recorded_at: string;
  weight_kg?: number | null;
  body_fat_pct?: number | null;
  muscle_mass_kg?: number | null;
  chest_cm?: number | null;
  waist_cm?: number | null;
  hip_cm?: number | null;
  arm_cm?: number | null;
  thigh_cm?: number | null;
  notes?: string | null;
  created_at: string;
}

export interface PersonalRecord {
  id: string;
  user_id: string;
  tenant_id: string;
  exercise_name: string;
  record_value: number;
  unit: string;
  recorded_at: string;
  notes?: string | null;
  created_at: string;
}

export interface ProgressPhoto {
  id: string;
  user_id: string;
  tenant_id: string;
  recorded_at: string;
  photo_url: string;
  notes?: string | null;
  created_at: string;
}

/* ─── Promo Codes ────────────────────────────────────────────── */

export interface PromoCode {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  description?: string;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
  max_uses?: number;
  uses_count: number;
  expires_at?: string;
  is_active: boolean;
  plan_ids?: string[];
  created_at: string;
  updated_at: string;
}

export interface PromoCodeValidateResponse {
  valid: boolean;
  reason?: string;
  promo_code_id?: string;
  discount_type?: 'percent' | 'fixed';
  discount_value?: number;
  discount_amount?: number;
  final_price?: number;
}

/* ─── API Clients (OAuth) ────────────────────────────────────── */

export type ApiClientScope = 'measurements:read' | 'measurements:write' | 'records:read' | 'records:write';

export interface ApiClient {
  id: string;
  tenant_id: string;
  name: string;
  client_id: string;
  scopes: ApiClientScope[];
  rate_limit_per_minute: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ApiClientWithSecret extends ApiClient {
  client_secret: string;
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

/* ─── POS ────────────────────────────────────────────────────── */

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
