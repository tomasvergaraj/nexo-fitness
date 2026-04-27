import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock3,
  Search,
  ShieldCheck,
  Store,
  WalletCards,
  Zap,
} from 'lucide-react';
import { NEXO_BRAND_SLOGAN } from '@/components/branding/NexoBrand';
import Modal from '@/components/ui/Modal';
import StatCard from '@/components/dashboard/StatCard';
import { billingApi } from '@/services/api';
import { fadeInUp, staggerContainer } from '@/utils/animations';
import { formatCurrency, formatDate, formatDateTime, getApiError, parseApiNumber } from '@/utils';
import type {
  AdminSaaSPlan,
  AdminTenantBilling,
  AdminTenantManualPaymentRequest,
  PaginatedResponse,
  PlatformPromoCode,
} from '@/types';

type ManualPaymentFormState = {
  plan_key: string;
  starts_at: string;
  promo_code_id: string;
  transfer_reference: string;
  notes: string;
};

const statusLabels: Record<string, string> = {
  active: 'Activo',
  trial: 'En prueba',
  suspended: 'Suspendido',
  expired: 'Vencido',
  cancelled: 'Cancelado',
};

const statusClasses: Record<string, string> = {
  active: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300',
  trial: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/40 dark:bg-sky-950/20 dark:text-sky-300',
  suspended: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300',
  expired: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300',
  cancelled: 'border-surface-300 bg-surface-100 text-surface-700 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-300',
};

const planLabels: Record<string, string> = {
  monthly: 'Mensual',
  quarterly: 'Trimestral',
  semi_annual: 'Semestral',
  annual: 'Anual',
  perpetual: 'Perpetuo',
};

function statusLabel(status: string): string {
  return statusLabels[status] ?? status;
}

function statusClass(status: string): string {
  return statusClasses[status] ?? statusClasses.cancelled;
}

function planLabel(planKey: string): string {
  return planLabels[planKey] ?? planKey;
}

function todayDateValue() {
  return new Date().toISOString().slice(0, 10);
}

function buildManualPaymentForm(
  tenant: AdminTenantBilling | null,
  plans: AdminSaaSPlan[],
): ManualPaymentFormState {
  const fallbackPlan = plans.find((plan) => plan.is_active) ?? plans[0];
  return {
    plan_key: tenant?.plan_key || fallbackPlan?.key || '',
    starts_at: todayDateValue(),
    promo_code_id: '',
    transfer_reference: '',
    notes: '',
  };
}

function getPromoPreview(plan: AdminSaaSPlan | null, promo: PlatformPromoCode | null) {
  if (!plan) {
    return null;
  }

  const baseAmount = parseApiNumber(plan.price);
  const taxRate = parseApiNumber(plan.tax_rate);

  if (!promo) {
    const taxAmount = parseApiNumber(plan.tax_amount);
    const totalAmount = parseApiNumber(plan.total_price);
    return {
      baseAmount,
      discountAmount: 0,
      subtotal: baseAmount,
      taxRate,
      taxAmount,
      totalAmount,
      valid: true,
      reason: null as string | null,
    };
  }

  const now = Date.now();
  if (!promo.is_active) {
    return {
      baseAmount,
      discountAmount: 0,
      subtotal: baseAmount,
      taxRate,
      taxAmount: Math.round(baseAmount * taxRate / 100),
      totalAmount: Math.round(baseAmount * (1 + taxRate / 100)),
      valid: false,
      reason: 'El promo code está inactivo.',
    };
  }

  if (promo.expires_at && new Date(promo.expires_at).getTime() < now) {
    return {
      baseAmount,
      discountAmount: 0,
      subtotal: baseAmount,
      taxRate,
      taxAmount: Math.round(baseAmount * taxRate / 100),
      totalAmount: Math.round(baseAmount * (1 + taxRate / 100)),
      valid: false,
      reason: 'El promo code ya expiró.',
    };
  }

  if (promo.max_uses != null && promo.uses_count >= promo.max_uses) {
    return {
      baseAmount,
      discountAmount: 0,
      subtotal: baseAmount,
      taxRate,
      taxAmount: Math.round(baseAmount * taxRate / 100),
      totalAmount: Math.round(baseAmount * (1 + taxRate / 100)),
      valid: false,
      reason: 'El promo code ya no tiene usos disponibles.',
    };
  }

  if (promo.plan_keys?.length && !promo.plan_keys.includes(plan.key)) {
    return {
      baseAmount,
      discountAmount: 0,
      subtotal: baseAmount,
      taxRate,
      taxAmount: Math.round(baseAmount * taxRate / 100),
      totalAmount: Math.round(baseAmount * (1 + taxRate / 100)),
      valid: false,
      reason: 'El promo code no aplica a este plan.',
    };
  }

  const rawDiscount = promo.discount_type === 'percent'
    ? Math.round(baseAmount * parseApiNumber(promo.discount_value) / 100)
    : parseApiNumber(promo.discount_value);
  const discountAmount = Math.min(baseAmount, rawDiscount);
  const subtotal = Math.max(baseAmount - discountAmount, 0);
  const taxAmount = Math.round(subtotal * taxRate / 100);
  const totalAmount = subtotal + taxAmount;

  return {
    baseAmount,
    discountAmount,
    subtotal,
    taxRate,
    taxAmount,
    totalAmount,
    valid: true,
    reason: null as string | null,
  };
}

export default function PlatformTenantsPage() {
  const [search, setSearch] = useState('');
  const [manualPaymentTenant, setManualPaymentTenant] = useState<AdminTenantBilling | null>(null);
  const [manualPaymentForm, setManualPaymentForm] = useState<ManualPaymentFormState>({
    plan_key: '',
    starts_at: todayDateValue(),
    promo_code_id: '',
    transfer_reference: '',
    notes: '',
  });

  const tenantsQuery = useQuery<PaginatedResponse<AdminTenantBilling>>({
    queryKey: ['platform-tenants'],
    queryFn: async () => {
      const response = await billingApi.listAdminTenants({ page: 1, per_page: 100 });
      return response.data;
    },
  });

  const plansQuery = useQuery<AdminSaaSPlan[]>({
    queryKey: ['platform-saas-plans'],
    queryFn: async () => (await billingApi.listAdminPlans()).data,
  });

  const promoCodesQuery = useQuery<PlatformPromoCode[]>({
    queryKey: ['platform-promo-codes'],
    queryFn: async () => (await billingApi.listAdminPromoCodes()).data,
  });

  const registerManualPayment = useMutation({
    mutationFn: async ({ tenantId, payload }: { tenantId: string; payload: AdminTenantManualPaymentRequest }) => {
      const response = await billingApi.registerTenantManualPayment(tenantId, payload);
      return response.data;
    },
    onSuccess: async (result: any) => {
      const expiry = result?.license_expires_at ? ` Vence ${formatDate(result.license_expires_at)}.` : '';
      toast.success(`Transferencia registrada.${expiry}`);
      setManualPaymentTenant(null);
      await Promise.all([
        tenantsQuery.refetch(),
        promoCodesQuery.refetch(),
      ]);
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No se pudo registrar la transferencia.'));
    },
  });

  const tenants = tenantsQuery.data?.items ?? [];
  const plans = plansQuery.data ?? [];
  const promoCodes = promoCodesQuery.data ?? [];

  useEffect(() => {
    if (!manualPaymentTenant) {
      return;
    }
    setManualPaymentForm(buildManualPaymentForm(manualPaymentTenant, plans));
  }, [manualPaymentTenant, plans]);

  const filteredTenants = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) {
      return tenants;
    }

    return tenants.filter((tenant) =>
      [
        tenant.tenant_name,
        tenant.tenant_slug,
        tenant.owner_email,
        tenant.owner_name,
        tenant.plan_name,
        tenant.plan_key,
        tenant.status,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearch))
    );
  }, [search, tenants]);

  const summary = useMemo(() => {
    const active = tenants.filter((tenant) => tenant.status === 'active').length;
    const trial = tenants.filter((tenant) => tenant.status === 'trial').length;
    const atRisk = tenants.filter((tenant) => ['suspended', 'expired', 'cancelled'].includes(tenant.status)).length;
    const checkoutReady = tenants.filter((tenant) => tenant.checkout_enabled).length;

    return { active, trial, atRisk, checkoutReady };
  }, [tenants]);

  const selectedManualPlan = useMemo(
    () => plans.find((plan) => plan.key === manualPaymentForm.plan_key) ?? null,
    [manualPaymentForm.plan_key, plans],
  );

  const selectedManualPromo = useMemo(
    () => promoCodes.find((promo) => promo.id === manualPaymentForm.promo_code_id) ?? null,
    [manualPaymentForm.promo_code_id, promoCodes],
  );

  const manualPreview = useMemo(
    () => getPromoPreview(selectedManualPlan, selectedManualPromo),
    [selectedManualPlan, selectedManualPromo],
  );

  const activePromoCodes = useMemo(
    () => promoCodes.filter((promo) => promo.is_active),
    [promoCodes],
  );

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-6">
      <motion.div variants={fadeInUp} className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-brand-200/50 bg-brand-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-brand-700 dark:border-brand-900/40 dark:bg-brand-950/20 dark:text-brand-300">
            <ShieldCheck size={14} />
            {NEXO_BRAND_SLOGAN}
          </div>
          <h1 className="mt-3 text-2xl font-bold font-display text-surface-900 dark:text-white">Cuentas SaaS y ventas online</h1>
          <p className="mt-1 text-sm text-surface-500">
            Vista operativa para seguir pruebas, activaciones, propietarios y capacidad del SaaS.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link to="/platform/plans" className="btn-secondary">
            Administrar planes
          </Link>
          <Link to="/platform/promo-codes" className="btn-secondary">
            Promo codes SaaS
          </Link>
          <div className="relative min-w-[280px]">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por gimnasio, propietario, plan o slug"
              className="input w-full pl-9"
            />
          </div>
          <button type="button" onClick={() => void tenantsQuery.refetch()} className="btn-secondary" disabled={tenantsQuery.isFetching}>
            {tenantsQuery.isFetching ? 'Actualizando...' : 'Actualizar'}
          </button>
        </div>
      </motion.div>

      {tenantsQuery.isError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-600 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
          No pudimos cargar las cuentas SaaS. Revisa el backend o tu sesión de superadmin.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Cuentas totales" value={tenants.length} icon={Building2} color="brand" />
        <StatCard label="Cuentas activas" value={summary.active} icon={CheckCircle2} color="emerald" />
        <StatCard label="Pruebas en curso" value={summary.trial} icon={Clock3} color="blue" />
        <StatCard label="Cobro online listo" value={summary.checkoutReady} icon={WalletCards} color="violet" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <motion.div variants={fadeInUp} className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-surface-500">Riesgo de churn</p>
              <p className="mt-1 text-2xl font-bold font-display text-surface-900 dark:text-white">{summary.atRisk}</p>
            </div>
            <div className="rounded-xl bg-amber-50 p-3 text-amber-500 dark:bg-amber-950/20">
              <AlertTriangle size={20} />
            </div>
          </div>
          <p className="mt-3 text-sm text-surface-500">
            Cuentas suspendidas, vencidas o canceladas que deberían entrar a seguimiento comercial.
          </p>
        </motion.div>

        <motion.div variants={fadeInUp} className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-surface-500">Propietarios registrados</p>
              <p className="mt-1 text-2xl font-bold font-display text-surface-900 dark:text-white">
                {tenants.filter((tenant) => tenant.owner_email).length}
              </p>
            </div>
            <div className="rounded-xl bg-sky-50 p-3 text-sky-500 dark:bg-sky-950/20">
              <Store size={20} />
            </div>
          </div>
          <p className="mt-3 text-sm text-surface-500">
            Cada cuenta llega con propietario creado para activar el alta, la prueba y el pago online.
          </p>
        </motion.div>

        <motion.div variants={fadeInUp} className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-surface-500">Pruebas / activas</p>
              <p className="mt-1 text-2xl font-bold font-display text-surface-900 dark:text-white">
                {summary.trial} / {summary.active}
              </p>
            </div>
            <div className="rounded-xl bg-brand-50 p-3 text-brand-500 dark:bg-brand-950/20">
              <Zap size={20} />
            </div>
          </div>
          <p className="mt-3 text-sm text-surface-500">
            Balance rápido entre adquisición y conversión del embudo actual del SaaS.
          </p>
        </motion.div>
      </div>

      <motion.div variants={fadeInUp} className="overflow-hidden rounded-2xl border border-surface-200/50 bg-white dark:border-surface-800/50 dark:bg-surface-900">
        <div className="flex flex-col gap-2 border-b border-surface-100 px-5 py-4 dark:border-surface-800 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-surface-900 dark:text-white">Cuentas SaaS</h2>
            <p className="text-sm text-surface-500">
              {tenantsQuery.isLoading ? 'Cargando cuentas...' : `${filteredTenants.length} visibles de ${tenants.length} cuentas`}
            </p>
          </div>
          <div className="text-xs uppercase tracking-[0.18em] text-surface-400">
            Última actualización: {formatDateTime(new Date())}
          </div>
        </div>

        {tenantsQuery.isLoading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-20 animate-pulse rounded-2xl bg-surface-100 dark:bg-surface-800/60" />
            ))}
          </div>
        ) : filteredTenants.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-base font-semibold text-surface-900 dark:text-white">No encontramos cuentas con ese filtro</p>
            <p className="mt-2 text-sm text-surface-500">Prueba buscando por slug, propietario o estado.</p>
          </div>
        ) : (
          <div className="divide-y divide-surface-100 dark:divide-surface-800">
            {filteredTenants.map((tenant) => (
              <div key={tenant.tenant_id} className="grid gap-4 px-5 py-5 xl:grid-cols-[1.35fr_0.9fr_0.8fr_1fr]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-surface-900 dark:text-white">{tenant.tenant_name}</h3>
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusClass(tenant.status)}`}>
                      {statusLabel(tenant.status)}
                    </span>
                    <span className="inline-flex rounded-full border border-surface-200 bg-surface-50 px-2.5 py-1 text-xs font-medium text-surface-600 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-300">
                      {tenant.plan_name || planLabel(tenant.plan_key)}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-xs text-surface-500">{tenant.tenant_slug}</p>
                  <div className="mt-3 space-y-1 text-sm text-surface-500">
                    <p>
                      <span className="font-medium text-surface-700 dark:text-surface-300">Propietario:</span>{' '}
                      {tenant.owner_name ? `${tenant.owner_name} - ${tenant.owner_email}` : tenant.owner_email ?? 'Sin propietario'}
                    </p>
                    <p>
                      <span className="font-medium text-surface-700 dark:text-surface-300">Creado:</span>{' '}
                      {formatDate(tenant.created_at)}
                    </p>
                  </div>
                </div>

                <div className="space-y-2 text-sm text-surface-500">
                  <p className="font-semibold text-surface-900 dark:text-white">Capacidad</p>
                  <p>Miembros: {tenant.max_members ?? 0}</p>
                  <p>Sedes: {tenant.max_branches ?? 0}</p>
                  <p>Moneda: {tenant.currency}</p>
                </div>

                <div className="space-y-2 text-sm text-surface-500">
                  <p className="font-semibold text-surface-900 dark:text-white">Ciclo</p>
                  <p>Prueba: {tenant.trial_ends_at ? formatDate(tenant.trial_ends_at) : 'No aplica'}</p>
                  <p>Vence: {tenant.license_expires_at ? formatDate(tenant.license_expires_at) : 'Sin fecha'}</p>
                  <p>Acceso: {tenant.is_active ? 'Habilitado' : 'Bloqueado'}</p>
                </div>

                <div className="space-y-3 text-sm text-surface-500">
                  <div>
                    <p className="font-semibold text-surface-900 dark:text-white">Facturación</p>
                    <p>{tenant.checkout_enabled ? 'Pago online habilitado' : 'Cobro manual'}</p>
                    <p>{tenant.stripe_customer_id ? `Cliente Stripe: ${tenant.stripe_customer_id}` : 'Sin cliente Stripe'}</p>
                    <p>{tenant.stripe_subscription_id ? `Suscripción Stripe: ${tenant.stripe_subscription_id}` : 'Sin suscripción Stripe'}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setManualPaymentTenant(tenant)}
                    className="btn-secondary w-full"
                  >
                    Registrar transferencia
                  </button>
                </div>

                {tenant.features.length ? (
                  <div className="xl:col-span-4">
                    <div className="flex flex-wrap gap-2">
                      {tenant.features.map((feature) => (
                        <span
                          key={`${tenant.tenant_id}-${feature}`}
                          className="rounded-full bg-surface-100 px-2.5 py-1 text-xs font-medium text-surface-600 dark:bg-surface-800 dark:text-surface-300"
                        >
                          {feature}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </motion.div>

      <Modal
        open={Boolean(manualPaymentTenant)}
        title={manualPaymentTenant ? `Registrar transferencia de ${manualPaymentTenant.tenant_name}` : 'Registrar transferencia'}
        description="La activación manual usa la duración del plan seleccionado y calcula automáticamente el vencimiento desde la fecha de inicio."
        onClose={() => !registerManualPayment.isPending && setManualPaymentTenant(null)}
        size="lg"
      >
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!manualPaymentTenant) return;
            registerManualPayment.mutate({
              tenantId: manualPaymentTenant.tenant_id,
              payload: {
                plan_key: manualPaymentForm.plan_key,
                starts_at: manualPaymentForm.starts_at,
                payment_method: 'transfer',
                promo_code_id: manualPaymentForm.promo_code_id || null,
                transfer_reference: manualPaymentForm.transfer_reference.trim(),
                notes: manualPaymentForm.notes.trim() || undefined,
              },
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Plan SaaS</label>
              <select
                className="input"
                value={manualPaymentForm.plan_key}
                onChange={(event) => setManualPaymentForm((current) => ({ ...current, plan_key: event.target.value }))}
                required
              >
                <option value="">Selecciona un plan</option>
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.key}>
                    {plan.name} · Neto {formatCurrency(parseApiNumber(plan.price), plan.currency)} · Total {formatCurrency(parseApiNumber(plan.total_price), plan.currency)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Fecha de inicio</label>
              <input
                type="date"
                className="input"
                value={manualPaymentForm.starts_at}
                onChange={(event) => setManualPaymentForm((current) => ({ ...current, starts_at: event.target.value }))}
                required
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Promo code SaaS opcional</label>
              <select
                className="input"
                value={manualPaymentForm.promo_code_id}
                onChange={(event) => setManualPaymentForm((current) => ({ ...current, promo_code_id: event.target.value }))}
              >
                <option value="">Sin promo code</option>
                {activePromoCodes.map((promo) => (
                  <option key={promo.id} value={promo.id}>
                    {promo.code} · {promo.discount_type === 'percent' ? `${promo.discount_value}%` : formatCurrency(parseApiNumber(promo.discount_value), 'CLP')}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Referencia de transferencia</label>
              <input
                className="input"
                value={manualPaymentForm.transfer_reference}
                onChange={(event) => setManualPaymentForm((current) => ({ ...current, transfer_reference: event.target.value }))}
                placeholder="TRX-20260421-001"
                required
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Notas internas</label>
            <textarea
              className="input min-h-28 resize-y"
              value={manualPaymentForm.notes}
              onChange={(event) => setManualPaymentForm((current) => ({ ...current, notes: event.target.value }))}
              placeholder="Detalles del depósito, banco, confirmación o acuerdo comercial."
            />
          </div>

          {selectedManualPlan && manualPreview ? (
            <div className="rounded-2xl border border-surface-200 bg-surface-50 p-4 dark:border-surface-800 dark:bg-surface-950/50">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-sm font-semibold text-surface-900 dark:text-white">Preview de cobro</p>
                  <p className="mt-1 text-sm text-surface-500">
                    El backend recalcula este monto al registrar la transferencia y activa el tenant con la duración del plan.
                  </p>
                  {manualPreview.reason ? (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
                      {manualPreview.reason}
                    </div>
                  ) : null}
                </div>
                <div className="min-w-[280px] rounded-2xl border border-surface-200 bg-white p-4 text-sm dark:border-surface-800 dark:bg-surface-900">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-surface-500">Valor neto</span>
                      <span className="font-medium text-surface-900 dark:text-white">{formatCurrency(manualPreview.baseAmount, selectedManualPlan.currency)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-surface-500">Descuento</span>
                      <span className="font-medium text-emerald-600 dark:text-emerald-300">-{formatCurrency(manualPreview.discountAmount, selectedManualPlan.currency)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-surface-500">Subtotal afecto</span>
                      <span className="font-medium text-surface-900 dark:text-white">{formatCurrency(manualPreview.subtotal, selectedManualPlan.currency)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-surface-500">IVA {manualPreview.taxRate}%</span>
                      <span className="font-medium text-surface-900 dark:text-white">{formatCurrency(manualPreview.taxAmount, selectedManualPlan.currency)}</span>
                    </div>
                    <div className="h-px bg-surface-200 dark:bg-surface-800" />
                    <div className="flex items-center justify-between gap-3 text-base">
                      <span className="font-semibold text-surface-900 dark:text-white">Total</span>
                      <span className="font-bold text-brand-700 dark:text-brand-300">{formatCurrency(manualPreview.totalAmount, selectedManualPlan.currency)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setManualPaymentTenant(null)}
              disabled={registerManualPayment.isPending}
            >
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={registerManualPayment.isPending}>
              {registerManualPayment.isPending ? 'Registrando...' : 'Registrar transferencia'}
            </button>
          </div>
        </form>
      </Modal>
    </motion.div>
  );
}
