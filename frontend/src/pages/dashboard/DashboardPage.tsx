import { useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Navigate, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  DollarSign, Users, CalendarDays, ClipboardCheck, AlertTriangle, TrendingUp, UserCheck, ArrowUpRight,
  Cake, Clock, CreditCard, Rocket, User,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { AreaChart, Area, BarChart, Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import StatCard from '@/components/dashboard/StatCard';
import OnboardingChecklist from '@/components/dashboard/OnboardingChecklist';
import { billingApi, dashboardApi } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { staggerContainer, fadeInUp } from '@/utils/animations';
import { cn, formatCurrency, getApiError, parseApiNumber } from '@/utils';
import type { DashboardMetrics, DayPanel, SaaSPlan, TenantBilling } from '@/types';

function billingStatusLabel(status?: TenantBilling['status']) {
  if (status === 'trial') return 'En prueba';
  if (status === 'active') return 'Activa';
  if (status === 'expired') return 'Vencida';
  if (status === 'cancelled') return 'Cancelada';
  if (status === 'suspended') return 'Suspendida';
  return 'Sin estado';
}

function billingStatusBadge(status?: TenantBilling['status']) {
  if (status === 'trial') return 'badge badge-warning';
  if (status === 'active') return 'badge badge-success';
  if (status === 'expired') return 'badge badge-danger';
  if (status === 'cancelled' || status === 'suspended') return 'badge badge-neutral';
  return 'badge badge-neutral';
}

function licenseTypeLabel(licenseType?: TenantBilling['license_type']) {
  if (licenseType === 'annual') return 'Anual';
  if (licenseType === 'perpetual') return 'Perpetua';
  return 'Mensual';
}

function billingDateLabel(subscription?: TenantBilling | null) {
  if (!subscription) return 'Sin fecha disponible';
  if (subscription.status === 'trial' && subscription.trial_ends_at) {
    return `Prueba hasta ${new Date(subscription.trial_ends_at).toLocaleDateString('es-CL')}`;
  }
  if (subscription.license_expires_at) {
    return `Vigente hasta ${new Date(subscription.license_expires_at).toLocaleDateString('es-CL')}`;
  }
  if (subscription.license_type === 'perpetual') {
    return 'Acceso sin vencimiento';
  }
  return 'Fecha de vigencia no informada';
}

function usageRatio(used: number, limit?: number) {
  if (!limit || limit <= 0) return 0;
  return Math.min((used / limit) * 100, 100);
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const canViewSubscription = user?.role === 'owner' || user?.role === 'admin';

  if (user?.role === 'superadmin') {
    return <Navigate to="/platform/tenants" replace />;
  }

  const { data, error, isLoading, isError } = useQuery<DashboardMetrics>({
    queryKey: ['dashboard-metrics'],
    queryFn: async () => {
      const response = await dashboardApi.getMetrics();
      return response.data;
    },
    retry: false,
  });

  const dashboardError = isError
    ? getApiError(error, 'No pudimos cargar el dashboard. Revisa el backend o vuelve a iniciar sesión.')
    : null;

  const { data: todayData } = useQuery<DayPanel>({
    queryKey: ['dashboard-today'],
    queryFn: async () => (await dashboardApi.getToday()).data,
    refetchInterval: 60_000,
  });

  const { data: subscriptionData } = useQuery<TenantBilling>({
    queryKey: ['tenant-current-subscription'],
    queryFn: async () => (await billingApi.currentSubscription()).data,
    enabled: canViewSubscription,
    retry: false,
  });

  const { data: publicPlans = [] } = useQuery<SaaSPlan[]>({
    queryKey: ['platform-public-plans'],
    queryFn: async () => (await billingApi.listPublicPlans()).data,
    enabled: canViewSubscription,
    staleTime: 60_000,
  });

  const upgradePlan = useMutation({
    mutationFn: async (planKey: string) => (await billingApi.reactivate(planKey)).data as { checkout_url?: string },
    onSuccess: (payload) => {
      if (payload.checkout_url) {
        window.location.href = payload.checkout_url;
        return;
      }
      toast.error('No encontramos un checkout disponible para mejorar tu plan.');
    },
    onError: (error: unknown) => {
      toast.error(getApiError(error, 'No pudimos iniciar el upgrade del plan.'));
    },
  });

  const revenueData = useMemo(() => ([
    { label: 'Hoy', value: parseApiNumber(data?.revenue_today) },
    { label: 'Semana', value: parseApiNumber(data?.revenue_week) },
    { label: 'Mes', value: parseApiNumber(data?.revenue_month) },
  ]), [data?.revenue_month, data?.revenue_today, data?.revenue_week]);

  const operationalData = useMemo(() => ([
    { label: 'Clases', value: data?.classes_today ?? 0 },
    { label: 'Reservas', value: data?.reservations_today ?? 0 },
    { label: 'Check-ins', value: data?.checkins_today ?? 0 },
  ]), [data?.checkins_today, data?.classes_today, data?.reservations_today]);

  const nextUpgradePlan = useMemo(() => {
    if (!subscriptionData) {
      return null;
    }

    return [...publicPlans]
      .filter((plan) => plan.checkout_enabled && plan.key !== subscriptionData.plan_key)
      .sort((left, right) => {
        const leftCapacity = left.max_members + left.max_branches * 1000;
        const rightCapacity = right.max_members + right.max_branches * 1000;
        return leftCapacity - rightCapacity;
      })
      .find((plan) =>
        plan.max_members > (subscriptionData.max_members ?? 0)
        || plan.max_branches > (subscriptionData.max_branches ?? 0),
      ) ?? null;
  }, [publicPlans, subscriptionData]);

  const quotaNeedsAttention = Boolean(
    subscriptionData
      && (
        subscriptionData.over_client_limit
        || subscriptionData.over_branch_limit
        || subscriptionData.remaining_client_slots === 0
        || subscriptionData.remaining_branch_slots === 0
      ),
  );

  return (
    <motion.div
      variants={staggerContainer}
      initial="initial"
      animate="animate"
      className="space-y-6"
    >
      <motion.div variants={fadeInUp} className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Dashboard</h1>
          <p className="mt-1 text-sm text-surface-500">
            {isLoading ? 'Cargando métricas del negocio...' : 'Resumen operativo del negocio'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => navigate('/classes')}
            className="btn-secondary text-sm"
          >
            <CalendarDays size={16} />
            Ver clases
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => navigate('/reports')}
            className="btn-primary text-sm"
          >
            <ArrowUpRight size={16} />
            Ver reportes
          </motion.button>
        </div>
      </motion.div>

      {isError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-600 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
          {dashboardError}
        </div>
      ) : null}

      {canViewSubscription && subscriptionData ? (
        <motion.div
          variants={fadeInUp}
          className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-brand-200/50 bg-brand-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-brand-700 dark:border-brand-900/40 dark:bg-brand-950/20 dark:text-brand-300">
                <CreditCard size={14} />
                Plan Contratado
              </div>
              <h2 className="mt-3 text-2xl font-bold font-display text-surface-900 dark:text-white">
                {subscriptionData.plan_name || 'Sin plan asignado'}
              </h2>
              <p className="mt-1 text-sm text-surface-500">
                {licenseTypeLabel(subscriptionData.license_type)} · {billingDateLabel(subscriptionData)}
              </p>
            </div>
            <span className={billingStatusBadge(subscriptionData.status)}>
              {billingStatusLabel(subscriptionData.status)}
            </span>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-surface-50 px-4 py-3 dark:bg-surface-800/40">
              <p className="text-xs uppercase tracking-[0.18em] text-surface-500">Clave</p>
              <p className="mt-1 font-semibold text-surface-900 dark:text-white">{subscriptionData.plan_key}</p>
            </div>
            <div className="rounded-xl bg-surface-50 px-4 py-3 dark:bg-surface-800/40">
              <p className="text-xs uppercase tracking-[0.18em] text-surface-500">Miembros incluidos</p>
              <p className="mt-1 font-semibold text-surface-900 dark:text-white">
                {subscriptionData.max_members ? subscriptionData.max_members.toLocaleString('es-CL') : 'Sin límite visible'}
              </p>
            </div>
            <div className="rounded-xl bg-surface-50 px-4 py-3 dark:bg-surface-800/40">
              <p className="text-xs uppercase tracking-[0.18em] text-surface-500">Sucursales incluidas</p>
              <p className="mt-1 font-semibold text-surface-900 dark:text-white">
                {subscriptionData.max_branches ?? 'Sin límite visible'}
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-surface-200/70 bg-surface-50 px-4 py-4 dark:border-surface-800/70 dark:bg-surface-800/30">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-surface-500">Uso de clientes</p>
                  <p className="mt-1 font-semibold text-surface-900 dark:text-white">
                    {subscriptionData.usage_active_clients.toLocaleString('es-CL')} / {(subscriptionData.max_members ?? 0).toLocaleString('es-CL')}
                  </p>
                </div>
                <span className={cn(
                  'badge',
                  subscriptionData.over_client_limit
                    ? 'badge-danger'
                    : subscriptionData.remaining_client_slots === 0
                      ? 'badge-warning'
                      : 'badge-success',
                )}>
                  {subscriptionData.over_client_limit
                    ? 'Sobrecupo'
                    : subscriptionData.remaining_client_slots === 0
                      ? 'Sin cupos'
                      : `${subscriptionData.remaining_client_slots} libres`}
                </span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-200 dark:bg-surface-800">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    subscriptionData.over_client_limit
                      ? 'bg-rose-500'
                      : subscriptionData.remaining_client_slots === 0
                        ? 'bg-amber-500'
                        : 'bg-emerald-500',
                  )}
                  style={{ width: `${usageRatio(subscriptionData.usage_active_clients, subscriptionData.max_members)}%` }}
                />
              </div>
            </div>

            <div className="rounded-xl border border-surface-200/70 bg-surface-50 px-4 py-4 dark:border-surface-800/70 dark:bg-surface-800/30">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-surface-500">Uso de sucursales</p>
                  <p className="mt-1 font-semibold text-surface-900 dark:text-white">
                    {subscriptionData.usage_active_branches} / {subscriptionData.max_branches ?? 0}
                  </p>
                </div>
                <span className={cn(
                  'badge',
                  subscriptionData.over_branch_limit
                    ? 'badge-danger'
                    : subscriptionData.remaining_branch_slots === 0
                      ? 'badge-warning'
                      : 'badge-success',
                )}>
                  {subscriptionData.over_branch_limit
                    ? 'Sobrecupo'
                    : subscriptionData.remaining_branch_slots === 0
                      ? 'Sin cupos'
                      : `${subscriptionData.remaining_branch_slots} libres`}
                </span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-200 dark:bg-surface-800">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    subscriptionData.over_branch_limit
                      ? 'bg-rose-500'
                      : subscriptionData.remaining_branch_slots === 0
                        ? 'bg-amber-500'
                        : 'bg-emerald-500',
                  )}
                  style={{ width: `${usageRatio(subscriptionData.usage_active_branches, subscriptionData.max_branches)}%` }}
                />
              </div>
            </div>
          </div>

          {quotaNeedsAttention ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 dark:border-amber-900/40 dark:bg-amber-950/10">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Capacidad del plan al límite</p>
                  <p className="mt-1 text-sm text-amber-700 dark:text-amber-200">
                    {subscriptionData.over_client_limit || subscriptionData.over_branch_limit
                      ? 'Tu cuenta quedó sobre el cupo del plan actual. No podrás crear nuevas altas hasta liberar espacio o mejorar tu plan.'
                      : 'Ya usaste todos los cupos disponibles del plan actual. La próxima alta de cliente o sucursal quedará bloqueada.'}
                  </p>
                </div>
                {nextUpgradePlan ? (
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={upgradePlan.isPending}
                    onClick={() => upgradePlan.mutate(nextUpgradePlan.key)}
                  >
                    <Rocket size={16} />
                    {upgradePlan.isPending ? 'Abriendo checkout...' : `Mejorar a ${nextUpgradePlan.name}`}
                  </button>
                ) : (
                  <span className="text-sm text-amber-700 dark:text-amber-200">
                    No hay un plan superior publicado ahora mismo. Contacta a soporte comercial.
                  </span>
                )}
              </div>
            </div>
          ) : null}

          {subscriptionData.features?.length ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {subscriptionData.features.slice(0, 4).map((feature) => (
                <span key={feature} className="badge badge-neutral">
                  {feature}
                </span>
              ))}
            </div>
          ) : null}
        </motion.div>
      ) : null}

      <OnboardingChecklist />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Ingresos del Día" value={parseApiNumber(data?.revenue_today)} icon={DollarSign} format="currency" color="brand" />
        <StatCard label="Miembros Activos" value={data?.active_members ?? 0} icon={Users} color="emerald" />
        <StatCard label="Clases Hoy" value={data?.classes_today ?? 0} icon={CalendarDays} color="violet" />
        <StatCard label="Check-ins Hoy" value={data?.checkins_today ?? 0} icon={UserCheck} color="blue" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Reservas Hoy" value={data?.reservations_today ?? 0} icon={ClipboardCheck} color="amber" />
        <StatCard label="Pagos Pendientes" value={data?.pending_payments ?? 0} icon={AlertTriangle} color="rose" />
        <StatCard label="Miembros por vencer" value={data?.expiring_memberships ?? 0} icon={TrendingUp} color="emerald" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <motion.div
          variants={fadeInUp}
          className="lg:col-span-2 rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900"
        >
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-surface-900 dark:text-white">Ingresos comparados</h3>
              <p className="text-sm text-surface-500">Hoy, semana y mes</p>
            </div>
            <span className="text-2xl font-bold font-display text-surface-900 dark:text-white">
              {formatCurrency(parseApiNumber(data?.revenue_month))}
            </span>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={revenueData}>
              <defs>
                <linearGradient id="dashboardRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-surface-100 dark:text-surface-800" />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#94a3b8', fontSize: 12 }}
                tickFormatter={(value) => `$${Math.round(value / 1000)}k`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(15, 23, 42, 0.9)',
                  border: 'none',
                  borderRadius: '12px',
                  color: '#fff',
                  fontSize: '13px',
                }}
                formatter={(value: number) => [formatCurrency(value), 'Ingresos']}
              />
              <Area type="monotone" dataKey="value" stroke="#06b6d4" strokeWidth={2.5} fill="url(#dashboardRevenue)" />
            </AreaChart>
          </ResponsiveContainer>
        </motion.div>

        <motion.div
          variants={fadeInUp}
          className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900"
        >
          <h3 className="mb-4 text-base font-semibold text-surface-900 dark:text-white">Operación del día</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={operationalData} barSize={42}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-surface-100 dark:text-surface-800" />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(15, 23, 42, 0.9)',
                  border: 'none',
                  borderRadius: '12px',
                  color: '#fff',
                  fontSize: '13px',
                }}
              />
              <Bar dataKey="value" fill="#8b5cf6" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <motion.div
          variants={fadeInUp}
          className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900"
        >
          <h3 className="mb-4 text-base font-semibold text-surface-900 dark:text-white">Actividad reciente</h3>
          {data?.recent_checkins?.length ? (
            <div className="space-y-3">
              {data.recent_checkins.map((checkin) => (
                <div key={checkin.id} className="rounded-xl bg-surface-50 px-4 py-3 text-sm dark:bg-surface-800/40">
                  <p className="font-medium text-surface-900 dark:text-white">
                    {checkin.user_name || `Usuario ${checkin.user_id.slice(0, 8)}`}
                  </p>
                  <p className="text-surface-500">{new Date(checkin.checked_in_at).toLocaleString('es-CL')}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-surface-300 px-4 py-8 text-center dark:border-surface-700">
              <p className="font-medium text-surface-700 dark:text-surface-200">Sin check-ins recientes</p>
              <p className="mt-1 text-sm text-surface-500">Puedes registrarlos desde el módulo de check-in.</p>
            </div>
          )}
        </motion.div>

        <motion.div
          variants={fadeInUp}
          className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900"
        >
          <h3 className="mb-4 text-base font-semibold text-surface-900 dark:text-white">Accesos rápidos</h3>
          <div className="space-y-3">
            <button onClick={() => navigate('/checkin')} className="btn-primary w-full justify-between">
              Registrar check-in
              <ArrowUpRight size={16} />
            </button>
            <button onClick={() => navigate('/clients')} className="btn-secondary w-full justify-between">
              Ver clientes
              <ArrowUpRight size={16} />
            </button>
            <button onClick={() => navigate('/plans')} className="btn-secondary w-full justify-between">
              Gestionar planes
              <ArrowUpRight size={16} />
            </button>
          </div>
        </motion.div>

        <motion.div
          variants={fadeInUp}
          className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900"
        >
          <h3 className="mb-4 text-base font-semibold text-surface-900 dark:text-white">Estado general</h3>
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between rounded-xl bg-surface-50 px-4 py-3 dark:bg-surface-800/40">
              <span className="text-surface-500">Ingresos del mes</span>
              <span className="font-semibold text-surface-900 dark:text-white">{formatCurrency(parseApiNumber(data?.revenue_month))}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-surface-50 px-4 py-3 dark:bg-surface-800/40">
              <span className="text-surface-500">Miembros totales</span>
              <span className="font-semibold text-surface-900 dark:text-white">{data?.total_members ?? 0}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-surface-50 px-4 py-3 dark:bg-surface-800/40">
              <span className="text-surface-500">Pendientes de pago</span>
              <span className="font-semibold text-surface-900 dark:text-white">{data?.pending_payments ?? 0}</span>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Panel del Día */}
      {todayData && (
        <motion.div variants={fadeInUp}>
          <h2 className="mb-4 text-lg font-bold font-display text-surface-900 dark:text-white flex items-center gap-2">
            <Clock size={20} className="text-brand-500" />
            Panel del Día
          </h2>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Classes today */}
            <motion.div
              variants={fadeInUp}
              className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900"
            >
              <h3 className="mb-4 text-sm font-semibold text-surface-900 dark:text-white flex items-center gap-2">
                <CalendarDays size={16} className="text-violet-500" />
                Clases de hoy ({todayData.classes.length})
              </h3>
              {todayData.classes.length ? (
                <div className="space-y-2">
                  {todayData.classes.map((cls) => {
                    const occupancy = cls.max_capacity ? Math.round((cls.current_bookings / cls.max_capacity) * 100) : 0;
                    return (
                      <div key={cls.id} className="rounded-xl bg-surface-50 px-3 py-2.5 dark:bg-surface-800/40">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium text-surface-900 dark:text-white truncate">{cls.name}</p>
                          <span className={cn(
                            'shrink-0 text-xs font-medium px-1.5 py-0.5 rounded-full',
                            occupancy >= 80 ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
                          )}>
                            {cls.current_bookings}/{cls.max_capacity}
                          </span>
                        </div>
                        <p className="text-xs text-surface-500 mt-0.5">
                          {new Date(cls.start_time).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                          {cls.instructor_name && ` · ${cls.instructor_name}`}
                        </p>
                        <div className="mt-1.5 h-1 rounded-full bg-surface-200 dark:bg-surface-700">
                          <div className={cn('h-full rounded-full', occupancy >= 80 ? 'bg-red-400' : 'bg-emerald-400')} style={{ width: `${occupancy}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-surface-500">Sin clases programadas para hoy</p>
              )}
            </motion.div>

            {/* Payments today */}
            <motion.div
              variants={fadeInUp}
              className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900"
            >
              <h3 className="mb-1 text-sm font-semibold text-surface-900 dark:text-white flex items-center gap-2">
                <CreditCard size={16} className="text-emerald-500" />
                Pagos de hoy ({todayData.payments.length})
              </h3>
              <p className="text-xs text-surface-500 mb-4">{formatCurrency(todayData.revenue_today)} recaudado</p>
              {todayData.payments.length ? (
                <div className="space-y-2">
                  {todayData.payments.slice(0, 8).map((pay) => (
                    <div key={pay.id} className="flex items-center justify-between rounded-xl bg-surface-50 px-3 py-2 dark:bg-surface-800/40">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-surface-900 dark:text-white truncate">
                          {pay.user_name || 'Cliente'}
                        </p>
                        <p className="text-xs text-surface-500">{pay.method}</p>
                      </div>
                      <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 shrink-0">
                        {formatCurrency(pay.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-surface-500">Sin pagos registrados hoy</p>
              )}
            </motion.div>

            {/* Birthdays + stats */}
            <motion.div
              variants={fadeInUp}
              className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900 space-y-5"
            >
              <div>
                <h3 className="mb-3 text-sm font-semibold text-surface-900 dark:text-white flex items-center gap-2">
                  <Cake size={16} className="text-pink-500" />
                  Cumpleaños hoy ({todayData.birthdays.length})
                </h3>
                {todayData.birthdays.length ? (
                  <div className="space-y-2">
                    {todayData.birthdays.map((b) => (
                      <div key={b.id} className="flex items-center gap-2 rounded-xl bg-pink-50 px-3 py-2 dark:bg-pink-900/20">
                        <User size={14} className="text-pink-500 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-surface-900 dark:text-white truncate">{b.full_name}</p>
                          <p className="text-xs text-surface-500 truncate">{b.email}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-surface-500">Sin cumpleaños hoy</p>
                )}
              </div>
              <div className="border-t border-surface-100 dark:border-surface-800 pt-4">
                <h3 className="mb-3 text-sm font-semibold text-surface-900 dark:text-white flex items-center gap-2">
                  <UserCheck size={16} className="text-brand-500" />
                  Check-ins hoy
                </h3>
                <p className="text-3xl font-bold font-display text-surface-900 dark:text-white">{todayData.checkins_count}</p>
              </div>
            </motion.div>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
