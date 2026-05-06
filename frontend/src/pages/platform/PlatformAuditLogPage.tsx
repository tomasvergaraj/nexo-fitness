import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  Building2,
  ChevronDown,
  ChevronRight,
  CreditCard,
  KeyRound,
  ScrollText,
  Search,
  ShieldOff,
  UserCog,
  Wifi,
} from 'lucide-react';
import { platformAdminApi } from '@/services/api';
import { fadeInUp, staggerContainer } from '@/utils/animations';

interface AuditEntry {
  id: string;
  actor_user_id: string | null;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  target_label: string | null;
  payload: Record<string, unknown> | null;
  severity: 'info' | 'warn' | 'critical';
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

interface AuditResponse {
  items: AuditEntry[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
}

const ACTION_LABEL: Record<string, { label: string; icon: React.ReactNode }> = {
  'tenant.access.set': { label: 'Cambio de acceso', icon: <ShieldOff size={13} /> },
  'tenant.impersonate': { label: 'Impersonación', icon: <UserCog size={13} /> },
  'tenant.password_reset': { label: 'Reset password owner', icon: <KeyRound size={13} /> },
  'tenant.manual_payment': { label: 'Pago manual', icon: <CreditCard size={13} /> },
  'tenant.refund': { label: 'Reembolso', icon: <CreditCard size={13} /> },
  'plan.toggle': { label: 'Plan toggle', icon: <Building2 size={13} /> },
};

const SEVERITY_BADGE: Record<string, string> = {
  info: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  warn: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  critical: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
};

const SEVERITY_DOT: Record<string, string> = {
  info: 'bg-sky-400',
  warn: 'bg-amber-400',
  critical: 'bg-rose-400',
};

const SEVERITY_LABEL: Record<string, string> = {
  info: 'Info',
  warn: 'Warn',
  critical: 'Crítico',
};

function formatRelative(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'hace segundos';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `hace ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `hace ${days}d`;
  return new Date(iso).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatExact(iso: string) {
  return new Date(iso).toLocaleString('es-CL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function actionIcon(action: string) {
  const known = ACTION_LABEL[action];
  if (known) return known.icon;
  if (action.startsWith('tenant.')) return <Building2 size={13} />;
  return <ScrollText size={13} />;
}

function actionLabel(action: string) {
  return ACTION_LABEL[action]?.label ?? action;
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const [open, setOpen] = useState(false);
  const hasPayload = entry.payload && Object.keys(entry.payload).length > 0;

  return (
    <li className="border-b border-surface-800/60 last:border-b-0">
      <button
        type="button"
        onClick={() => hasPayload && setOpen((v) => !v)}
        className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-800/40 ${
          hasPayload ? 'cursor-pointer' : 'cursor-default'
        }`}
      >
        <span className={`mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${SEVERITY_BADGE[entry.severity] ?? SEVERITY_BADGE.info}`}>
          {actionIcon(entry.action)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-white text-sm">{actionLabel(entry.action)}</span>
            <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${SEVERITY_BADGE[entry.severity] ?? SEVERITY_BADGE.info}`}>
              <span className={`h-1 w-1 rounded-full ${SEVERITY_DOT[entry.severity] ?? SEVERITY_DOT.info}`} />
              {SEVERITY_LABEL[entry.severity] ?? entry.severity}
            </span>
            {entry.target_label && (
              <span className="truncate text-xs text-surface-400">→ {entry.target_label}</span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-surface-500">
            <span>
              <span className="font-medium text-surface-300">{entry.actor_email ?? 'sistema'}</span>
            </span>
            <span title={formatExact(entry.created_at)}>{formatRelative(entry.created_at)}</span>
            {entry.ip_address && (
              <span className="inline-flex items-center gap-1">
                <Wifi size={10} /> {entry.ip_address}
              </span>
            )}
            {entry.target_type && (
              <span className="rounded bg-surface-800 px-1.5 py-px font-mono text-[10px] text-surface-400">
                {entry.target_type}
                {entry.target_id ? ` · ${entry.target_id.slice(0, 8)}` : ''}
              </span>
            )}
          </div>
        </div>
        {hasPayload && (
          <span className="mt-1.5 shrink-0 text-surface-500">
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        )}
      </button>
      {open && hasPayload && (
        <pre className="mx-4 mb-3 overflow-x-auto rounded-md border border-surface-800 bg-surface-950 px-3 py-2 font-mono text-[11px] text-surface-300">
          {JSON.stringify(entry.payload, null, 2)}
        </pre>
      )}
    </li>
  );
}

export default function PlatformAuditLogPage() {
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [sinceDays, setSinceDays] = useState<number>(30);

  const params = useMemo(() => {
    const p: Record<string, unknown> = { page: 1, per_page: 100, since_days: sinceDays };
    if (search.trim()) p.search = search.trim();
    if (actionFilter !== 'all') p.action = actionFilter;
    if (severityFilter !== 'all') p.severity = severityFilter;
    return p;
  }, [search, actionFilter, severityFilter, sinceDays]);

  const { data, isLoading, isError } = useQuery<AuditResponse>({
    queryKey: ['platform-audit-logs', params],
    queryFn: async () => (await platformAdminApi.listAuditLogs(params)).data as AuditResponse,
    refetchInterval: 30_000,
  });

  const items = data?.items ?? [];
  const stats = useMemo(() => {
    const counts = { info: 0, warn: 0, critical: 0 };
    items.forEach((e) => {
      counts[e.severity] = (counts[e.severity] ?? 0) + 1;
    });
    return counts;
  }, [items]);

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-5">
      <motion.div variants={fadeInUp}>
        <span className="inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-brand-300">
          <ScrollText size={12} />
          Audit log
        </span>
        <h1 className="mt-3 text-3xl font-bold tracking-tight font-display text-white">
          Acciones privilegiadas
        </h1>
        <p className="mt-1 text-sm text-surface-400">
          Trazabilidad append-only · cada acción de superadmin queda registrada con actor, IP y payload.
        </p>
      </motion.div>

      {/* Severity counters */}
      <motion.div variants={fadeInUp} className="grid grid-cols-3 gap-3 sm:max-w-md">
        <div className="rounded-xl border border-surface-800 bg-surface-900/50 px-4 py-3">
          <p className="text-[11px] text-surface-400">Info</p>
          <p className="font-display text-xl font-bold text-sky-300">{stats.info}</p>
        </div>
        <div className="rounded-xl border border-surface-800 bg-surface-900/50 px-4 py-3">
          <p className="text-[11px] text-surface-400">Warn</p>
          <p className="font-display text-xl font-bold text-amber-300">{stats.warn}</p>
        </div>
        <div className="rounded-xl border border-surface-800 bg-surface-900/50 px-4 py-3">
          <p className="text-[11px] text-surface-400">Crítico</p>
          <p className="font-display text-xl font-bold text-rose-300">{stats.critical}</p>
        </div>
      </motion.div>

      {/* Filters */}
      <motion.div
        variants={fadeInUp}
        className="rounded-xl border border-surface-800 bg-surface-900/40 p-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1 max-w-md">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-surface-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar acción, actor, target…"
              className="w-full rounded-md border border-surface-800 bg-surface-950 px-3 py-1.5 pl-9 text-sm text-white placeholder:text-surface-500 focus:border-brand-500 focus:outline-none"
            />
          </div>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="rounded-md border border-surface-800 bg-surface-950 px-2 py-1.5 text-sm text-white focus:border-brand-500 focus:outline-none"
          >
            <option value="all">Todas las acciones</option>
            {Object.entries(ACTION_LABEL).map(([key, info]) => (
              <option key={key} value={key}>{info.label}</option>
            ))}
          </select>
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="rounded-md border border-surface-800 bg-surface-950 px-2 py-1.5 text-sm text-white focus:border-brand-500 focus:outline-none"
          >
            <option value="all">Cualquier severidad</option>
            <option value="info">Info</option>
            <option value="warn">Warn</option>
            <option value="critical">Crítico</option>
          </select>
          <select
            value={sinceDays}
            onChange={(e) => setSinceDays(Number(e.target.value))}
            className="rounded-md border border-surface-800 bg-surface-950 px-2 py-1.5 text-sm text-white focus:border-brand-500 focus:outline-none"
          >
            <option value={1}>Últimas 24 hrs</option>
            <option value={7}>Últimos 7 días</option>
            <option value={30}>Últimos 30 días</option>
            <option value={90}>Últimos 90 días</option>
            <option value={365}>Últimos 12 meses</option>
          </select>
          {data && (
            <span className="ml-auto text-xs text-surface-500 tabular-nums">
              {data.total} registro{data.total === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </motion.div>

      {/* List */}
      <motion.div variants={fadeInUp} className="overflow-hidden rounded-xl border border-surface-800 bg-surface-900/40">
        {isError ? (
          <div className="flex items-center gap-2 px-4 py-10 text-sm text-rose-300">
            <AlertTriangle size={16} /> No pudimos cargar el audit log.
          </div>
        ) : isLoading && !data ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-md bg-surface-800/50" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
            <ScrollText size={28} className="text-surface-600" />
            <p className="text-sm font-medium text-white">Sin acciones registradas</p>
            <p className="text-xs text-surface-500">Las acciones privilegiadas aparecerán aquí en tiempo real.</p>
          </div>
        ) : (
          <ul>
            {items.map((entry) => (
              <AuditRow key={entry.id} entry={entry} />
            ))}
          </ul>
        )}
      </motion.div>
    </motion.div>
  );
}
