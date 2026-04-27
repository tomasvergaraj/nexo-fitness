import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  Ban,
  Check,
  Clock,
  GitBranch,
  Loader2,
  LogOut,
  Mail,
  Tag,
  Users,
  XCircle,
  Zap,
} from 'lucide-react';
import toast from 'react-hot-toast';
import NexoBrand from '@/components/branding/NexoBrand';
import { useAuthStore } from '@/stores/authStore';
import { billingApi } from '@/services/api';
import type { BillingQuote, SaaSPlan } from '@/types';
import { cn, getApiError, getDefaultRouteForRole } from '@/utils';

interface BillingStatus {
  status: string;
  allow_access: boolean;
  detail: string | null;
  days_remaining: number | null;
  trial_ends_at: string | null;
  license_expires_at: string | null;
  checkout_url: string | null;
  plan_key?: string | null;
  plan_name: string;
}

const STATUS_CONFIG: Record<string, {
  title: string;
  description: string;
  Icon: typeof Clock;
  orbColor: string;
  accentFrom: string;
  accentTo: string;
  accentShadow: string;
}> = {
  expired: {
    title: 'Tu suscripción ha vencido',
    description: 'Elige un plan para recuperar el acceso a NexoFitness.',
    Icon: Clock,
    orbColor: 'bg-amber-500/10',
    accentFrom: 'from-amber-400',
    accentTo: 'to-amber-600',
    accentShadow: 'shadow-amber-500/30',
  },
  trial: {
    title: 'Tu período de prueba terminó',
    description: 'Activa tu suscripción para seguir gestionando tu gimnasio.',
    Icon: Zap,
    orbColor: 'bg-brand-500/10',
    accentFrom: 'from-brand-400',
    accentTo: 'to-brand-600',
    accentShadow: 'shadow-brand-500/30',
  },
  suspended: {
    title: 'Cuenta suspendida',
    description: 'Tu cuenta fue suspendida. Reactiva tu plan o contacta a soporte.',
    Icon: Ban,
    orbColor: 'bg-red-500/10',
    accentFrom: 'from-red-400',
    accentTo: 'to-red-600',
    accentShadow: 'shadow-red-500/30',
  },
  cancelled: {
    title: 'Suscripción cancelada',
    description: 'Elige un plan para reactivar tu cuenta.',
    Icon: XCircle,
    orbColor: 'bg-surface-400/10',
    accentFrom: 'from-surface-400',
    accentTo: 'to-surface-600',
    accentShadow: 'shadow-surface-500/30',
  },
};

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatInterval(interval: SaaSPlan['billing_interval']) {
  if (interval === 'year') return '/año';
  if (interval === 'quarter') return '/trimestre';
  if (interval === 'semi_annual') return '/semestre';
  return '/mes';
}

export default function BillingWallPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { logout, user } = useAuthStore();

  const statusParam = searchParams.get('status') || 'expired';
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [plans, setPlans] = useState<SaaSPlan[]>([]);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [promoCode, setPromoCode] = useState('');
  const [quote, setQuote] = useState<BillingQuote | null>(null);
  const [quotedPromoCode, setQuotedPromoCode] = useState('');
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteFeedback, setQuoteFeedback] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    Promise.all([
      billingApi.getStatus().then(({ data }) => data).catch(() => ({
        status: statusParam,
        allow_access: false,
        detail: null,
        days_remaining: null,
        trial_ends_at: null,
        license_expires_at: null,
        checkout_url: null,
        plan_key: null,
        plan_name: '',
      })),
      billingApi.listPublicPlans().then(({ data }) => data).catch(() => []),
    ])
      .then(([billingData, plansData]) => {
        setBilling(billingData);
        const checkoutPlans = (plansData as SaaSPlan[]).filter((plan) => plan.checkout_enabled);
        setPlans(checkoutPlans);

        const currentKey = checkoutPlans.find((plan) => plan.key === billingData.plan_key)?.key
          ?? checkoutPlans.find((plan) => plan.name.toLowerCase() === billingData.plan_name?.toLowerCase())?.key
          ?? checkoutPlans.find((plan) => plan.highlighted)?.key
          ?? checkoutPlans[0]?.key
          ?? null;
        setSelectedPlan(currentKey);
      })
      .finally(() => setLoadingStatus(false));
  }, [statusParam]);

  useEffect(() => {
    if (billing?.allow_access) {
      navigate(getDefaultRouteForRole(user?.role), { replace: true });
    }
  }, [billing, navigate, user?.role]);

  useEffect(() => {
    setQuote(null);
    setQuotedPromoCode('');
    setQuoteFeedback(null);
  }, [selectedPlan]);

  const selectedPlanData = useMemo(
    () => plans.find((plan) => plan.key === selectedPlan) ?? null,
    [plans, selectedPlan],
  );

  const breakdown = useMemo(() => {
    if (!selectedPlanData) {
      return null;
    }

    const activeQuote = quote?.plan_key === selectedPlan ? quote : null;
    return {
      currency: activeQuote?.currency ?? selectedPlanData.currency,
      basePrice: Number(activeQuote?.base_price ?? selectedPlanData.price),
      discount: Number(activeQuote?.promo_discount_amount ?? 0),
      subtotal: Number(activeQuote?.taxable_subtotal ?? selectedPlanData.price),
      taxRate: Number(activeQuote?.tax_rate ?? selectedPlanData.tax_rate),
      taxAmount: Number(activeQuote?.tax_amount ?? selectedPlanData.tax_amount),
      totalAmount: Number(activeQuote?.total_amount ?? selectedPlanData.total_price),
      valid: activeQuote?.valid ?? true,
      reason: activeQuote?.reason ?? null,
      promoCodeId: activeQuote?.promo_code_id ?? null,
    };
  }, [quote, selectedPlan, selectedPlanData]);

  const handleQuote = async () => {
    if (!selectedPlan) return;

    setQuoteLoading(true);
    setQuoteFeedback(null);

    try {
      const code = promoCode.trim();
      const { data } = await billingApi.quote({
        plan_key: selectedPlan,
        ...(code ? { promo_code: code } : {}),
      });

      setQuote(data);

      if (!data.valid) {
        setQuotedPromoCode('');
        setQuoteFeedback(data.reason || 'No se pudo validar el código promocional.');
        return;
      }

      setQuotedPromoCode(code.toUpperCase());
      if (code) {
        setQuoteFeedback('Código promocional aplicado. El IVA se calculó sobre el neto descontado.');
      } else {
        setQuoteFeedback('Cotización actualizada.');
      }
    } catch (error) {
      setQuote(null);
      setQuotedPromoCode('');
      setQuoteFeedback(getApiError(error, 'No pudimos calcular el total del plan.'));
    } finally {
      setQuoteLoading(false);
    }
  };

  const handleClearPromo = () => {
    setPromoCode('');
    setQuote(null);
    setQuotedPromoCode('');
    setQuoteFeedback(null);
  };

  const handleReactivate = async () => {
    if (!selectedPlan) return;

    const normalizedPromo = promoCode.trim();
    if (
      normalizedPromo
      && (
        !quote
        || quote.plan_key !== selectedPlan
        || !quote.valid
        || !quote.promo_code_id
        || normalizedPromo.toUpperCase() !== quotedPromoCode
      )
    ) {
      toast.error('Valida el código promocional antes de continuar al pago.');
      return;
    }

    setRedirecting(true);
    try {
      const { data } = await billingApi.reactivate({
        plan_key: selectedPlan,
        promo_code_id: normalizedPromo ? quote?.promo_code_id ?? null : null,
      });
      if (data.checkout_url) {
        window.location.href = data.checkout_url;
        return;
      }
      toast.error('No hay pago online disponible para este plan. Contacta a soporte.');
    } catch (error) {
      toast.error(getApiError(error, 'No pudimos iniciar el checkout.'));
    } finally {
      setRedirecting(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const effectiveStatus = billing?.status || statusParam;
  const config = STATUS_CONFIG[effectiveStatus] || STATUS_CONFIG.expired;
  const canReactivate = ['owner', 'admin'].includes(user?.role || '');
  const isSuspended = effectiveStatus === 'suspended' && plans.length === 0;
  const { Icon } = config;

  if (loadingStatus) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-950">
        <Loader2 className="w-8 h-8 text-brand-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-surface-950 px-4 py-6 sm:px-6 sm:py-10">
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-br from-surface-950 via-surface-900 to-brand-950" />
        <motion.div
          animate={{ x: [0, 80, -40, 0], y: [0, -60, 50, 0], scale: [1, 1.2, 0.9, 1] }}
          transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
          className={cn('absolute top-1/4 left-1/4 w-96 h-96 rounded-full blur-[100px]', config.orbColor)}
        />
        <motion.div
          animate={{ x: [0, -60, 50, 0], y: [0, 80, -40, 0], scale: [1, 0.9, 1.1, 1] }}
          transition={{ duration: 25, repeat: Infinity, ease: 'linear' }}
          className="absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full bg-violet-500/8 blur-[100px]"
        />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px),
                              linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)`,
            backgroundSize: '60px 60px',
          }}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="relative w-full max-w-3xl"
      >
        <div className="mb-6 sm:mb-8">
          <NexoBrand
            className="justify-center"
            align="center"
            iconSize={36}
            iconClassName="shadow-lg shadow-brand-500/25"
            titleClassName="text-xl sm:text-2xl"
            accentClassName="text-brand-400"
          />
        </div>

        <div className="rounded-[1.75rem] border border-white/10 bg-white/5 p-5 shadow-2xl backdrop-blur-2xl sm:rounded-3xl sm:p-8">
          <div className="mb-7 flex flex-col items-center text-center sm:mb-8">
            <motion.div
              initial={{ scale: 0, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ delay: 0.2, type: 'spring', stiffness: 200, damping: 15 }}
              className={cn(
                'mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br shadow-2xl sm:h-14 sm:w-14',
                config.accentFrom,
                config.accentTo,
                config.accentShadow,
              )}
            >
              <Icon size={24} className="text-white sm:hidden" />
              <Icon size={28} className="hidden text-white sm:block" />
            </motion.div>
            <h2 className="mb-1 text-xl font-bold font-display text-white sm:text-2xl">{config.title}</h2>
            <p className="max-w-xl text-sm text-surface-400">{billing?.detail || config.description}</p>
          </div>

          {canReactivate && !isSuspended ? (
            <>
              {plans.length > 0 && (
                <div className="mb-6">
                  <p className="text-xs font-medium text-surface-500 uppercase tracking-wider mb-3">
                    Elige tu plan
                  </p>
                  <div className="grid gap-3">
                    <AnimatePresence>
                      {plans.map((plan, index) => {
                        const isSelected = selectedPlan === plan.key;
                        const isCurrent = plan.key === billing?.plan_key
                          || plan.name.toLowerCase() === billing?.plan_name?.toLowerCase();
                        return (
                          <motion.button
                            key={plan.key}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.1 + index * 0.05 }}
                            onClick={() => setSelectedPlan(plan.key)}
                            className={cn(
                              'w-full text-left rounded-2xl border p-4 transition-all duration-200',
                              isSelected
                                ? 'border-brand-500/50 bg-brand-500/10 ring-1 ring-brand-500/30'
                                : 'border-white/10 bg-white/3 hover:bg-white/5 hover:border-white/20',
                            )}
                          >
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className={cn('font-semibold text-sm', isSelected ? 'text-white' : 'text-surface-200')}>
                                    {plan.name}
                                  </span>
                                  {isCurrent ? (
                                    <span className="px-2 py-0.5 rounded-full text-xs bg-brand-500/20 text-brand-300 border border-brand-500/20">
                                      Plan actual
                                    </span>
                                  ) : null}
                                  {plan.highlighted && !isCurrent ? (
                                    <span className="px-2 py-0.5 rounded-full text-xs bg-amber-500/20 text-amber-300 border border-amber-500/20">
                                      Recomendado
                                    </span>
                                  ) : null}
                                </div>
                                <div className="flex flex-wrap items-center gap-3 text-xs text-surface-500">
                                  <span className="flex items-center gap-1">
                                    <Users size={11} />
                                    {plan.max_members.toLocaleString()} miembros
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <GitBranch size={11} />
                                    {plan.max_branches} sucursal{plan.max_branches !== 1 ? 'es' : ''}
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center justify-between gap-3 sm:shrink-0 sm:justify-end">
                                <div className="sm:text-right">
                                  <p className={cn('font-bold text-sm tabular-nums', isSelected ? 'text-brand-300' : 'text-surface-300')}>
                                    {formatMoney(plan.price, plan.currency)}{formatInterval(plan.billing_interval)}
                                  </p>
                                  <p className="text-[11px] text-surface-500">Valor neto + IVA 19%</p>
                                  <p className="text-xs text-surface-400">
                                    Total: {formatMoney(plan.total_price, plan.currency)}
                                  </p>
                                </div>
                                <div className={cn(
                                  'w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all',
                                  isSelected ? 'border-brand-500 bg-brand-500' : 'border-white/20',
                                )}>
                                  {isSelected ? <Check size={11} className="text-white" strokeWidth={3} /> : null}
                                </div>
                              </div>
                            </div>
                          </motion.button>
                        );
                      })}
                    </AnimatePresence>
                  </div>
                </div>
              )}

              {selectedPlanData && breakdown ? (
                <div className="mb-6 rounded-2xl border border-white/10 bg-black/20 p-5">
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,360px)] xl:items-start">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white">Código promocional</p>
                      <p className="mt-1 text-sm text-surface-400">
                        El descuento se aplica solo al valor neto del plan. El IVA 19% se calcula después.
                      </p>
                      <div className="mt-4 space-y-3">
                        <div className="rounded-2xl border border-brand-500/30 bg-brand-500/10 p-3">
                          <label htmlFor="promo-code" className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-brand-200">
                            Código promocional
                          </label>
                          <div className="relative min-w-0">
                            <Tag size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-200/80" />
                            <input
                              id="promo-code"
                              type="text"
                              value={promoCode}
                              onChange={(event) => {
                                const nextValue = event.target.value.toUpperCase();
                                setPromoCode(nextValue);
                                if (quotedPromoCode && nextValue.trim() !== quotedPromoCode) {
                                  setQuote(null);
                                  setQuotedPromoCode('');
                                  setQuoteFeedback(null);
                                }
                              }}
                              placeholder="Ingresa tu código"
                              className="h-12 w-full rounded-xl border border-white/20 bg-surface-950/80 pl-10 pr-3 text-sm text-white outline-none transition-colors placeholder:text-surface-500 focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"
                            />
                          </div>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <button
                            type="button"
                            onClick={() => void handleQuote()}
                            disabled={quoteLoading}
                            className="btn-secondary w-full justify-center text-center whitespace-nowrap text-sm"
                          >
                            {quoteLoading ? 'Cotizando...' : promoCode.trim() ? 'Validar y cotizar' : 'Actualizar total'}
                          </button>
                          {promoCode ? (
                            <button
                              type="button"
                              onClick={handleClearPromo}
                              className="inline-flex w-full items-center justify-center rounded-xl border border-white/10 px-4 py-2 text-sm text-surface-300 transition-colors hover:bg-white/5 md:whitespace-nowrap"
                            >
                              Limpiar
                            </button>
                          ) : (
                            <div className="hidden md:block" />
                          )}
                        </div>
                      </div>
                      {quoteFeedback ? (
                        <div
                          className={cn(
                            'mt-3 rounded-xl border px-3 py-2 text-sm',
                            quote && quote.plan_key === selectedPlan && quote.valid
                              ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
                              : 'border-amber-500/20 bg-amber-500/10 text-amber-200',
                          )}
                        >
                          {quoteFeedback}
                        </div>
                      ) : null}
                    </div>

                    <div className="w-full rounded-2xl border border-white/10 bg-white/[0.03] p-4 xl:max-w-[360px]">
                      <div className="space-y-3 text-sm text-surface-300">
                        <div className="flex items-center justify-between gap-3">
                          <span>Valor del plan</span>
                          <span className="font-medium">{formatMoney(breakdown.basePrice, breakdown.currency)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>Descuento promo</span>
                          <span className={cn('font-medium', breakdown.discount > 0 ? 'text-emerald-300' : 'text-surface-400')}>
                            -{formatMoney(breakdown.discount, breakdown.currency)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>Subtotal afecto</span>
                          <span className="font-medium">{formatMoney(breakdown.subtotal, breakdown.currency)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>IVA {breakdown.taxRate}%</span>
                          <span className="font-medium">{formatMoney(breakdown.taxAmount, breakdown.currency)}</span>
                        </div>
                        <div className="h-px bg-white/10" />
                        <div className="flex items-center justify-between gap-3 text-sm sm:text-base">
                          <span className="font-semibold text-white">Total Webpay</span>
                          <span className="font-bold text-brand-300">{formatMoney(breakdown.totalAmount, breakdown.currency)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              <motion.button
                onClick={handleReactivate}
                disabled={redirecting || !selectedPlan}
                whileHover={{ scale: redirecting ? 1 : 1.01 }}
                whileTap={{ scale: redirecting ? 1 : 0.98 }}
                className={cn(
                  'w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-semibold',
                  'bg-gradient-to-r from-brand-500 to-brand-600 text-white',
                  'shadow-xl shadow-brand-500/25 hover:shadow-brand-500/40',
                  'transition-all duration-300',
                  (redirecting || !selectedPlan) && 'opacity-70 cursor-not-allowed',
                )}
              >
                {redirecting ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <>
                    Continuar al pago
                    <ArrowRight size={16} />
                  </>
                )}
              </motion.button>
            </>
          ) : canReactivate && isSuspended ? (
            <a
              href="mailto:soporte@nexofitness.com"
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-semibold
                         bg-gradient-to-r from-red-500 to-red-600 text-white
                         shadow-xl shadow-red-500/25 hover:shadow-red-500/40 transition-all duration-300"
            >
              <Mail size={16} />
              Contactar soporte
            </a>
          ) : (
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-sm text-surface-400 text-center">
              Contacta al administrador de tu cuenta para renovar la suscripción.
            </div>
          )}

          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 mt-3 py-2.5 px-4 rounded-xl
                       text-sm text-surface-500 hover:text-surface-200 hover:bg-white/5
                       transition-all duration-200"
          >
            <LogOut size={14} />
            Cerrar sesión
          </button>
        </div>

        <p className="text-center text-xs text-surface-600 mt-6">
          NexoFitness · Gestión de gimnasios
        </p>
      </motion.div>
    </div>
  );
}
