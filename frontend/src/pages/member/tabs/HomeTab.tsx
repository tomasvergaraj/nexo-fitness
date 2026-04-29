import { motion } from 'framer-motion';
import {
  Bell,
  CalendarDays,
  CreditCard,
  Dumbbell,
  LifeBuoy,
  MapPin,
  ShieldCheck,
  Ticket,
  UserRound,
  Wallet,
  Wifi,
} from 'lucide-react';
import type { LucideProps } from 'lucide-react';
import type { ForwardRefExoticComponent, RefAttributes } from 'react';
import {
  DeviceStatusItem,
  MemberPassCard,
  MetricCard,
  Panel,
  QuickActionCard,
  SkeletonMetricCards,
  SkeletonPassCard,
} from '../components/MemberShared';
import {
  cn,
  formatClassModalityLabel,
  formatDateTime,
  formatMembershipStatusLabel,
  formatRelative,
} from '@/utils';
import { useMemberContext } from '../MemberContext';

export default function HomeTab() {
  const {
    wallet,
    walletQuery,
    reservations,
    unreadNotifications,
    memberFullName,
    accentColor,
    secondaryColor,
    brandGradient,
    isDark,
    gymLocation,
    isOnline,
    isStandalone,
    notificationPermissionMeta,
    hasCheckinCode,
    installHint,
    navigateTo,
    copyCheckinCode,
  } = useMemberContext();

  type LucideIcon = ForwardRefExoticComponent<Omit<LucideProps, 'ref'> & RefAttributes<SVGSVGElement>>;
  function asMetricIcon(icon: LucideIcon) {
    return icon as unknown as React.ComponentType<{ size?: number }>;
  }

  const isWalletLoading = walletQuery.isLoading && !walletQuery.data;

  const isMembershipExpiredOrInactive =
    wallet?.membership_status === 'expired' || wallet?.membership_status === 'inactive';

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
      className="space-y-4"
    >
      {/* ── Stats row ─────────────────────────────────────────────────── */}
      {isWalletLoading ? (
        <SkeletonMetricCards />
      ) : (
        <section className="grid gap-3 md:grid-cols-3">
          <MetricCard
            icon={asMetricIcon(Wallet)}
            label="Plan"
            value={wallet?.plan_name ?? 'Sin plan'}
            caption={
              wallet?.membership_status
                ? formatMembershipStatusLabel(wallet.membership_status)
                : 'Membresía pendiente'
            }
            accentColor={accentColor}
            secondaryColor={secondaryColor}
          />
          <MetricCard
            icon={asMetricIcon(CalendarDays)}
            label="Reservas"
            value={String(reservations.length)}
            caption={
              wallet?.next_class?.start_time
                ? formatDateTime(wallet.next_class.start_time)
                : 'Sin próxima clase'
            }
            accentColor={accentColor}
            secondaryColor={secondaryColor}
          />
          <MetricCard
            icon={asMetricIcon(Bell)}
            label="Sin leer"
            value={String(unreadNotifications)}
            caption={notificationPermissionMeta.label}
            accentColor={accentColor}
            secondaryColor={secondaryColor}
          />
        </section>
      )}

      {/* ── Main content ───────────────────────────────────────────────── */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        {/* Left column */}
        <div className="space-y-4">
          <Panel title="Pase digital">
            <p className="text-sm leading-6 text-surface-600 dark:text-surface-300">
              Muestra este pase al entrar al gimnasio. El personal escaneará tu código de
              check-in para confirmar tu acceso.
            </p>

            {isWalletLoading ? (
              <SkeletonPassCard />
            ) : (
              <MemberPassCard
                accentColor={accentColor}
                secondaryColor={secondaryColor}
                isDark={isDark}
                expiresAt={wallet?.expires_at}
                memberName={memberFullName}
                membershipStatus={wallet?.membership_status}
                planName={wallet?.plan_name ?? 'Sin plan activo'}
                qrPayload={wallet?.qr_payload}
                onCopyCode={copyCheckinCode}
              />
            )}

            {/* Expired / inactive warning */}
            {!isWalletLoading && isMembershipExpiredOrInactive ? (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-500/30 dark:bg-amber-500/10">
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                  {wallet?.membership_status === 'expired'
                    ? 'Tu membresía está vencida.'
                    : 'Tu membresía está inactiva.'}
                </p>
                <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
                  Renueva tu plan para seguir disfrutando de todos los beneficios del gimnasio.
                </p>
                <button
                  type="button"
                  onClick={() => navigateTo('plans')}
                  className="btn-primary mt-3"
                  style={{ background: brandGradient }}
                >
                  Renovar
                </button>
              </div>
            ) : null}

            {/* Quick actions */}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <QuickActionCard
                icon={CalendarDays}
                title="Agenda"
                description="Clases, reservas y próximas actividades de la semana."
                onClick={() => navigateTo('agenda')}
                accentColor={accentColor}
                secondaryColor={secondaryColor}
              />
              <QuickActionCard
                icon={Dumbbell}
                title="Programas"
                description="Programas de entrenamiento e inscripción personal."
                onClick={() => navigateTo('programs')}
                accentColor={accentColor}
                secondaryColor={secondaryColor}
              />
              <QuickActionCard
                icon={CreditCard}
                title="Planes"
                description="Planes disponibles y compra online."
                onClick={() => navigateTo('plans')}
                accentColor={accentColor}
                secondaryColor={secondaryColor}
              />
              <QuickActionCard
                icon={Ticket}
                title="Pagos"
                description="Historial de pagos y comprobantes."
                onClick={() => navigateTo('payments')}
                accentColor={accentColor}
                secondaryColor={secondaryColor}
              />
              <QuickActionCard
                icon={Bell}
                title="Bandeja"
                description="Avisos, recordatorios y acciones pendientes."
                onClick={() => navigateTo('notifications')}
                accentColor={accentColor}
                secondaryColor={secondaryColor}
              />
              <QuickActionCard
                icon={UserRound}
                title="Perfil"
                description="Cuenta, dispositivo y preferencias personales."
                onClick={() => navigateTo('profile')}
                accentColor={accentColor}
                secondaryColor={secondaryColor}
              />
              <QuickActionCard
                icon={LifeBuoy}
                title="Soporte"
                description="Ayuda, respuestas y seguimiento de tus casos."
                onClick={() => navigateTo('support')}
                accentColor={accentColor}
                secondaryColor={secondaryColor}
              />
            </div>
          </Panel>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Next activity */}
          <Panel title="Próxima actividad">
            {wallet?.next_class ? (
              <div className="space-y-3">
                <p className="text-base font-semibold text-surface-900 dark:text-white">
                  {wallet.next_class.name}
                </p>
                <p className="text-sm text-surface-600 dark:text-surface-300">
                  {formatDateTime(wallet.next_class.start_time)}
                </p>
                {gymLocation ? (
                  <div className="flex items-center gap-1.5 text-sm text-surface-500 dark:text-surface-400">
                    <MapPin size={14} />
                    <span>{gymLocation}</span>
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="badge badge-info">
                    {formatClassModalityLabel(wallet.next_class.modality)}
                  </span>
                  <span className="badge badge-neutral">
                    {formatRelative(wallet.next_class.start_time)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => navigateTo('agenda')}
                  className="btn-secondary mt-1 w-full"
                >
                  Abrir agenda
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm leading-6 text-surface-600 dark:text-surface-300">
                  No tienes clases próximas esta semana. Explora la agenda para reservar.
                </p>
                <button
                  type="button"
                  onClick={() => navigateTo('agenda')}
                  className="btn-secondary w-full"
                >
                  Explorar clases
                </button>
              </div>
            )}
          </Panel>

          {/* Next program class */}
          {wallet?.next_program_class ? (
            <Panel title="Mi programa">
              <div className="space-y-3">
                <p className="text-base font-semibold text-surface-900 dark:text-white">
                  {wallet.next_program_class.name}
                </p>
                <p className="text-sm text-surface-600 dark:text-surface-300">
                  {formatDateTime(wallet.next_program_class.start_time)}
                </p>
                {gymLocation ? (
                  <div className="flex items-center gap-1.5 text-sm text-surface-500 dark:text-surface-400">
                    <MapPin size={14} />
                    <span>{gymLocation}</span>
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="badge badge-info">
                    {formatClassModalityLabel(wallet.next_program_class.modality)}
                  </span>
                  <span className="badge badge-neutral">
                    {formatRelative(wallet.next_program_class.start_time)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => navigateTo('programs')}
                  className="btn-secondary mt-1 w-full"
                >
                  Ver programa
                </button>
              </div>
            </Panel>
          ) : null}

          {/* Device panel */}
          <Panel title="Tu dispositivo">
            <div className="space-y-2">
              <DeviceStatusItem
                label="Conexión"
                value={isOnline ? 'En línea' : 'Sin conexión'}
                tone={isOnline ? 'success' : 'warning'}
              />
              <DeviceStatusItem
                label="App"
                value={isStandalone ? 'Instalada' : 'En navegador'}
                tone={isStandalone ? 'success' : 'info'}
              />
              <DeviceStatusItem
                label="Avisos"
                value={notificationPermissionMeta.label}
                tone={notificationPermissionMeta.tone}
              />
              <DeviceStatusItem
                label="Código QR"
                value={hasCheckinCode ? 'Sincronizado' : 'Sin código'}
                tone={hasCheckinCode ? 'success' : 'neutral'}
              />
            </div>

            {/* Install / connectivity hint */}
            <div
              className={cn(
                'mt-4 flex items-start gap-3 rounded-2xl border px-4 py-3',
                isOnline
                  ? 'border-cyan-200 bg-cyan-50 dark:border-cyan-500/30 dark:bg-cyan-500/10'
                  : 'border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10',
              )}
            >
              {isOnline ? (
                <ShieldCheck
                  size={18}
                  className="mt-0.5 shrink-0 text-cyan-700 dark:text-cyan-300"
                />
              ) : (
                <Wifi size={18} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-300" />
              )}
              <p
                className={cn(
                  'text-sm leading-6',
                  isOnline
                    ? 'text-cyan-800 dark:text-cyan-200'
                    : 'text-amber-800 dark:text-amber-200',
                )}
              >
                {installHint}
              </p>
            </div>
          </Panel>
        </div>
      </div>
    </motion.div>
  );
}
