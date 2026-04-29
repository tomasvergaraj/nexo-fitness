import type { SetURLSearchParams } from 'react-router-dom';
import type { Home, CalendarDays } from 'lucide-react';

export type MemberTabId =
  | 'home'
  | 'agenda'
  | 'programs'
  | 'support'
  | 'plans'
  | 'payments'
  | 'notifications'
  | 'profile'
  | 'progress';

export type SupportFilter = 'all' | 'pending' | 'resolved';
export type NotificationFilter = 'all' | 'unread' | 'read' | 'actionable';
export type NotificationDatePreset = '7d' | '30d' | '90d' | 'custom';
export type NotificationPermissionState = NotificationPermission | 'unsupported';

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

export type SupportRequestForm = {
  channel: 'whatsapp' | 'email' | 'phone' | 'in_person';
  subject: string;
  notes: string;
};

export type MemberTabMeta = {
  id: MemberTabId;
  label: string;
  icon: typeof Home | typeof CalendarDays;
  primary: boolean;
  description: string;
};

export { type SetURLSearchParams };
