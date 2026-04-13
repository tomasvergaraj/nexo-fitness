import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  CreditCard,
  Loader2,
  LockKeyhole,
  Mail,
  MapPin,
  Moon,
  Phone,
  ShieldCheck,
  Sparkles,
  Store,
  Sun,
  Tag,
  UserRound,
} from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import Modal from '@/components/ui/Modal';
import { authApi, publicApi } from '@/services/api';
import { useThemeStore } from '@/stores/themeStore';
import {
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_SECONDARY_COLOR,
  cn,
  formatClassCapacityLabel,
  formatClassModalityLabel,
  formatCurrency,
  formatDateTime,
  formatDurationLabel,
  getApiError,
  getPlanLimitError,
  getPublicAppOrigin,
  hexToRgbString,
  normalizeHexColor,
} from '@/utils';
import type { PromoCodeValidateResponse, PublicCheckoutSession, TenantPublicProfile } from '@/types';

type CheckoutForm = {
  plan_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  customer_date_of_birth: string;
  customer_password: string;
  customer_password_confirm: string;
};

type AccountMode = 'create' | 'existing';

type CheckoutResumeSession = {
  checkout_url: string;
  payment_link_url: string;
  session_reference: string;
  plan_id: string;
  customer_email: string;
  created_at: number;
};

type StorefrontPlan = TenantPublicProfile['featured_plans'][number] & {
  discount_pct?: number | null;
};

const emptyForm: CheckoutForm = {
  plan_id: '',
  customer_name: '',
  customer_email: '',
  customer_phone: '',
  customer_date_of_birth: '',
  customer_password: '',
  customer_password_confirm: '',
};

const getCheckoutStorageKey = (storefrontKey: string) => `nexo-storefront-checkout:${storefrontKey}`;

const readStoredCheckoutSession = (storefrontKey: string): CheckoutResumeSession | null => {
  if (!storefrontKey || typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(getCheckoutStorageKey(storefrontKey));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as CheckoutResumeSession;
    const isExpired = Date.now() - parsed.created_at > 1000 * 60 * 60 * 24;

    if (isExpired || !parsed.checkout_url || !parsed.plan_id) {
      window.sessionStorage.removeItem(getCheckoutStorageKey(storefrontKey));
      return null;
    }

    return parsed;
  } catch {
    window.sessionStorage.removeItem(getCheckoutStorageKey(storefrontKey));
    return null;
  }
};

const saveCheckoutSession = (storefrontKey: string, session: CheckoutResumeSession) => {
  if (!storefrontKey || typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.setItem(getCheckoutStorageKey(storefrontKey), JSON.stringify(session));
};

const clearCheckoutSession = (storefrontKey: string) => {
  if (!storefrontKey || typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.removeItem(getCheckoutStorageKey(storefrontKey));
};

const buildPlanHighlights = (
  plan: TenantPublicProfile['featured_plans'][number],
  profile: TenantPublicProfile
) => {
  const highlights: string[] = [];

  if (plan.discount_pct) {
    highlights.push(`Aprovecha ${plan.discount_pct}% de descuento sobre el valor normal.`);
  }

  if (plan.description) {
    highlights.push(plan.description);
  }

  if (plan.duration_days) {
    highlights.push(`Vigencia por ${plan.duration_days} días desde la activación.`);
  } else {
    highlights.push(`Acceso ${formatDurationLabel(plan.duration_type, plan.duration_days).toLowerCase()} con compra online inmediata.`);
  }

  if (profile.upcoming_classes.length > 0) {
    highlights.push('Después de comprar podrás coordinar reservas y activación con el gimnasio.');
  } else {
    highlights.push('Compra en minutos y recibe la confirmación para comenzar sin pasos extra.');
  }

  return highlights.slice(0, 3);
};

const getDiscountedPrice = (plan: StorefrontPlan | null | undefined) => {
  if (!plan) {
    return 0;
  }
  if (!plan.discount_pct) {
    return plan.price;
  }
  return Math.round(plan.price * (1 - plan.discount_pct / 100));
};

const getDiscountAmount = (plan: StorefrontPlan | null | undefined) => {
  if (!plan?.discount_pct) {
    return 0;
  }
  return Math.max(plan.price - getDiscountedPrice(plan), 0);
};

type CheckoutVerifyStep = 'email' | 'code' | 'done';

export default function TenantStorefrontPage() {
  const { slug = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { isDark, toggle: toggleTheme } = useThemeStore();
  const [showCheckout, setShowCheckout] = useState(false);
  const [form, setForm] = useState<CheckoutForm>(emptyForm);
  const [accountMode, setAccountMode] = useState<AccountMode>('create');
  const [resumeSession, setResumeSession] = useState<CheckoutResumeSession | null>(null);
  const handledCheckoutStateRef = useRef(false);

  // Email verification for new account creation
  const [checkoutVerifyStep, setCheckoutVerifyStep] = useState<CheckoutVerifyStep>('email');
  const [checkoutVerifyCode, setCheckoutVerifyCode] = useState('');
  const [checkoutVerifyToken, setCheckoutVerifyToken] = useState('');
  const [checkoutVerifyLoading, setCheckoutVerifyLoading] = useState(false);
  const [checkoutVerifyError, setCheckoutVerifyError] = useState('');
  const [checkoutPlanLimitError, setCheckoutPlanLimitError] = useState('');
  const [promoInputByPlan, setPromoInputByPlan] = useState<Record<string, string>>({});
  const [promoResultByPlan, setPromoResultByPlan] = useState<Record<string, PromoCodeValidateResponse | null>>({});
  const [promoValidatingPlan, setPromoValidatingPlan] = useState<string | null>(null);
  const checkoutVerifyCodeRef = useRef<HTMLInputElement>(null);
  const isHostResolvedStorefront = !slug;
  const hostStorefrontKey = typeof window === 'undefined' ? '' : window.location.hostname;
  const storefrontKey = isHostResolvedStorefront ? hostStorefrontKey : slug;

  useEffect(() => {
    setResumeSession(readStoredCheckoutSession(storefrontKey));
  }, [storefrontKey]);

  useEffect(() => {
    const checkoutState = new URLSearchParams(location.search).get('checkout');
    if (!checkoutState || handledCheckoutStateRef.current) {
      return;
    }
    handledCheckoutStateRef.current = true;

    const storedSession = readStoredCheckoutSession(storefrontKey);
    const email = storedSession?.customer_email || resumeSession?.customer_email || form.customer_email || '';
    if (checkoutState === 'success') {
      clearCheckoutSession(storefrontKey);
      setResumeSession(null);
      const next = new URLSearchParams();
      next.set('purchase', 'success');
      if (email) {
        next.set('email', email);
      }
      navigate(`/login?${next.toString()}`, { replace: true });
    } else if (checkoutState === 'cancelled' || checkoutState === 'cancel') {
      clearCheckoutSession(storefrontKey);
      const next = new URLSearchParams();
      next.set('purchase', 'cancelled');
      if (email) {
        next.set('email', email);
      }
      navigate(`/login?${next.toString()}`, { replace: true });
    } else {
      handledCheckoutStateRef.current = false;
      return;
    }
  }, [form.customer_email, location.search, navigate, resumeSession?.customer_email, storefrontKey]);

  const { data, isLoading, isError } = useQuery<TenantPublicProfile>({
    queryKey: ['tenant-public-profile', isHostResolvedStorefront ? `host:${hostStorefrontKey}` : slug],
    queryFn: async () => {
      const response = isHostResolvedStorefront
        ? await publicApi.getStorefrontProfile()
        : await publicApi.getTenantProfile(slug);
      return response.data;
    },
    enabled: isHostResolvedStorefront || Boolean(slug),
  });

  const featuredPlans = (data?.featured_plans ?? []) as StorefrontPlan[];
  const defaultPlan = featuredPlans.find((plan) => plan.is_featured) ?? featuredPlans[0] ?? null;
  const selectedPlan = featuredPlans.find((plan) => plan.id === form.plan_id) ?? defaultPlan;
  const selectedPlanHighlights = selectedPlan && data ? buildPlanHighlights(selectedPlan, data) : [];
  const resumePlan = featuredPlans.find((plan) => plan.id === resumeSession?.plan_id) ?? selectedPlan;
  const hasMultiplePlans = featuredPlans.length > 1;
  const discountedSelectedPrice = getDiscountedPrice(selectedPlan);
  const selectedSavings = getDiscountAmount(selectedPlan);
  const selectedPromoResult = selectedPlan ? promoResultByPlan[selectedPlan.id] ?? null : null;
  const selectedFinalCheckoutPrice = selectedPromoResult?.valid
    ? (selectedPromoResult.final_price ?? discountedSelectedPrice)
    : discountedSelectedPrice;
  const selectedPromoDiscountAmount = selectedPromoResult?.valid
    ? (selectedPromoResult.discount_amount ?? 0)
    : 0;
  const passwordMismatch = accountMode === 'create'
    && form.customer_password.length > 0
    && form.customer_password_confirm.length > 0
    && form.customer_password !== form.customer_password_confirm;
  const hasPasswordLengthError = accountMode === 'create'
    && form.customer_password.length > 0
    && form.customer_password.length < 8;
  const storefrontSummary = useMemo(() => ([
    { label: 'Planes disponibles', value: featuredPlans.length },
    { label: 'Clases visibles', value: data?.upcoming_classes.length ?? 0 },
    { label: 'Sucursales', value: data?.branches.length ?? 0 },
  ]), [data?.branches.length, data?.upcoming_classes.length, featuredPlans.length]);

  useEffect(() => {
    if (!defaultPlan) {
      return;
    }

    setForm((current) => (
      current.plan_id
        ? current
        : { ...current, plan_id: defaultPlan.id }
    ));
  }, [defaultPlan]);

  async function validatePromoCode(planId: string) {
    const code = (promoInputByPlan[planId] ?? '').trim();
    if (!code) {
      return;
    }
    setPromoValidatingPlan(planId);
    try {
      const response = isHostResolvedStorefront
        ? await publicApi.validateStorefrontPromoCode(code, planId)
        : await publicApi.validateTenantPromoCode(slug, code, planId);
      const result = response.data as PromoCodeValidateResponse;
      setPromoResultByPlan((current) => ({ ...current, [planId]: result }));
      if (result.valid) {
        toast.success('Código promocional aplicado.');
      } else {
        toast.error(result.reason ?? 'Código promocional no válido.');
      }
    } catch (error) {
      toast.error(getApiError(error, 'No se pudo validar el código promocional.'));
    } finally {
      setPromoValidatingPlan(null);
    }
  }

  const handleCheckoutSendCode = async () => {
    const email = form.customer_email.trim().toLowerCase();
    if (!email) return;
    setCheckoutVerifyLoading(true);
    setCheckoutVerifyError('');
    try {
      const res = await authApi.sendEmailVerification(email);
      const data = res.data as { exists?: boolean; sent?: boolean };
      if (data.exists) {
        // Email exists → switch to "existing account" mode, skip verification
        setAccountMode('existing');
        setCheckoutVerifyStep('done');
        setCheckoutVerifyToken('');
        toast('Este correo ya tiene una cuenta. Continuarás con acceso existente.', { icon: 'ℹ️' });
        return;
      }
      setCheckoutVerifyStep('code');
      setTimeout(() => checkoutVerifyCodeRef.current?.focus(), 100);
    } catch (err: any) {
      setCheckoutVerifyError(err?.response?.data?.detail || 'No se pudo enviar el código. Inténtalo de nuevo.');
    } finally {
      setCheckoutVerifyLoading(false);
    }
  };

  const handleCheckoutConfirmCode = async () => {
    const email = form.customer_email.trim().toLowerCase();
    setCheckoutVerifyLoading(true);
    setCheckoutVerifyError('');
    try {
      const res = await authApi.confirmEmailVerification(email, checkoutVerifyCode);
      const data = res.data as { verified_token: string };
      setCheckoutVerifyToken(data.verified_token);
      setCheckoutVerifyStep('done');
    } catch (err: any) {
      setCheckoutVerifyError(err?.response?.data?.detail || 'Código incorrecto. Inténtalo de nuevo.');
    } finally {
      setCheckoutVerifyLoading(false);
    }
  };

  const checkoutMutation = useMutation({
    mutationFn: async () => {
      const storefrontUrl = isHostResolvedStorefront
        ? `${window.location.origin}${location.pathname || '/'}`
        : `${getPublicAppOrigin()}${location.pathname}`;
      const payload = {
        plan_id: form.plan_id,
        customer_name: form.customer_name.trim(),
        customer_email: form.customer_email.trim().toLowerCase(),
        customer_phone: form.customer_phone.trim(),
        customer_date_of_birth: form.customer_date_of_birth || undefined,
        customer_password: accountMode === 'create' ? form.customer_password : undefined,
        verification_token: accountMode === 'create' && checkoutVerifyToken ? checkoutVerifyToken : undefined,
        success_url: `${storefrontUrl}?checkout=success`,
        cancel_url: `${storefrontUrl}?checkout=cancelled`,
        ...(selectedPromoResult?.valid && selectedPromoResult.promo_code_id ? { promo_code_id: selectedPromoResult.promo_code_id } : {}),
      };
      const response = isHostResolvedStorefront
        ? await publicApi.createStorefrontCheckoutSession(payload)
        : await publicApi.createCheckoutSession(slug, payload);
      return response.data as PublicCheckoutSession;
    },
    onSuccess: (payload) => {
      const nextSession = {
        checkout_url: payload.checkout_url,
        payment_link_url: payload.payment_link_url,
        session_reference: payload.session_reference,
        plan_id: form.plan_id,
        customer_email: form.customer_email,
        created_at: Date.now(),
      };

      saveCheckoutSession(storefrontKey, nextSession);
      setResumeSession(nextSession);
      setShowCheckout(false);
      toast.success('Te estamos llevando al pago seguro...');
      window.location.assign(payload.checkout_url);
    },
    onError: (error: unknown) => {
      const limitError = getPlanLimitError(error);
      if (limitError) {
        setCheckoutPlanLimitError(limitError.detail);
      }
      toast.error(getApiError(error, 'No se pudo iniciar la compra'));
    },
  });

  const primaryColor = normalizeHexColor(data?.branding?.primary_color, DEFAULT_PRIMARY_COLOR) ?? DEFAULT_PRIMARY_COLOR;
  const secondaryColor = normalizeHexColor(data?.branding?.secondary_color, DEFAULT_SECONDARY_COLOR) ?? DEFAULT_SECONDARY_COLOR;
  const primaryRgb = hexToRgbString(primaryColor);
  const secondaryRgb = hexToRgbString(secondaryColor);
  const ctaStyle = {
    backgroundImage: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`,
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f8f5ef] px-4 py-8 dark:bg-surface-950 sm:px-6 lg:px-10">
        <div className="mx-auto h-[620px] max-w-6xl rounded-[2rem] border border-surface-200/70 bg-white/80 shimmer dark:border-surface-800/70 dark:bg-surface-900/80" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen bg-[#f8f5ef] px-4 py-10 text-surface-900 dark:bg-surface-950 dark:text-white">
        <div className="mx-auto max-w-4xl rounded-[2rem] border border-surface-200 bg-white p-8 text-center shadow-sm dark:border-surface-800 dark:bg-surface-900">
          <h1 className="text-3xl font-bold font-display">Tienda no disponible</h1>
          <p className="mt-3 text-surface-600 dark:text-surface-300">
            No encontramos el gimnasio solicitado o su compra online aún no está habilitada.
          </p>
        </div>
      </div>
    );
  }

  const checkoutReady = Boolean(data.checkout_enabled && selectedPlan);
  const checkoutActionLabel = accountMode === 'create' ? 'Crear cuenta y continuar al pago' : 'Continuar al pago';

  return (
    <div className="min-h-screen bg-[#f8f5ef] text-surface-900 dark:bg-surface-950 dark:text-surface-100">
      <section className="relative overflow-hidden px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(circle at top left, rgba(${primaryRgb},0.16), transparent 32%), radial-gradient(circle at bottom right, rgba(${secondaryRgb},0.12), transparent 30%)`,
          }}
        />

        <div className="relative mx-auto max-w-7xl space-y-8">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={toggleTheme}
              className="btn-secondary border-white/70 bg-white/75 backdrop-blur-xl dark:border-surface-700 dark:bg-surface-900/85"
            >
              {isDark ? <Sun size={16} className="text-amber-500" /> : <Moon size={16} className="text-surface-600" />}
              {isDark ? 'Modo claro' : 'Modo oscuro'}
            </button>
          </div>

          <div className="grid gap-8 xl:grid-cols-[minmax(0,1.08fr)_minmax(340px,0.92fr)] xl:gap-10">
            <div className="space-y-6">
              <div className="rounded-[2rem] border border-white/60 bg-white/85 p-6 shadow-[0_30px_80px_-45px_rgba(15,23,42,0.35)] backdrop-blur-xl dark:border-surface-800/70 dark:bg-surface-900/88 sm:p-8">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                  {data.branding.logo_url ? (
                    <img
                      src={data.branding.logo_url}
                      alt={data.tenant_name}
                      className="h-16 w-16 shrink-0 rounded-2xl border border-surface-200 bg-white object-contain p-2 dark:border-surface-700 dark:bg-surface-900"
                      onError={(event) => {
                        (event.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <div
                      className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-2xl font-bold text-white shadow-lg"
                      style={ctaStyle}
                    >
                      {data.tenant_name.slice(0, 1).toUpperCase()}
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="inline-flex items-center gap-2 rounded-full border border-surface-200 bg-surface-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-surface-600 dark:border-surface-700 dark:bg-surface-800/80 dark:text-surface-300">
                      <Store size={14} />
                      Compra online
                    </div>
                    <h1 className="mt-4 max-w-3xl text-4xl font-bold font-display leading-tight sm:text-5xl">
                      {data.branding.marketplace_headline || `Compra tu plan en ${data.tenant_name}`}
                    </h1>
                    <p className="mt-4 max-w-2xl text-base leading-7 text-surface-600 dark:text-surface-300">
                      {data.branding.marketplace_description || 'Elige tu plan, completa tus datos y continúa al pago seguro en pocos pasos.'}
                    </p>

                    <div className="mt-6 grid gap-3 sm:grid-cols-3">
                      {storefrontSummary.map((item) => (
                        <div key={item.label} className="rounded-[1.35rem] border border-surface-200 bg-[#fcfbf7] px-4 py-4 dark:border-surface-700 dark:bg-surface-800/70">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-surface-500 dark:text-surface-400">{item.label}</p>
                          <p className="mt-2 text-2xl font-bold font-display text-surface-900 dark:text-white">{item.value}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-6 flex flex-wrap gap-3 text-sm text-surface-600 dark:text-surface-300">
                  {data.city ? (
                    <span className="inline-flex items-center gap-2 rounded-full border border-surface-200 bg-white px-4 py-2 dark:border-surface-700 dark:bg-surface-900/80">
                      <MapPin size={15} />
                      {data.city}
                    </span>
                  ) : null}
                  {data.phone ? (
                    <span className="inline-flex items-center gap-2 rounded-full border border-surface-200 bg-white px-4 py-2 dark:border-surface-700 dark:bg-surface-900/80">
                      <Phone size={15} />
                      {data.phone}
                    </span>
                  ) : null}
                  {data.email ? (
                    <span className="inline-flex items-center gap-2 rounded-full border border-surface-200 bg-white px-4 py-2 dark:border-surface-700 dark:bg-surface-900/80">
                      <Mail size={15} />
                      {data.email}
                    </span>
                  ) : null}
                </div>

                <div className="mt-8 grid gap-4 md:grid-cols-3">
                  <div className="rounded-[1.5rem] border border-surface-200 bg-[#fcfbf7] p-5 dark:border-surface-700 dark:bg-surface-800/70">
                    <p className="text-sm font-semibold text-surface-900 dark:text-white">1. Elige tu plan</p>
                    <p className="mt-2 text-sm leading-6 text-surface-600 dark:text-surface-300">Compara duración, ahorro y beneficios sin perderte en detalles técnicos.</p>
                  </div>
                  <div className="rounded-[1.5rem] border border-surface-200 bg-[#fcfbf7] p-5 dark:border-surface-700 dark:bg-surface-800/70">
                    <p className="text-sm font-semibold text-surface-900 dark:text-white">2. Crea tu acceso</p>
                    <p className="mt-2 text-sm leading-6 text-surface-600 dark:text-surface-300">Deja tu correo, teléfono y, si quieres, tu contraseña para entrar apenas se confirme el pago.</p>
                  </div>
                  <div className="rounded-[1.5rem] border border-surface-200 bg-[#fcfbf7] p-5 dark:border-surface-700 dark:bg-surface-800/70">
                    <p className="text-sm font-semibold text-surface-900 dark:text-white">3. Paga y empieza</p>
                    <p className="mt-2 text-sm leading-6 text-surface-600 dark:text-surface-300">Te llevamos a un pago seguro y, si lo interrumpes, podrás retomar la compra desde aquí.</p>
                  </div>
                </div>
              </div>

              {hasMultiplePlans ? (
                <div className="rounded-[2rem] border border-white/60 bg-white/80 p-6 shadow-sm backdrop-blur-xl dark:border-surface-800/70 dark:bg-surface-900/82">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-2xl font-bold font-display">Elige tu plan</h2>
                      <p className="mt-1 text-sm text-surface-600 dark:text-surface-300">Te dejamos claro cuánto pagas hoy, cuánto ahorras y por cuánto tiempo te cubre.</p>
                    </div>
                    <span className="badge badge-neutral">{featuredPlans.length} opciones</span>
                  </div>

                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    {featuredPlans.map((plan) => {
                      const isSelected = plan.id === selectedPlan?.id;
                      const finalPrice = getDiscountedPrice(plan);
                      const savings = getDiscountAmount(plan);

                      return (
                        <button
                          key={plan.id}
                          type="button"
                          onClick={() => setForm((current) => ({ ...current, plan_id: plan.id }))}
                          style={isSelected ? ctaStyle : undefined}
                          className={`rounded-[1.5rem] border p-5 text-left transition-all ${
                            isSelected
                              ? 'border-transparent text-white shadow-xl shadow-surface-900/10'
                              : 'border-surface-200 bg-[#fcfbf7] hover:-translate-y-0.5 hover:border-surface-300 hover:bg-white dark:border-surface-700 dark:bg-surface-800/70 dark:hover:border-surface-600 dark:hover:bg-surface-800/90'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className={`text-lg font-semibold ${isSelected ? 'text-white' : 'text-surface-900 dark:text-white'}`}>{plan.name}</p>
                              <p className={`mt-1 text-sm ${isSelected ? 'text-surface-300' : 'text-surface-600 dark:text-surface-300'}`}>
                                {plan.description || 'Plan listo para contratar online.'}
                              </p>
                            </div>
                            {plan.is_featured ? (
                              <span className={`badge ${isSelected ? 'bg-white/15 text-white' : 'badge-info'}`}>
                                Recomendado
                              </span>
                            ) : null}
                          </div>

                          <div className="mt-5 flex flex-col gap-4">
                            <div className="flex items-end justify-between gap-3">
                              <div>
                                {plan.discount_pct ? (
                                  <>
                                    <div className="mb-1 flex items-center gap-1.5">
                                      <Tag size={11} className={isSelected ? 'text-white' : 'text-emerald-500'} />
                                      <span className={`text-xs font-bold ${isSelected ? 'text-white' : 'text-emerald-700'}`}>
                                        {plan.discount_pct}% descuento
                                      </span>
                                    </div>
                                    <div className="flex flex-wrap items-baseline gap-2">
                                      <p className={`text-3xl font-bold font-display ${isSelected ? 'text-white' : 'text-surface-900'}`}>
                                        {formatCurrency(finalPrice, plan.currency)}
                                      </p>
                                      <p className={`text-sm line-through ${isSelected ? 'text-white/50' : 'text-surface-400'}`}>
                                        {formatCurrency(plan.price, plan.currency)}
                                      </p>
                                    </div>
                                  </>
                                ) : (
                                  <p className={`text-3xl font-bold font-display ${isSelected ? 'text-white' : 'text-surface-900'}`}>
                                    {formatCurrency(plan.price, plan.currency)}
                                  </p>
                                )}
                                <p className={`mt-1 text-xs uppercase tracking-[0.18em] ${isSelected ? 'text-surface-300' : 'text-surface-500'}`}>
                                  {formatDurationLabel(plan.duration_type, plan.duration_days)}
                                </p>
                              </div>
                              <span className={`inline-flex items-center gap-2 text-sm font-semibold ${isSelected ? 'text-white' : 'text-surface-700'}`}>
                                {isSelected ? 'Seleccionado' : 'Elegir'}
                                <ChevronRight size={16} />
                              </span>
                            </div>

                            <div className={cn(
                              'grid gap-3 sm:grid-cols-2',
                              plan.discount_pct ? 'lg:grid-cols-3' : 'lg:grid-cols-2',
                            )}>
                              {plan.discount_pct ? (
                                <div className={`rounded-2xl border px-3 py-3 ${isSelected ? 'border-white/15 bg-white/10' : 'border-emerald-100 bg-emerald-50/90 dark:border-emerald-900/40 dark:bg-emerald-950/25'}`}>
                                  <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${isSelected ? 'text-white/70' : 'text-emerald-700'}`}>Ahorro</p>
                                  <p className={`mt-1 text-sm font-semibold ${isSelected ? 'text-white' : 'text-surface-900 dark:text-white'}`}>
                                    {formatCurrency(savings, plan.currency)}
                                  </p>
                                </div>
                              ) : null}

                              <div className={`rounded-2xl border px-3 py-3 ${isSelected ? 'border-white/15 bg-white/10' : 'border-surface-200 bg-white/90 dark:border-surface-700 dark:bg-surface-900/80'}`}>
                                <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${isSelected ? 'text-white/70' : 'text-surface-500 dark:text-surface-400'}`}>Vigencia</p>
                                <p className={`mt-1 text-sm font-semibold ${isSelected ? 'text-white' : 'text-surface-900 dark:text-white'}`}>
                                  {formatDurationLabel(plan.duration_type, plan.duration_days)}
                                </p>
                              </div>

                              <div className={`rounded-2xl border px-3 py-3 ${isSelected ? 'border-white/15 bg-white/10' : 'border-surface-200 bg-white/90 dark:border-surface-700 dark:bg-surface-900/80'}`}>
                                <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${isSelected ? 'text-white/70' : 'text-surface-500 dark:text-surface-400'}`}>Compra</p>
                                <p className={`mt-1 text-sm font-semibold ${isSelected ? 'text-white' : 'text-surface-900 dark:text-white'}`}>
                                  Online y segura
                                </p>
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {(data.upcoming_classes.length > 0 || data.branches.length > 0) ? (
                <div className="grid gap-6 lg:grid-cols-2">
                  {data.upcoming_classes.length > 0 ? (
                    <div className="rounded-[2rem] border border-white/60 bg-white/80 p-6 shadow-sm backdrop-blur-xl dark:border-surface-800/70 dark:bg-surface-900/82">
                      <h2 className="text-2xl font-bold font-display">Próximas clases</h2>
                      <div className="mt-5 space-y-3">
                        {data.upcoming_classes.slice(0, 3).map((item) => (
                          <div key={item.id} className="rounded-[1.25rem] border border-surface-200 bg-[#fcfbf7] px-4 py-4 dark:border-surface-700 dark:bg-surface-800/70">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <p className="font-semibold text-surface-900 dark:text-white">{item.name}</p>
                                <p className="mt-1 text-sm text-surface-600 dark:text-surface-300">
                                  {item.class_type || 'Clase general'} · {formatClassModalityLabel(item.modality)}
                                  {item.branch_name ? ` · ${item.branch_name}` : ''}
                                </p>
                              </div>
                              <div className="text-sm text-surface-600 dark:text-surface-300">
                                <div className="flex items-center gap-2">
                                  <CalendarDays size={15} />
                                  {formatDateTime(item.start_time)}
                                </div>
                                <div className="mt-1">Ocupación: {formatClassCapacityLabel(item.bookings, item.capacity)}</div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {data.branches.length > 0 ? (
                    <div className="rounded-[2rem] border border-white/60 bg-white/80 p-6 shadow-sm backdrop-blur-xl dark:border-surface-800/70 dark:bg-surface-900/82">
                      <h2 className="text-2xl font-bold font-display">Dónde encontrarnos</h2>
                      <div className="mt-5 space-y-3">
                        {data.branches.slice(0, 3).map((branch) => (
                          <div key={branch.id} className="rounded-[1.25rem] border border-surface-200 bg-[#fcfbf7] px-4 py-4 dark:border-surface-700 dark:bg-surface-800/70">
                            <p className="font-semibold text-surface-900 dark:text-white">{branch.name}</p>
                            <p className="mt-1 text-sm text-surface-600 dark:text-surface-300">{branch.address || 'Dirección por confirmar'}</p>
                            <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
                              {branch.city || 'Ciudad por confirmar'}{branch.phone ? ` · ${branch.phone}` : ''}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="space-y-6 xl:sticky xl:top-6 xl:self-start">
              <div className="rounded-[2rem] border border-surface-200 bg-white p-6 shadow-[0_40px_100px_-55px_rgba(15,23,42,0.4)] dark:border-surface-800 dark:bg-surface-900">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.2em] text-surface-500 dark:text-surface-400">Tu selección</p>
                    <h2 className="mt-2 text-3xl font-bold font-display">{selectedPlan?.name || 'Plan disponible'}</h2>
                    <p className="mt-2 text-sm leading-6 text-surface-600 dark:text-surface-300">
                      {selectedPlan?.description || 'Plan listo para comprar online y activar con el gimnasio.'}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-surface-200 bg-surface-50 px-4 py-3 text-left sm:min-w-[180px] sm:text-right dark:border-surface-700 dark:bg-surface-800/80">
                    <p className="text-xs uppercase tracking-[0.18em] text-surface-500 dark:text-surface-400">
                      {selectedPlan ? formatDurationLabel(selectedPlan.duration_type, selectedPlan.duration_days) : 'Disponible'}
                    </p>
                    <p className="mt-1 text-2xl font-bold font-display">
                      {selectedPlan ? formatCurrency(selectedFinalCheckoutPrice, selectedPlan.currency) : '--'}
                    </p>
                    {selectedPlan?.discount_pct ? (
                      <>
                        <p className="text-xs text-surface-400 line-through">
                          {formatCurrency(selectedPlan.price, selectedPlan.currency)}
                        </p>
                        <p className="mt-1 text-xs font-semibold text-emerald-700">
                          Ahorras {formatCurrency(selectedSavings, selectedPlan.currency)}
                        </p>
                      </>
                    ) : null}
                  </div>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-[1.25rem] border border-surface-200 bg-[#fcfbf7] p-4 dark:border-surface-700 dark:bg-surface-800/70">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-surface-500 dark:text-surface-400">Hoy pagas</p>
                    <p className="mt-2 text-lg font-bold font-display text-surface-900 dark:text-white">
                      {selectedPlan ? formatCurrency(selectedFinalCheckoutPrice, selectedPlan.currency) : '--'}
                    </p>
                  </div>
                  <div className="rounded-[1.25rem] border border-surface-200 bg-[#fcfbf7] p-4 dark:border-surface-700 dark:bg-surface-800/70">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-surface-500 dark:text-surface-400">Vigencia</p>
                    <p className="mt-2 text-lg font-bold font-display text-surface-900 dark:text-white">
                      {selectedPlan ? formatDurationLabel(selectedPlan.duration_type, selectedPlan.duration_days) : '--'}
                    </p>
                  </div>
                  <div className="rounded-[1.25rem] border border-surface-200 bg-[#fcfbf7] p-4 dark:border-surface-700 dark:bg-surface-800/70">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-surface-500 dark:text-surface-400">Acceso</p>
                    <p className="mt-2 text-lg font-bold font-display text-surface-900 dark:text-white">Desde cualquier dispositivo</p>
                  </div>
                </div>

                <div className="mt-5 rounded-[1.5rem] border border-surface-200 bg-[#fcfbf7] p-5 dark:border-surface-700 dark:bg-surface-800/70">
                  <div className="flex items-center gap-2 text-sm font-semibold text-surface-900 dark:text-white">
                    <Tag size={16} className="text-brand-600" />
                    Código promocional
                  </div>
                  <div className="mt-4 flex gap-2">
                    <input
                      type="text"
                      className="input flex-1 uppercase"
                      placeholder="Ej. BIENVENIDA10"
                      value={selectedPlan ? (promoInputByPlan[selectedPlan.id] ?? '') : ''}
                      onChange={(event) => {
                        if (!selectedPlan) return;
                        const nextValue = event.target.value.toUpperCase();
                        setPromoInputByPlan((current) => ({ ...current, [selectedPlan.id]: nextValue }));
                        if (promoResultByPlan[selectedPlan.id]) {
                          setPromoResultByPlan((current) => ({ ...current, [selectedPlan.id]: null }));
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && selectedPlan) {
                          event.preventDefault();
                          void validatePromoCode(selectedPlan.id);
                        }
                      }}
                      maxLength={50}
                      disabled={!selectedPlan}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!selectedPlan) return;
                        void validatePromoCode(selectedPlan.id);
                      }}
                      disabled={!selectedPlan || promoValidatingPlan === selectedPlan.id || !(selectedPlan ? (promoInputByPlan[selectedPlan.id] ?? '').trim() : '')}
                      className="btn-secondary whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {promoValidatingPlan === selectedPlan?.id ? 'Aplicando...' : 'Aplicar'}
                    </button>
                  </div>
                  {selectedPlan && selectedPromoResult?.valid ? (
                    <div className="mt-3 rounded-[1.1rem] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                      <p className="font-semibold">
                        {selectedPromoResult.discount_type === 'percent'
                          ? `${selectedPromoResult.discount_value}% de descuento adicional`
                          : `${formatCurrency(selectedPromoDiscountAmount, selectedPlan.currency)} de descuento adicional`}
                      </p>
                      <p className="mt-1 text-xs">
                        Total con promo: {formatCurrency(selectedFinalCheckoutPrice, selectedPlan.currency)}
                      </p>
                    </div>
                  ) : null}
                  {selectedPlan && selectedPromoResult && !selectedPromoResult.valid ? (
                    <div className="mt-3 rounded-[1.1rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                      {selectedPromoResult.reason || 'Este código no se pudo aplicar al plan seleccionado.'}
                    </div>
                  ) : null}
                </div>

                <div className="mt-5 rounded-[1.5rem] border border-surface-200 bg-[#fcfbf7] p-5 dark:border-surface-700 dark:bg-surface-800/70">
                  <div className="flex items-center gap-3 text-sm text-surface-600 dark:text-surface-300">
                    <ShieldCheck size={18} className="text-emerald-600" />
                    Pago seguro y confirmación del intento de compra en el momento
                  </div>
                  <div className="mt-3 flex items-center gap-3 text-sm text-surface-600 dark:text-surface-300">
                    <Clock3 size={18} className="text-surface-500 dark:text-surface-400" />
                    Flujo guiado para crear tu acceso y pagar sin vueltas
                  </div>
                  <div className="mt-3 flex items-center gap-3 text-sm text-surface-600 dark:text-surface-300">
                    <BadgeCheck size={18} className="text-brand-600" />
                    Si ya tienes cuenta con este correo, mantendremos tu acceso actual
                  </div>
                </div>

                <ul className="mt-6 space-y-3">
                  {selectedPlanHighlights.map((item) => (
                    <li key={item} className="flex items-start gap-3 text-sm leading-6 text-surface-700">
                      <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>

                <button
                  type="button"
                  onClick={() => {
                    if (!selectedPlan) {
                      return;
                    }

                    setCheckoutPlanLimitError('');
                    setForm((current) => ({ ...current, plan_id: selectedPlan.id }));
                    setShowCheckout(true);
                  }}
                  className="mt-8 btn-primary w-full py-4 text-base"
                  style={ctaStyle}
                  disabled={!checkoutReady}
                >
                  <CreditCard size={18} />
                  {checkoutReady ? 'Crear cuenta y pagar' : 'Compra online no disponible'}
                </button>

                <p className="mt-3 text-center text-sm text-surface-500 dark:text-surface-400">
                  {checkoutReady
                    ? 'Primero completarás tus datos y luego te llevaremos al pago seguro.'
                    : 'Este gimnasio aún no tiene la compra online habilitada.'}
                </p>
              </div>

              {resumeSession ? (
                <div className="rounded-[2rem] border border-surface-200 bg-white p-6 shadow-sm dark:border-surface-800 dark:bg-surface-900">
                  <h3 className="text-xl font-bold font-display">Retomar compra</h3>
                  <p className="mt-2 text-sm leading-6 text-surface-600 dark:text-surface-300">
                    Tienes una compra pendiente para {resumePlan?.name ?? 'tu plan seleccionado'}. Puedes seguir desde donde la dejaste.
                  </p>
                  <a href={resumeSession.checkout_url} className="mt-5 btn-primary w-full py-3">
                    Continuar al pago
                    <ArrowRight size={16} />
                  </a>
                </div>
              ) : null}

              <div className="rounded-[2rem] border border-surface-200 bg-white p-6 shadow-sm dark:border-surface-800 dark:bg-surface-900">
                <h3 className="text-xl font-bold font-display">Antes de pagar</h3>
                <ul className="mt-4 space-y-3 text-sm leading-6 text-surface-600 dark:text-surface-300">
                  <li className="flex items-start gap-3">
                    <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" />
                    Verifica bien tu correo para recibir acceso e instrucciones del gimnasio.
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" />
                    Si eliges crear tu cuenta ahora, después del pago podrás entrar con ese mismo correo.
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" />
                    Si detienes el pago, podrás retomarlo desde esta misma página sin volver a empezar.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Modal
        open={showCheckout}
        title={accountMode === 'create' && checkoutVerifyStep !== 'done' ? 'Verifica tu correo' : 'Crea tu cuenta y paga'}
        description={
          accountMode === 'create' && checkoutVerifyStep === 'email'
            ? 'Ingresa tu correo. Te enviamos un código de 6 dígitos para confirmarlo antes de continuar.'
            : accountMode === 'create' && checkoutVerifyStep === 'code'
            ? `Ingresaste ${form.customer_email}. Revisa tu bandeja y escribe el código de 6 dígitos.`
            : 'Completa tus datos, define cómo quieres acceder y te llevaremos a un pago seguro.'
        }
        size="lg"
        onClose={() => {
          if (!checkoutMutation.isPending && !checkoutVerifyLoading) {
            setShowCheckout(false);
            setCheckoutVerifyStep('email');
            setCheckoutVerifyCode('');
            setCheckoutVerifyToken('');
            setCheckoutVerifyError('');
            setCheckoutPlanLimitError('');
          }
        }}
      >
        {/* ── Email verification sub-steps (only for new account creation) ── */}
        {accountMode === 'create' && checkoutVerifyStep !== 'done' ? (
          <div className="space-y-5 py-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-200">
                {checkoutVerifyStep === 'email' ? 'Tu correo electrónico' : 'Código de verificación'}
              </label>
              {checkoutVerifyStep === 'email' ? (
                <input
                  type="email"
                  className="input"
                  value={form.customer_email}
                  onChange={(e) => setForm((c) => ({ ...c, customer_email: e.target.value }))}
                  placeholder="tu@email.com"
                  autoFocus
                  required
                />
              ) : (
                <input
                  ref={checkoutVerifyCodeRef}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  className="input text-center text-2xl font-mono tracking-[0.4em]"
                  value={checkoutVerifyCode}
                  onChange={(e) => setCheckoutVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="······"
                />
              )}
            </div>
            {checkoutVerifyError ? (
              <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{checkoutVerifyError}</p>
            ) : null}
            <div className="flex flex-col gap-2">
              {checkoutVerifyStep === 'email' ? (
                <button
                  type="button"
                  onClick={handleCheckoutSendCode}
                  disabled={checkoutVerifyLoading || !form.customer_email}
                  className="btn-primary flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {checkoutVerifyLoading ? <Loader2 size={16} className="animate-spin" /> : <>Enviar código <ArrowRight size={15} /></>}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleCheckoutConfirmCode}
                    disabled={checkoutVerifyLoading || checkoutVerifyCode.length !== 6}
                    className="btn-primary flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {checkoutVerifyLoading ? <Loader2 size={16} className="animate-spin" /> : <>Verificar y continuar <Check size={15} /></>}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setCheckoutVerifyStep('email'); setCheckoutVerifyCode(''); setCheckoutVerifyError(''); }}
                    className="text-center text-sm text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200"
                  >
                    Cambiar correo o reenviar código
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => { setAccountMode('existing'); setCheckoutVerifyStep('done'); setCheckoutVerifyToken(''); }}
                className="text-center text-sm text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200"
              >
                Ya tengo una cuenta, continuar con acceso existente
              </button>
            </div>
          </div>
        ) : (
        <form
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            setCheckoutPlanLimitError('');
            if (accountMode === 'create' && form.customer_password.trim().length < 8) {
              toast.error('Crea una contraseña de al menos 8 caracteres.');
              return;
            }
            if (accountMode === 'create' && form.customer_password !== form.customer_password_confirm) {
              toast.error('Las contraseñas no coinciden.');
              return;
            }
            checkoutMutation.mutate();
          }}
        >
          {checkoutPlanLimitError ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/10 dark:text-amber-200">
              {checkoutPlanLimitError}
            </div>
          ) : null}
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(260px,0.9fr)]">
            <div className="space-y-5">
              <div className="rounded-[1.5rem] border border-surface-200 bg-[#fcfbf7] p-5 dark:border-surface-700 dark:bg-surface-800/70">
                <div className="flex items-center gap-2 text-sm font-semibold text-surface-900 dark:text-white">
                  <UserRound size={16} className="text-brand-600" />
                  Tus datos
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="block sm:col-span-2">
                    <span className="mb-1.5 block text-sm font-medium text-surface-700">Nombre completo</span>
                    <input
                      className="input"
                      value={form.customer_name}
                      onChange={(event) => setForm((current) => ({ ...current, customer_name: event.target.value }))}
                      placeholder="Ej. Martina Gonzalez"
                      autoComplete="name"
                      required
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-surface-700">Correo</span>
                    <input
                      type="email"
                      className="input"
                      value={form.customer_email}
                      onChange={(event) => setForm((current) => ({ ...current, customer_email: event.target.value }))}
                      placeholder="tu@email.com"
                      autoComplete="email"
                      required
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-surface-700">Teléfono</span>
                    <input
                      className="input"
                      value={form.customer_phone}
                      onChange={(event) => setForm((current) => ({ ...current, customer_phone: event.target.value }))}
                      placeholder="+56 9 1234 5678"
                      autoComplete="tel"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-surface-700">Fecha de nacimiento</span>
                    <input
                      type="date"
                      className="input"
                      value={form.customer_date_of_birth}
                      onChange={(event) => setForm((current) => ({ ...current, customer_date_of_birth: event.target.value }))}
                    />
                    <span className="mt-1.5 block text-xs text-surface-500 dark:text-surface-400">Opcional. Nos ayuda a personalizar recordatorios y cumpleaños.</span>
                  </label>
                </div>
              </div>

              <div className="rounded-[1.5rem] border border-surface-200 bg-white p-5 dark:border-surface-800 dark:bg-surface-900">
                <div className="flex items-center gap-2 text-sm font-semibold text-surface-900 dark:text-white">
                  <LockKeyhole size={16} className="text-brand-600" />
                  Tu acceso
                </div>
                <p className="mt-2 text-sm leading-6 text-surface-600 dark:text-surface-300">
                  Puedes dejar tu cuenta lista ahora o seguir con tu acceso actual si ya habías usado este correo.
                </p>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setAccountMode('create')}
                    className={cn(
                      'rounded-[1.35rem] border p-4 text-left transition-all',
                      accountMode === 'create'
                        ? 'border-brand-300 bg-gradient-to-br from-brand-50 to-cyan-50 shadow-sm ring-1 ring-brand-100'
                        : 'border-surface-200 bg-[#fcfbf7] hover:border-surface-300 dark:border-surface-700 dark:bg-surface-800/70 dark:hover:border-surface-600',
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-surface-900 dark:text-white">Crear mi cuenta ahora</p>
                      <Sparkles size={16} className={accountMode === 'create' ? 'text-brand-600' : 'text-surface-400'} />
                    </div>
                    <p className="mt-2 text-sm leading-6 text-surface-600 dark:text-surface-300">
                      Dejas tu contraseña lista y, después del pago, ya puedes entrar con este correo.
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAccountMode('existing');
                      setForm((current) => ({ ...current, customer_password: '', customer_password_confirm: '' }));
                    }}
                    className={cn(
                      'rounded-[1.35rem] border p-4 text-left transition-all',
                      accountMode === 'existing'
                        ? 'border-amber-300 bg-gradient-to-br from-amber-50 to-orange-50 shadow-sm ring-1 ring-amber-100'
                        : 'border-surface-200 bg-[#fcfbf7] hover:border-surface-300 dark:border-surface-700 dark:bg-surface-800/70 dark:hover:border-surface-600',
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-surface-900 dark:text-white">
                        Ya tengo cuenta o la crearé después
                      </p>
                      <BadgeCheck size={16} className={accountMode === 'existing' ? 'text-amber-600' : 'text-surface-400'} />
                    </div>
                    <p className="mt-2 text-sm leading-6 text-surface-600 dark:text-surface-300">
                      Mantendremos tu acceso actual si este correo ya existe. Si aún no existe, te ayudaremos después del pago.
                    </p>
                  </button>
                </div>

                {accountMode === 'create' ? (
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-1.5 block text-sm font-medium text-surface-700">Contraseña</span>
                      <input
                        type="password"
                        className={cn('input', hasPasswordLengthError && 'border-red-300 focus:border-red-400 focus:ring-red-200')}
                        value={form.customer_password}
                        onChange={(event) => setForm((current) => ({ ...current, customer_password: event.target.value }))}
                        placeholder="Mínimo 8 caracteres"
                        autoComplete="new-password"
                        required={accountMode === 'create'}
                      />
                      <span className="mt-1.5 block text-xs text-surface-500 dark:text-surface-400">Úsala para entrar apenas se confirme el pago.</span>
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-sm font-medium text-surface-700">Confirmar contraseña</span>
                      <input
                        type="password"
                        className={cn('input', passwordMismatch && 'border-red-300 focus:border-red-400 focus:ring-red-200')}
                        value={form.customer_password_confirm}
                        onChange={(event) => setForm((current) => ({ ...current, customer_password_confirm: event.target.value }))}
                        placeholder="Repite tu contraseña"
                        autoComplete="new-password"
                        required={accountMode === 'create'}
                      />
                      {passwordMismatch ? (
                        <span className="mt-1.5 block text-xs font-medium text-red-600">Las contraseñas deben coincidir.</span>
                      ) : (
                        <span className="mt-1.5 block text-xs text-surface-500 dark:text-surface-400">Si este correo ya tenía cuenta, mantendremos esa clave actual.</span>
                      )}
                    </label>
                  </div>
                ) : null}
              </div>

              <div className="rounded-[1.25rem] border border-brand-100 bg-gradient-to-r from-brand-50 to-cyan-50 px-4 py-4 text-sm text-surface-700 dark:border-brand-900/50 dark:from-brand-950/30 dark:to-cyan-950/20 dark:text-surface-200">
                Al continuar, prepararemos tu compra y te redirigiremos a una pantalla segura para pagar.
              </div>
            </div>

            <div className="space-y-4">
              {selectedPlan ? (
                <div className="rounded-[1.5rem] border border-surface-200 bg-[#fcfbf7] p-5 dark:border-surface-700 dark:bg-surface-800/70">
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-surface-500 dark:text-surface-400">Resumen de tu compra</p>
                  <p className="mt-3 text-lg font-semibold text-surface-900 dark:text-white">{selectedPlan.name}</p>
                  <p className="mt-2 text-sm leading-6 text-surface-600 dark:text-surface-300">
                    {selectedPlan.description || 'Plan listo para contratar online.'}
                  </p>

                  <div className="mt-4 rounded-[1.25rem] border border-surface-200 bg-white p-4 dark:border-surface-700 dark:bg-surface-900/80">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.18em] text-surface-500 dark:text-surface-400">Hoy pagas</p>
                        <p className="mt-1 text-2xl font-bold font-display text-surface-900 dark:text-white">
                          {formatCurrency(selectedFinalCheckoutPrice, selectedPlan.currency)}
                        </p>
                        {selectedPlan.discount_pct ? (
                          <>
                            <p className="text-xs text-surface-400 line-through">
                              {formatCurrency(selectedPlan.price, selectedPlan.currency)}
                            </p>
                            <p className="mt-1 text-xs font-semibold text-emerald-700">
                              Ahorras {formatCurrency(selectedSavings, selectedPlan.currency)}
                            </p>
                          </>
                        ) : null}
                        {selectedPromoResult?.valid ? (
                          <p className="mt-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                            Promo aplicado: -{formatCurrency(selectedPromoDiscountAmount, selectedPlan.currency)}
                          </p>
                        ) : null}
                      </div>
                      <span className="rounded-full border border-surface-200 bg-surface-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-surface-500 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-400">
                        {formatDurationLabel(selectedPlan.duration_type, selectedPlan.duration_days)}
                      </span>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="rounded-[1.5rem] border border-surface-200 bg-white p-5 dark:border-surface-800 dark:bg-surface-900">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-surface-500 dark:text-surface-400">Qué pasará después</p>
                <ul className="mt-4 space-y-3 text-sm leading-6 text-surface-600 dark:text-surface-300">
                  <li className="flex items-start gap-3">
                    <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" />
                    Confirmaremos tu intento de compra y te llevaremos al pago seguro.
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" />
                    Si elegiste crear tu cuenta ahora, tu acceso quedará listo con este correo y contraseña.
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" />
                    Si detienes el pago, podrás volver y retomarlo desde esta misma tienda.
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <button type="button" className="btn-secondary" onClick={() => setShowCheckout(false)}>
              Cancelar
            </button>
            <button
              type="submit"
              className="btn-primary"
              style={ctaStyle}
              disabled={checkoutMutation.isPending || passwordMismatch || hasPasswordLengthError}
            >
              {checkoutMutation.isPending ? 'Preparando pago...' : checkoutActionLabel}
            </button>
          </div>
        </form>
        )}
      </Modal>
    </div>
  );
}
