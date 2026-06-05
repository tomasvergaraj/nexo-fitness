export type UserRole = 'superadmin' | 'owner' | 'admin' | 'reception' | 'trainer' | 'marketing' | 'client';

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
  tenant_id?: string;
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
  prefers_qr_card?: boolean;
  uses_app?: boolean;
}
