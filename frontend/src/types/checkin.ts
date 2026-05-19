import type { Branch } from './branch';

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
