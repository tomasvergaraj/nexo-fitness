// Charts del dashboard aislados en su propio módulo para que recharts (~106KB gz)
// NO entre en el chunk crítico de la landing del owner. DashboardPage los carga
// con React.lazy + Suspense: las tarjetas/números pintan al instante y los
// gráficos hidratan después. JSX movido verbatim — sin cambios visuales.
import { AreaChart, Area, BarChart, Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCurrency } from '@/utils';

interface ChartPoint {
  label: string;
  value: number;
}

export function RevenueAreaChart({ data }: { data: ChartPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data}>
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
  );
}

export function OperationalBarChart({ data }: { data: ChartPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} barSize={42}>
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
  );
}
