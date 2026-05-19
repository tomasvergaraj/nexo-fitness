export interface AppNotification {
  id: string;
  campaign_id?: string;
  title: string;
  message?: string;
  type: 'info' | 'warning' | 'success' | 'error';
  is_read: boolean;
  opened_at?: string;
  clicked_at?: string;
  action_url?: string;
  created_at: string;
}

export interface PushDelivery {
  subscription_id: string;
  provider: 'expo' | 'webpush' | string;
  delivery_target: string;
  expo_push_token?: string;
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

export interface PushSubscriptionRecord {
  id: string;
  tenant_id: string;
  user_id: string;
  provider: 'expo' | 'webpush' | string;
  device_type: string;
  device_name?: string;
  expo_push_token?: string;
  web_endpoint?: string;
  user_agent?: string;
  is_active: boolean;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

export interface WebPushConfig {
  enabled: boolean;
  public_vapid_key?: string;
}

export interface NotificationDispatchResponse {
  notification: AppNotification;
  push_deliveries: PushDelivery[];
}

export interface NotificationBroadcastRecipient {
  user_id: string;
  user_name?: string;
  notification: AppNotification;
  push_deliveries: PushDelivery[];
}

export interface NotificationBroadcastResponse {
  total_recipients: number;
  total_notifications: number;
  total_push_deliveries: number;
  accepted_push_deliveries: number;
  errored_push_deliveries: number;
  campaign_id?: string;
  recipients: NotificationBroadcastRecipient[];
}
