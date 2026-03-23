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
  channel: 'email' | 'whatsapp' | 'sms';
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled';
  total_recipients: number;
  total_sent: number;
  total_opened: number;
  scheduled_at?: string;
  sent_at?: string;
  created_at: string;
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
