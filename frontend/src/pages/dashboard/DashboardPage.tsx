import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  DollarSign, Users, CalendarDays, ClipboardCheck, AlertTriangle, TrendingUp, UserCheck, ArrowUpRight,
} from 'lucide-react';
import { AreaChart, Area, BarChart, Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import StatCard from '@/components/dashboard/StatCard';
import { dashboardApi } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { staggerContainer, fadeInUp } from '@/utils/animations';
import { formatCurrency, parseApiNumber } from '@/utils';
import type { DashboardMetrics } from '@/types';

export default function DashboardPage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);

  if (user?.role === 'superadmin') {
    return <Navigate to="/platform/tenants" replace />;
  }

  const { data, isLoading, isError } = useQuery<DashboardMetrics>({
    queryKey: ['dashboard-metrics'],
    queryFn: async () => {
      const response = await dashboardApi.getMetrics();
      return response.data;
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
            {isLoading ? 'Cargando métricas reales del gimnasio...' : 'Resumen operativo conectado al backend'}
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
          No pudimos cargar el dashboard. Revisa el backend o vuelve a iniciar sesión.
        </div>
      ) : null}

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
                  <p className="font-medium text-surface-900 dark:text-white">Usuario {checkin.user_id.slice(0, 8)}</p>
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
    </motion.div>
  );
}
