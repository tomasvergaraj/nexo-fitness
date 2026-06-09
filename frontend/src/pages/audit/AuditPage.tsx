import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ScrollText, ShieldCheck, Filter, RotateCcw, Eye } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import Modal from '@/components/ui/Modal';
import { auditApi } from '@/services/api';
import type { AuditFilters, AuditLog, PaginatedResponse } from '@/types';
import { cn, formatDateTime, getApiError } from '@/utils';
import { fadeInUp, staggerContainer } from '@/utils/animations';

const PER_PAGE = 25;

// Acciones sensibles que conviene resaltar en rojo (destructivas / de seguridad).
const DANGER_ACTIONS = new Set([
  'client_hard_delete',
  'client_delete',
  'staff_remove',
  'role_change',
  'login_failed',
  'impersonate_start',
]);

function actionBadgeClass(action: string): string {
  if (DANGER_ACTIONS.has(action)) return 'badge-danger';
  if (action.startsWith('login') || action.startsWith('password') || action.startsWith('impersonate')) {
    return 'badge-info';
  }
  return 'badge-neutral';
}

export default function AuditPage() {
  const [page, setPage] = useState(1);
  const [actorId, setActorId] = useState('');
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selected, setSelected] = useState<AuditLog | null>(null);

  const filtersQuery = useQuery<AuditFilters>({
    queryKey: ['audit-filters'],
    queryFn: async () => (await auditApi.filters()).data,
  });

  const params = useMemo(
    () => ({
      page,
      per_page: PER_PAGE,
      actor_id: actorId || undefined,
      action: action || undefined,
      entity_type: entityType || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    }),
    [page, actorId, action, entityType, dateFrom, dateTo],
  );

  const logsQuery = useQuery<PaginatedResponse<AuditLog>>({
    queryKey: ['audit-logs', params],
    queryFn: async () => (await auditApi.list(params)).data,
  });

  const filters = filtersQuery.data;
  const actionLabel = useMemo(() => {
    const map = new Map<string, string>();
    filters?.actions.forEach((a) => map.set(a.value, a.label));
    return map;
  }, [filters]);
  const entityLabel = useMemo(() => {
    const map = new Map<string, string>();
    filters?.entity_types.forEach((e) => map.set(e.value, e.label));
    return map;
  }, [filters]);

  const logs = logsQuery.data?.items ?? [];
  const total = logsQuery.data?.total ?? 0;
  const pages = logsQuery.data?.pages ?? 0;
  const hasActiveFilters = Boolean(actorId || action || entityType || dateFrom || dateTo);

  const resetFilters = () => {
    setActorId('');
    setAction('');
    setEntityType('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  };

  // Cualquier cambio de filtro vuelve a la primera página.
  const withPageReset = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setPage(1);
  };

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-6">
      <motion.section
        variants={fadeInUp}
        className="rounded-[1.75rem] border border-surface-200/70 bg-white/90 p-6 shadow-sm dark:border-white/10 dark:bg-white/[0.04] dark:shadow-none"
      >
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-surface-200 bg-surface-50 px-3 py-1 text-xs font-semibold text-surface-600 dark:border-white/10 dark:bg-white/5 dark:text-surface-300">
            <ShieldCheck size={14} />
            Registro de auditoría
          </div>
          <h1 className="mt-4 text-2xl font-bold font-display text-surface-900 dark:text-white">
            Quién hizo qué, y cuándo
          </h1>
          <p className="mt-2 text-sm leading-6 text-surface-500 dark:text-surface-400">
            Acciones sensibles del gimnasio: inicios de sesión, cambios de rol, eliminación de clientes y más.
            Solo lectura, ordenado del más reciente al más antiguo.
          </p>
        </div>
      </motion.section>

      <motion.section
        variants={fadeInUp}
        className="rounded-[1.5rem] border border-surface-200/70 bg-white/90 p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.04] dark:shadow-none"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-surface-900 dark:text-white">
          <Filter size={15} />
          Filtros
          {hasActiveFilters ? (
            <button
              type="button"
              onClick={resetFilters}
              className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold text-surface-500 hover:text-surface-900 dark:text-surface-400 dark:hover:text-white"
            >
              <RotateCcw size={13} />
              Limpiar
            </button>
          ) : null}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-surface-500">Actor</span>
            <select className="input" value={actorId} onChange={(e) => withPageReset(setActorId)(e.target.value)}>
              <option value="">Todos los usuarios</option>
              {filters?.actors.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-surface-500">Acción</span>
            <select className="input" value={action} onChange={(e) => withPageReset(setAction)(e.target.value)}>
              <option value="">Todas las acciones</option>
              {filters?.actions.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-surface-500">Entidad</span>
            <select className="input" value={entityType} onChange={(e) => withPageReset(setEntityType)(e.target.value)}>
              <option value="">Todas las entidades</option>
              {filters?.entity_types.map((e) => (
                <option key={e.value} value={e.value}>
                  {e.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3 grid gap-3 border-t border-surface-200/70 pt-4 sm:grid-cols-2 dark:border-white/10">
          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-surface-500">Desde</span>
            <input
              type="date"
              className="input"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => withPageReset(setDateFrom)(e.target.value)}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-surface-500">Hasta</span>
            <input
              type="date"
              className="input"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => withPageReset(setDateTo)(e.target.value)}
            />
          </label>
        </div>
      </motion.section>

      {logsQuery.isError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-600 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
          {getApiError(logsQuery.error, 'No pudimos cargar el registro de auditoría.')}
        </div>
      ) : null}

      {!logsQuery.isLoading && !logs.length ? (
        <EmptyState
          icon={ScrollText}
          title={hasActiveFilters ? 'Sin registros con esos filtros' : 'Todavía no hay registros'}
          description={
            hasActiveFilters
              ? 'Prueba ampliando el rango de fechas o quitando algún filtro.'
              : 'Cuando ocurran acciones sensibles (inicios de sesión, cambios de rol, etc.) aparecerán aquí.'
          }
        />
      ) : null}

      {logs.length || logsQuery.isLoading ? (
        <motion.section
          variants={fadeInUp}
          className="overflow-hidden rounded-[1.65rem] border border-surface-200/70 bg-white/90 shadow-sm dark:border-white/10 dark:bg-white/[0.04] dark:shadow-none"
        >
          <div className="overflow-x-auto">
            <table className="min-w-[860px] w-full">
              <thead className="bg-surface-50/90 dark:bg-white/[0.03]">
                <tr className="text-left text-xs uppercase tracking-[0.18em] text-surface-500 dark:text-surface-400">
                  <th className="px-5 py-4 font-semibold">Fecha</th>
                  <th className="px-4 py-4 font-semibold">Actor</th>
                  <th className="px-4 py-4 font-semibold">Acción</th>
                  <th className="px-4 py-4 font-semibold">Entidad</th>
                  <th className="px-4 py-4 font-semibold">IP</th>
                  <th className="px-5 py-4 font-semibold text-right">Detalle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-200/70 dark:divide-white/10">
                {logsQuery.isLoading && !logsQuery.data ? (
                  Array.from({ length: 8 }).map((_, index) => (
                    <tr key={index}>
                      <td colSpan={6} className="px-5 py-4">
                        <div className="shimmer h-10 rounded-2xl" />
                      </td>
                    </tr>
                  ))
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} className="transition-colors hover:bg-surface-50/80 dark:hover:bg-white/[0.03]">
                      <td className="px-5 py-4 align-top whitespace-nowrap">
                        <p className="text-sm text-surface-700 dark:text-surface-200">{formatDateTime(log.created_at)}</p>
                      </td>
                      <td className="px-4 py-4 align-top">
                        <p className="text-sm font-medium text-surface-900 dark:text-white">
                          {log.actor_name || 'Sistema'}
                        </p>
                        {log.actor_email ? (
                          <p className="mt-0.5 text-xs text-surface-500 dark:text-surface-400">{log.actor_email}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-4 align-top">
                        <span className={cn('badge', actionBadgeClass(log.action))}>
                          {actionLabel.get(log.action) || log.action}
                        </span>
                      </td>
                      <td className="px-4 py-4 align-top">
                        {log.entity_type ? (
                          <>
                            <p className="text-sm text-surface-700 dark:text-surface-200">
                              {entityLabel.get(log.entity_type) || log.entity_type}
                            </p>
                            {log.entity_id ? (
                              <p
                                className="mt-0.5 font-mono text-xs text-surface-500 dark:text-surface-400"
                                title={log.entity_id}
                              >
                                {log.entity_id.length > 12 ? `${log.entity_id.slice(0, 8)}…` : log.entity_id}
                              </p>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-sm text-surface-500 dark:text-surface-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-4 align-top">
                        <span className="font-mono text-xs text-surface-500 dark:text-surface-400">
                          {log.ip_address || '—'}
                        </span>
                      </td>
                      <td className="px-5 py-4 align-top text-right">
                        {log.details ? (
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => setSelected(log)}
                          >
                            <Eye size={15} />
                            Ver
                          </button>
                        ) : (
                          <span className="text-sm text-surface-500 dark:text-surface-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-surface-200/70 bg-surface-50/70 px-5 py-3 text-sm text-surface-500 dark:border-white/10 dark:bg-white/[0.02] dark:text-surface-400">
            <span>
              {total} {total === 1 ? 'registro' : 'registros'}
              {pages > 1 ? ` · página ${page} de ${pages}` : ''}
            </span>
            {pages > 1 ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={page <= 1 || logsQuery.isFetching}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Anterior
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={page >= pages || logsQuery.isFetching}
                  onClick={() => setPage((p) => Math.min(pages, p + 1))}
                >
                  Siguiente
                </button>
              </div>
            ) : null}
          </div>
        </motion.section>
      ) : null}

      <Modal
        open={Boolean(selected)}
        title={selected ? actionLabel.get(selected.action) || selected.action : 'Detalle del registro'}
        description={selected ? formatDateTime(selected.created_at) : undefined}
        onClose={() => setSelected(null)}
      >
        {selected ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <DetailItem label="Actor" value={selected.actor_name || 'Sistema'} />
              <DetailItem label="Correo" value={selected.actor_email || '—'} />
              <DetailItem label="Entidad" value={selected.entity_type ? (entityLabel.get(selected.entity_type) || selected.entity_type) : '—'} />
              <DetailItem label="ID entidad" value={selected.entity_id || '—'} mono />
              <DetailItem label="IP" value={selected.ip_address || '—'} mono />
            </div>
            <div>
              <p className="mb-2 text-[11px] uppercase tracking-[0.18em] text-surface-500">Datos</p>
              <pre className="max-h-[45vh] overflow-auto rounded-2xl border border-surface-200 bg-surface-50 p-4 text-xs leading-relaxed text-surface-700 dark:border-white/10 dark:bg-surface-950/40 dark:text-surface-200">
                {JSON.stringify(selected.details, null, 2)}
              </pre>
            </div>
          </div>
        ) : null}
      </Modal>
    </motion.div>
  );
}

function DetailItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-2xl border border-surface-200 bg-surface-50 px-4 py-3 dark:border-white/10 dark:bg-surface-950/35">
      <p className="text-[11px] uppercase tracking-[0.18em] text-surface-500">{label}</p>
      <p className={cn('mt-1.5 text-sm font-medium text-surface-900 dark:text-white break-all', mono && 'font-mono')}>
        {value}
      </p>
    </div>
  );
}
