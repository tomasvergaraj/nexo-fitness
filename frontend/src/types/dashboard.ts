import type { CheckIn } from './checkin';

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
