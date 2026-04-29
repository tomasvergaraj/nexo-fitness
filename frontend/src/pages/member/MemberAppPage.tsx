import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, CheckCheck, ExternalLink, LifeBuoy, Menu, RefreshCcw, WifiOff, XCircle, ShieldCheck } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { cn, formatDateTime, formatRelative } from '@/utils';
import { SUPPORT_CHANNEL_OPTIONS } from './memberUtils';
import { MemberProvider, useMemberContext } from './MemberContext';
import MemberBottomNav from './components/MemberBottomNav';
import MemberDrawer from './components/MemberDrawer';
import { ProfileDetailItem } from './components/MemberShared';
import HomeTab from './tabs/HomeTab';
import AgendaTab from './tabs/AgendaTab';
import ProgramsTab from './tabs/ProgramsTab';
import ProgressTab from './tabs/ProgressTab';
import SupportTab from './tabs/SupportTab';
import PlansTab from './tabs/PlansTab';
import PaymentsTab from './tabs/PaymentsTab';
import NotificationsTab from './tabs/NotificationsTab';
import ProfileTab from './tabs/ProfileTab';
import type { AppNotification } from '@/types';
import {
  getNotificationActionLabel,
  getNotificationTypeMeta,
} from './memberUtils';

// ─── Notification type icon ───────────────────────────────────────────────────

function NotificationTypeIcon({ type, size = 16 }: { type: AppNotification['type']; size?: number }) {
  if (type === 'success') return <CheckCheck size={size} />;
  if (type === 'error') return <XCircle size={size} />;
  if (type === 'warning') return <ShieldCheck size={size} />;
  return <Bell size={size} />;
}

// ─── Inner app (needs context) ────────────────────────────────────────────────

function MemberApp() {
  const {
    activeTab,
    navigateTo,
    accentColor,
    secondaryColor,
    brandGradient,
    tenantDisplayName,
    ownerLogoUrl,
    isOnline,
    isSyncing,
    lastSyncedAt,
    unreadNotifications,
    notifications,
    syncMemberData,
    // Notification detail modal
    selectedNotificationId,
    setSelectedNotificationId,
    notificationMutation,
    // Support request modal
    showSupportRequestModal,
    setShowSupportRequestModal,
    supportRequestForm,
    setSupportRequestForm,
    createSupportInteractionMutation,
  } = useMemberContext();

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const TABS_META: Record<string, string> = {
    home: 'Inicio', agenda: 'Agenda', programs: 'Programas', progress: 'Progreso',
    support: 'Soporte', plans: 'Planes', payments: 'Pagos', notifications: 'Bandeja', profile: 'Perfil',
  };

  const selectedNotification = notifications.find((n) => n.id === selectedNotificationId) ?? null;

  async function openNotificationAction(notification: AppNotification) {
    const url = notification.action_url;
    if (!url) return;
    await notificationMutation.mutateAsync({ notificationId: notification.id, payload: { clicked_at: new Date().toISOString() } });
    if (url.startsWith('nexofitness://tab/')) {
      const tab = url.replace('nexofitness://tab/', '');
      setSelectedNotificationId(null);
      navigateTo(tab as Parameters<typeof navigateTo>[0]);
    } else if (url.startsWith('http')) {
      window.open(url, '_blank', 'noreferrer');
    }
  }

  async function toggleNotificationReadState(notification: AppNotification) {
    await notificationMutation.mutateAsync({
      notificationId: notification.id,
      payload: { is_read: !notification.is_read, ...(notification.is_read ? {} : { mark_opened: true }) },
    });
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-surface-50 dark:bg-surface-950">
      {/* ── TOP BAR ────────────────────────────────────────────────────────── */}
      <header
        className="fixed inset-x-0 top-0 z-20 flex items-end border-b border-surface-200/80 bg-white/92 backdrop-blur-2xl dark:border-white/10 dark:bg-surface-950/90"
        style={{ paddingTop: 'env(safe-area-inset-top)', height: 'calc(56px + env(safe-area-inset-top))' }}
      >
        <div
          className="absolute inset-x-0 bottom-0 h-0.5 opacity-60"
          style={{ backgroundImage: brandGradient }}
        />
        <div className="flex h-14 w-full items-center gap-2 px-3 sm:px-5">
          <button
            type="button"
            onClick={() => setIsDrawerOpen(true)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-surface-600 transition-colors hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-white/10"
            aria-label="Abrir menú"
          >
            <Menu size={21} />
          </button>

          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-xl text-sm font-bold text-white"
              style={{ background: `linear-gradient(135deg, ${accentColor}, ${secondaryColor})` }}
            >
              {ownerLogoUrl ? (
                <img src={ownerLogoUrl} alt={tenantDisplayName} className="h-full w-full object-cover" />
              ) : (
                tenantDisplayName.charAt(0).toUpperCase()
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold leading-tight text-surface-900 dark:text-white">
                {tenantDisplayName}
              </p>
              <p className="truncate text-[11px] leading-tight text-surface-400 dark:text-surface-500">
                {TABS_META[activeTab] ?? activeTab}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            {!isOnline && (
              <span className="flex h-8 w-8 items-center justify-center text-amber-500">
                <WifiOff size={15} />
              </span>
            )}
            <button
              type="button"
              onClick={() => void syncMemberData()}
              disabled={isSyncing}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-surface-500 transition-colors hover:bg-surface-100 disabled:opacity-40 dark:text-surface-400 dark:hover:bg-white/10"
              aria-label="Actualizar datos"
            >
              <RefreshCcw size={17} className={cn(isSyncing && 'animate-spin')} />
            </button>
            <button
              type="button"
              onClick={() => navigateTo('notifications')}
              className="relative flex h-9 w-9 items-center justify-center rounded-xl text-surface-500 transition-colors hover:bg-surface-100 dark:text-surface-400 dark:hover:bg-white/10"
              aria-label="Notificaciones"
            >
              <Bell size={17} />
              {unreadNotifications > 0 && (
                <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-400 px-0.5 text-[9px] font-bold text-surface-950">
                  {unreadNotifications > 9 ? '9+' : unreadNotifications}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* ── CONTENT ────────────────────────────────────────────────────────── */}
      <main
        className="flex-1 overflow-y-auto overscroll-y-none"
        style={{
          paddingTop: 'calc(56px + env(safe-area-inset-top))',
        }}
      >
        <div className="mx-auto max-w-7xl space-y-4 px-4 py-5 sm:px-6 lg:px-8">
          {!isOnline && (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-50/90">
              <div className="flex items-center gap-2.5">
                <WifiOff size={15} className="shrink-0" />
                <p className="text-sm font-semibold">
                  Sin conexión · Mostrando datos guardados
                  {lastSyncedAt ? ` (${formatRelative(lastSyncedAt)})` : ''}
                </p>
              </div>
            </section>
          )}

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
            >
              {activeTab === 'home' && <HomeTab />}
              {activeTab === 'agenda' && <AgendaTab />}
              {activeTab === 'programs' && <ProgramsTab />}
              {activeTab === 'progress' && <ProgressTab />}
              {activeTab === 'support' && <SupportTab />}
              {activeTab === 'plans' && <PlansTab />}
              {activeTab === 'payments' && <PaymentsTab />}
              {activeTab === 'notifications' && <NotificationsTab />}
              {activeTab === 'profile' && <ProfileTab />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* ── BOTTOM NAV ─────────────────────────────────────────────────────── */}
      <MemberBottomNav onOpenDrawer={() => setIsDrawerOpen(true)} />

      {/* ── DRAWER ─────────────────────────────────────────────────────────── */}
      <MemberDrawer isOpen={isDrawerOpen} onClose={() => setIsDrawerOpen(false)} />

      {/* ── NOTIFICATION DETAIL MODAL ───────────────────────────────────────── */}
      <Modal
        open={Boolean(selectedNotification)}
        title={selectedNotification?.title || 'Detalle de la notificación'}
        description={selectedNotification ? `Recibida ${formatDateTime(selectedNotification.created_at)}.` : undefined}
        onClose={() => setSelectedNotificationId(null)}
        size="lg"
      >
        {selectedNotification ? (
          <div className="space-y-5">
            <div className="rounded-[1.25rem] border border-surface-200 bg-surface-50/80 p-4 dark:border-white/10 dark:bg-surface-950/35">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <div
                    className={cn(
                      'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl',
                      getNotificationTypeMeta(selectedNotification.type).panelIconClass,
                    )}
                  >
                    <NotificationTypeIcon type={selectedNotification.type} size={20} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn('badge', getNotificationTypeMeta(selectedNotification.type).badgeClass)}>
                        {getNotificationTypeMeta(selectedNotification.type).label}
                      </span>
                      <span className={cn('badge', selectedNotification.is_read ? 'badge-neutral' : 'badge-info')}>
                        {selectedNotification.is_read ? 'Leída' : 'Nueva'}
                      </span>
                      {selectedNotification.action_url ? (
                        <span className="badge badge-warning">Con acción</span>
                      ) : null}
                    </div>
                    <p className="mt-3 text-base font-semibold text-surface-900 dark:text-white">
                      {selectedNotification.title}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-surface-600 dark:text-surface-300">
                      {selectedNotification.message || 'Sin mensaje adicional.'}
                    </p>
                  </div>
                </div>
                <div className="text-sm text-surface-500 dark:text-surface-400">
                  {formatRelative(selectedNotification.created_at)}
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <ProfileDetailItem label="Recibida" value={formatDateTime(selectedNotification.created_at)} />
              <ProfileDetailItem
                label="Vista"
                value={selectedNotification.opened_at ? formatDateTime(selectedNotification.opened_at) : 'Pendiente'}
              />
              <ProfileDetailItem
                label="Acción ejecutada"
                value={selectedNotification.clicked_at ? formatDateTime(selectedNotification.clicked_at) : 'Sin ejecutar'}
              />
              <ProfileDetailItem
                label="Destino"
                value={selectedNotification.action_url ? getNotificationActionLabel(selectedNotification.action_url) : 'Sin acción'}
              />
            </div>

            <div className="flex flex-wrap justify-end gap-3">
              <button
                type="button"
                className="btn-secondary"
                disabled={notificationMutation.isPending}
                onClick={() => void toggleNotificationReadState(selectedNotification)}
              >
                {selectedNotification.is_read ? 'Marcar como nueva' : 'Marcar como leída'}
              </button>
              {selectedNotification.action_url ? (
                <button
                  type="button"
                  className="btn-primary"
                  style={{ backgroundImage: brandGradient }}
                  onClick={() => void openNotificationAction(selectedNotification)}
                >
                  <ExternalLink size={16} />
                  {getNotificationActionLabel(selectedNotification.action_url)}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>

      {/* ── SUPPORT REQUEST MODAL ───────────────────────────────────────────── */}
      <Modal
        open={showSupportRequestModal}
        title="Pedir ayuda"
        description="Tu solicitud quedará visible para el gimnasio y podrás seguir si sigue pendiente o si ya quedó resuelta."
        onClose={() => {
          if (!createSupportInteractionMutation.isPending) setShowSupportRequestModal(false);
        }}
      >
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            createSupportInteractionMutation.mutate();
          }}
        >
          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">
              ¿Cómo prefieres que te respondan?
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              {SUPPORT_CHANNEL_OPTIONS.map((option) => {
                const isSelected = supportRequestForm.channel === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setSupportRequestForm((f) => ({ ...f, channel: option.value }))}
                    className={cn(
                      'rounded-[1.15rem] border px-4 py-4 text-left transition-colors',
                      isSelected
                        ? 'border-brand-300 bg-brand-50 text-surface-900 dark:border-brand-400/30 dark:bg-brand-500/10 dark:text-white'
                        : 'border-surface-200 bg-white text-surface-600 hover:border-surface-300 dark:border-white/10 dark:bg-surface-950/30 dark:text-surface-300',
                    )}
                  >
                    <p className="text-sm font-semibold">{option.label}</p>
                    <p className="mt-1 text-xs leading-5 opacity-80">{option.description}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">
              Qué necesitas
            </label>
            <input
              className="input"
              value={supportRequestForm.subject}
              onChange={(e) => setSupportRequestForm((f) => ({ ...f, subject: e.target.value }))}
              placeholder="Ej. No puedo reservar una clase"
              required
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">
              Más contexto
            </label>
            <textarea
              className="input min-h-28 resize-y"
              value={supportRequestForm.notes}
              onChange={(e) => setSupportRequestForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Cuéntanos qué intentaste, desde cuándo pasa o cualquier detalle que ayude a resolverlo más rápido."
            />
          </div>

          <div className="rounded-[1.15rem] border border-surface-200 bg-surface-50 px-4 py-4 dark:border-white/10 dark:bg-surface-950/35">
            <p className="text-[11px] uppercase tracking-[0.18em] text-surface-500">Así funciona</p>
            <p className="mt-2 text-sm leading-6 text-surface-600 dark:text-surface-300">
              El gimnasio verá esta solicitud en su módulo de soporte. Aquí mismo podrás revisar si sigue pendiente o si ya la marcaron como resuelta.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setShowSupportRequestModal(false)}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn-primary"
              style={{ backgroundImage: brandGradient }}
              disabled={createSupportInteractionMutation.isPending}
            >
              <LifeBuoy size={16} />
              {createSupportInteractionMutation.isPending ? 'Enviando...' : 'Enviar solicitud'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ─── Public export (wraps with provider) ─────────────────────────────────────

export default function MemberAppPage() {
  return (
    <MemberProvider>
      <MemberApp />
    </MemberProvider>
  );
}
