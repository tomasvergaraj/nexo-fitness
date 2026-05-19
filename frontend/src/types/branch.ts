export interface Branch {
  id: string;
  name: string;
  address?: string;
  city?: string;
  phone?: string;
  email?: string;
  opening_time?: string; // "HH:MM:SS"
  closing_time?: string; // "HH:MM:SS"
  capacity?: number;
  is_active: boolean;
  created_at: string;
}
