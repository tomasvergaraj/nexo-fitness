import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Clock3,
  CreditCard,
  TrendingUp,
  Users,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { platformAdminApi } from '@/services/api';
import { fadeInUp, staggerContainer } from '@/utils/animations';
import { formatCurrency } from '@/utils';

interface PlatformStats {
  metrics: {
    mrr: number;
    mrr_delta_pct: number;
    active_tenants: number;
    trial_tenants: number;
    suspended_tenants: number;
    cancelled_tenants: number;
    total_tenants: number;
    trials_expiring_7d: number;
    trials_critical_2d: number;
    licenses_expiring_7d: number;
    conversion_rate: number;
    conversion_cohort_size: number;
    payments_last_24h: number;
  };
  mrr_series: { month: string; amount: number }[];
  leads_funnel: { new: number; contacted: number; qualified: number; won: number; lost: number; total: number };
  lead_sources?: {
    source: string;
    total: number;
    won: number;
    qualified: number;
    lost: number;
    new: number;
    contacted: number;
    conversion_rate: number;
  }[];
  cohort_retention?: {
    cohort_month: string;
    size: number;
    months_elapsed: number;
    retention: (number | null)[];
  }[];
  alerts: {
    kind: 'warn' | 'critical' | 'info';
    title: string;
    detail: string;
    cta_to: string;
    cta_label: string;
    count: number;
  }[];
  as_of: string;
}

const TINT: Record<string, string> = {
  brand: 'bg-brand-500/15 text-brand-300 border-brand-500/30',
  emerald: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  sky: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  violet: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
};

const ALERT_KIND: Record<string, string> = {
  warn: 'border-amber-500/30 bg-amber-500/5 text-amber-200',
  critical: 'border-rose-500/30 bg-rose-500/5 text-rose-200',
  info: 'border-sky-500/30 bg-sky-500/5 text-sky-200',
};

const ALERT_ICON: Record<string, React.ReactNode> = {
  warn: <Clock3 size={14} />,
  critical: <AlertTriangle size={14} />,
  info: <CreditCard size={14} />,
};

function MetricCard({
  label,
  value,
  delta,
  deltaPositive = true,
  spark,
  icon,
  tint = 'brand',
}: {
  label: string;
  value: string;
  delta?: string;
  deltaPositive?: boolean;
  spark?: number[];
  icon: React.ReactNode;
  tint?: string;
}) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-surface-800 bg-surface-900/50 p-4 transition-colors hover:border-surface-700">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-medium text-surface-400">{label}</span>
        <span className={`inline-flex h-6 w-6 items-center justify-center rounded-md border ${TINT[tint]}`}>
          {icon}
        </span>
      </div>
      <div className="mt-2 font-display text-2xl font-bold tracking-tight text-white">{value}</div>
      {delta && (
        <div
          className={`mt-1 inline-flex items-center gap-1 text-[11px] font-medium ${
            deltaPositive ? 'text-emerald-300' : 'text-amber-300'
          }`}
        >
          <ArrowUpRight size={11} className={deltaPositive ? '' : 'rotate-90'} />
          {delta}
        </div>
      )}
      {spark && spark.length > 1 && <div className="mt-3 -mb-1"><Sparkline data={spark} color={tint} /></div>}
    </div>
  );
}

function Sparkline({ data, color = 'brand' }: { data: number[]; color?: string }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data
    .map((d, i) => `${(i / (data.length - 1)) * 100},${100 - ((d - min) / range) * 80 - 10}`)
    .join(' ');
  const stroke =
    color === 'emerald' ? '#34d399' : color === 'sky' ? '#38bdf8' : color === 'violet' ? '#a78bfa' : '#22d3ee';
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-10 w-full">
      <polyline points={points} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MrrChart({ series }: { series: PlatformStats['mrr_series'] }) {
  if (!series.length) {
    return <div className="text-xs text-surface-500">Sin datos en últimos 12 meses.</div>;
  }
  const max = Math.max(...series.map((s) => s.amount), 1);
  const min = 0;
  const range = max - min || 1;
  const w = 100;
  const h = 40;
  const points = series
    .map((s, i) => `${(i / (series.length - 1 || 1)) * w},${h - ((s.amount - min) / range) * (h - 6) - 3}`)
    .join(' ');
  // Build closed polygon for area fill
  const areaPoints = `${points} ${w},${h} 0,${h}`;
  const total = series.reduce((acc, s) => acc + s.amount, 0);

  return (
    <div className="relative">
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="text-[11px] font-medium text-surface-400">Ingresos últimos 12 meses</p>
          <p className="mt-1 font-display text-2xl font-bold tracking-tight text-white">
            {formatCurrency(total, 'CLP')}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-surface-500">Pico</p>
          <p className="text-sm font-semibold text-brand-300">{formatCurrency(max, 'CLP')}</p>
        </div>
      </div>
      <svg viewBox={`0 0 ${w} ${h + 10}`} preserveAspectRatio="none" className="mt-3 h-32 w-full overflow-visible">
        <defs>
          <linearGradient id="mrr-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={areaPoints} fill="url(#mrr-fill)" />
        <polyline
          points={points}
          fill="none"
          stroke="#22d3ee"
          strokeWidth="1.2"
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {series.map((s, i) => {
          const x = (i / (series.length - 1 || 1)) * w;
          const y = h - ((s.amount - min) / range) * (h - 6) - 3;
          return <circle key={s.month} cx={x} cy={y} r="0.6" fill="#22d3ee" vectorEffect="non-scaling-stroke" />;
        })}
        {/* X axis labels every 3rd month */}
        {series.map((s, i) => {
          if (i % 3 !== 0 && i !== series.length - 1) return null;
          const x = (i / (series.length - 1 || 1)) * w;
          return (
            <text
              key={`x-${s.month}`}
              x={x}
              y={h + 8}
              textAnchor="middle"
              fontSize="3"
              fill="#64748b"
              style={{ fontFamily: 'ui-monospace, monospace' }}
            >
              {s.month.slice(5)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

const FUNNEL_STEPS: { key: keyof PlatformStats['leads_funnel']; label: string; color: string }[] = [
  { key: 'new', label: 'Nuevos', color: '#38bdf8' },
  { key: 'contacted', label: 'Contactados', color: '#a78bfa' },
  { key: 'qualified', label: 'Calificados', color: '#22d3ee' },
  { key: 'won', label: 'Ganados', color: '#34d399' },
];

function LeadsFunnel({ funnel }: { funnel: PlatformStats['leads_funnel'] }) {
  const max = Math.max(funnel.new, funnel.contacted, funnel.qualified, funnel.won, 1);
  return (
    <div className="space-y-2">
      {FUNNEL_STEPS.map((step) => {
        const count = funnel[step.key] as number;
        const pct = max > 0 ? (count / max) * 100 : 0;
        const conversionFromNew = funnel.new > 0 ? Math.round((count / funnel.new) * 100) : 0;
        return (
          <div key={step.key}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-medium text-surface-300">{step.label}</span>
              <span className="tabular-nums text-surface-400">
                <span className="font-semibold text-white">{count}</span>
                {step.key !== 'new' && funnel.new > 0 && (
                  <span className="ml-1.5 text-surface-500">({conversionFromNew}%)</span>
                )}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-800">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, background: step.color }}
              />
            </div>
          </div>
        );
      })}
      {funnel.lost > 0 && (
        <div className="mt-3 border-t border-surface-800 pt-2 text-xs text-surface-500">
          Perdidos: <span className="text-rose-300 font-semibold">{funnel.lost}</span> · Total leads: {funnel.total}
        </div>
      )}
    </div>
  );
}

function retentionTone(pct: number | null): string {
  if (pct === null) return 'bg-surface-900/40 text-surface-700';
  if (pct >= 80) return 'bg-brand-500/85 text-white';
  if (pct >= 60) return 'bg-brand-500/65 text-white';
  if (pct >= 40) return 'bg-brand-500/45 text-brand-50';
  if (pct >= 20) return 'bg-brand-500/25 text-brand-200';
  if (pct > 0) return 'bg-brand-500/12 text-brand-200';
  return 'bg-surface-800/60 text-surface-500';
}

function CohortHeatmap({ cohorts }: { cohorts: NonNullable<PlatformStats['cohort_retention']> }) {
  if (!cohorts.length) {
    return (
      <div className="text-xs text-surface-500">
        Sin cohortes en la ventana de 12 meses. Aparecerán cuando registres tenants.
      </div>
    );
  }
  // Show up to 12 columns (M0..M11)
  const maxMonths = Math.max(...cohorts.map((c) => c.retention.length), 1);
  const cols = Math.min(maxMonths, 12);
  return (
    <div className="overflow-x-auto">
      <table className="text-[11px] border-separate border-spacing-1">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-surface-900/80 px-2 py-1 text-left text-[10px] font-bold uppercase tracking-wider text-surface-500">
              Cohorte
            </th>
            <th className="px-2 py-1 text-right text-[10px] font-bold uppercase tracking-wider text-surface-500">N</th>
            {Array.from({ length: cols }).map((_, i) => (
              <th key={i} className="px-1 py-1 text-center text-[10px] font-mono font-bold text-surface-500">
                M{i}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((c) => (
            <tr key={c.cohort_month}>
              <td className="sticky left-0 z-10 bg-surface-900/80 px-2 py-1 font-mono text-surface-300">
                {c.cohort_month}
              </td>
              <td className="px-2 py-1 text-right tabular-nums text-surface-400">{c.size}</td>
              {Array.from({ length: cols }).map((_, i) => {
                const value = c.retention[i] ?? null;
                return (
                  <td
                    key={i}
                    className={`h-7 w-9 rounded-md text-center font-mono tabular-nums ${retentionTone(value)}`}
                    title={value === null ? 'sin datos' : `${value}% retenido en M${i}`}
                  >
                    {value === null ? '·' : `${value.toFixed(0)}%`}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  website: 'Web',
  landing: 'Landing',
  storefront: 'Storefront',
  instagram: 'Instagram',
  facebook: 'Facebook',
  whatsapp: 'WhatsApp',
  referral: 'Referido',
  organic: 'Orgánico',
  google: 'Google',
  ads: 'Ads',
  unknown: 'Sin origen',
};

function LeadSourcesTable({ sources }: { sources: NonNullable<PlatformStats['lead_sources']> }) {
  if (!sources.length) {
    return <div className="text-xs text-surface-500">Sin leads registrados todavía.</div>;
  }
  const totalLeads = sources.reduce((acc, s) => acc + s.total, 0);
  return (
    <div className="space-y-2">
      {sources.slice(0, 8).map((src) => {
        const sharePct = totalLeads > 0 ? (src.total / totalLeads) * 100 : 0;
        return (
          <div key={src.source}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-medium text-surface-200">{SOURCE_LABEL[src.source] ?? src.source}</span>
              <span className="text-surface-400 tabular-nums">
                <span className="font-semibold text-white">{src.total}</span>
                <span className="ml-1.5 text-surface-500">({sharePct.toFixed(0)}%)</span>
                {src.won > 0 && (
                  <span className="ml-2 text-emerald-400">
                    {src.won} ganados ({src.conversion_rate}%)
                  </span>
                )}
              </span>
            </div>
            <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-800">
              <div className="h-full bg-emerald-400" style={{ width: `${(src.won / src.total) * sharePct}%` }} />
              <div className="h-full bg-brand-500/40" style={{ width: `${((src.qualified + src.contacted) / src.total) * sharePct}%` }} />
              <div className="h-full bg-rose-500/40" style={{ width: `${(src.lost / src.total) * sharePct}%` }} />
              <div className="h-full bg-surface-600" style={{ width: `${(src.new / src.total) * sharePct}%` }} />
            </div>
          </div>
        );
      })}
      <div className="flex items-center gap-3 pt-1.5 text-[10px] text-surface-500">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-400" />Ganados</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-brand-500/40" />En proceso</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500/40" />Perdidos</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-surface-600" />Nuevos</span>
      </div>
    </div>
  );
}

export default function PlatformDashboardPage() {
  const { data, isLoading, isError } = useQuery<PlatformStats>({
    queryKey: ['platform-stats'],
    queryFn: async () => {
      const response = await platformAdminApi.getPlatformStats();
      return response.data as PlatformStats;
    },
    refetchInterval: 60_000,
  });

  const tenantSpark = useMemo(() => {
    if (!data) return [];
    const m = data.metrics;
    return [m.cancelled_tenants, m.suspended_tenants, m.trial_tenants, m.active_tenants];
  }, [data]);

  const mrrSpark = useMemo(() => (data?.mrr_series ?? []).map((s) => s.amount), [data]);

  if (isLoading && !data) {
    return (
      <div className="space-y-5">
        <div className="h-20 rounded-xl bg-surface-900/50 animate-pulse" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-32 rounded-xl bg-surface-900/50 animate-pulse" />
          ))}
        </div>
        <div className="h-72 rounded-xl bg-surface-900/50 animate-pulse" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-5 py-6 text-sm text-rose-200">
        No pudimos cargar las métricas de plataforma. Revisa el backend o tu sesión de superadmin.
      </div>
    );
  }

  const m = data.metrics;
  const mrrDelta = m.mrr_delta_pct;
  const mrrDeltaText = mrrDelta === 0
    ? 'Sin cambios vs período anterior'
    : `${mrrDelta > 0 ? '+' : ''}${mrrDelta.toFixed(1)}% vs anterior`;

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-5">
      {/* Header */}
      <motion.div variants={fadeInUp}>
        <span className="inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-brand-300">
          <span className="h-1 w-1 rounded-full bg-brand-400" />
          Operación SaaS
        </span>
        <h1 className="mt-3 text-3xl font-bold tracking-tight font-display text-white">
          Resumen de plataforma
        </h1>
        <p className="mt-1 text-sm text-surface-400">
          Datos en vivo desde el backend · actualizado {new Date(data.as_of).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </motion.div>

      {/* Metrics */}
      <motion.div variants={fadeInUp} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Ingresos últimos 30d"
          value={formatCurrency(m.mrr, 'CLP')}
          delta={mrrDeltaText}
          deltaPositive={mrrDelta >= 0}
          spark={mrrSpark}
          icon={<TrendingUp size={14} />}
          tint="brand"
        />
        <MetricCard
          label="Tenants activos"
          value={String(m.active_tenants)}
          delta={`${m.total_tenants} totales`}
          deltaPositive
          spark={tenantSpark}
          icon={<Building2 size={14} />}
          tint="emerald"
        />
        <MetricCard
          label="Trials en curso"
          value={String(m.trial_tenants)}
          delta={
            m.trials_expiring_7d > 0
              ? `${m.trials_expiring_7d} vencen en 7 días`
              : 'Ninguno vence pronto'
          }
          deltaPositive={m.trials_expiring_7d === 0}
          icon={<Clock3 size={14} />}
          tint="sky"
        />
        <MetricCard
          label="Conversión trial → pago"
          value={`${m.conversion_rate.toFixed(1)}%`}
          delta={
            m.conversion_cohort_size > 0
              ? `Cohorte ${m.conversion_cohort_size} cuentas`
              : 'Sin cohorte aún'
          }
          deltaPositive={m.conversion_rate >= 25}
          icon={<CheckCircle2 size={14} />}
          tint="violet"
        />
      </motion.div>

      {/* Chart + funnel */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <motion.div variants={fadeInUp} className="lg:col-span-2">
          <div className="rounded-xl border border-surface-800 bg-surface-900/40 p-5">
            <MrrChart series={data.mrr_series} />
          </div>
        </motion.div>

        <motion.div variants={fadeInUp}>
          <div className="h-full rounded-xl border border-surface-800 bg-surface-900/40 p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm font-semibold text-white">Embudo de leads</p>
                <p className="text-[11px] text-surface-500">Conversión por etapa</p>
              </div>
              <Users size={14} className="text-surface-500" />
            </div>
            <LeadsFunnel funnel={data.leads_funnel} />
          </div>
        </motion.div>
      </div>

      {/* Cohort retention + lead attribution */}
      {(data.cohort_retention?.length || data.lead_sources?.length) ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <motion.div variants={fadeInUp} className="lg:col-span-2">
            <div className="rounded-xl border border-surface-800 bg-surface-900/40 p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm font-semibold text-white">Retención por cohorte</p>
                  <p className="text-[11px] text-surface-500">% de tenants activos N meses después de su mes de alta</p>
                </div>
                <span className="rounded-full bg-brand-500/15 px-2 py-0.5 text-[10px] font-bold text-brand-300">
                  {data.cohort_retention?.length ?? 0} cohortes
                </span>
              </div>
              <CohortHeatmap cohorts={data.cohort_retention ?? []} />
            </div>
          </motion.div>

          <motion.div variants={fadeInUp}>
            <div className="h-full rounded-xl border border-surface-800 bg-surface-900/40 p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm font-semibold text-white">Origen de leads</p>
                  <p className="text-[11px] text-surface-500">Atribución por canal · top 8</p>
                </div>
                <Users size={14} className="text-surface-500" />
              </div>
              <LeadSourcesTable sources={data.lead_sources ?? []} />
            </div>
          </motion.div>
        </div>
      ) : null}

      {/* Alerts + Activity */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <motion.div variants={fadeInUp} className="lg:col-span-2">
          <div className="rounded-xl border border-surface-800 bg-surface-900/40">
            <div className="flex items-center justify-between border-b border-surface-800 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-white">Necesita tu atención</p>
                <p className="text-[11px] text-surface-500">Alertas operativas en tiempo real</p>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                data.alerts.length > 0 ? 'bg-rose-500/15 text-rose-300' : 'bg-emerald-500/15 text-emerald-300'
              }`}>
                {data.alerts.length} {data.alerts.length === 1 ? 'pendiente' : 'pendientes'}
              </span>
            </div>
            {data.alerts.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <CheckCircle2 size={28} className="mx-auto mb-2 text-emerald-400" />
                <p className="text-sm font-medium text-white">Todo bajo control</p>
                <p className="mt-1 text-xs text-surface-500">Sin alertas operativas activas</p>
              </div>
            ) : (
              <div className="divide-y divide-surface-800/70">
                {data.alerts.map((a, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3">
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${ALERT_KIND[a.kind]}`}>
                      {ALERT_ICON[a.kind]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-white">{a.title}</p>
                      <p className="truncate text-xs text-surface-400">{a.detail}</p>
                    </div>
                    <Link
                      to={a.cta_to}
                      className="shrink-0 rounded-md border border-surface-700 px-2.5 py-1 text-xs font-medium text-surface-200 hover:border-brand-500/40 hover:bg-brand-500/10 hover:text-brand-200"
                    >
                      {a.cta_label}
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.div>

        <motion.div variants={fadeInUp}>
          <div className="h-full rounded-xl border border-surface-800 bg-surface-900/40">
            <div className="flex items-center justify-between border-b border-surface-800 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-white">Pulso operativo</p>
                <p className="text-[11px] text-surface-500">Últimas 24 horas</p>
              </div>
              <Activity size={14} className="text-surface-500" />
            </div>
            <ul className="divide-y divide-surface-800/70 text-xs">
              <li className="px-4 py-2.5 flex justify-between items-center">
                <span className="text-surface-400">Pagos registrados</span>
                <span className="font-semibold text-white tabular-nums">{m.payments_last_24h}</span>
              </li>
              <li className="px-4 py-2.5 flex justify-between items-center">
                <span className="text-surface-400">Trials críticos (≤48h)</span>
                <span className={`font-semibold tabular-nums ${m.trials_critical_2d > 0 ? 'text-rose-300' : 'text-white'}`}>
                  {m.trials_critical_2d}
                </span>
              </li>
              <li className="px-4 py-2.5 flex justify-between items-center">
                <span className="text-surface-400">Licencias venciendo (7d)</span>
                <span className={`font-semibold tabular-nums ${m.licenses_expiring_7d > 0 ? 'text-amber-300' : 'text-white'}`}>
                  {m.licenses_expiring_7d}
                </span>
              </li>
              <li className="px-4 py-2.5 flex justify-between items-center">
                <span className="text-surface-400">Cuentas suspendidas</span>
                <span className="font-semibold text-white tabular-nums">{m.suspended_tenants}</span>
              </li>
              <li className="px-4 py-2.5 flex justify-between items-center">
                <span className="text-surface-400">Cuentas canceladas</span>
                <span className="font-semibold text-surface-300 tabular-nums">{m.cancelled_tenants}</span>
              </li>
            </ul>
          </div>
        </motion.div>
      </div>

      {/* Coming-soon hint */}
      <motion.div variants={fadeInUp}>
        <div className="rounded-xl border border-dashed border-surface-800 bg-surface-900/30 px-4 py-3 text-xs text-surface-500">
          <strong className="text-surface-300">Próximas fases:</strong> tabla tenants con bulk actions ·
          command palette ⌘K · cohort retention heatmap · audit log + impersonation segura.
        </div>
      </motion.div>
    </motion.div>
  );
}
