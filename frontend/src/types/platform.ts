export interface PlatformLead {
  id: string;
  tenant_id?: string;
  owner_name: string;
  gym_name: string;
  email: string;
  phone?: string;
  request_type: 'lead' | 'demo' | 'import';
  source: string;
  status: 'new' | 'contacted' | 'qualified' | 'won' | 'lost';
  desired_plan_key?: string;
  notes?: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
