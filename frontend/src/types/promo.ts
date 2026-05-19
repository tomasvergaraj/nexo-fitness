export interface PromoCode {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  description?: string;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
  max_uses?: number;
  uses_count: number;
  expires_at?: string;
  is_active: boolean;
  plan_ids?: string[];
  created_at: string;
  updated_at: string;
}

export interface PromoCodeValidateResponse {
  valid: boolean;
  reason?: string;
  promo_code_id?: string;
  discount_type?: 'percent' | 'fixed';
  discount_value?: number;
  discount_amount?: number;
  final_price?: number;
}
