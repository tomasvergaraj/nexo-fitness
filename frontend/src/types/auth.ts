import type { User } from './user';

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  access_token?: string;
  refresh_token?: string;
  token_type: string;
  user?: User;
  billing_status?: string;
  next_action?: string | null;
  checkout_url?: string | null;
  widget_token?: string | null;
  checkout_provider?: string | null;
  billing_detail?: string | null;
  // 2FA
  mfa_token?: string;
  mfa_attempts_remaining?: number;
  trusted_device_token?: string;
}

export interface TrustedDevice {
  id: string;
  label?: string | null;
  user_agent?: string | null;
  ip_address?: string | null;
  created_at: string;
  last_used_at?: string | null;
  expires_at: string;
}

export interface TwoFactorStatus {
  enabled: boolean;
  verified_at?: string | null;
  backup_codes_remaining: number;
}

export interface TwoFactorSetupResponse {
  secret: string;
  provisioning_uri: string;
  issuer: string;
  account: string;
}

export interface TwoFactorVerifySetupResponse {
  detail: string;
  backup_codes: string[];
}

export interface MfaForcedSetupResponse extends AuthResponse {
  backup_codes: string[];
}

export interface RegisterGymRequest {
  gym_name: string;
  slug: string;
  email: string;
  phone?: string;
  address?: string;
  city?: string;
  country: string;
  timezone: string;
  currency: string;
  license_type: string;
  owner_first_name: string;
  owner_last_name: string;
  owner_email: string;
  owner_password: string;
}
