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
