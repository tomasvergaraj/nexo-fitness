export interface SupportInteraction {
  id: string;
  user_id?: string;
  channel: 'whatsapp' | 'email' | 'phone' | 'in_person';
  subject?: string;
  notes?: string;
  resolved: boolean;
  handled_by?: string;
  created_at: string;
  client_name?: string;
  handler_name?: string;
}

export type FeedbackCategory = 'suggestion' | 'improvement' | 'problem' | 'other';

export interface FeedbackSubmission {
  id: string;
  category: FeedbackCategory;
  message: string;
  image_url?: string | null;
  created_at: string;
  created_by?: string | null;
  created_by_name?: string | null;
}

export interface PlatformFeedbackSubmission extends FeedbackSubmission {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  created_by_email?: string | null;
}
