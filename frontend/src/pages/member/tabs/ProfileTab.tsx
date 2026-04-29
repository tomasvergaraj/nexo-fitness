import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Bell,
  CalendarDays,
  Download,
  LifeBuoy,
  Mail,
  Moon,
  Pencil,
  Phone,
  Sun,
  Ticket,
  UserRound,
} from 'lucide-react';
import WhatsAppIcon from '@/components/icons/WhatsAppIcon';
import Tooltip from '@/components/ui/Tooltip';
import { DeviceStatusItem, Panel, ProfileDetailItem } from '../components/MemberShared';
import {
  cn,
  formatDate,
  formatDateTime,
  formatMembershipStatusLabel,
  formatRelative,
  formatUserRoleLabel,
  getApiError,
} from '@/utils';
import { authApi, mobileApi } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import toast from 'react-hot-toast';
import { useMemberContext } from '../MemberContext';

const MEMBER_AUTO_RENEW_AVAILABLE = false;

export default function ProfileTab() {
  const {
    user,
    wallet,
    profile,
    supportInteractions,
    pendingSupportInteractions,
    resolvedSupportInteractions,
    supportWhatsAppUrl,
    supportCallUrl,
    supportEmailUrl,
    supportPhone,
    accentColor,
    brandGradient,
    isDark,
    isOnline,
    isStandalone,
    notificationPermissionMeta,
    lastSyncedAt,
    webPushSupported,
    webPushConfigured,
    activeWebPushSubscription,
    enableWebPush,
    installApp,
    toggleTheme,
    navigateTo,
    queryClient,
  } = useMemberContext();

  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [profileEditForm, setProfileEditForm] = useState({ first_name: '', last_name: '', phone: '' });

  // ── Mutations ──────────────────────────────────────────────────────────────

  const updateProfileMutation = useMutation({
    mutationFn: async (data: { first_name?: string; last_name?: string; phone?: string }) =>
      (await authApi.updateMe(data)).data,
    onSuccess: (updatedUser) => {
      useAuthStore.getState().setUser(updatedUser);
      setIsEditingProfile(false);
      toast.success('Perfil actualizado.');
    },
    onError: (error: any) => toast.error(getApiError(error, 'No se pudo actualizar el perfil.')),
  });

  const toggleAutoRenewMutation = useMutation({
    mutationFn: async (autoRenew: boolean) => (await mobileApi.updateMembership({ auto_renew: autoRenew })).data,
    onSuccess: (updatedWallet) => {
      queryClient.setQueryData(['member-wallet'], updatedWallet);
      toast.success(
        updatedWallet.auto_renew
          ? 'Renovacion automatica activada.'
          : 'Renovacion automatica desactivada.',
      );
    },
    onError: (error: any) => toast.error(getApiError(error, 'No se pudo actualizar la membresia.')),
  });

  // ── Computed ───────────────────────────────────────────────────────────────

  const webPushStateLabel = activeWebPushSubscription
    ? 'Activos en este dispositivo'
    : webPushConfigured
      ? 'Configurados, pero inactivos'
      : 'No disponibles aún';

  const supportEmail = profile?.branding?.support_email || profile?.email;

  function handleEditStart() {
    setProfileEditForm({
      first_name: user.first_name ?? '',
      last_name: user.last_name ?? '',
      phone: user.phone ?? '',
    });
    setIsEditingProfile(true);
  }

  function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: { first_name?: string; last_name?: string; phone?: string } = {};
    if (profileEditForm.first_name.trim()) payload.first_name = profileEditForm.first_name.trim();
    if (profileEditForm.last_name.trim()) payload.last_name = profileEditForm.last_name.trim();
    if (profileEditForm.phone.trim()) payload.phone = profileEditForm.phone.trim();
    updateProfileMutation.mutate(payload);
  }

  const autoRenewOn = Boolean(wallet?.auto_renew);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
      className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]"
    >
      {/* ══ Left column ═══════════════════════════════════════════════════════ */}
      <div className="space-y-4">

        {/* ── Panel: Perfil del miembro ──────────────────────────────────── */}
        <Panel title="Perfil del miembro">
          {/* Avatar + identity */}
          <div className="flex items-start gap-4">
            <div
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl text-white shadow-lg"
              style={{ background: brandGradient }}
            >
              <UserRound size={28} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xl font-bold text-surface-900 dark:text-white">
                {user.first_name} {user.last_name}
              </p>
              <p className="mt-0.5 text-sm text-surface-500 dark:text-surface-400">{user.email}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="badge badge-info">{formatUserRoleLabel(user.role)}</span>
                {user.is_verified ? (
                  <span className="badge badge-success">Verificado</span>
                ) : (
                  <span className="badge badge-warning">Sin verificar</span>
                )}
              </div>
            </div>
          </div>

          {/* Edit form / detail grid */}
          {isEditingProfile ? (
            <form onSubmit={handleEditSubmit} className="mt-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="prof-first-name">Nombre</label>
                  <input
                    id="prof-first-name"
                    type="text"
                    className="input w-full"
                    value={profileEditForm.first_name}
                    onChange={(e) => setProfileEditForm((f) => ({ ...f, first_name: e.target.value }))}
                    placeholder={user.first_name}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="prof-last-name">Apellido</label>
                  <input
                    id="prof-last-name"
                    type="text"
                    className="input w-full"
                    value={profileEditForm.last_name}
                    onChange={(e) => setProfileEditForm((f) => ({ ...f, last_name: e.target.value }))}
                    placeholder={user.last_name}
                  />
                </div>
              </div>
              <div>
                <label className="label" htmlFor="prof-phone">Teléfono</label>
                <input
                  id="prof-phone"
                  type="tel"
                  className="input w-full"
                  value={profileEditForm.phone}
                  onChange={(e) => setProfileEditForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder={user.phone ?? '+56 9 0000 0000'}
                />
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  type="submit"
                  disabled={updateProfileMutation.isPending}
                  className="btn-primary flex-1"
                >
                  {updateProfileMutation.isPending ? 'Guardando...' : 'Guardar cambios'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingProfile(false)}
                  className="btn-secondary flex-1"
                >
                  Cancelar
                </button>
              </div>
            </form>
          ) : (
            <div className="mt-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <ProfileDetailItem label="Teléfono" value={user.phone ?? '—'} />
                <ProfileDetailItem label="Alta" value={formatDate(user.created_at)} />
                <ProfileDetailItem
                  label="Último acceso"
                  value={user.last_login_at ? formatRelative(user.last_login_at) : '—'}
                />
                <ProfileDetailItem label="Cuenta" value={wallet?.tenant_name ?? '—'} />
              </div>
              <button
                type="button"
                onClick={handleEditStart}
                className="btn-secondary inline-flex items-center gap-2"
              >
                <Pencil size={14} />
                Editar perfil
              </button>
            </div>
          )}
        </Panel>

        {/* ── Panel: Membresía y actividad ──────────────────────────────── */}
        <Panel title="Membresía y actividad">
          {/* Membership summary grid */}
          <div className="grid gap-3 sm:grid-cols-2">
            <ProfileDetailItem label="Plan activo" value={wallet?.plan_name ?? '—'} />
            <ProfileDetailItem
              label="Estado"
              value={formatMembershipStatusLabel(wallet?.membership_status)}
            />
            <ProfileDetailItem
              label="Inicio"
              value={wallet?.starts_at ? formatDate(wallet.starts_at) : '—'}
            />
            <ProfileDetailItem
              label="Vencimiento"
              value={wallet?.expires_at ? formatDate(wallet.expires_at) : '—'}
            />
          </div>

          {/* Auto-renew toggle */}
          <div className="mt-4 rounded-2xl border border-surface-200 bg-surface-50 px-4 py-3 dark:border-white/10 dark:bg-surface-950/30">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-surface-900 dark:text-white">
                  Renovación automática
                </p>
                <p className="mt-0.5 text-xs text-surface-500 dark:text-surface-400">
                  {MEMBER_AUTO_RENEW_AVAILABLE
                    ? autoRenewOn
                      ? 'Tu membresía se renovará automáticamente al vencer.'
                      : 'Activa para que tu membresía se renueve sin interrupciones.'
                    : 'Próximamente disponible para gestionar desde la app.'}
                </p>
              </div>
              <Tooltip
                content={
                  !MEMBER_AUTO_RENEW_AVAILABLE
                    ? 'Función no disponible aún'
                    : undefined
                }
                side="top"
              >
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoRenewOn}
                  disabled={!MEMBER_AUTO_RENEW_AVAILABLE || toggleAutoRenewMutation.isPending}
                  onClick={() => toggleAutoRenewMutation.mutate(!autoRenewOn)}
                  className={cn(
                    'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40',
                    autoRenewOn ? 'bg-[var(--toggle-on)]' : 'bg-surface-300 dark:bg-surface-600',
                  )}
                  style={
                    autoRenewOn
                      ? ({ '--toggle-on': accentColor } as React.CSSProperties)
                      : undefined
                  }
                >
                  <span
                    className={cn(
                      'inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200',
                      autoRenewOn ? 'translate-x-5' : 'translate-x-0',
                    )}
                  />
                </button>
              </Tooltip>
            </div>
          </div>

          {/* Next membership */}
          {wallet?.next_membership ? (
            <div className="mt-4 rounded-2xl border border-surface-200 bg-surface-50 px-4 py-3 dark:border-white/10 dark:bg-surface-950/30">
              <p className="text-[11px] uppercase tracking-[0.18em] text-surface-500">
                Próxima renovación programada
              </p>
              <p className="mt-1.5 text-sm font-semibold text-surface-900 dark:text-white">
                {wallet.next_membership.plan_name ?? 'Sin nombre'}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="badge badge-neutral">
                  Inicio: {formatDate(wallet.next_membership.starts_at)}
                </span>
                {wallet.next_membership.expires_at ? (
                  <span className="badge badge-neutral">
                    Vence: {formatDate(wallet.next_membership.expires_at)}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Next class */}
          {wallet?.next_class ? (
            <div className="mt-4 rounded-2xl border border-surface-200 bg-surface-50 px-4 py-3 dark:border-white/10 dark:bg-surface-950/30">
              <p className="text-[11px] uppercase tracking-[0.18em] text-surface-500">
                Próxima actividad
              </p>
              <p className="mt-1.5 text-sm font-semibold text-surface-900 dark:text-white">
                {wallet.next_class.name}
              </p>
              <p className="mt-0.5 text-xs text-surface-500 dark:text-surface-400">
                {formatDateTime(wallet.next_class.start_time)}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => navigateTo('agenda')}
                  className="btn-secondary inline-flex items-center gap-1.5 py-1.5 text-xs"
                >
                  <CalendarDays size={13} />
                  Abrir agenda
                </button>
                <button
                  type="button"
                  onClick={() => navigateTo('plans')}
                  className="btn-secondary inline-flex items-center gap-1.5 py-1.5 text-xs"
                >
                  <Ticket size={13} />
                  Ver planes
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => navigateTo('agenda')}
                className="btn-secondary inline-flex items-center gap-1.5 py-1.5 text-xs"
              >
                <CalendarDays size={13} />
                Abrir agenda
              </button>
              <button
                type="button"
                onClick={() => navigateTo('plans')}
                className="btn-secondary inline-flex items-center gap-1.5 py-1.5 text-xs"
              >
                <Ticket size={13} />
                Ver planes
              </button>
            </div>
          )}
        </Panel>
      </div>

      {/* ══ Right column ══════════════════════════════════════════════════════ */}
      <div className="space-y-4">

        {/* ── Panel: Ajustes ─────────────────────────────────────────────── */}
        <Panel title="Ajustes">
          <div className="space-y-2.5">
            {/* Install app */}
            <button
              type="button"
              onClick={installApp}
              className="btn-primary w-full justify-center"
              style={{ background: brandGradient }}
            >
              <Download size={15} className="mr-2" />
              {isStandalone ? 'App instalada' : 'Instalar app'}
            </button>

            {/* Toggle theme */}
            <button
              type="button"
              onClick={toggleTheme}
              className="btn-secondary w-full justify-center"
            >
              {isDark ? (
                <>
                  <Sun size={15} className="mr-2" />
                  Cambiar a claro
                </>
              ) : (
                <>
                  <Moon size={15} className="mr-2" />
                  Cambiar a oscuro
                </>
              )}
            </button>

            {/* Enable push notifications */}
            <Tooltip
              content={
                !webPushSupported
                  ? 'Tu navegador no soporta avisos push'
                  : !webPushConfigured
                    ? 'Los avisos aún no están configurados'
                    : undefined
              }
              side="top"
            >
              <button
                type="button"
                onClick={enableWebPush}
                disabled={!webPushSupported || !webPushConfigured}
                className="btn-secondary w-full justify-center disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Bell size={15} className="mr-2" />
                Activar avisos
              </button>
            </Tooltip>
          </div>

          {/* Info box */}
          <div className="mt-4 rounded-2xl border border-surface-200 bg-surface-50 px-4 py-3 dark:border-white/10 dark:bg-surface-950/30">
            <p className="text-[11px] uppercase tracking-[0.18em] text-surface-500">Acciones rápidas</p>
            <p className="mt-1.5 text-xs leading-5 text-surface-600 dark:text-surface-400">
              Instala la app para acceder más rápido, activa los avisos para recibir notificaciones de clases y novedades, y cambia el tema de la interfaz según tu preferencia.
            </p>
          </div>
        </Panel>

        {/* ── Panel: Estado del dispositivo ──────────────────────────────── */}
        <Panel title="Estado del dispositivo">
          <div className="space-y-2">
            <DeviceStatusItem
              label="Instalación"
              tone={isStandalone ? 'success' : 'info'}
              value={isStandalone ? 'App instalada' : 'Usando navegador'}
            />
            <DeviceStatusItem
              label="Conexión"
              tone={isOnline ? 'success' : 'warning'}
              value={isOnline ? 'En línea' : 'Sin conexión'}
            />
            <DeviceStatusItem
              label="Avisos"
              tone={notificationPermissionMeta.tone}
              value={notificationPermissionMeta.label}
            />
            <DeviceStatusItem
              label="Avisos del navegador"
              tone={
                activeWebPushSubscription
                  ? 'success'
                  : webPushConfigured
                    ? 'warning'
                    : 'neutral'
              }
              value={webPushStateLabel}
            />
            <DeviceStatusItem
              label="Última actualización"
              tone="neutral"
              value={lastSyncedAt ? formatRelative(lastSyncedAt) : 'Sin datos aún'}
            />
          </div>

          {/* Web push warning */}
          {!webPushConfigured && (
            <div className="mt-4 rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 dark:border-amber-500/25 dark:bg-amber-500/10">
              <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                Avisos no disponibles
              </p>
              <p className="mt-1 text-xs leading-5 text-amber-700 dark:text-amber-400">
                Los avisos push aún no están configurados para este gimnasio. Cuando estén listos, podrás activarlos desde aquí.
              </p>
            </div>
          )}

          {/* Support block */}
          <div className="mt-4 rounded-2xl border border-surface-200 bg-surface-50 px-4 py-3 dark:border-white/10 dark:bg-surface-950/30">
            <p className="text-[11px] uppercase tracking-[0.18em] text-surface-500">
              Soporte del gimnasio
            </p>

            {/* 4-col grid of support info */}
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.16em] text-surface-400">Correo</p>
                <p className="mt-1 text-xs font-medium text-surface-700 dark:text-surface-300 break-all">
                  {supportEmail ?? '—'}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.16em] text-surface-400">Teléfono</p>
                <p className="mt-1 text-xs font-medium text-surface-700 dark:text-surface-300">
                  {supportPhone ?? '—'}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.16em] text-surface-400">WhatsApp</p>
                <p className="mt-1 text-xs font-medium text-surface-700 dark:text-surface-300">
                  {supportWhatsAppUrl ? 'Disponible' : '—'}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.16em] text-surface-400">Tus solicitudes</p>
                <p className="mt-1 text-xs font-medium text-surface-700 dark:text-surface-300">
                  {supportInteractions.length} total · {pendingSupportInteractions.length} pendientes · {resolvedSupportInteractions} resueltas
                </p>
              </div>
            </div>

            {/* Action buttons */}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => navigateTo('support')}
                className="btn-secondary inline-flex items-center gap-1.5 py-1.5 text-xs"
              >
                <LifeBuoy size={13} />
                Abrir soporte
              </button>

              {supportWhatsAppUrl && (
                <a
                  href={supportWhatsAppUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary inline-flex items-center gap-1.5 py-1.5 text-xs"
                >
                  <WhatsAppIcon size={13} />
                  WhatsApp
                </a>
              )}

              {supportCallUrl && (
                <a
                  href={supportCallUrl}
                  className="btn-secondary inline-flex items-center gap-1.5 py-1.5 text-xs"
                >
                  <Phone size={13} />
                  Llamar
                </a>
              )}

              {supportEmailUrl && (
                <a
                  href={supportEmailUrl}
                  className="btn-secondary inline-flex items-center gap-1.5 py-1.5 text-xs"
                >
                  <Mail size={13} />
                  Email
                </a>
              )}
            </div>

            {/* Gym location */}
            {profile && (profile.address || profile.city) && (
              <p className="mt-3 text-xs text-surface-500 dark:text-surface-400">
                {[profile.address, profile.city].filter(Boolean).join(', ')}
              </p>
            )}
          </div>
        </Panel>
      </div>
    </motion.div>
  );
}
