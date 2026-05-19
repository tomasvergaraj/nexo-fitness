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
