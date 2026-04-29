import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCheck, Search } from 'lucide-react';
import {
  DeviceStatusItem,
  EmptyState,
  NotificationInboxItem,
  Panel,
  SkeletonListItems,
} from '../components/MemberShared';
import {
  getAgendaDateKey,
  getNotificationDateRangeSummary,
  getNotificationEmptyStateDescription,
  getNotificationEmptyStateTitle,
  getNotificationPresetDateRange,
  isDateKeyWithinRange,
} from '../memberUtils';
import type { NotificationDatePreset, NotificationFilter } from '../memberTypes';
import { useMemberContext } from '../MemberContext';

// ─── NotificationsTab ─────────────────────────────────────────────────────────

export default function NotificationsTab() {
  const {
    notifications,
    notificationsQuery,
    unreadNotifications,
    readNotifications,
    actionableNotifications,
    accentColor,
    secondaryColor,
    brandGradient,
    markAllNotificationsReadMutation,
    notificationMutation,
    setSelectedNotificationId,
    withAlpha,
    cn,
    navigateTo,
  } = useMemberContext();

  const [notificationFilter, setNotificationFilter] = useState<NotificationFilter>('all');
  const [notificationSearch, setNotificationSearch] = useState('');
  const initialRange = useMemo(() => getNotificationPresetDateRange('30d'), []);
  const [notificationDatePreset, setNotificationDatePreset] = useState<NotificationDatePreset>('30d');
  const [notificationDateFrom, setNotificationDateFrom] = useState(initialRange.from);
  const [notificationDateTo, setNotificationDateTo] = useState(initialRange.to);

  // Sync date range when preset changes (excluding 'custom')
  useEffect(() => {
    if (notificationDatePreset === 'custom') return;
    const range = getNotificationPresetDateRange(notificationDatePreset);
    setNotificationDateFrom(range.from);
    setNotificationDateTo(range.to);
  }, [notificationDatePreset]);

  // ── Computed ──────────────────────────────────────────────────────────────

  const notificationDateRangeSummary = getNotificationDateRangeSummary(
    notificationDateFrom,
    notificationDateTo,
  );

  const filteredNotifications = useMemo(() => {
    return notifications
      .filter((n) => {
        const dateKey = getAgendaDateKey(n.created_at);
        if (!isDateKeyWithinRange(dateKey, notificationDateFrom, notificationDateTo)) return false;
        if (notificationFilter === 'unread' && n.is_read) return false;
        if (notificationFilter === 'read' && !n.is_read) return false;
        if (notificationFilter === 'actionable' && !n.action_url) return false;
        const q = notificationSearch.trim().toLowerCase();
        if (q && !n.title?.toLowerCase().includes(q) && !n.message?.toLowerCase().includes(q))
          return false;
        return true;
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [notifications, notificationFilter, notificationSearch, notificationDateFrom, notificationDateTo]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  function updateNotificationDateFrom(value: string) {
    setNotificationDateFrom(value);
    if (notificationDatePreset !== 'custom') setNotificationDatePreset('custom');
  }

  function updateNotificationDateTo(value: string) {
    setNotificationDateTo(value);
    if (notificationDatePreset !== 'custom') setNotificationDatePreset('custom');
  }

  function openNotificationDetail(notification: (typeof notifications)[number]) {
    setSelectedNotificationId(notification.id);
    if (!notification.is_read) {
      notificationMutation.mutate({
        notificationId: notification.id,
        payload: { mark_opened: true, is_read: true },
      });
    }
    if (notification.action_url) {
      if (notification.action_url.startsWith('nexofitness://')) {
        // Deep-link handled by modal/context; nothing extra to do here.
      } else if (notification.action_url.startsWith('http')) {
        window.open(notification.action_url, '_blank', 'noopener,noreferrer');
      } else {
        // Treat remaining patterns as tab navigation targets
        const tab = notification.action_url.replace(/^\//, '');
        try {
          navigateTo(tab as Parameters<typeof navigateTo>[0]);
        } catch {
          // Unknown tab — ignore.
        }
      }
    }
  }

  function markAllNotificationsAsRead() {
    const ids = filteredNotifications.filter((n) => !n.is_read).map((n) => n.id);
    if (!ids.length) return;
    markAllNotificationsReadMutation.mutate(ids);
  }

  const isPending = markAllNotificationsReadMutation.isPending;

  // ── Filter chip definitions ───────────────────────────────────────────────

  const filterChips: Array<{ id: NotificationFilter; label: string }> = [
    { id: 'all', label: 'Todas' },
    { id: 'unread', label: 'Nuevas' },
    { id: 'read', label: 'Leídas' },
    { id: 'actionable', label: 'Con acción' },
  ];

  const presetChips: Array<{ id: NotificationDatePreset; label: string }> = [
    { id: '7d', label: '7 días' },
    { id: '30d', label: '30 días' },
    { id: '90d', label: '90 días' },
    { id: 'custom', label: 'Personalizado' },
  ];

  // ── Render ────────────────────────────────────────────────────────────────

  if (notificationsQuery.isLoading) {
    return (
      <div className="space-y-4 p-4">
        <SkeletonListItems count={4} />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
      className="space-y-4 p-4 pb-8"
    >
      <Panel title="Tu bandeja">
        <p className="text-sm leading-6 text-surface-600 dark:text-surface-300">
          Revisa tus avisos, recordatorios y acciones pendientes en un solo lugar.
        </p>

        {/* Stats grid */}
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <DeviceStatusItem
            label="Nuevas"
            value={String(unreadNotifications)}
            tone={unreadNotifications > 0 ? 'info' : 'neutral'}
          />
          <DeviceStatusItem
            label="Leídas"
            value={String(readNotifications)}
            tone="neutral"
          />
          <DeviceStatusItem
            label="Con acción"
            value={String(actionableNotifications)}
            tone={actionableNotifications > 0 ? 'warning' : 'neutral'}
          />
        </div>

        {/* Search + mark all read */}
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-surface-400"
            />
            <input
              type="search"
              placeholder="Buscar avisos..."
              value={notificationSearch}
              onChange={(e) => setNotificationSearch(e.target.value)}
              className="w-full rounded-xl border border-surface-200 bg-surface-50 py-2.5 pl-10 pr-4 text-sm text-surface-900 placeholder-surface-400 focus:border-transparent focus:outline-none focus:ring-2 dark:border-white/10 dark:bg-surface-950/40 dark:text-white dark:placeholder-surface-500"
              style={{ '--tw-ring-color': withAlpha(accentColor, 0.4) } as React.CSSProperties}
            />
          </div>
          <button
            type="button"
            onClick={markAllNotificationsAsRead}
            disabled={!unreadNotifications || isPending}
            className={cn(
              'flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all',
              !unreadNotifications || isPending
                ? 'cursor-not-allowed opacity-40'
                : 'hover:opacity-90 active:scale-[0.97]',
            )}
            style={{ background: brandGradient }}
          >
            <CheckCheck size={15} />
            Marcar visibles como leídas
          </button>
        </div>

        {/* Filter chips */}
        <div className="mt-3 flex flex-wrap gap-2">
          {filterChips.map((chip) => {
            const isActive = notificationFilter === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => setNotificationFilter(chip.id)}
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
        <div className="mt-4 rounded-2xl border border-surface-200/80 bg-surface-50 p-4 dark:border-white/10 dark:bg-surface-950/30">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-surface-500 dark:text-surface-400">
              Rango de fechas
            </p>
            <p className="text-xs text-surface-500 dark:text-surface-400">
              {filteredNotifications.length}{' '}
              {filteredNotifications.length === 1 ? 'aviso' : 'avisos'}{' '}
              {notificationDateRangeSummary}
            </p>
          </div>

          {/* Preset chips */}
          <div className="mt-3 flex flex-wrap gap-2">
            {presetChips.map((chip) => {
              const isActive = notificationDatePreset === chip.id;
              return (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setNotificationDatePreset(chip.id)}
                  className={cn(
                    'rounded-full px-3 py-1 text-xs font-medium transition-all',
                    isActive
                      ? 'text-white shadow-sm'
                      : 'border border-surface-200 bg-white text-surface-600 hover:bg-surface-100 dark:border-white/10 dark:bg-surface-900/40 dark:text-surface-300 dark:hover:bg-surface-800/50',
                  )}
                  style={isActive ? { background: `linear-gradient(135deg, ${accentColor}, ${secondaryColor})` } : undefined}
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
                value={notificationDateFrom}
                onChange={(e) => updateNotificationDateFrom(e.target.value)}
                className="w-full rounded-xl border border-surface-200 bg-white px-3 py-2 text-sm text-surface-900 focus:border-transparent focus:outline-none focus:ring-2 dark:border-white/10 dark:bg-surface-950/50 dark:text-white"
                style={{ '--tw-ring-color': withAlpha(accentColor, 0.4) } as React.CSSProperties}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-surface-500 dark:text-surface-400">
                Hasta
              </label>
              <input
                type="date"
                value={notificationDateTo}
                onChange={(e) => updateNotificationDateTo(e.target.value)}
                className="w-full rounded-xl border border-surface-200 bg-white px-3 py-2 text-sm text-surface-900 focus:border-transparent focus:outline-none focus:ring-2 dark:border-white/10 dark:bg-surface-950/50 dark:text-white"
                style={{ '--tw-ring-color': withAlpha(accentColor, 0.4) } as React.CSSProperties}
              />
            </div>
          </div>
        </div>

        {/* Notification list */}
        <div className="mt-4">
          {filteredNotifications.length > 0 ? (
            <div className="overflow-hidden rounded-[1.35rem] border border-surface-200/80 bg-white/85 divide-y divide-surface-200/80 dark:divide-white/10 dark:border-white/10 dark:bg-white/[0.04]">
              {filteredNotifications.map((notification) => (
                <NotificationInboxItem
                  key={notification.id}
                  notification={notification}
                  onOpen={() => void openNotificationDetail(notification)}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title={getNotificationEmptyStateTitle(notificationFilter, notificationSearch)}
              description={getNotificationEmptyStateDescription(
                notificationFilter,
                notificationSearch,
                notificationDateRangeSummary,
              )}
            />
          )}
        </div>
      </Panel>
    </motion.div>
  );
}
