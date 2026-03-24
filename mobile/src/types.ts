export interface AuthUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone?: string;
  avatar_url?: string;
  role: string;
  is_active: boolean;
  is_verified: boolean;
  created_at: string;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user: AuthUser;
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

export interface PublicBranch {
  id: string;
  name: string;
  city?: string;
  address?: string;
  phone?: string;
}

export interface PublicPlan {
  id: string;
  name: string;
  description?: string;
  price: number;
  currency: string;
  duration_type: string;
  duration_days?: number;
  is_active?: boolean;
  is_featured: boolean;
  auto_renew?: boolean;
  created_at?: string;
}

export interface PublicClassSummary {
  id: string;
  name: string;
  class_type?: string;
  start_time: string;
  modality: string;
  capacity: number;
  bookings: number;
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
  branches: PublicBranch[];
  featured_plans: PublicPlan[];
  upcoming_classes: PublicClassSummary[];
  checkout_enabled: boolean;
}

export interface CheckoutSessionRequest {
  plan_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone?: string;
  success_url?: string;
  cancel_url?: string;
}

export interface CheckoutSession {
  provider: string;
  status: string;
  checkout_url: string;
  payment_link_url: string;
  qr_payload: string;
  session_reference: string;
}

export interface MobileWallet {
  tenant_slug: string;
  tenant_name: string;
  membership_id?: string;
  plan_id?: string;
  plan_name?: string;
  membership_status?: string;
  expires_at?: string;
  auto_renew?: boolean;
  next_class?: {
    id: string;
    name: string;
    start_time: string;
    modality: string;
  };
  qr_payload?: string;
}

export interface GymClass {
  id: string;
  name: string;
  description?: string;
  class_type?: string;
  modality: string;
  status: string;
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

export interface Reservation {
  id: string;
  user_id: string;
  gym_class_id: string;
  status: string;
  waitlist_position?: number;
  created_at: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
}

export interface PaymentHistoryItem {
  id: string;
  user_id: string;
  membership_id?: string;
  amount: number;
  currency: string;
  status: string;
  method: string;
  description?: string;
  paid_at?: string;
  created_at: string;
  receipt_url?: string;
  external_id?: string;
  plan_name?: string;
}

export interface AppNotification {
  id: string;
  title: string;
  message?: string;
  type: string;
  is_read: boolean;
  action_url?: string;
  created_at: string;
}

export interface PushPreviewRequest {
  title?: string;
  message?: string;
  type?: string;
  action_url?: string;
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

export interface PushSubscriptionRequest {
  device_type: string;
  device_name?: string;
  expo_push_token: string;
}

export interface PushSubscriptionResponse {
  id: string;
  tenant_id: string;
  user_id: string;
  device_type: string;
  device_name?: string;
  expo_push_token: string;
  is_active: boolean;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}
