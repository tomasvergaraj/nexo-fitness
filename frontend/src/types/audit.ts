export interface AuditLog {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
}

export interface AuditFilterOption {
  value: string;
  label: string;
}

export interface AuditActorOption {
  id: string;
  name: string;
  email: string | null;
}

export interface AuditFilters {
  actions: AuditFilterOption[];
  entity_types: AuditFilterOption[];
  actors: AuditActorOption[];
}
