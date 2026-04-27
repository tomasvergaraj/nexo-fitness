import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  Ban,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock,
  CreditCard,
  Loader2,
  Receipt,
  RefreshCw,
  Tag,
  XCircle,
  Zap,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useSearchParams } from 'react-router-dom';
import { billingApi } from '@/services/api';
import type { OwnerPaymentItem, PaginatedResponse, ReactivateResponse, SaaSPlan, TenantBilling } from '@/types';
import { cn, getApiError } from '@/utils';
import { fadeInUp, staggerContainer } from '@/utils/animations';

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  stripe: 'Stripe',
  webpay: 'WebPay',
  fintoc: 'Fintoc',
  transfer: 'Transferencia',
  other: 'Otro',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Activo',
  trial: 'Período de prueba',
  suspended: 'Suspendido',
  expired: 'Vencido',
  cancelled: 'Cancelado',
};

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-emerald-400/20 text-emerald-100 border-emerald-300/30',
  trial: 'bg-amber-400/20 text-amber-100 border-amber-300/30',
  suspended: 'bg-red-400/20 text-red-100 border-red-300/30',
  expired: 'bg-white/10 text-white/80 border-white/20',
  cancelled: 'bg-white/10 text-white/80 border-white/20',
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  active: <CheckCircle2 size={28} className="text-white" />,
  trial: <Zap size={28} className="text-white" />,
  suspended: <Ban size={28} className="text-white" />,
  expired: <Clock size={28} className="text-white" />,
  cancelled: <XCircle size={28} className="text-white" />,
};

function formatCLP(amount: number) {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(amount);
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(value));
}

function daysUntil(value?: string | null): number | null {
  if (!value) return null;
  const diff = new Date(value).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86_400_000));
}

function licenseTypeLabel(type: string) {
  if (type === 'monthly') return 'Mensual';
  if (type === 'quarterly') return 'Trimestral';
  if (type === 'semi_annual') return 'Semestral';
  if (type === 'annual') return 'Anual';
  return type;
}

function periodLabel(type: string) {
  if (type === 'monthly') return 'por mes';
  if (type === 'quarterly') return 'por trimestre';
  if (type === 'semi_annual') return 'por 6 meses';
  if (type === 'annual') return 'por año';
  return '';
}

function StatusCard({ billing }: { billing: TenantBilling }) {
  const expiryField = billing.status === 'trial' ? billing.trial_ends_at : billing.license_expires_at;
  const days = daysUntil(expiryField);
  const icon = STATUS_ICON[billing.status] ?? STATUS_ICON.expired;
  const badge = STATUS_BADGE[billing.status] ?? STATUS_BADGE.expired;
  const label = STATUS_LABEL[billing.status] ?? billing.status;

  return (
    <div className="rounded-[2rem] border border-brand-200/40 bg-gradient-to-br from-brand-500 via-brand-600 to-brand-800 p-6 text-white shadow-2xl shadow-brand-500/20">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/15">
            {icon}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/60">Plan actual</p>
            <h2 className="mt-1 text-2xl font-bold font-display">{billing.plan_name}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={cn('rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide', badge)}>
                {label}
              </span>
              {billing.license_type && (
                <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium">
                  {licenseTypeLabel(billing.license_type)}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          {expiryField && (
            <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3">
              <p className="text-xs text-white/60">
                {billing.status === 'trial' ? 'Trial vence' : 'Vence el'}
              </p>
              <p className="mt-0.5 font-semibold">{formatDate(expiryField)}</p>
              {days !== null && days <= 30 && (
                <p className="mt-0.5 text-xs text-white/80">
                  {days === 0 ? 'Vence hoy' : `${days} día${days !== 1 ? 's' : ''} restante${days !== 1 ? 's' : ''}`}
                </p>
              )}
            </div>
          )}
          <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3">
            <p className="text-xs text-white/60">Miembros activos</p>
            <p className="mt-0.5 font-semibold">
              {billing.usage_active_clients}
              {billing.max_members ? <span className="text-white/60"> / {billing.max_members}</span> : null}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function NextPlanBanner({
  billing,
  onCancel,
  cancelling,
}: {
  billing: TenantBilling;
  onCancel: () => void;
  cancelling: boolean;
}) {
  if (!billing.next_plan_key || !billing.next_plan_name) return null;

  return (
    <motion.div
      variants={fadeInUp}
      className="flex items-center justify-between gap-4 rounded-2xl border border-violet-200 bg-violet-50 px-5 py-4 dark:border-violet-800/50 dark:bg-violet-950/20"
    >
      <div className="flex items-center gap-3">
        <CalendarClock size={20} className="shrink-0 text-violet-600 dark:text-violet-400" />
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-violet-900 dark:text-violet-200">
              Plan programado: <span className="text-violet-700 dark:text-violet-300">{billing.next_plan_name}</span>
            </p>
            {billing.next_plan_paid && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
                Pagado
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-violet-600 dark:text-violet-400">
            Entrará en vigor el {formatDate(billing.next_plan_starts_at)} cuando termine el ciclo actual.
          </p>
        </div>
      </div>
      {!billing.next_plan_paid && (
        <button
          type="button"
          onClick={onCancel}
          disabled={cancelling}
          className="shrink-0 rounded-xl border border-violet-200 bg-white px-3 py-2 text-xs font-semibold text-violet-700 transition-colors hover:bg-violet-50 disabled:opacity-50 dark:border-violet-700 dark:bg-violet-950/30 dark:text-violet-300 dark:hover:bg-violet-950/50"
        >
          {cancelling ? <Loader2 size={13} className="animate-spin" /> : 'Cancelar cambio'}
        </button>
      )}
    </motion.div>
  );
}

function PlanCard({
  plan,
  billing,
  onSelect,
  isLoading,
  selectedKey,
  selectedForce,
}: {
  plan: SaaSPlan;
  billing: TenantBilling;
  onSelect: (planKey: string, forceImmediate: boolean) => void;
  isLoading: boolean;
  selectedKey: string | null;
  selectedForce: boolean | null;
}) {
  const isCurrent = plan.key === billing.plan_key;
  const isNextPlan = plan.key === billing.next_plan_key;
  const isActive = billing.status === 'active' && billing.license_expires_at && new Date(billing.license_expires_at) > new Date();
  const isPendingSchedule = selectedKey === plan.key && isLoading && selectedForce === false;
  const isPendingImmediate = selectedKey === plan.key && isLoading && selectedForce === true;
  const anyLoading = isLoading;

  const expiryDate = billing.license_expires_at ? formatDate(billing.license_expires_at) : null;

  return (
    <div className={cn(
      'relative flex flex-col rounded-2xl border p-5 transition-all',
      isCurrent
        ? 'border-violet-300 bg-violet-50/60 dark:border-violet-700/60 dark:bg-violet-950/20'
        : isNextPlan
        ? 'border-dashed border-violet-300 bg-violet-50/30 dark:border-violet-700/40 dark:bg-violet-950/10'
        : 'border-surface-200/70 bg-white hover:border-violet-200 dark:border-surface-800 dark:bg-surface-900 dark:hover:border-violet-800/60',
      plan.highlighted && !isCurrent ? 'ring-2 ring-violet-300/50 dark:ring-violet-700/30' : '',
    )}>
      {plan.highlighted && !isCurrent && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-violet-600 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white shadow">
          Recomendado
        </span>
      )}
      {isCurrent && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-violet-700 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white shadow">
          Plan actual
        </span>
      )}

      <div className="mb-4">
        <p className="text-base font-bold text-surface-900 dark:text-white">{plan.name}</p>
        <p className="mt-1 text-xs text-surface-500">{plan.description}</p>
      </div>

      {/* Pricing: neto + IVA breakdown */}
      <div className="mb-4">
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-bold text-surface-900 dark:text-white">
            {formatCLP(Number(plan.price))}
          </span>
          {plan.discount_pct && Number(plan.discount_pct) > 0 ? (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
              -{plan.discount_pct}%
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs text-surface-500">neto · {periodLabel(plan.license_type)}</p>
        {Number(plan.tax_rate) > 0 && (
          <p className="mt-1 text-xs text-surface-400 dark:text-surface-500">
            + IVA {Number(plan.tax_rate)}% ({formatCLP(Number(plan.tax_amount))})
            {' '}→{' '}
            <span className="font-semibold text-surface-600 dark:text-surface-300">
              Total {formatCLP(Number(plan.total_price))}
            </span>
          </p>
        )}
      </div>

      <ul className="mb-5 space-y-1.5">
        {plan.features.slice(0, 4).map((f) => (
          <li key={f} className="flex items-start gap-2 text-xs text-surface-600 dark:text-surface-400">
            <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-violet-500" />
            {f}
          </li>
        ))}
      </ul>

      {/* CTAs */}
      <div className="mt-auto space-y-2">
        {/* "Pagar ahora" — only shown when there's an active subscription */}
        {isActive && !isNextPlan && (
          <button
            type="button"
            onClick={() => onSelect(plan.key, true)}
            disabled={anyLoading}
            className={cn(
              'flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all',
              'bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50',
            )}
          >
            {isPendingImmediate ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
            Pagar ahora
          </button>
        )}

        {/* Schedule / activate button */}
        {isNextPlan ? (
          <div className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-100 px-4 py-2.5 text-sm font-semibold text-violet-500 dark:bg-violet-950/30 dark:text-violet-400">
            <CalendarClock size={14} />
            Programado
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onSelect(plan.key, false)}
            disabled={anyLoading}
            className={cn(
              'flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all',
              isActive
                ? 'border border-violet-200 bg-white text-violet-700 hover:bg-violet-50 disabled:opacity-50 dark:border-violet-700/50 dark:bg-surface-800 dark:text-violet-300 dark:hover:bg-violet-950/20'
                : 'bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50',
            )}
          >
            {isPendingSchedule ? <Loader2 size={14} className="animate-spin" /> : null}
            {isActive ? (
              <>
                {!isPendingSchedule && <ChevronRight size={14} />}
                {isCurrent ? 'Renovar al vencer' : 'Cambiar al vencer'}
                {expiryDate && !isPendingSchedule ? <span className="text-[11px] opacity-60">({expiryDate})</span> : null}
              </>
            ) : (
              <>
                Activar ahora
                {!isPendingSchedule && <ChevronRight size={14} />}
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

function truncateRef(ref: string, max = 16): string {
  return ref.length > max ? `${ref.slice(0, max)}…` : ref;
}

function PaymentRow({ payment }: { payment: OwnerPaymentItem }) {
  const method = PAYMENT_METHOD_LABEL[payment.payment_method] ?? payment.payment_method;
  const ref = payment.external_reference ? truncateRef(payment.external_reference) : null;
  const isFuture = payment.starts_at && new Date(payment.starts_at) > new Date();
  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl border border-surface-200/70 p-4 dark:border-surface-800">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-50 dark:bg-violet-950/30">
          <Receipt size={16} className="text-violet-600 dark:text-violet-400" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-surface-900 dark:text-white">{payment.plan_name}</p>
            {isFuture && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                Próximo
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-surface-500">
            {method}{ref ? ` · ${ref}` : ''}
          </p>
          <p className="mt-0.5 text-xs text-surface-400">
            {formatDate(payment.starts_at)}
            {payment.expires_at ? ` → ${formatDate(payment.expires_at)}` : ''}
          </p>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold text-surface-900 dark:text-white">
          {formatCLP(Number(payment.total_amount))}
        </p>
        <p className="mt-0.5 text-xs text-surface-500">
          {payment.paid_at ? `Pagado ${formatDate(payment.paid_at)}` : formatDate(payment.created_at)}
        </p>
      </div>
    </div>
  );
}

export default function SubscriptionPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [promoCode, setPromoCode] = useState('');
  const [promoApplied, setPromoApplied] = useState<string | null>(null);
  const [selectedPlanKey, setSelectedPlanKey] = useState<string | null>(null);
  const [selectedForce, setSelectedForce] = useState<boolean | null>(null);
  const [paymentsPage, setPaymentsPage] = useState(1);

  useEffect(() => {
    const billing = searchParams.get('billing');
    if (billing === 'success') {
      toast.success('Pago procesado correctamente. Tu suscripción se actualizará en breve.');
      queryClient.invalidateQueries({ queryKey: ['owner-subscription'] });
      queryClient.invalidateQueries({ queryKey: ['owner-payments'] });
    } else if (billing === 'cancelled') {
      toast('Pago cancelado. Puedes intentarlo nuevamente cuando quieras.', { icon: 'ℹ️' });
    }
    if (billing) {
      setSearchParams((p) => { p.delete('billing'); return p; }, { replace: true });
    }
  }, []);

  const billingQuery = useQuery<TenantBilling>({
    queryKey: ['owner-subscription'],
    queryFn: async () => (await billingApi.currentSubscription()).data,
  });

  const plansQuery = useQuery<SaaSPlan[]>({
    queryKey: ['public-plans'],
    queryFn: async () => (await billingApi.listPublicPlans()).data,
  });

  const paymentsQuery = useQuery<PaginatedResponse<OwnerPaymentItem>>({
    queryKey: ['owner-payments', paymentsPage],
    queryFn: async () => (await billingApi.listPayments({ page: paymentsPage, per_page: 8 })).data,
  });

  const reactivateMutation = useMutation({
    mutationFn: async ({ planKey, forceImmediate }: { planKey: string; forceImmediate: boolean }) => {
      const base = window.location.origin + '/subscription';
      const data = await billingApi.reactivate({
        plan_key: planKey,
        promo_code: promoApplied ?? undefined,
        force_immediate: forceImmediate,
        success_url: `${base}?billing=success`,
        cancel_url: `${base}?billing=cancelled`,
      });
      return data.data as ReactivateResponse;
    },
    onSuccess: (result) => {
      setSelectedPlanKey(null);
      setSelectedForce(null);
      if (result.scheduled) {
        toast.success(`Plan "${result.next_plan_name}" programado para el ${formatDate(result.next_plan_starts_at)}.`);
        queryClient.invalidateQueries({ queryKey: ['owner-subscription'] });
      } else if (result.checkout_url) {
        window.location.href = result.checkout_url;
      }
    },
    onError: (error: unknown) => {
      setSelectedPlanKey(null);
      setSelectedForce(null);
      toast.error(getApiError(error, 'No se pudo procesar la solicitud'));
    },
  });

  const cancelNextPlanMutation = useMutation({
    mutationFn: () => billingApi.cancelNextPlan(),
    onSuccess: () => {
      toast.success('Plan programado cancelado.');
      queryClient.invalidateQueries({ queryKey: ['owner-subscription'] });
    },
    onError: (error: unknown) => {
      toast.error(getApiError(error, 'No se pudo cancelar el plan programado'));
    },
  });

  const handleSelectPlan = (planKey: string, forceImmediate: boolean) => {
    setSelectedPlanKey(planKey);
    setSelectedForce(forceImmediate);
    reactivateMutation.mutate({ planKey, forceImmediate });
  };

  const billing = billingQuery.data;
  const plans = plansQuery.data ?? [];
  const payments = paymentsQuery.data?.items ?? [];
  const paymentsTotal = paymentsQuery.data?.pages ?? 1;

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-6">
      <motion.div variants={fadeInUp}>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-violet-500">Cuenta</p>
        <h1 className="mt-2 text-3xl font-bold font-display text-surface-900 dark:text-white">Mi Suscripción</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-surface-500">
          Estado de tu plan, historial de pagos y opciones para renovar o cambiar de plan.
        </p>
      </motion.div>

      {billingQuery.isLoading ? (
        <div className="flex items-center justify-center py-24 text-surface-400">
          <Loader2 size={28} className="animate-spin" />
        </div>
      ) : billing ? (
        <>
          <motion.div variants={fadeInUp}>
            <StatusCard billing={billing} />
          </motion.div>

          {billing.next_plan_key ? (
            <NextPlanBanner
              billing={billing}
              onCancel={() => cancelNextPlanMutation.mutate()}
              cancelling={cancelNextPlanMutation.isPending}
            />
          ) : null}

          <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
            {/* Planes disponibles */}
            <motion.section variants={fadeInUp} className="rounded-3xl border border-surface-200/60 bg-white p-5 dark:border-surface-800/60 dark:bg-surface-900">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <CreditCard size={16} className="text-violet-500" />
                    <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Planes disponibles</h2>
                  </div>
                  <p className="mt-1 text-sm text-surface-500">Selecciona un plan para renovar o programar el cambio.</p>
                </div>

                {/* Promo code */}
                <div className="flex shrink-0 items-center gap-2">
                  <div className="relative">
                    <Tag size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                    <input
                      type="text"
                      value={promoCode}
                      onChange={(e) => setPromoCode(e.target.value)}
                      placeholder="Código promo"
                      className="input w-36 py-2 pl-8 pr-3 text-xs"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (promoCode.trim()) setPromoApplied(promoCode.trim());
                      else { setPromoApplied(null); }
                    }}
                    className="rounded-xl border border-surface-200 bg-white px-3 py-2 text-xs font-semibold text-surface-700 hover:bg-surface-50 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-200"
                  >
                    {promoApplied ? 'Quitar' : 'Aplicar'}
                  </button>
                </div>
              </div>

              {promoApplied && (
                <div className="mb-4 flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm text-violet-700 dark:border-violet-800/50 dark:bg-violet-950/20 dark:text-violet-300">
                  <Tag size={14} />
                  Código aplicado: <span className="font-semibold">{promoApplied}</span>
                </div>
              )}

              {plansQuery.isLoading ? (
                <div className="flex justify-center py-12 text-surface-400">
                  <Loader2 size={22} className="animate-spin" />
                </div>
              ) : plans.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-surface-300 px-4 py-10 text-center dark:border-surface-700">
                  <p className="text-sm text-surface-500">No hay planes disponibles</p>
                </div>
              ) : (
                <div className="mt-2 grid gap-4 sm:grid-cols-2">
                  {plans.map((plan) => (
                    <PlanCard
                      key={plan.key}
                      plan={plan}
                      billing={billing}
                      onSelect={handleSelectPlan}
                      isLoading={reactivateMutation.isPending}
                      selectedKey={selectedPlanKey}
                      selectedForce={selectedForce}
                    />
                  ))}
                </div>
              )}

              {billing.status === 'active' && billing.license_expires_at && (
                <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700 dark:border-amber-800/50 dark:bg-amber-950/20 dark:text-amber-300">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>
                    Tu plan está activo hasta el <strong>{formatDate(billing.license_expires_at)}</strong>.
                    {' '}<strong>Pagar ahora</strong> inicia un checkout inmediato. <strong>Al vencer</strong> lo programa para esa fecha.
                  </span>
                </div>
              )}
            </motion.section>

            {/* Historial de pagos */}
            <motion.section variants={fadeInUp} className="rounded-3xl border border-surface-200/60 bg-white p-5 dark:border-surface-800/60 dark:bg-surface-900">
              <div className="mb-5 flex items-center gap-2">
                <RefreshCw size={16} className="text-violet-500" />
                <div>
                  <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Historial de pagos</h2>
                  <p className="mt-0.5 text-sm text-surface-500">Todos los ciclos facturados.</p>
                </div>
                {paymentsQuery.isFetching ? <Loader2 size={15} className="ml-auto animate-spin text-surface-400" /> : null}
              </div>

              <div className="space-y-3">
                {payments.length === 0 && !paymentsQuery.isLoading ? (
                  <div className="rounded-2xl border border-dashed border-surface-300 px-4 py-10 text-center dark:border-surface-700">
                    <Receipt size={24} className="mx-auto mb-2 text-surface-300" />
                    <p className="text-sm text-surface-500">Aún no hay pagos registrados</p>
                  </div>
                ) : payments.map((p) => (
                  <PaymentRow key={p.id} payment={p} />
                ))}
              </div>

              {paymentsTotal > 1 && (
                <div className="mt-4 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setPaymentsPage((prev) => Math.max(1, prev - 1))}
                    disabled={paymentsPage === 1 || paymentsQuery.isFetching}
                    className="rounded-xl border border-surface-200 px-3 py-1.5 text-xs font-medium text-surface-600 hover:bg-surface-50 disabled:opacity-40 dark:border-surface-700 dark:text-surface-400"
                  >
                    Anterior
                  </button>
                  <span className="text-xs text-surface-500">
                    Página {paymentsPage} de {paymentsTotal}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPaymentsPage((prev) => Math.min(paymentsTotal, prev + 1))}
                    disabled={paymentsPage >= paymentsTotal || paymentsQuery.isFetching}
                    className="rounded-xl border border-surface-200 px-3 py-1.5 text-xs font-medium text-surface-600 hover:bg-surface-50 disabled:opacity-40 dark:border-surface-700 dark:text-surface-400"
                  >
                    Siguiente
                  </button>
                </div>
              )}
            </motion.section>
          </div>
        </>
      ) : (
        <div className="flex items-center justify-center py-24 text-surface-400">
          <p className="text-sm">No se pudo cargar la información de suscripción.</p>
        </div>
      )}
    </motion.div>
  );
}
