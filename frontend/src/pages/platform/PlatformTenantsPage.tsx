import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, Building2, CheckCircle2, Clock3, Search, ShieldCheck, Store, WalletCards, Zap,
} from 'lucide-react';
import { NEXO_BRAND_SLOGAN } from '@/components/branding/NexoBrand';
import StatCard from '@/components/dashboard/StatCard';
import { billingApi } from '@/services/api';
import { fadeInUp, staggerContainer } from '@/utils/animations';
import { formatDate, formatDateTime } from '@/utils';
import type { AdminTenantBilling, PaginatedResponse } from '@/types';

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

export default function PlatformTenantsPage() {
  const [search, setSearch] = useState('');

  const { data, isLoading, isError, isFetching, refetch } = useQuery<PaginatedResponse<AdminTenantBilling>>({
    queryKey: ['platform-tenants'],
    queryFn: async () => {
      const response = await billingApi.listAdminTenants({ page: 1, per_page: 100 });
      return response.data;
    },
  });

  const tenants = data?.items ?? [];

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
          <button type="button" onClick={() => void refetch()} className="btn-secondary" disabled={isFetching}>
            {isFetching ? 'Actualizando...' : 'Actualizar'}
          </button>
        </div>
      </motion.div>

      {isError ? (
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
              {isLoading ? 'Cargando cuentas...' : `${filteredTenants.length} visibles de ${tenants.length} cuentas`}
            </p>
          </div>
          <div className="text-xs uppercase tracking-[0.18em] text-surface-400">
            Última actualización: {formatDateTime(new Date())}
          </div>
        </div>

        {isLoading ? (
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
              <div key={tenant.tenant_id} className="grid gap-4 px-5 py-5 xl:grid-cols-[1.4fr_0.9fr_0.8fr_0.9fr]">
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

                <div className="space-y-2 text-sm text-surface-500">
                  <p className="font-semibold text-surface-900 dark:text-white">Facturación</p>
                  <p>{tenant.checkout_enabled ? 'Pago online habilitado' : 'Cobro manual'}</p>
                  <p>{tenant.stripe_customer_id ? `Cliente Stripe: ${tenant.stripe_customer_id}` : 'Sin cliente Stripe'}</p>
                  <p>{tenant.stripe_subscription_id ? `Suscripción Stripe: ${tenant.stripe_subscription_id}` : 'Sin suscripción Stripe'}</p>
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
    </motion.div>
  );
}
