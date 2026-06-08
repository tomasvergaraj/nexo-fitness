import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, Heart, Loader2, TrendingDown, Users, Clock, Megaphone, Smile, Gift } from 'lucide-react';
import { motion } from 'framer-motion';
import { retentionApi } from '@/services/api';
import { cn } from '@/utils';

interface CohortCell { month_index: number; retained: number; pct: number }
interface CohortRow { cohort_month: string; cohort_size: number; cells: CohortCell[] }
interface ChurnMonth { month: string; active_at_start: number; cancelled: number; churn_pct: number }
interface AtRiskSummary { high: number; medium: number; low: number; total_active_clients: number }
interface RetentionDashboard {
  cohort_matrix: CohortRow[];
  churn_monthly: ChurnMonth[];
  at_risk: AtRiskSummary;
  avg_lifetime_days: number | null;
  months_window: number;
}
interface NpsSummary {
  nps_score: number | null;
  total: number;
  promoters: number;
  passives: number;
  detractors: number;
  average: number | null;
  days: number;
}
interface ReferrerRow { user_id: string; name: string; referred_count: number; reward_days: number }
interface ReferralMetrics {
  total_referred: number;
  rewarded_count: number;
  applied_count: number;
  pending_count: number;
  total_reward_days: number;
  top_referrers: ReferrerRow[];
}

const MONTH_OPTIONS = [3, 6, 12];

function formatMonthLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split('-');
  const date = new Date(Number(y), Number(m) - 1, 1);
  return date.toLocaleDateString('es-CL', { month: 'short', year: '2-digit' });
}

function pctColor(pct: number, max: number): string {
  if (max <= 0) return 'bg-surface-100 dark:bg-surface-800/30';
  const ratio = pct / 100;
  if (ratio >= 0.8) return 'bg-emerald-500/90 text-white';
  if (ratio >= 0.6) return 'bg-emerald-400/80 text-white';
  if (ratio >= 0.4) return 'bg-amber-400/80 text-surface-900';
  if (ratio >= 0.2) return 'bg-orange-400/80 text-white';
  return 'bg-red-400/80 text-white';
}

export default function RetentionPage() {
  const [months, setMonths] = useState(6);

  const { data, isLoading, isError } = useQuery<RetentionDashboard>({
    queryKey: ['retention-dashboard', months],
    queryFn: async () => (await retentionApi.getDashboard(months)).data,
    staleTime: 5 * 60_000,
  });

  const npsDays = months * 30;
  const { data: nps } = useQuery<NpsSummary>({
    queryKey: ['retention-nps', npsDays],
    queryFn: async () => (await retentionApi.getNps(npsDays)).data,
    staleTime: 5 * 60_000,
  });

  const { data: referrals } = useQuery<ReferralMetrics>({
    queryKey: ['retention-referrals'],
    queryFn: async () => (await retentionApi.getReferrals()).data,
    staleTime: 5 * 60_000,
  });

  const maxOffset = useMemo(
    () => (data?.cohort_matrix.reduce((m, row) => Math.max(m, row.cells.length), 0) ?? 0),
    [data],
  );

  const churnAvg = useMemo(() => {
    if (!data?.churn_monthly.length) return 0;
    return data.churn_monthly.reduce((s, m) => s + m.churn_pct, 0) / data.churn_monthly.length;
  }, [data]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 sm:py-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Retención</h1>
          <p className="text-sm text-surface-500 mt-0.5">Cohorts, churn mensual y clientes en riesgo</p>
        </div>
        <div className="flex gap-2">
          {MONTH_OPTIONS.map((m) => (
            <button
              key={m}
              onClick={() => setMonths(m)}
              className={cn(
                'rounded-xl px-3 py-1.5 text-xs font-medium transition-colors',
                m === months
                  ? 'bg-brand-500 text-white'
                  : 'bg-surface-100 text-surface-600 hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-400',
              )}
            >
              {m}m
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 size={28} className="animate-spin text-brand-500" />
        </div>
      ) : isError || !data ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-6 text-center text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
          No se pudo cargar el panel de retención.
        </div>
      ) : (
        <>
          {/* ── KPI cards ──────────────────────────────────────────────── */}
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <KpiCard
              icon={<Users size={16} className="text-brand-500" />}
              label="Clientes activos"
              value={String(data.at_risk.total_active_clients)}
            />
            <KpiCard
              icon={<AlertTriangle size={16} className="text-red-500" />}
              label="En riesgo alto"
              value={String(data.at_risk.high)}
              hint={`${data.at_risk.medium} medio · ${data.at_risk.low} bajo`}
              variant="danger"
            />
            <KpiCard
              icon={<TrendingDown size={16} className="text-amber-500" />}
              label={`Churn promedio (${months}m)`}
              value={`${churnAvg.toFixed(1)}%`}
            />
            <KpiCard
              icon={<Clock size={16} className="text-violet-500" />}
              label="Vida útil promedio"
              value={data.avg_lifetime_days ? `${data.avg_lifetime_days}d` : '—'}
              hint="Memberships canceladas"
            />
          </motion.div>

          {/* ── NPS post-clase ─────────────────────────────────────────── */}
          {nps && <NpsPanel nps={nps} months={months} />}

          {/* ── Referidos ──────────────────────────────────────────────── */}
          {referrals && <ReferralPanel data={referrals} />}

          {/* ── At-risk CTA ────────────────────────────────────────────── */}
          {data.at_risk.high > 0 && (
            <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-4 dark:border-red-900/40 dark:bg-red-950/20 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <Heart size={20} className="mt-0.5 shrink-0 text-red-500" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-red-700 dark:text-red-300">
                    {data.at_risk.high} {data.at_risk.high === 1 ? 'cliente' : 'clientes'} en riesgo alto
                  </p>
                  <p className="text-xs text-red-600 dark:text-red-400">
                    Sin check-in ≥30 días o con membresía vencida/cancelada.
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Link
                  to="/clients?risk=high"
                  className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-red-700 shadow-sm hover:bg-red-50 dark:bg-surface-900 dark:text-red-300 dark:hover:bg-surface-800"
                >
                  Ver clientes →
                </Link>
                <Link
                  to="/marketing?segment=inactive"
                  className="flex items-center gap-1.5 rounded-xl bg-red-500 px-3 py-2 text-xs font-semibold text-white hover:bg-red-600"
                >
                  <Megaphone size={12} /> Lanzar campaña
                </Link>
              </div>
            </div>
          )}

          {/* ── Cohort matrix ──────────────────────────────────────────── */}
          <div className="mb-6 rounded-2xl border border-surface-200 bg-white p-4 dark:border-surface-800 dark:bg-surface-900 sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-surface-900 dark:text-white">Cohort de retención</h2>
                <p className="text-xs text-surface-500">% de cada cohorte de altas que sigue activa luego de N meses</p>
              </div>
            </div>

            {data.cohort_matrix.every((r) => r.cohort_size === 0) ? (
              <p className="py-8 text-center text-sm text-surface-400">Sin datos suficientes para el periodo.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="text-surface-400">
                      <th className="px-2 py-1.5 text-left font-medium">Cohorte</th>
                      <th className="px-2 py-1.5 text-left font-medium">N°</th>
                      {Array.from({ length: maxOffset }).map((_, i) => (
                        <th key={i} className="px-2 py-1.5 text-center font-medium">
                          M{i}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.cohort_matrix.map((row) => (
                      <tr key={row.cohort_month}>
                        <td className="px-2 py-1 text-surface-600 dark:text-surface-300">
                          {formatMonthLabel(row.cohort_month)}
                        </td>
                        <td className="px-2 py-1 text-surface-500">{row.cohort_size}</td>
                        {Array.from({ length: maxOffset }).map((_, i) => {
                          const cell = row.cells[i];
                          if (!cell || row.cohort_size === 0) {
                            return <td key={i} className="px-1 py-1" />;
                          }
                          return (
                            <td key={i} className="px-1 py-1">
                              <div
                                title={`${cell.retained} de ${row.cohort_size} (${cell.pct}%)`}
                                className={cn(
                                  'flex h-7 items-center justify-center rounded-md text-[10px] font-semibold',
                                  pctColor(cell.pct, 100),
                                )}
                              >
                                {cell.pct.toFixed(0)}%
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Churn mensual ──────────────────────────────────────────── */}
          <div className="rounded-2xl border border-surface-200 bg-white p-4 dark:border-surface-800 dark:bg-surface-900 sm:p-6">
            <h2 className="mb-4 text-sm font-semibold text-surface-900 dark:text-white">Churn mensual</h2>
            <div className="space-y-2">
              {data.churn_monthly.map((m) => {
                const maxChurn = Math.max(...data.churn_monthly.map((x) => x.churn_pct), 5);
                const widthPct = Math.min(100, (m.churn_pct / maxChurn) * 100);
                return (
                  <div key={m.month} className="flex items-center gap-3">
                    <span className="w-16 shrink-0 text-xs text-surface-500">{formatMonthLabel(m.month)}</span>
                    <div className="flex-1">
                      <div className="h-6 w-full overflow-hidden rounded-md bg-surface-100 dark:bg-surface-800">
                        <div
                          className={cn(
                            'h-full rounded-md transition-all',
                            m.churn_pct >= 10 ? 'bg-red-500' : m.churn_pct >= 5 ? 'bg-amber-500' : 'bg-emerald-500',
                          )}
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                    </div>
                    <span className="w-28 shrink-0 text-right text-xs text-surface-600 dark:text-surface-300">
                      <span className="font-semibold">{m.churn_pct.toFixed(1)}%</span>
                      <span className="text-surface-400"> · {m.cancelled}/{m.active_at_start}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function npsScoreColor(score: number): string {
  if (score >= 50) return 'text-emerald-600 dark:text-emerald-400';
  if (score >= 0) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

function NpsPanel({ nps, months }: { nps: NpsSummary; months: number }) {
  const total = nps.total;
  const seg = (n: number) => (total > 0 ? (n / total) * 100 : 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-6 rounded-2xl border border-surface-200 bg-white p-4 dark:border-surface-800 dark:bg-surface-900 sm:p-6"
    >
      <div className="mb-4 flex items-center gap-2">
        <Smile size={16} className="text-brand-500" />
        <div>
          <h2 className="text-sm font-semibold text-surface-900 dark:text-white">NPS post-clase</h2>
          <p className="text-xs text-surface-500">Satisfacción de miembros tras asistir a clase · últimos {months}m</p>
        </div>
      </div>

      {total === 0 ? (
        <p className="py-6 text-center text-sm text-surface-500 dark:text-surface-400">
          Aún no hay respuestas. Se envía una encuesta automática ~24h después de cada check-in en clase.
        </p>
      ) : (
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="shrink-0 text-center sm:w-32">
            <p className={cn('text-4xl font-bold', npsScoreColor(nps.nps_score ?? 0))}>
              {nps.nps_score! > 0 ? '+' : ''}{nps.nps_score}
            </p>
            <p className="mt-0.5 text-xs text-surface-500 dark:text-surface-400">
              NPS · {total} {total === 1 ? 'respuesta' : 'respuestas'}
            </p>
            {nps.average !== null && (
              <p className="text-xs text-surface-500 dark:text-surface-400">Promedio {nps.average}/10</p>
            )}
          </div>

          <div className="flex-1 space-y-2">
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-100 dark:bg-surface-800">
              <div className="h-full bg-emerald-500" style={{ width: `${seg(nps.promoters)}%` }} />
              <div className="h-full bg-amber-400" style={{ width: `${seg(nps.passives)}%` }} />
              <div className="h-full bg-red-400" style={{ width: `${seg(nps.detractors)}%` }} />
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <SegLabel color="bg-emerald-500" label="Promotores" value={nps.promoters} sub="9-10" />
              <SegLabel color="bg-amber-400" label="Pasivos" value={nps.passives} sub="7-8" />
              <SegLabel color="bg-red-400" label="Detractores" value={nps.detractors} sub="0-6" />
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function SegLabel({ color, label, value, sub }: { color: string; label: string; value: number; sub: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', color)} />
      <div className="min-w-0">
        <p className="truncate font-medium text-surface-700 dark:text-surface-300">{label}</p>
        <p className="text-surface-500 dark:text-surface-400">{value} · {sub}</p>
      </div>
    </div>
  );
}

function ReferralPanel({ data }: { data: ReferralMetrics }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-6 rounded-2xl border border-surface-200 bg-white p-4 dark:border-surface-800 dark:bg-surface-900 sm:p-6"
    >
      <div className="mb-4 flex items-center gap-2">
        <Gift size={16} className="text-pink-500" />
        <div>
          <h2 className="text-sm font-semibold text-surface-900 dark:text-white">Referidos</h2>
          <p className="text-xs text-surface-500">Clientes que llegaron por recomendación y recompensas otorgadas</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat label="Referidos" value={String(data.total_referred)} />
        <MiniStat label="Recompensas" value={String(data.rewarded_count)} hint={`${data.applied_count} aplicadas · ${data.pending_count} pendientes`} />
        <MiniStat label="Días gratis dados" value={String(data.total_reward_days)} />
        <MiniStat label="Top referrer" value={data.top_referrers[0]?.referred_count ? String(data.top_referrers[0].referred_count) : '—'} hint={data.top_referrers[0]?.name} />
      </div>

      {data.top_referrers.length > 0 ? (
        <div className="mt-4 border-t border-surface-100 pt-3 dark:border-surface-800">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-surface-500 dark:text-surface-400">Ranking de referrers</p>
          <div className="space-y-1.5">
            {data.top_referrers.map((r, i) => (
              <div key={r.user_id} className="flex items-center gap-3 text-sm">
                <span className="w-5 shrink-0 text-center text-xs font-bold text-surface-500 dark:text-surface-400">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-surface-700 dark:text-surface-300">{r.name}</span>
                <span className="shrink-0 text-xs text-surface-500">
                  {r.referred_count} {r.referred_count === 1 ? 'referido' : 'referidos'}
                  {r.reward_days > 0 ? ` · ${r.reward_days}d` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-4 border-t border-surface-100 pt-3 text-center text-sm text-surface-500 dark:border-surface-800 dark:text-surface-400">
          Aún no hay clientes referidos. Compártelo: cada miembro tiene un link en su perfil.
        </p>
      )}
    </motion.div>
  );
}

function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-surface-50 px-3 py-2.5 dark:bg-surface-800/40">
      <p className="text-xs font-medium uppercase tracking-wide text-surface-500">{label}</p>
      <p className="mt-0.5 text-xl font-bold text-surface-900 dark:text-white">{value}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-surface-500 dark:text-surface-400">{hint}</p>}
    </div>
  );
}

function KpiCard({
  icon, label, value, hint, variant,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  variant?: 'default' | 'danger';
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border bg-white p-4 dark:bg-surface-800',
        variant === 'danger'
          ? 'border-red-200 dark:border-red-900/40'
          : 'border-surface-200 dark:border-surface-700',
      )}
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide text-surface-500">{label}</span>
      </div>
      <p className="mt-1 text-2xl font-bold text-surface-900 dark:text-white">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-surface-400">{hint}</p>}
    </div>
  );
}
