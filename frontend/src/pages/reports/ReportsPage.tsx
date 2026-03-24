import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Download, Filter, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import {
  AreaChart, Area, CartesianGrid, LineChart, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell,
} from 'recharts';
import { reportsApi } from '@/services/api';
import { fadeInUp, staggerContainer } from '@/utils/animations';
import { formatCurrency, parseApiNumber } from '@/utils';
import type { ReportsOverview } from '@/types';

type RangeKey = '30d' | '90d' | '12m';

function exportCsv(filename: string, rows: string[][]) {
  const content = rows.map((row) => row.map((value) => `"${value}"`).join(',')).join('\n');
  const blob = new Blob([`\ufeff${content}`], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

export default function ReportsPage() {
  const [range, setRange] = useState<RangeKey>('12m');

  const { data, isLoading, isError } = useQuery<ReportsOverview>({
    queryKey: ['reports-overview', range],
    queryFn: async () => {
      const response = await reportsApi.overview({ range_key: range });
      return response.data;
    },
  });

  const cards = useMemo(() => ([
    { label: 'Ingresos', value: formatCurrency(parseApiNumber(data?.revenue_total)), icon: Wallet, accent: 'text-brand-500' },
    { label: 'Miembros activos', value: String(data?.active_members ?? 0), icon: TrendingUp, accent: 'text-emerald-500' },
    { label: 'Renovacion', value: `${data?.renewal_rate ?? 0}%`, icon: TrendingUp, accent: 'text-violet-500' },
    { label: 'Churn', value: `${data?.churn_rate ?? 0}%`, icon: TrendingDown, accent: 'text-amber-500' },
  ]), [data?.active_members, data?.churn_rate, data?.renewal_rate, data?.revenue_total]);

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-6">
      <motion.div variants={fadeInUp} className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Reportes</h1>
          <p className="mt-1 text-sm text-surface-500">Analitica real de ingresos, retencion y asistencia</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setRange((current) => current === '12m' ? '90d' : current === '90d' ? '30d' : '12m')}
            className="btn-secondary"
          >
            <Filter size={16} />
            {range}
          </button>
          <button
            type="button"
            onClick={() => exportCsv(`reportes-${range}.csv`, [
              ['Periodo', 'Ingresos', 'Miembros'],
              ...(data?.revenue_series ?? []).map((item, index) => [item.label, String(item.value), String(data?.members_series?.[index]?.value ?? 0)]),
            ])}
            className="btn-primary"
          >
            <Download size={16} />
            Exportar
          </button>
        </div>
      </motion.div>

      {isError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-600 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
          No pudimos cargar los reportes del tenant.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
            <div className="flex items-center justify-between">
              <p className="text-sm text-surface-500">{card.label}</p>
              <card.icon size={18} className={card.accent} />
            </div>
            <p className="mt-3 text-3xl font-bold font-display text-surface-900 dark:text-white">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.4fr_0.6fr]">
        <motion.div variants={fadeInUp} className="rounded-3xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
          <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Ingresos en el tiempo</h2>
          <p className="mt-1 text-sm text-surface-500">Serie consolidada desde backend</p>
          <div className="mt-5 h-[320px]">
            {isLoading ? (
              <div className="shimmer h-full rounded-2xl" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data?.revenue_series ?? []}>
                  <defs>
                    <linearGradient id="reportsRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-surface-100 dark:text-surface-800" />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                  <Tooltip formatter={(value: number) => [formatCurrency(value), 'Ingresos']} />
                  <Area type="monotone" dataKey="value" stroke="#06b6d4" strokeWidth={2.5} fill="url(#reportsRevenue)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </motion.div>

        <motion.div variants={fadeInUp} className="rounded-3xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
          <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Ingresos por plan</h2>
          <p className="mt-1 text-sm text-surface-500">Mix comercial actual</p>
          <div className="mt-5 h-[320px]">
            {isLoading ? (
              <div className="shimmer h-full rounded-2xl" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data?.revenue_by_plan ?? []} dataKey="value" innerRadius={55} outerRadius={95} paddingAngle={3}>
                    {(data?.revenue_by_plan ?? []).map((item) => <Cell key={item.name} fill={item.color} />)}
                  </Pie>
                  <Tooltip formatter={(value: number) => [formatCurrency(value), 'Ingresos']} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <motion.div variants={fadeInUp} className="rounded-3xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
          <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Miembros y asistencia</h2>
          <div className="mt-5 h-[280px]">
            {isLoading ? (
              <div className="shimmer h-full rounded-2xl" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data?.members_series ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-surface-100 dark:text-surface-800" />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="value" stroke="#8b5cf6" strokeWidth={2.5} dot={{ fill: '#8b5cf6', r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </motion.div>

        <motion.div variants={fadeInUp} className="rounded-3xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
          <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Ocupacion por clase</h2>
          <div className="mt-5 space-y-3">
            {(data?.occupancy_by_class ?? []).map((item) => (
              <div key={item.name} className="rounded-2xl border border-surface-200/60 px-4 py-4 dark:border-surface-800/60">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm font-medium text-surface-900 dark:text-white">{item.name}</span>
                  <span className="text-sm text-surface-500">{item.occupancy}%</span>
                </div>
                <div className="mt-3 h-2 rounded-full bg-surface-100 dark:bg-surface-800">
                  <div className="h-2 rounded-full bg-gradient-to-r from-brand-500 to-cyan-500" style={{ width: `${Math.min(item.occupancy, 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
