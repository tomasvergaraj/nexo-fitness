import { useState } from 'react';
import { authApi, publicApi } from '@/services/api';
import { getApiError, isCustomStorefrontHost } from '@/utils';
import type { PromoCodeValidateResponse } from '@/types';

export type CheckoutStep = 'email' | 'data' | 'summary';
export type AccountMode = 'create' | 'existing';

export interface CheckoutState {
  step: CheckoutStep;
  open: boolean;
  planId: string;
  // email step
  email: string;
  otpCode: string;
  otpSent: boolean;
  verificationToken: string;
  accountMode: AccountMode;
  // data step
  name: string;
  phone: string;
  dob: string;
  password: string;
  existingPassword: string;
  // promo
  promoInput: string;
  promoResult: PromoCodeValidateResponse | null;
  // loading / errors
  loading: boolean;
  error: string;
}

const initial: Omit<CheckoutState, 'open' | 'planId'> = {
  step: 'email',
  email: '',
  otpCode: '',
  otpSent: false,
  verificationToken: '',
  accountMode: 'create',
  name: '',
  phone: '',
  dob: '',
  password: '',
  existingPassword: '',
  promoInput: '',
  promoResult: null,
  loading: false,
  error: '',
};

export function useCheckout(slug: string) {
  const isCustom = isCustomStorefrontHost();

  const [state, setState] = useState<CheckoutState>({
    ...initial,
    open: false,
    planId: '',
  });

  const set = (patch: Partial<CheckoutState>) =>
    setState(prev => ({ ...prev, ...patch }));

  function openFor(planId: string) {
    setState({ ...initial, open: true, planId });
  }

  function close() {
    set({ open: false, error: '' });
  }

  // ── Step 1: send OTP ──────────────────────────────────────────
  async function sendOtp() {
    if (!state.email) return;
    set({ loading: true, error: '' });
    try {
      await authApi.sendEmailVerification(state.email);
      set({ otpSent: true, loading: false });
    } catch (e) {
      const msg = getApiError(e);
      // 409 = account already exists
      if (msg.toLowerCase().includes('ya existe') || msg.toLowerCase().includes('already')) {
        set({ accountMode: 'existing', otpSent: false, loading: false, error: '' });
      } else {
        set({ error: msg, loading: false });
      }
    }
  }

  async function confirmOtp() {
    set({ loading: true, error: '' });
    try {
      const res = await authApi.confirmEmailVerification(state.email, state.otpCode);
      const token = (res.data as { verification_token?: string }).verification_token ?? '';
      set({ verificationToken: token, step: 'data', loading: false });
    } catch (e) {
      set({ error: getApiError(e), loading: false });
    }
  }

  function proceedExisting() {
    // existing account — no OTP needed, password verified at checkout
    set({ step: 'data', verificationToken: '' });
  }

  // ── Step 2: go to summary ─────────────────────────────────────
  function proceedToSummary() {
    if (!state.name.trim()) {
      set({ error: 'Ingresa tu nombre completo.' });
      return;
    }
    if (state.accountMode === 'create' && state.password.length < 8) {
      set({ error: 'La contraseña debe tener al menos 8 caracteres.' });
      return;
    }
    set({ step: 'summary', error: '' });
  }

  // ── Promo code ────────────────────────────────────────────────
  async function validatePromo() {
    if (!state.promoInput.trim()) return;
    set({ loading: true, error: '' });
    try {
      const res = isCustom
        ? await publicApi.validateStorefrontPromoCode(state.promoInput.trim(), state.planId)
        : await publicApi.validateTenantPromoCode(slug, state.promoInput.trim(), state.planId);
      const data = res.data as PromoCodeValidateResponse;
      if (!data.valid) {
        set({ promoResult: null, error: data.reason ?? 'Código inválido.', loading: false });
      } else {
        set({ promoResult: data, error: '', loading: false });
      }
    } catch (e) {
      set({ error: getApiError(e), loading: false });
    }
  }

  function clearPromo() {
    set({ promoResult: null, promoInput: '' });
  }

  // ── Step 3: pay ───────────────────────────────────────────────
  async function pay(successUrl: string, cancelUrl: string) {
    set({ loading: true, error: '' });
    try {
      const payload: Record<string, unknown> = {
        plan_id: state.planId,
        customer_name: state.name.trim(),
        customer_email: state.email.trim(),
        success_url: successUrl,
        cancel_url: cancelUrl,
      };
      if (state.phone) payload.customer_phone = state.phone;
      if (state.dob) payload.customer_date_of_birth = state.dob;
      if (state.accountMode === 'create' && state.verificationToken) {
        payload.customer_password = state.password;
        payload.verification_token = state.verificationToken;
      }
      if (state.promoResult?.promo_code_id) {
        payload.promo_code_id = state.promoResult.promo_code_id;
      }

      const res = isCustom
        ? await publicApi.createStorefrontCheckoutSession(payload)
        : await publicApi.createCheckoutSession(slug, payload);

      const session = res.data as { checkout_url: string; qr_payload: string };
      const url = session.checkout_url || session.qr_payload;
      if (url) {
        window.location.href = url;
      } else {
        set({ error: 'No se pudo iniciar el pago. Intenta de nuevo.', loading: false });
      }
    } catch (e) {
      set({ error: getApiError(e), loading: false });
    }
  }

  return {
    state,
    set,
    openFor,
    close,
    sendOtp,
    confirmOtp,
    proceedExisting,
    proceedToSummary,
    validatePromo,
    clearPromo,
    pay,
  };
}
