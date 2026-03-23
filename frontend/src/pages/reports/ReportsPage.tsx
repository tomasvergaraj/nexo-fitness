import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Download, Calendar, Filter, TrendingUp, TrendingDown, DollarSign, Users,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line,
} from 'recharts';
import { staggerContainer, fadeInUp } from '@/utils/animations';
import { cn, formatCurrency } from '@/utils';

const monthlyRevenue = [
  { month: 'Ene', revenue: 4200000, members: 120 },
  { month: 'Feb', revenue: 4800000, members: 128 },
  { month: 'Mar', revenue: 5100000, members: 135 },
  { month: 'Abr', revenue: 4900000, members: 132 },
  { month: 'May', revenue: 5500000, members: 140 },
  { month: 'Jun', revenue: 5200000, members: 138 },
  { month: 'Jul', revenue: 4700000, members: 130 },
  { month: 'Ago', revenue: 5800000, members: 145 },
  { month: 'Sep', revenue: 6100000, members: 150 },
  { month: 'Oct', revenue: 6400000, members: 155 },
  { month: 'Nov', revenue: 6800000, members: 160 },
  { month: 'Dic', revenue: 7200000, members: 167 },
];

const revenueByPlan = [
  { name: 'Basico', value: 1050000, color: '#94a3b8' },
  { name: 'Full', value: 3350000, color: '#06b6d4' },
  { name: 'Premium', value: 2400000, color: '#8b5cf6' },
  { name: 'Anual', value: 675000, color: '#10b981' },
];

const attendanceData = [
  { day: 'Lun', attendance: 85 }, { day: 'Mar', attendance: 72 },
  { day: 'Mie', attendance: 90 }, { day: 'Jue', attendance: 78 },
  { day: 'Vie', attendance: 95 }, { day: 'Sab', attendance: 65 },
  { day: 'Dom', attendance: 40 },
];

type RangeKey = '30d' | '90d' | '12m';
type MetricFilter = 'all' | 'revenue' | 'members';

function exportReportsCsv(rows: string[][], fileSuffix: string) {
  const csv = rows.map((row) => row.map((value) => `"${value}"`).join(',')).join('\n');
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `reportes-nexo-${fileSuffix}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const [range, setRange] = useState<RangeKey>('12m');
  const [metricFilter, setMetricFilter] = useState<MetricFilter>('all');

  const visibleRevenue = useMemo(() => {
    if (range === '30d') return monthlyRevenue.slice(-1);
    if (range === '90d') return monthlyRevenue.slice(-3);
    return monthlyRevenue;
  }, [range]);

  const cards = useMemo(() => {
    const totalRevenue = visibleRevenue.reduce((sum, item) => sum + item.revenue, 0);
    const latestMembers = visibleRevenue[visibleRevenue.length - 1]?.members ?? 0;
    const previousMembers = visibleRevenue[visibleRevenue.length - 2]?.members ?? latestMembers;
    const renewalRate = range === '30d' ? 91.2 : range === '90d' ? 89.6 : 87.5;
    const churnRate = range === '30d' ? 3.4 : range === '90d' ? 3.9 : 4.2;

    return [
      { label: 'Ingresos totales', value: formatCurrency(totalRevenue), change: '+18%', up: true, icon: DollarSign, color: 'brand' },
      { label: 'Miembros totales', value: String(latestMembers), change: `${latestMembers - previousMembers >= 0 ? '+' : ''}${latestMembers - previousMembers}`, up: latestMembers >= previousMembers, icon: Users, color: 'emerald' },
      { label: 'Tasa renovacion', value: `${renewalRate}%`, change: '+3.2%', up: true, icon: TrendingUp, color: 'violet' },
      { label: 'Tasa cancelacion', value: `${churnRate}%`, change: '-1.1%', up: false, icon: TrendingDown, color: 'amber' },
    ];
  }, [range, visibleRevenue]);

  const chartData = useMemo(() => {
    if (metricFilter === 'members') {
      return visibleRevenue.map((item) => ({ month: item.month, value: item.members }));
    }

    return visibleRevenue.map((item) => ({ month: item.month, value: item.revenue }));
  }, [metricFilter, visibleRevenue]);

  const exportCurrentView = () => {
    exportReportsCsv(
      [
        ['Periodo', metricFilter === 'members' ? 'Miembros' : 'Ingresos'],
        ...chartData.map((item) => [item.month, String(item.value)]),
      ],
      `${range}-${metricFilter}`,
    );
  };

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-6">
      <motion.div variants={fadeInUp} className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Reportes</h1>
          <p className="mt-1 text-sm text-surface-500">Analitica ejecutiva del gimnasio con filtros interactivos</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setRange(range === '12m' ? '90d' : range === '90d' ? '30d' : '12m')} className="btn-secondary text-sm">
            <Calendar size={16} />
            {range === '12m' ? 'Ultimos 12 meses' : range === '90d' ? 'Ultimos 90 dias' : 'Ultimos 30 dias'}
          </button>
          <button onClick={() => setMetricFilter(metricFilter === 'all' ? 'revenue' : metricFilter === 'revenue' ? 'members' : 'all')} className="btn-secondary text-sm">
            <Filter size={16} />
            {metricFilter === 'all' ? 'Todas las metricas' : metricFilter === 'revenue' ? 'Solo ingresos' : 'Solo miembros'}
          </button>
          <button onClick={exportCurrentView} className="btn-primary text-sm">
            <Download size={16} /> Exportar
          </button>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card, index) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.08 }}
            className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm text-surface-500">{card.label}</span>
              <card.icon size={18} className={cn(
                card.color === 'brand' ? 'text-brand-500' :
                card.color === 'emerald' ? 'text-emerald-500' :
                card.color === 'violet' ? 'text-violet-500' : 'text-amber-500',
              )} />
            </div>
            <p className="text-2xl font-bold font-display text-surface-900 dark:text-white">{card.value}</p>
            <span className={cn('text-xs font-semibold', card.up ? 'text-emerald-500' : 'text-red-500')}>
              {card.change} vs periodo anterior
            </span>
          </motion.div>
        ))}
      </div>

      <motion.div
        variants={fadeInUp}
        className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900"
      >
        <h3 className="mb-4 text-base font-semibold text-surface-900 dark:text-white">
          {metricFilter === 'members' ? 'Evolucion de miembros' : 'Ingresos mensuales'}
        </h3>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-surface-100 dark:text-surface-800" />
            <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              tickFormatter={(value) => metricFilter === 'members' ? String(value) : `$${(value / 1000000).toFixed(1)}M`}
            />
            <Tooltip
              contentStyle={{ backgroundColor: 'rgba(15,23,42,0.9)', border: 'none', borderRadius: '12px', color: '#fff' }}
              formatter={(value: number) => [metricFilter === 'members' ? `${value} miembros` : formatCurrency(value), metricFilter === 'members' ? 'Miembros' : 'Ingresos']}
            />
            <Area type="monotone" dataKey="value" stroke="#06b6d4" strokeWidth={2.5} fill="url(#revGrad)" />
          </AreaChart>
        </ResponsiveContainer>
      </motion.div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <motion.div
          variants={fadeInUp}
          className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900"
        >
          <h3 className="mb-4 text-base font-semibold text-surface-900 dark:text-white">Ingresos por plan</h3>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={revenueByPlan} cx="50%" cy="50%" innerRadius={60} outerRadius={95} paddingAngle={4} dataKey="value">
                {revenueByPlan.map((entry, index) => <Cell key={index} fill={entry.color} />)}
              </Pie>
              <Tooltip
                contentStyle={{ backgroundColor: 'rgba(15,23,42,0.9)', border: 'none', borderRadius: '10px', color: '#fff' }}
                formatter={(value: number) => [formatCurrency(value), 'Ingresos']}
              />
            </PieChart>
          </ResponsiveContainer>
        </motion.div>

        <motion.div
          variants={fadeInUp}
          className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900"
        >
          <h3 className="mb-4 text-base font-semibold text-surface-900 dark:text-white">Asistencia semanal</h3>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={attendanceData}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-surface-100 dark:text-surface-800" />
              <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} domain={[0, 100]} />
              <Tooltip contentStyle={{ backgroundColor: 'rgba(15,23,42,0.9)', border: 'none', borderRadius: '10px', color: '#fff' }} />
              <Line type="monotone" dataKey="attendance" stroke="#8b5cf6" strokeWidth={2.5} dot={{ fill: '#8b5cf6', r: 5 }} activeDot={{ r: 7, stroke: '#8b5cf6', strokeWidth: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </motion.div>
      </div>
    </motion.div>
  );
}
