export type ApiClientScope = 'measurements:read' | 'measurements:write' | 'records:read' | 'records:write';

export interface ApiClient {
  id: string;
  tenant_id: string;
  name: string;
  client_id: string;
  scopes: ApiClientScope[];
  rate_limit_per_minute: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ApiClientWithSecret extends ApiClient {
  client_secret: string;
}
