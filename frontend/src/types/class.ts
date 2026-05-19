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

export interface BulkReassignInstructorRequest {
  from_instructor_id: string;
  to_instructor_id: string;
  date_from?: string;
  date_to?: string;
  branch_id?: string;
}

export interface BulkReassignableClassItem {
  id: string;
  name: string;
  start_time: string;
  branch_name?: string;
  current_bookings: number;
}

export interface BulkReassignInstructorPreviewResponse {
  matched_classes: number;
  items: BulkReassignableClassItem[];
}

export interface BulkReassignInstructorResponse extends BulkReassignInstructorPreviewResponse {
  reassigned_classes: number;
}
