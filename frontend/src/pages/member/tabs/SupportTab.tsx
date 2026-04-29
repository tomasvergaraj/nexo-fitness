import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { LifeBuoy, Mail, Phone } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import WhatsAppIcon from '@/components/icons/WhatsAppIcon';
import Modal from '@/components/ui/Modal';
import {
  EmptyState,
  ProfileDetailItem,
  SkeletonListItems,
  SupportInboxItem,
} from '../components/MemberShared';
import { mobileApi } from '@/services/api';
import {
  formatDate,
  formatRelative,
  formatSupportChannelLabel,
  supportChannelBadgeColor,
  cn,
  withAlpha,
} from '@/utils';
import {
  getSupportLastActivityAt,
  getSupportLastTimelineEntry,
  getSupportTraceCount,
  parseSupportTimeline,
} from '@/utils/support';
import type { SupportTimelineEntry } from '@/utils/support';
import type { SupportInteraction } from '@/types';
import {
  getAgendaDateKey,
  getNotificationDateRangeSummary,
  getNotificationPresetDateRange,
  isDateKeyWithinRange,
} from '../memberUtils';
import type { NotificationDatePreset, SupportFilter } from '../memberTypes';
import { useMemberContext } from '../MemberContext';

// ─── SupportTab ───────────────────────────────────────────────────────────────

export default function SupportTab() {
  const {
    supportInteractions,
    supportInteractionsQuery,
    pendingSupportInteractions,
    resolvedSupportInteractions,
    hasDirectSupport,
    supportWhatsAppUrl,
    supportCallUrl,
    supportEmailUrl,
    openSupportRequestModal,
    accentColor,
    secondaryColor,
    brandGradient,
  } = useMemberContext();

  const [supportFilter, setSupportFilter] = useState<SupportFilter>('all');
  const [selectedSupportInteractionId, setSelectedSupportInteractionId] = useState<string | null>(
    null,
  );
  const initialRange = useMemo(() => getNotificationPresetDateRange('30d'), []);
  const [supportDatePreset, setSupportDatePreset] = useState<NotificationDatePreset>('30d');
  const [supportDateFrom, setSupportDateFrom] = useState(initialRange.from);
  const [supportDateTo, setSupportDateTo] = useState(initialRange.to);

  // ── Local query (date-range aware) ────────────────────────────────────────

  const supportInteractionsRangeQuery = useQuery<SupportInteraction[]>({
    queryKey: ['member-support-interactions', supportDateFrom, supportDateTo],
    queryFn: async () =>
      (
        await mobileApi.listSupportInteractions({
          limit: 50,
          date_from: supportDateFrom,
          date_to: supportDateTo,
        })
      ).data,
    staleTime: 30000,
  });

  const interactions = supportInteractionsRangeQuery.data ?? supportInteractions;

  // Sync date range when preset changes (excluding 'custom')
  useEffect(() => {
    if (supportDatePreset === 'custom') return;
    const range = getNotificationPresetDateRange(supportDatePreset);
    setSupportDateFrom(range.from);
    setSupportDateTo(range.to);
  }, [supportDatePreset]);

  // ── Computed ──────────────────────────────────────────────────────────────

  const supportDateRangeSummary = getNotificationDateRangeSummary(supportDateFrom, supportDateTo);

  const supportInteractionMetaMap = useMemo(() => {
    const map = new Map<
      string,
      { lastEntry: SupportTimelineEntry | null; lastActivityAt: string; traceCount: number }
    >();
    interactions.forEach((interaction) => {
      const timeline = parseSupportTimeline(interaction.notes, {
        createdAt: interaction.created_at,
        authorName: interaction.client_name || 'Miembro',
      });
      const lastEntry = getSupportLastTimelineEntry(interaction.notes, {
        createdAt: interaction.created_at,
        authorName: interaction.client_name || 'Miembro',
      });
      const lastActivityAt =
        getSupportLastActivityAt(interaction.notes, {
          createdAt: interaction.created_at,
          authorName: interaction.client_name || 'Miembro',
        }) || interaction.created_at;
      const traceCount = getSupportTraceCount(interaction.notes, {
        createdAt: interaction.created_at,
        authorName: interaction.client_name || 'Miembro',
      });
      map.set(interaction.id, { lastEntry, lastActivityAt, traceCount });
      // Suppress unused variable warning for timeline
      void timeline;
    });
    return map;
  }, [interactions]);

  const filteredSupportInteractions = useMemo(() => {
    return interactions
      .filter((i) => {
        if (supportFilter === 'pending' && i.resolved) return false;
        if (supportFilter === 'resolved' && !i.resolved) return false;
        const dateKey = getAgendaDateKey(i.created_at);
        return isDateKeyWithinRange(dateKey, supportDateFrom, supportDateTo);
      })
      .sort((a, b) => {
        const aAt =
          supportInteractionMetaMap.get(a.id)?.lastActivityAt || a.created_at;
        const bAt =
          supportInteractionMetaMap.get(b.id)?.lastActivityAt || b.created_at;
        return new Date(bAt).getTime() - new Date(aAt).getTime();
      });
  }, [interactions, supportFilter, supportDateFrom, supportDateTo, supportInteractionMetaMap]);

  const latestSupportActivityAt = filteredSupportInteractions.length
    ? supportInteractionMetaMap.get(filteredSupportInteractions[0].id)?.lastActivityAt ||
      filteredSupportInteractions[0].created_at
    : null;

  const selectedSupportInteraction =
    interactions.find((i) => i.id === selectedSupportInteractionId) ?? null;

  const selectedSupportMeta = selectedSupportInteraction
    ? supportInteractionMetaMap.get(selectedSupportInteraction.id)
    : null;

  const selectedTimeline = selectedSupportInteraction
    ? parseSupportTimeline(selectedSupportInteraction.notes, {
        createdAt: selectedSupportInteraction.created_at,
        authorName: selectedSupportInteraction.client_name || 'Miembro',
      })
    : [];

  // ── Chip definitions ──────────────────────────────────────────────────────

  const filterChips: Array<{ id: SupportFilter; label: string }> = [
    { id: 'all', label: 'Todas' },
    { id: 'pending', label: 'Pendientes' },
    { id: 'resolved', label: 'Resueltas' },
  ];

  const presetChips: Array<{ id: NotificationDatePreset; label: string }> = [
    { id: '7d', label: '7 días' },
    { id: '30d', label: '30 días' },
    { id: '90d', label: '90 días' },
    { id: 'custom', label: 'Personalizado' },
  ];

  // ── Date helpers ──────────────────────────────────────────────────────────

  function updateSupportDateFrom(value: string) {
    setSupportDateFrom(value);
    if (supportDatePreset !== 'custom') setSupportDatePreset('custom');
  }

  function updateSupportDateTo(value: string) {
    setSupportDateTo(value);
    if (supportDatePreset !== 'custom') setSupportDatePreset('custom');
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (supportInteractionsQuery.isLoading) {
    return (
      <div className="space-y-4 p-4">
        <SkeletonListItems count={3} />
      </div>
    );
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
        className="space-y-4 p-4 pb-8"
      >
        <div
          className="rounded-[1.4rem] border border-surface-200/80 bg-white/85 p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.04] dark:shadow-none"
        >
          <h2 className="text-lg font-semibold text-surface-900 dark:text-white">
            Soporte y seguimiento
          </h2>
          <div className="mt-2.5 space-y-5">
            <p className="text-sm leading-6 text-surface-600 dark:text-surface-300">
              Crea solicitudes de ayuda y sigue su estado desde aquí. El equipo del gimnasio
              verá cada caso y responderá en la línea de tiempo.
            </p>

            {/* Stats grid */}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <ProfileDetailItem
                label="Solicitudes activas"
                value={String(pendingSupportInteractions.length)}
              />
              <ProfileDetailItem
                label="Solicitudes resueltas"
                value={String(resolvedSupportInteractions)}
              />
              <ProfileDetailItem
                label="Canal directo"
                value={hasDirectSupport ? 'Disponible' : 'Solo desde la app'}
              />
              <ProfileDetailItem
                label="Último avance"
                value={
                  latestSupportActivityAt
                    ? formatRelative(latestSupportActivityAt)
                    : 'Sin movimientos'
                }
              />
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={openSupportRequestModal}
                className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:opacity-90 active:scale-[0.97]"
                style={{ background: brandGradient }}
              >
                <LifeBuoy size={15} />
                Pedir ayuda desde la app
              </button>

              {supportWhatsAppUrl ? (
                <a
                  href={supportWhatsAppUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-xl border border-surface-200 bg-surface-50 px-4 py-2.5 text-sm font-semibold text-surface-700 transition-all hover:bg-surface-100 dark:border-white/10 dark:bg-surface-900/40 dark:text-surface-200 dark:hover:bg-surface-800/50"
                >
                  <WhatsAppIcon size={15} />
                  WhatsApp
                </a>
              ) : null}

              {supportCallUrl ? (
                <a
                  href={supportCallUrl}
                  className="flex items-center gap-2 rounded-xl border border-surface-200 bg-surface-50 px-4 py-2.5 text-sm font-semibold text-surface-700 transition-all hover:bg-surface-100 dark:border-white/10 dark:bg-surface-900/40 dark:text-surface-200 dark:hover:bg-surface-800/50"
                >
                  <Phone size={15} />
                  Llamar
                </a>
              ) : null}

              {supportEmailUrl ? (
                <a
                  href={supportEmailUrl}
                  className="flex items-center gap-2 rounded-xl border border-surface-200 bg-surface-50 px-4 py-2.5 text-sm font-semibold text-surface-700 transition-all hover:bg-surface-100 dark:border-white/10 dark:bg-surface-900/40 dark:text-surface-200 dark:hover:bg-surface-800/50"
                >
                  <Mail size={15} />
                  Correo
                </a>
              ) : null}
            </div>

            {/* Filter chips */}
            <div className="flex flex-wrap gap-2">
              {filterChips.map((chip) => {
                const isActive = supportFilter === chip.id;
                return (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => setSupportFilter(chip.id)}
                    className={cn(
                      'rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all',
                      isActive
                        ? 'text-white shadow-sm'
                        : 'border border-surface-200 bg-surface-100 text-surface-600 hover:bg-surface-200 dark:border-white/10 dark:bg-surface-900/50 dark:text-surface-300 dark:hover:bg-surface-800/60',
                    )}
                    style={isActive ? { background: brandGradient } : undefined}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>

            {/* Date range section */}
            <div className="rounded-2xl border border-surface-200/80 bg-surface-50 p-4 dark:border-white/10 dark:bg-surface-950/30">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-surface-500 dark:text-surface-400">
                  Rango de fechas
                </p>
                <p className="text-xs text-surface-500 dark:text-surface-400">
                  {filteredSupportInteractions.length}{' '}
                  {filteredSupportInteractions.length === 1 ? 'solicitud' : 'solicitudes'}{' '}
                  {supportDateRangeSummary}
                </p>
              </div>

              {/* Preset chips */}
              <div className="mt-3 flex flex-wrap gap-2">
                {presetChips.map((chip) => {
                  const isActive = supportDatePreset === chip.id;
                  return (
                    <button
                      key={chip.id}
                      type="button"
                      onClick={() => setSupportDatePreset(chip.id)}
                      className={cn(
                        'rounded-full px-3 py-1 text-xs font-medium transition-all',
                        isActive
                          ? 'text-white shadow-sm'
                          : 'border border-surface-200 bg-white text-surface-600 hover:bg-surface-100 dark:border-white/10 dark:bg-surface-900/40 dark:text-surface-300 dark:hover:bg-surface-800/50',
                      )}
                      style={
                        isActive
                          ? { background: `linear-gradient(135deg, ${accentColor}, ${secondaryColor})` }
                          : undefined
                      }
                    >
                      {chip.label}
                    </button>
                  );
                })}
              </div>

              {/* Date inputs */}
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-surface-500 dark:text-surface-400">
                    Desde
                  </label>
                  <input
                    type="date"
                    value={supportDateFrom}
                    onChange={(e) => updateSupportDateFrom(e.target.value)}
                    className="w-full rounded-xl border border-surface-200 bg-white px-3 py-2 text-sm text-surface-900 focus:border-transparent focus:outline-none focus:ring-2 dark:border-white/10 dark:bg-surface-950/50 dark:text-white"
                    style={
                      { '--tw-ring-color': withAlpha(accentColor, 0.4) } as React.CSSProperties
                    }
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-surface-500 dark:text-surface-400">
                    Hasta
                  </label>
                  <input
                    type="date"
                    value={supportDateTo}
                    onChange={(e) => updateSupportDateTo(e.target.value)}
                    className="w-full rounded-xl border border-surface-200 bg-white px-3 py-2 text-sm text-surface-900 focus:border-transparent focus:outline-none focus:ring-2 dark:border-white/10 dark:bg-surface-950/50 dark:text-white"
                    style={
                      { '--tw-ring-color': withAlpha(accentColor, 0.4) } as React.CSSProperties
                    }
                  />
                </div>
              </div>
            </div>

            {/* Support interactions list */}
            <div>
              {filteredSupportInteractions.length > 0 ? (
                <div className="overflow-hidden rounded-[1.35rem] border border-surface-200/80 bg-white/85 divide-y divide-surface-200/80 dark:divide-white/10 dark:border-white/10 dark:bg-white/[0.04]">
                  {filteredSupportInteractions.map((interaction) => {
                    const meta = supportInteractionMetaMap.get(interaction.id);
                    return (
                      <SupportInboxItem
                        key={interaction.id}
                        interaction={interaction}
                        lastEntry={meta?.lastEntry ?? null}
                        lastActivityAt={meta?.lastActivityAt || interaction.created_at}
                        traceCount={meta?.traceCount ?? 0}
                        onOpen={() => setSelectedSupportInteractionId(interaction.id)}
                      />
                    );
                  })}
                </div>
              ) : (
                <EmptyState
                  title={
                    supportFilter === 'pending'
                      ? 'Sin solicitudes pendientes'
                      : supportFilter === 'resolved'
                        ? 'Sin solicitudes resueltas'
                        : 'Sin solicitudes en este período'
                  }
                  description={
                    supportFilter === 'pending'
                      ? `No tienes solicitudes abiertas ${supportDateRangeSummary}.`
                      : supportFilter === 'resolved'
                        ? `No hay solicitudes resueltas ${supportDateRangeSummary}.`
                        : `No encontramos solicitudes de soporte ${supportDateRangeSummary}.`
                  }
                />
              )}
            </div>
          </div>
        </div>
      </motion.div>

      {/* ── Modal: Historial de la solicitud ──────────────────────────────────── */}
      <Modal
        open={!!selectedSupportInteraction}
        size="lg"
        title={selectedSupportInteraction?.subject || 'Historial de la solicitud'}
        onClose={() => setSelectedSupportInteractionId(null)}
      >
        {selectedSupportInteraction ? (
          <div className="space-y-5">
            {/* Status + channel badges */}
            <div className="flex flex-wrap gap-2">
              <span
                className={cn(
                  'badge',
                  selectedSupportInteraction.resolved ? 'badge-success' : 'badge-warning',
                )}
              >
                {selectedSupportInteraction.resolved ? 'Resuelta' : 'Pendiente'}
              </span>
              <span
                className={cn('badge', supportChannelBadgeColor(selectedSupportInteraction.channel))}
              >
                {formatSupportChannelLabel(selectedSupportInteraction.channel)}
              </span>
            </div>

            {/* Stats grid */}
            <div className="grid gap-3 sm:grid-cols-2">
              <ProfileDetailItem
                label="Estado"
                value={selectedSupportInteraction.resolved ? 'Resuelta' : 'Pendiente'}
              />
              <ProfileDetailItem
                label="Canal elegido"
                value={formatSupportChannelLabel(selectedSupportInteraction.channel)}
              />
              <ProfileDetailItem
                label="Último avance"
                value={
                  selectedSupportMeta?.lastActivityAt
                    ? formatRelative(selectedSupportMeta.lastActivityAt)
                    : formatRelative(selectedSupportInteraction.created_at)
                }
              />
              <ProfileDetailItem
                label="Responsable"
                value={selectedSupportInteraction.handler_name || 'Sin asignar'}
              />
            </div>

            {/* Timeline */}
            {selectedTimeline.length > 0 ? (
              <div>
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-surface-500 dark:text-surface-400">
                  Historial de actividad
                </p>
                <div className="space-y-3">
                  {selectedTimeline.map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-2xl border border-surface-200/80 bg-surface-50/80 p-4 dark:border-white/10 dark:bg-surface-950/30"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-surface-900 dark:text-white">
                            {entry.author_name}
                          </p>
                          {entry.author_role ? (
                            <span className="badge badge-neutral">{entry.author_role}</span>
                          ) : null}
                          <span
                            className={cn(
                              'badge',
                              entry.kind === 'initial'
                                ? 'badge-info'
                                : entry.kind === 'reply'
                                  ? 'badge-success'
                                  : 'badge-neutral',
                            )}
                          >
                            {entry.kind === 'initial'
                              ? 'Solicitud'
                              : entry.kind === 'reply'
                                ? 'Respuesta'
                                : 'Nota'}
                          </span>
                        </div>
                        <p className="text-xs text-surface-500 dark:text-surface-400">
                          {formatDate(entry.created_at)}{' '}
                          <span className="opacity-70">
                            · {formatRelative(entry.created_at)}
                          </span>
                        </p>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-surface-700 dark:text-surface-200">
                        {entry.message}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-surface-300 bg-surface-50/80 px-5 py-6 text-center dark:border-white/15 dark:bg-black/10">
                <p className="text-sm text-surface-500 dark:text-surface-400">
                  Aún no hay actividad registrada para esta solicitud.
                </p>
              </div>
            )}

            {/* Close button */}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedSupportInteractionId(null)}
                className="rounded-xl border border-surface-200 bg-surface-50 px-5 py-2.5 text-sm font-semibold text-surface-700 transition-colors hover:bg-surface-100 dark:border-white/10 dark:bg-surface-900/40 dark:text-surface-200 dark:hover:bg-surface-800/50"
              >
                Cerrar
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
