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
