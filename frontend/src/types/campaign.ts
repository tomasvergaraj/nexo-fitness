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
