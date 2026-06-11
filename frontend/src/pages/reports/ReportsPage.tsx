import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  BarChart2,
  Banknote,
  ClipboardList,
  Download,
  Filter,
  Package,
  ShoppingBag,
  TrendingDown,
  TrendingUp,
  User,
  Wallet,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  LineChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
} from 'recharts';
import { reportsApi, posApi, settingsApi } from '@/services/api';
import { fadeInUp, staggerContainer } from '@/utils/animations';
import { cn, formatCurrency, parseApiNumber } from '@/utils';
import type { ReportsOverview, SalesBreakdown, CashSession } from '@/types';

type RangeKey = '30d' | '90d' | '12m';
type TabKey = 'members' | 'pl' | 'caja';
type CajaPeriod = 'day' | 'week' | 'month' | 'year';

const CAJA_PERIODS: { value: CajaPeriod; label: string }[] = [
  { value: 'day', label: 'Día' },
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mes' },
  { value: 'year', label: 'Año' },
];

const METHOD_COLORS = ['#10b981', '#06b6d4', '#8b5cf6', '#f59e0b', '#ec4899', '#6366f1', '#94a3b8'];

function cajaRange(period: CajaPeriod): { from: string; to: string } {
  const now = new Date();
  let from = new Date(now);
  if (period === 'day') {
    from.setHours(0, 0, 0, 0);
  } else if (period === 'week') {
    const day = (now.getDay() + 6) % 7; // lunes = 0
    from.setDate(now.getDate() - day);
    from.setHours(0, 0, 0, 0);
  } else if (period === 'month') {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
  } else {
    from = new Date(now.getFullYear(), 0, 1);
  }
  return { from: from.toISOString(), to: now.toISOString() };
}

function exportCsv(filename: string, rows: string[][]) {
  const content = rows.map((row) => row.map((value) => `"${value}"`).join(',')).join('\n');
  const blob = new Blob([`\ufeff${content}`], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

type AttendanceReport = {
  classes: Array<{
    name: string;
    sessions: number;
    avg_occupancy_pct: number;
    avg_attendance_pct: number;
    total_reservations: number;
    total_checkins: number;
  }>;
  instructors: Array<{
    instructor_id: string;
    name: string | null;
    sessions: number;
    total_reservations: number;
    total_checkins: number;
  }>;
};

const EXPENSE_COLORS: Record<string, string> = {
  rent: '#f59e0b',
  utilities: '#3b82f6',
  salaries: '#8b5cf6',
  equipment: '#06b6d4',
  marketing: '#ec4899',
  supplies: '#10b981',
  maintenance: '#f97316',
  insurance: '#6366f1',
  taxes: '#ef4444',
  other: '#94a3b8',
};

export default function ReportsPage() {
  const [range, setRange] = useState<RangeKey>('12m');
  const [tab, setTab] = useState<TabKey>('members');
  const [cajaPeriod, setCajaPeriod] = useState<CajaPeriod>('month');

  const { from: cajaFrom, to: cajaTo } = useMemo(() => cajaRange(cajaPeriod), [cajaPeriod]);

  const { data: breakdown, isLoading: breakdownLoading } = useQuery<SalesBreakdown>({
    queryKey: ['pos-sales-breakdown', cajaFrom, cajaTo],
    queryFn: () => posApi.salesBreakdown({ from_date: cajaFrom, to_date: cajaTo }).then((r) => r.data),
    enabled: tab === 'caja',
  });

  const { data: cashSessions = [], isLoading: sessionsLoading } = useQuery<CashSession[]>({
    queryKey: ['pos-cash-sessions-history'],
    queryFn: () => posApi.listCashSessions({ size: 30 }).then((r) => r.data),
    enabled: tab === 'caja',
  });

  // La API serializa Decimal como string → convertir a número para los gráficos
  const methodData = useMemo(
    () => (breakdown?.by_method ?? []).map((m) => ({
      ...m,
      total: parseApiNumber(m.total),
      subtotal: parseApiNumber(m.subtotal),
      discount: parseApiNumber(m.discount),
    })),
    [breakdown],
  );
  const methodTotal = useMemo(() => methodData.reduce((s, m) => s + m.total, 0), [methodData]);

  const { data, isLoading, isError } = useQuery<ReportsOverview>({
    queryKey: ['reports-overview', range],
    queryFn: async () => {
      const response = await reportsApi.overview({ range_key: range });
      return response.data;
    },
  });

  const { data: attendanceData, isLoading: attendanceLoading } = useQuery<AttendanceReport>({
    queryKey: ['reports-attendance', range],
    queryFn: async () => {
      const response = await reportsApi.attendance({ range_key: range });
      return response.data;
    },
  });

  const memberCards = useMemo(() => ([
    { label: 'Ingresos membresías', value: formatCurrency(parseApiNumber(data?.revenue_total)), icon: Wallet, accent: 'text-brand-500' },
    { label: 'Miembros activos', value: String(data?.active_members ?? 0), icon: TrendingUp, accent: 'text-emerald-500' },
    { label: 'Renovación', value: `${data?.renewal_rate ?? 0}%`, icon: TrendingUp, accent: 'text-violet-500' },
    { label: 'Churn', value: `${data?.churn_rate ?? 0}%`, icon: TrendingDown, accent: 'text-amber-500' },
  ]), [data?.active_members, data?.churn_rate, data?.renewal_rate, data?.revenue_total]);

  // Combined series for P&L chart: merge revenue_series + pos_revenue_series + expense_series by label
  const plCombinedSeries = useMemo(() => {
    const labels = (data?.revenue_series ?? []).map((p) => p.label);
    const posMap = Object.fromEntries((data?.pos_revenue_series ?? []).map((p) => [p.label, p.value]));
    const expMap = Object.fromEntries((data?.expense_series ?? []).map((p) => [p.label, p.value]));
    return labels.map((label, i) => ({
      label,
      membresias: data?.revenue_series[i]?.value ?? 0,
      pos: posMap[label] ?? 0,
      gastos: expMap[label] ?? 0,
    }));
  }, [data?.expense_series, data?.pos_revenue_series, data?.revenue_series]);

  const netProfit = parseApiNumber(data?.net_profit);
  const netMargin = parseApiNumber(data?.net_margin_pct);

  const cashflowSeries = data?.cashflow_series ?? [];
  const openingBalance = parseApiNumber(data?.opening_balance);
  const closingBalance = parseApiNumber(data?.closing_balance);
  const periodNet = closingBalance - openingBalance;
  const cutoffDay = data?.report_cutoff_day ?? null;

  const queryClient = useQueryClient();
  const cutoffMutation = useMutation({
    mutationFn: (day: number | null) => settingsApi.update({ report_cutoff_day: day }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reports-overview'] });
      queryClient.invalidateQueries({ queryKey: ['tenant-settings'] });
    },
  });

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-6">
      {/* Header */}
      <motion.div variants={fadeInUp} className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Reportes</h1>
          <p className="mt-1 text-sm text-surface-500">Analítica real de ingresos, retención y asistencia</p>
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
              ['Periodo', 'Membresías', 'POS', 'Gastos', 'Resultado', 'Saldo acumulado'],
              ...plCombinedSeries.map((item, i) => [
                item.label,
                String(item.membresias),
                String(item.pos),
                String(item.gastos),
                String(cashflowSeries[i]?.net ?? ''),
                String(cashflowSeries[i]?.balance ?? ''),
              ]),
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
          No pudimos cargar los reportes de la cuenta.
        </div>
      ) : null}

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-surface-200/50 bg-surface-50 p-1 dark:border-surface-800/50 dark:bg-surface-900/50 w-fit">
        <button
          type="button"
          onClick={() => setTab('members')}
          className={cn(
            'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all',
            tab === 'members'
              ? 'bg-white shadow-sm text-surface-900 dark:bg-surface-800 dark:text-white'
              : 'text-surface-500 hover:text-surface-700 dark:hover:text-surface-300',
          )}
        >
          <User size={15} />
          Membresías
        </button>
        <button
          type="button"
          onClick={() => setTab('pl')}
          className={cn(
            'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all',
            tab === 'pl'
              ? 'bg-white shadow-sm text-surface-900 dark:bg-surface-800 dark:text-white'
              : 'text-surface-500 hover:text-surface-700 dark:hover:text-surface-300',
          )}
        >
          <BarChart2 size={15} />
          P&amp;L / Gastos
        </button>
        <button
          type="button"
          onClick={() => setTab('caja')}
          className={cn(
            'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all',
            tab === 'caja'
              ? 'bg-white shadow-sm text-surface-900 dark:bg-surface-800 dark:text-white'
              : 'text-surface-500 hover:text-surface-700 dark:hover:text-surface-300',
          )}
        >
          <Banknote size={15} />
          Caja / Métodos de pago
        </button>
      </div>

      {/* ── TAB: MEMBRESÍAS ── */}
      {tab === 'members' && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {memberCards.map((card) => (
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
                      <Pie
                        data={data?.revenue_by_plan ?? []}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="45%"
                        innerRadius={50}
                        outerRadius={85}
                        paddingAngle={3}
                      >
                        {(data?.revenue_by_plan ?? []).map((item) => <Cell key={item.name} fill={item.color} />)}
                      </Pie>
                      <Tooltip formatter={(value: number) => [formatCurrency(value), 'Ingresos']} />
                      <Legend
                        verticalAlign="bottom"
                        align="center"
                        iconType="circle"
                        wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
                      />
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
              <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Ocupación por clase</h2>
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

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.4fr_0.6fr]">
            <motion.div variants={fadeInUp} className="rounded-3xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
              <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Ranking de clases por ocupación</h2>
              <p className="mt-1 text-sm text-surface-500">Promedio de reservas vs. capacidad en el período</p>
              <div className="mt-4 space-y-3">
                {attendanceLoading ? (
                  Array.from({ length: 5 }).map((_, i) => <div key={i} className="shimmer h-14 rounded-2xl" />)
                ) : (attendanceData?.classes ?? []).length === 0 ? (
                  <p className="py-6 text-center text-sm text-surface-400">Sin datos de clases para el período seleccionado.</p>
                ) : (
                  (attendanceData?.classes ?? []).map((item, index) => (
                    <div key={item.name} className="rounded-2xl border border-surface-200/60 px-4 py-3 dark:border-surface-800/60">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs font-bold text-surface-400 w-5 text-right flex-shrink-0">#{index + 1}</span>
                          <span className="truncate text-sm font-medium text-surface-900 dark:text-white">{item.name}</span>
                          <span className="flex-shrink-0 text-xs text-surface-400">{item.sessions} ses.</span>
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-3 text-xs text-surface-500">
                          <span>{item.total_checkins} check-ins</span>
                          <span className={cn('font-semibold', item.avg_occupancy_pct >= 70 ? 'text-emerald-600 dark:text-emerald-400' : item.avg_occupancy_pct >= 40 ? 'text-amber-500' : 'text-rose-500')}>
                            {item.avg_occupancy_pct}%
                          </span>
                        </div>
                      </div>
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-100 dark:bg-surface-800">
                        <div
                          className={cn('h-full rounded-full', item.avg_occupancy_pct >= 70 ? 'bg-emerald-500' : item.avg_occupancy_pct >= 40 ? 'bg-amber-400' : 'bg-rose-400')}
                          style={{ width: `${Math.min(item.avg_occupancy_pct, 100)}%` }}
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>

            <motion.div variants={fadeInUp} className="rounded-3xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
              <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Ranking instructores</h2>
              <p className="mt-1 text-sm text-surface-500">Check-ins generados en el período</p>
              <div className="mt-4 space-y-3">
                {attendanceLoading ? (
                  Array.from({ length: 4 }).map((_, i) => <div key={i} className="shimmer h-14 rounded-2xl" />)
                ) : (attendanceData?.instructors ?? []).length === 0 ? (
                  <p className="py-6 text-center text-sm text-surface-400">Sin instructores asignados en el período.</p>
                ) : (
                  (attendanceData?.instructors ?? []).map((item, index) => (
                    <div key={item.instructor_id} className="flex items-center gap-3 rounded-2xl border border-surface-200/60 px-4 py-3 dark:border-surface-800/60">
                      <span className="text-xs font-bold text-surface-400 w-4 text-right">{index + 1}</span>
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30">
                        <User size={14} className="text-violet-600 dark:text-violet-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-surface-900 dark:text-white">{item.name ?? 'Sin nombre'}</p>
                        <p className="text-xs text-surface-400">{item.sessions} clases · {item.total_checkins} check-ins</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </div>
        </>
      )}

      {/* ── TAB: P&L / GASTOS ── */}
      {tab === 'pl' && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-6">
            {[
              { label: 'Ingresos totales', value: formatCurrency(parseApiNumber(data?.total_revenue)), icon: Wallet, accent: 'text-brand-500', bg: 'bg-brand-50 dark:bg-brand-950/30' },
              { label: 'Ingresos membresías', value: formatCurrency(parseApiNumber(data?.revenue_total)), icon: User, accent: 'text-violet-500', bg: 'bg-violet-50 dark:bg-violet-950/30' },
              { label: 'Ingresos POS', value: formatCurrency(parseApiNumber(data?.pos_revenue)), icon: ShoppingBag, accent: 'text-cyan-500', bg: 'bg-cyan-50 dark:bg-cyan-950/30' },
              { label: 'COGS', value: formatCurrency(parseApiNumber(data?.pos_cogs)), icon: Package, accent: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/30' },
              { label: 'Gastos op.', value: formatCurrency(parseApiNumber(data?.total_expenses)), icon: TrendingDown, accent: 'text-rose-500', bg: 'bg-rose-50 dark:bg-rose-950/30' },
              {
                label: 'Ganancia neta',
                value: formatCurrency(netProfit),
                icon: netProfit >= 0 ? TrendingUp : TrendingDown,
                accent: netProfit >= 0 ? 'text-emerald-500' : 'text-rose-500',
                bg: netProfit >= 0 ? 'bg-emerald-50 dark:bg-emerald-950/30' : 'bg-rose-50 dark:bg-rose-950/30',
              },
            ].map((card) => (
              <div key={card.label} className={cn('rounded-2xl border border-surface-200/50 p-4 dark:border-surface-800/50', card.bg)}>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-surface-500">{card.label}</p>
                  <card.icon size={16} className={card.accent} />
                </div>
                <p className="mt-2 text-xl font-bold font-display text-surface-900 dark:text-white">{isLoading ? '—' : card.value}</p>
              </div>
            ))}
          </div>

          {/* Saldo acumulado con arrastre mes a mes */}
          <motion.div variants={fadeInUp} className="rounded-3xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Saldo acumulado</h2>
                <p className="mt-1 text-sm text-surface-500">El excedente o déficit de cada mes queda como pie del mes siguiente</p>
                <label className="mt-3 flex items-center gap-2 text-sm text-surface-500">
                  Día de corte
                  <select
                    value={cutoffDay ?? ''}
                    disabled={cutoffMutation.isPending}
                    onChange={(e) => cutoffMutation.mutate(e.target.value === '' ? null : Number(e.target.value))}
                    className="rounded-lg border border-surface-200 bg-white px-2 py-1.5 text-sm text-surface-900 focus:border-brand-500 focus:outline-none disabled:opacity-50 dark:border-surface-700 dark:bg-surface-800 dark:text-white"
                  >
                    <option value="">Fin de mes</option>
                    {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                      <option key={day} value={day}>{day}</option>
                    ))}
                  </select>
                  {cutoffDay != null && (
                    <span className="text-xs text-surface-400">cada mes va del {cutoffDay + 1} al {cutoffDay}</span>
                  )}
                </label>
              </div>
              <div className="flex flex-wrap gap-x-8 gap-y-2">
                <div>
                  <p className="text-xs text-surface-500">Saldo inicial del período</p>
                  <p className="mt-1 text-lg font-bold font-display tabular-nums text-surface-900 dark:text-white">
                    {isLoading ? '—' : formatCurrency(openingBalance)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-surface-500">Resultado del período</p>
                  <p className={cn('mt-1 text-lg font-bold font-display tabular-nums', periodNet >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                    {isLoading ? '—' : `${periodNet >= 0 ? '+' : ''}${formatCurrency(periodNet)}`}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-surface-500">Saldo actual</p>
                  <p className={cn('mt-1 text-lg font-bold font-display tabular-nums', closingBalance >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                    {isLoading ? '—' : formatCurrency(closingBalance)}
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-5 h-[300px]">
              {isLoading ? (
                <div className="shimmer h-full rounded-2xl" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={cashflowSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-surface-100 dark:text-surface-800" />
                    <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                    <Tooltip formatter={(value: number, name: string) => [formatCurrency(value), name === 'net' ? 'Resultado del mes' : 'Saldo acumulado']} />
                    <Legend formatter={(value) => value === 'net' ? 'Resultado del mes' : 'Saldo acumulado'} />
                    <Bar dataKey="net" radius={[4, 4, 0, 0]}>
                      {cashflowSeries.map((point) => (
                        <Cell key={point.label} fill={point.net >= 0 ? '#10b981' : '#ef4444'} />
                      ))}
                    </Bar>
                    <Line type="monotone" dataKey="balance" stroke="#06b6d4" strokeWidth={2.5} dot={{ fill: '#06b6d4', r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
            {!isLoading && cashflowSeries.length > 1 && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-surface-400">
                      <th className="px-2 py-2 font-medium">Mes</th>
                      <th className="px-2 py-2 text-right font-medium">Ingresos</th>
                      <th className="px-2 py-2 text-right font-medium">Costos y gastos</th>
                      <th className="px-2 py-2 text-right font-medium">Resultado</th>
                      <th className="px-2 py-2 text-right font-medium">Saldo acumulado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
                    {cashflowSeries.map((point) => (
                      <tr key={point.label} className="text-surface-700 dark:text-surface-300">
                        <td className="px-2 py-2.5 whitespace-nowrap font-medium">{point.label}</td>
                        <td className="px-2 py-2.5 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{formatCurrency(point.income)}</td>
                        <td className="px-2 py-2.5 text-right tabular-nums text-rose-600 dark:text-rose-400">− {formatCurrency(point.costs)}</td>
                        <td className={cn('px-2 py-2.5 text-right tabular-nums font-medium', point.net >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                          {point.net >= 0 ? '+' : ''}{formatCurrency(point.net)}
                        </td>
                        <td className={cn('px-2 py-2.5 text-right tabular-nums font-bold', point.balance >= 0 ? 'text-surface-900 dark:text-white' : 'text-rose-600 dark:text-rose-400')}>
                          {formatCurrency(point.balance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </motion.div>

          {/* Combined revenue vs expenses chart */}
          <motion.div variants={fadeInUp} className="rounded-3xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
            <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Ingresos vs Gastos en el tiempo</h2>
            <p className="mt-1 text-sm text-surface-500">Membresías · POS · Gastos operativos</p>
            <div className="mt-5 h-[320px]">
              {isLoading ? (
                <div className="shimmer h-full rounded-2xl" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={plCombinedSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-surface-100 dark:text-surface-800" />
                    <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                    <Tooltip formatter={(value: number, name: string) => [formatCurrency(value), name === 'membresias' ? 'Membresías' : name === 'pos' ? 'POS' : 'Gastos']} />
                    <Legend formatter={(value) => value === 'membresias' ? 'Membresías' : value === 'pos' ? 'POS' : 'Gastos'} />
                    <Area type="monotone" dataKey="membresias" stroke="#8b5cf6" strokeWidth={2} fill="#8b5cf620" />
                    <Area type="monotone" dataKey="pos" stroke="#06b6d4" strokeWidth={2} fill="#06b6d420" />
                    <Line type="monotone" dataKey="gastos" stroke="#ef4444" strokeWidth={2} strokeDasharray="5 3" dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
          </motion.div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.55fr_0.45fr]">
            {/* Expenses by category */}
            <motion.div variants={fadeInUp} className="rounded-3xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
              <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Gastos por categoría</h2>
              <p className="mt-1 text-sm text-surface-500">Distribución del gasto operativo</p>
              <div className="mt-5 h-[280px]">
                {isLoading ? (
                  <div className="shimmer h-full rounded-2xl" />
                ) : (data?.expenses_by_category ?? []).length === 0 ? (
                  <p className="py-16 text-center text-sm text-surface-400">Sin gastos registrados en el período.</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data?.expenses_by_category ?? []} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-surface-100 dark:text-surface-800" horizontal={false} />
                      <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                      <YAxis type="category" dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} width={90} />
                      <Tooltip formatter={(value: number) => [formatCurrency(value), 'Gasto']} />
                      <Bar dataKey="amount" radius={[0, 6, 6, 0]}>
                        {(data?.expenses_by_category ?? []).map((item) => (
                          <Cell key={item.category} fill={EXPENSE_COLORS[item.category] ?? '#94a3b8'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </motion.div>

            {/* Top products */}
            <motion.div variants={fadeInUp} className="rounded-3xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
              <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Top productos POS</h2>
              <p className="mt-1 text-sm text-surface-500">Por ingresos generados</p>
              <div className="mt-4 space-y-3">
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => <div key={i} className="shimmer h-12 rounded-2xl" />)
                ) : (data?.top_products ?? []).length === 0 ? (
                  <p className="py-10 text-center text-sm text-surface-400">Sin ventas POS en el período.</p>
                ) : (
                  (data?.top_products ?? []).map((product, index) => {
                    const maxRevenue = Math.max(...(data?.top_products ?? []).map((p) => p.revenue), 1);
                    const pct = Math.round((product.revenue / maxRevenue) * 100);
                    return (
                      <div key={product.name} className="rounded-2xl border border-surface-200/60 px-4 py-3 dark:border-surface-800/60">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xs font-bold text-surface-400 w-5 text-right flex-shrink-0">#{index + 1}</span>
                            <span className="truncate text-sm font-medium text-surface-900 dark:text-white">{product.name}</span>
                          </div>
                          <div className="flex flex-shrink-0 items-center gap-2 text-xs text-surface-500">
                            <span>{product.units_sold} uds.</span>
                            <span className="font-semibold text-emerald-600 dark:text-emerald-400">{formatCurrency(product.revenue)}</span>
                          </div>
                        </div>
                        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-100 dark:bg-surface-800">
                          <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-brand-500" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </motion.div>
          </div>

          {/* P&L summary table */}
          <motion.div variants={fadeInUp} className="rounded-3xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
            <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Resumen P&amp;L</h2>
            <p className="mt-1 text-sm text-surface-500">Estado de resultados resumido del período</p>
            <div className="mt-5 divide-y divide-surface-100 dark:divide-surface-800">
              {[
                { label: 'Ingresos membresías', value: parseApiNumber(data?.revenue_total), type: 'income' },
                { label: 'Ingresos POS', value: parseApiNumber(data?.pos_revenue), type: 'income' },
                { label: '= Ingresos totales', value: parseApiNumber(data?.total_revenue), type: 'subtotal' },
                { label: '− Costo mercadería (COGS)', value: parseApiNumber(data?.pos_cogs), type: 'expense' },
                { label: '= Ganancia bruta POS', value: parseApiNumber(data?.pos_gross_profit), type: 'subtotal' },
                { label: `  Margen bruto POS`, value: null, extra: `${parseApiNumber(data?.pos_gross_margin_pct).toFixed(1)}%`, type: 'note' },
                { label: '− Gastos operativos', value: parseApiNumber(data?.total_expenses), type: 'expense' },
                { label: '= Ganancia neta', value: netProfit, type: 'net' },
                { label: `  Margen neto`, value: null, extra: `${netMargin.toFixed(1)}%`, type: 'net-note' },
              ].map((row) => (
                <div
                  key={row.label}
                  className={cn(
                    'flex items-center justify-between px-2 py-3',
                    row.type === 'subtotal' && 'bg-surface-50 dark:bg-surface-800/40 rounded-lg font-semibold',
                    row.type === 'net' && 'bg-surface-50 dark:bg-surface-800/40 rounded-lg font-bold text-base',
                    row.type === 'note' && 'text-xs text-surface-400',
                    row.type === 'net-note' && 'text-xs text-surface-400',
                  )}
                >
                  <span className={cn('text-sm', row.type === 'net' && 'text-base font-bold', row.type === 'subtotal' && 'font-semibold')}>{row.label}</span>
                  {row.value !== null ? (
                    <span className={cn(
                      'text-sm tabular-nums',
                      row.type === 'expense' && 'text-rose-600 dark:text-rose-400',
                      row.type === 'income' && 'text-emerald-600 dark:text-emerald-400',
                      row.type === 'net' && `text-base font-bold ${netProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`,
                      row.type === 'subtotal' && 'font-semibold',
                    )}>
                      {row.type === 'expense' ? `− ${formatCurrency(row.value)}` : formatCurrency(row.value)}
                    </span>
                  ) : (
                    <span className="text-xs tabular-nums text-surface-400">{row.extra}</span>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        </>
      )}

      {/* ── TAB: CAJA / MÉTODOS DE PAGO ── */}
      {tab === 'caja' && (
        <>
          {/* Period selector */}
          <motion.div variants={fadeInUp} className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-1 rounded-xl border border-surface-200/50 bg-surface-50 p-1 dark:border-surface-800/50 dark:bg-surface-900/50 w-fit">
              {CAJA_PERIODS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setCajaPeriod(p.value)}
                  className={cn(
                    'rounded-lg px-4 py-2 text-sm font-medium transition-all',
                    cajaPeriod === p.value
                      ? 'bg-white shadow-sm text-surface-900 dark:bg-surface-800 dark:text-white'
                      : 'text-surface-500 hover:text-surface-700 dark:hover:text-surface-300',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => exportCsv(`ventas-metodo-pago-${cajaPeriod}.csv`, [
                ['Método', 'Transacciones', 'Subtotal', 'Descuento', 'Total'],
                ...(breakdown?.by_method ?? []).map((m) => [m.label, String(m.count), String(m.subtotal), String(m.discount), String(m.total)]),
              ])}
              className="btn-secondary"
            >
              <Download size={16} />
              Exportar
            </button>
          </motion.div>

          {/* KPIs */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-2xl border border-surface-200/50 bg-white p-4 dark:border-surface-800/50 dark:bg-surface-900">
              <p className="text-xs text-surface-500">Ventas totales</p>
              <p className="mt-2 text-2xl font-bold font-display text-surface-900 dark:text-white">
                {breakdownLoading ? '—' : formatCurrency(parseApiNumber(breakdown?.total))}
              </p>
            </div>
            <div className="rounded-2xl border border-surface-200/50 bg-white p-4 dark:border-surface-800/50 dark:bg-surface-900">
              <p className="text-xs text-surface-500">Transacciones</p>
              <p className="mt-2 text-2xl font-bold font-display text-surface-900 dark:text-white">
                {breakdownLoading ? '—' : (breakdown?.transaction_count ?? 0)}
              </p>
            </div>
            <div className="rounded-2xl border border-surface-200/50 bg-white p-4 dark:border-surface-800/50 dark:bg-surface-900">
              <p className="text-xs text-surface-500">Efectivo</p>
              <p className="mt-2 text-2xl font-bold font-display text-emerald-600 dark:text-emerald-400">
                {breakdownLoading ? '—' : formatCurrency(parseApiNumber(breakdown?.by_method.find((m) => m.payment_method === 'cash')?.total ?? 0))}
              </p>
            </div>
            <div className="rounded-2xl border border-surface-200/50 bg-white p-4 dark:border-surface-800/50 dark:bg-surface-900">
              <p className="text-xs text-surface-500">Métodos usados</p>
              <p className="mt-2 text-2xl font-bold font-display text-surface-900 dark:text-white">
                {breakdownLoading ? '—' : (breakdown?.by_method.length ?? 0)}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.45fr_0.55fr]">
            {/* Pie por método */}
            <motion.div variants={fadeInUp} className="rounded-3xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
              <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Ventas por método de pago</h2>
              <p className="mt-1 text-sm text-surface-500">Distribución del período</p>
              <div className="mt-5 h-[280px]">
                {breakdownLoading ? (
                  <div className="shimmer h-full rounded-2xl" />
                ) : methodData.length === 0 ? (
                  <p className="py-16 text-center text-sm text-surface-400">Sin ventas en el período.</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={methodData}
                        dataKey="total"
                        nameKey="label"
                        cx="50%"
                        cy="45%"
                        innerRadius={50}
                        outerRadius={85}
                        paddingAngle={3}
                        label={(entry: { label: string; total: number }) =>
                          `${entry.label} ${methodTotal > 0 ? Math.round((entry.total / methodTotal) * 100) : 0}%`}
                        labelLine={false}
                      >
                        {methodData.map((m, i) => <Cell key={m.payment_method} fill={METHOD_COLORS[i % METHOD_COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(value: number, _name, item) => [formatCurrency(value), item?.payload?.label ?? 'Total']} />
                      <Legend verticalAlign="bottom" align="center" iconType="circle" wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </motion.div>

            {/* Tabla por método */}
            <motion.div variants={fadeInUp} className="rounded-3xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
              <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Detalle por método</h2>
              <p className="mt-1 text-sm text-surface-500">Transacciones e ingresos por medio</p>
              <div className="mt-4 space-y-3">
                {breakdownLoading ? (
                  Array.from({ length: 4 }).map((_, i) => <div key={i} className="shimmer h-12 rounded-2xl" />)
                ) : methodData.length === 0 ? (
                  <p className="py-10 text-center text-sm text-surface-400">Sin ventas en el período.</p>
                ) : (
                  methodData.map((m, i) => {
                    const pct = methodTotal > 0 ? Math.round((m.total / methodTotal) * 100) : 0;
                    return (
                      <div key={m.payment_method} className="rounded-2xl border border-surface-200/60 px-4 py-3 dark:border-surface-800/60">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: METHOD_COLORS[i % METHOD_COLORS.length] }} />
                            <span className="truncate text-sm font-medium text-surface-900 dark:text-white">{m.label}</span>
                            <span className="flex-shrink-0 text-xs text-surface-400">{m.count} ventas</span>
                          </div>
                          <span className="flex-shrink-0 text-sm font-semibold text-emerald-600 dark:text-emerald-400">{formatCurrency(m.total)}</span>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-100 dark:bg-surface-800">
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: METHOD_COLORS[i % METHOD_COLORS.length] }} />
                          </div>
                          <span className="w-9 text-right text-xs text-surface-400">{pct}%</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </motion.div>
          </div>

          {/* Historial de turnos de caja */}
          <motion.div variants={fadeInUp} className="rounded-3xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
            <div className="flex items-center gap-2">
              <ClipboardList size={18} className="text-brand-500" />
              <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Historial de turnos de caja</h2>
            </div>
            <p className="mt-1 text-sm text-surface-500">Aperturas y cierres recientes con arqueo</p>
            <div className="mt-4 overflow-x-auto">
              {sessionsLoading ? (
                <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="shimmer h-12 rounded-2xl" />)}</div>
              ) : cashSessions.length === 0 ? (
                <p className="py-10 text-center text-sm text-surface-400">Sin turnos de caja registrados.</p>
              ) : (
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-surface-400">
                      <th className="px-2 py-2 font-medium">Apertura</th>
                      <th className="px-2 py-2 font-medium">Responsable</th>
                      <th className="px-2 py-2 font-medium">Estado</th>
                      <th className="px-2 py-2 text-right font-medium">Fondo</th>
                      <th className="px-2 py-2 text-right font-medium">Ventas</th>
                      <th className="px-2 py-2 text-right font-medium">Efectivo esp.</th>
                      <th className="px-2 py-2 text-right font-medium">Contado</th>
                      <th className="px-2 py-2 text-right font-medium">Dif.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
                    {cashSessions.map((s) => (
                      <tr key={s.id} className="text-surface-700 dark:text-surface-300">
                        <td className="px-2 py-2.5 whitespace-nowrap">
                          {new Date(s.opened_at).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="px-2 py-2.5">{s.opened_by_name ?? '—'}</td>
                        <td className="px-2 py-2.5">
                          <span className={cn(
                            'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                            s.status === 'open'
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                              : 'bg-surface-100 text-surface-500 dark:bg-surface-800',
                          )}>
                            {s.status === 'open' ? 'Abierta' : 'Cerrada'}
                          </span>
                        </td>
                        <td className="px-2 py-2.5 text-right tabular-nums">{formatCurrency(s.opening_amount)}</td>
                        <td className="px-2 py-2.5 text-right tabular-nums">{formatCurrency(s.sales_total)}</td>
                        <td className="px-2 py-2.5 text-right tabular-nums">{s.expected_cash != null ? formatCurrency(s.expected_cash) : '—'}</td>
                        <td className="px-2 py-2.5 text-right tabular-nums">{s.closing_amount != null ? formatCurrency(s.closing_amount) : '—'}</td>
                        <td className={cn(
                          'px-2 py-2.5 text-right tabular-nums font-medium',
                          s.difference == null ? 'text-surface-400' : s.difference === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400',
                        )}>
                          {s.difference != null ? `${s.difference >= 0 ? '+' : ''}${formatCurrency(s.difference)}` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </motion.div>
        </>
      )}
    </motion.div>
  );
}
