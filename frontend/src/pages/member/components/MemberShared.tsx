import {
  Bell,
  CheckCheck,
  Mail,
  MapPin,
  Phone,
  QrCode,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import QRCode from 'react-qr-code';
import type { AppNotification, SupportInteraction } from '@/types';
import { cn, formatDate, formatMembershipStatusLabel, formatRelative, formatSupportChannelLabel, supportChannelBadgeColor } from '@/utils';
import type { SupportTimelineEntry } from '@/utils/support';
import { withAlpha } from '@/utils';
import WhatsAppIcon from '@/components/icons/WhatsAppIcon';
import { getNotificationTypeMeta } from '../memberUtils';

// ─── ProfileDetailItem ─────────────────────────────────────────────────────────

export function ProfileDetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-surface-200 bg-surface-50 px-4 py-3 dark:border-white/10 dark:bg-surface-950/35">
      <p className="text-[11px] uppercase tracking-[0.18em] text-surface-500">{label}</p>
      <p className="mt-2 text-sm font-semibold text-surface-900 dark:text-white">{value}</p>
    </div>
  );
}

// ─── MetricCard ───────────────────────────────────────────────────────────────

export function MetricCard({
  icon: Icon,
  label,
  value,
  caption,
  accentColor,
  secondaryColor,
}: {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  value: string;
  caption: string;
  accentColor: string;
  secondaryColor: string;
}) {
  return (
    <div className="rounded-[1.5rem] border border-surface-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-2xl dark:border-white/10 dark:bg-white/5 dark:shadow-none">
      <div
        className="flex h-10 w-10 items-center justify-center rounded-2xl text-white"
        style={{ background: `linear-gradient(135deg, ${accentColor}, ${secondaryColor})` }}
      >
        <Icon size={18} />
      </div>
      <p className="mt-3 text-[11px] uppercase tracking-[0.18em] text-surface-500 dark:text-surface-400">
        {label}
      </p>
      <p className="mt-1.5 text-[1.65rem] font-bold font-display text-surface-900 dark:text-white">
        {value}
      </p>
      <p className="mt-1 text-sm text-surface-600 dark:text-surface-300">{caption}</p>
    </div>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export function Panel({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-[1.4rem] border border-surface-200/80 bg-white/85 p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.04] dark:shadow-none',
        className,
      )}
    >
      <h2 className="text-lg font-semibold text-surface-900 dark:text-white">{title}</h2>
      <div className="mt-2.5">{children}</div>
    </div>
  );
}

// ─── QuickActionCard ──────────────────────────────────────────────────────────

export function QuickActionCard({
  accentColor,
  description,
  icon: Icon,
  onClick,
  secondaryColor,
  title,
}: {
  accentColor: string;
  description: string;
  icon: React.ComponentType<{ size?: string | number; className?: string }>;
  onClick: () => void;
  secondaryColor: string;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[1.25rem] border border-surface-200 bg-surface-50/85 p-3.5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-surface-300 hover:bg-white dark:border-white/10 dark:bg-surface-950/35 dark:hover:border-white/20 dark:hover:bg-surface-950/55"
    >
      <div className="flex items-start justify-between gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-white"
          style={{ background: `linear-gradient(135deg, ${accentColor}, ${secondaryColor})` }}
        >
          <Icon size={18} />
        </div>
        <span className="text-[11px] uppercase tracking-[0.18em] text-surface-500">Abrir</span>
      </div>
      <p className="mt-3 text-[15px] font-semibold text-surface-900 dark:text-white">{title}</p>
      <p className="mt-1 text-sm leading-6 text-surface-600 dark:text-surface-300">{description}</p>
    </button>
  );
}

// ─── DeviceStatusItem ─────────────────────────────────────────────────────────

export function DeviceStatusItem({
  label,
  tone,
  value,
}: {
  label: string;
  tone: 'success' | 'info' | 'warning' | 'neutral';
  value: string;
}) {
  const valueColorClass = {
    success: 'text-emerald-700 dark:text-emerald-200',
    info: 'text-cyan-700 dark:text-cyan-200',
    warning: 'text-amber-700 dark:text-amber-200',
    neutral: 'text-surface-700 dark:text-surface-200',
  }[tone];

  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl border border-surface-200 bg-surface-50 px-4 py-3 dark:border-white/10 dark:bg-surface-950/30">
      <p className="text-sm text-surface-500 dark:text-surface-400">{label}</p>
      <p className={cn('text-right text-sm font-semibold', valueColorClass)}>{value}</p>
    </div>
  );
}

// ─── EmptyState ───────────────────────────────────────────────────────────────

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-[1.5rem] border border-dashed border-surface-300 bg-surface-50/80 px-5 py-8 text-center dark:border-white/15 dark:bg-black/10">
      <p className="text-lg font-semibold text-surface-900 dark:text-white">{title}</p>
      <p className="mt-2 text-sm leading-6 text-surface-600 dark:text-surface-300">{description}</p>
    </div>
  );
}

// ─── NotificationTypeIcon ─────────────────────────────────────────────────────

export function NotificationTypeIcon({
  type,
  size = 16,
}: {
  type: AppNotification['type'];
  size?: number;
}) {
  if (type === 'success') return <CheckCheck size={size} />;
  if (type === 'error') return <XCircle size={size} />;
  if (type === 'warning') return <ShieldCheck size={size} />;
  return <Bell size={size} />;
}

// ─── NotificationInboxItem ────────────────────────────────────────────────────

export function NotificationInboxItem({
  notification,
  onOpen,
}: {
  notification: AppNotification;
  onOpen: () => void;
}) {
  const typeMeta = getNotificationTypeMeta(notification.type);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'w-full px-4 py-4 text-left transition-colors hover:bg-surface-50/80 dark:hover:bg-white/[0.03]',
        notification.is_read ? '' : 'bg-brand-50/35 dark:bg-brand-500/5',
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl',
            typeMeta.panelIconClass,
          )}
        >
          <NotificationTypeIcon type={notification.type} size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-surface-900 dark:text-white">
                  {notification.title}
                </p>
                {!notification.is_read ? (
                  <span className="h-2.5 w-2.5 rounded-full bg-brand-500" />
                ) : null}
              </div>
              <p className="mt-1 line-clamp-2 text-sm leading-6 text-surface-600 dark:text-surface-300">
                {notification.message || 'Sin mensaje adicional.'}
              </p>
            </div>
            <div className="shrink-0 text-right text-xs text-surface-500 dark:text-surface-400">
              <p>{formatRelative(notification.created_at)}</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className={cn('badge', typeMeta.badgeClass)}>{typeMeta.label}</span>
            <span className={cn('badge', notification.is_read ? 'badge-neutral' : 'badge-info')}>
              {notification.is_read ? 'Leída' : 'Nueva'}
            </span>
            {notification.action_url ? (
              <span className="badge badge-warning">Con acción</span>
            ) : null}
          </div>
        </div>
      </div>
    </button>
  );
}

// ─── SupportInboxItem ─────────────────────────────────────────────────────────

export function SupportInboxItem({
  interaction,
  lastEntry,
  lastActivityAt,
  traceCount,
  onOpen,
}: {
  interaction: SupportInteraction;
  lastEntry: SupportTimelineEntry | null;
  lastActivityAt: string;
  traceCount: number;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'w-full px-4 py-4 text-left transition-colors hover:bg-surface-50/80 dark:hover:bg-white/[0.03]',
        interaction.resolved ? '' : 'bg-brand-50/30 dark:bg-brand-500/5',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-surface-100 text-surface-700 dark:bg-surface-900 dark:text-surface-200">
          <MemberSupportChannelIcon channel={interaction.channel} size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-surface-900 dark:text-white">
                  {interaction.subject || 'Solicitud de ayuda'}
                </p>
                {!interaction.resolved ? (
                  <span className="h-2.5 w-2.5 rounded-full bg-brand-500" />
                ) : null}
              </div>
              <p className="mt-1 line-clamp-2 text-sm leading-6 text-surface-600 dark:text-surface-300">
                {lastEntry?.message ||
                  'Tu gimnasio ya recibió esta solicitud y verás las respuestas aquí.'}
              </p>
            </div>
            <div className="shrink-0 text-right text-xs text-surface-500 dark:text-surface-400">
              <p>{formatRelative(lastActivityAt)}</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className={cn('badge', supportChannelBadgeColor(interaction.channel))}>
              {formatSupportChannelLabel(interaction.channel)}
            </span>
            <span className={cn('badge', interaction.resolved ? 'badge-success' : 'badge-warning')}>
              {interaction.resolved ? 'Resuelta' : 'Pendiente'}
            </span>
            <span className="badge badge-neutral">
              {traceCount || 1} {(traceCount || 1) === 1 ? 'movimiento' : 'movimientos'}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-surface-500 dark:text-surface-400">
            <span>
              {lastEntry
                ? `${lastEntry.author_name} escribió ${formatRelative(lastActivityAt)}`
                : `Enviada ${formatRelative(interaction.created_at)}`}
            </span>
            <span>
              {interaction.handler_name
                ? `La está viendo ${interaction.handler_name}`
                : 'Aún sin responsable asignado'}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

// ─── MemberSupportChannelIcon ─────────────────────────────────────────────────

export function MemberSupportChannelIcon({
  channel,
  size = 16,
}: {
  channel: SupportInteraction['channel'];
  size?: number;
}) {
  if (channel === 'whatsapp') return <WhatsAppIcon size={size} />;
  if (channel === 'email') return <Mail size={size} />;
  if (channel === 'phone') return <Phone size={size} />;
  return <MapPin size={size} />;
}

// ─── MemberPassCard ───────────────────────────────────────────────────────────

export function MemberPassCard({
  accentColor,
  secondaryColor,
  expiresAt,
  isDark,
  memberName,
  membershipStatus,
  onCopyCode,
  planName,
  qrPayload,
}: {
  accentColor: string;
  secondaryColor: string;
  expiresAt?: string;
  isDark: boolean;
  memberName: string;
  membershipStatus?: string;
  onCopyCode: () => void;
  planName: string;
  qrPayload?: string;
}) {
  const hasCode = Boolean(qrPayload);

  return (
    <div
      className="relative mt-4 overflow-hidden rounded-[1.75rem] border border-surface-200 p-5 shadow-[0_24px_80px_rgba(4,20,26,0.12)] dark:border-white/10 dark:shadow-[0_24px_80px_rgba(4,20,26,0.38)]"
      style={{
        background: isDark
          ? `radial-gradient(circle at top right, ${withAlpha(accentColor, 0.34)}, transparent 34%), radial-gradient(circle at bottom left, ${withAlpha(secondaryColor, 0.2)}, transparent 28%), linear-gradient(135deg, rgba(6,10,15,0.94), rgba(6,24,31,0.96))`
          : `radial-gradient(circle at top right, ${withAlpha(accentColor, 0.22)}, transparent 34%), radial-gradient(circle at bottom left, ${withAlpha(secondaryColor, 0.18)}, transparent 28%), linear-gradient(135deg, rgba(255,255,255,0.96), rgba(241,245,249,0.98))`,
      }}
    >
      <div className="absolute -right-10 top-0 h-40 w-40 rounded-full bg-white/40 blur-3xl dark:bg-white/5" />
      <div
        className="absolute bottom-0 left-0 h-28 w-28 rounded-full blur-3xl"
        style={{ backgroundColor: withAlpha(secondaryColor, isDark ? 0.16 : 0.14) }}
      />
      <div className="relative">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.22em] text-surface-600 dark:text-teal-100/80">
              Acceso móvil
            </p>
            <p className="mt-2 text-2xl font-bold font-display text-surface-900 dark:text-white">
              {planName}
            </p>
            <p className="mt-2 truncate text-sm text-surface-600 dark:text-surface-200">
              {memberName}
            </p>
          </div>
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-surface-200 bg-white/90 text-surface-700 dark:border-white/10 dark:bg-white/10 dark:text-teal-50">
            {hasCode ? (
              <QRCode
                value={qrPayload!}
                size={40}
                bgColor="transparent"
                fgColor={isDark ? '#ccfbf1' : '#0f172a'}
                level="M"
              />
            ) : (
              <QrCode size={22} />
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {membershipStatus ? (
            <span className={cn('badge', membershipStatusColor(membershipStatus))}>
              {formatMembershipStatusLabel(membershipStatus)}
            </span>
          ) : null}
          <span className={cn('badge', hasCode ? 'badge-success' : 'badge-neutral')}>
            {hasCode ? 'Codigo sincronizado' : 'Sin codigo'}
          </span>
          {expiresAt ? (
            <span className="badge badge-neutral">Vence {formatDate(expiresAt)}</span>
          ) : null}
        </div>

        <div className="mt-5 rounded-[1.5rem] border border-surface-200 bg-white/85 p-4 dark:border-white/10 dark:bg-surface-950/55">
          {hasCode ? (
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
              <div className="rounded-2xl bg-white p-3 shadow-lg">
                <QRCode value={qrPayload!} size={148} bgColor="#ffffff" fgColor="#0a0f14" level="M" />
              </div>
              <div className="flex-1 space-y-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-surface-500">
                    Credencial de check-in
                  </p>
                  <p className="mt-1 text-sm font-semibold text-surface-900 dark:text-surface-100">
                    Muestra este codigo al personal del gimnasio o usa el escaner en la entrada.
                  </p>
                </div>
                <p className="break-all font-mono text-[11px] leading-5 text-surface-500 dark:text-surface-400">
                  {qrPayload}
                </p>
                <button type="button" onClick={onCopyCode} className="btn-secondary">
                  Copiar codigo
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-surface-500">
                  Credencial lista para check-in
                </p>
                <p className="mt-1 text-sm font-semibold text-surface-900 dark:text-surface-100">
                  Aún no hay un código sincronizado para esta credencial.
                </p>
              </div>
              <button
                type="button"
                onClick={onCopyCode}
                disabled
                className="btn-secondary shrink-0 cursor-not-allowed opacity-50"
              >
                Copiar código
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function membershipStatusColor(status: string) {
  if (status === 'active') return 'badge-success';
  if (status === 'expired') return 'badge-danger';
  if (status === 'inactive') return 'badge-warning';
  return 'badge-neutral';
}

// ─── Skeletons ────────────────────────────────────────────────────────────────

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('animate-pulse rounded-2xl bg-surface-200/80 dark:bg-white/8', className)} />
  );
}

export function SkeletonMetricCards() {
  return (
    <section className="mt-5 grid gap-4 md:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="rounded-[1.75rem] border border-surface-200/80 bg-white/80 p-5 shadow-sm backdrop-blur-2xl dark:border-white/10 dark:bg-white/5 dark:shadow-none"
        >
          <Skeleton className="h-11 w-11 rounded-2xl" />
          <Skeleton className="mt-4 h-3 w-16" />
          <Skeleton className="mt-2 h-7 w-24" />
          <Skeleton className="mt-2 h-3 w-32" />
        </div>
      ))}
    </section>
  );
}

export function SkeletonPassCard() {
  return (
    <div className="relative mt-4 overflow-hidden rounded-[1.75rem] border border-surface-200 bg-white/80 p-5 dark:border-white/10 dark:bg-transparent">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-28" />
        </div>
        <Skeleton className="h-12 w-12 rounded-2xl" />
      </div>
      <div className="mt-4 flex gap-2">
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-5 w-28 rounded-full" />
      </div>
      <div className="mt-5 rounded-[1.5rem] border border-surface-200 bg-white/85 p-4 dark:border-white/10 dark:bg-surface-950/55">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <Skeleton className="h-[156px] w-[156px] rounded-2xl" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-9 w-32 rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function SkeletonListItems({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 rounded-2xl border border-surface-200 bg-surface-50 p-4 dark:border-white/10 dark:bg-surface-950/30"
        >
          <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-3 w-2/5" />
          </div>
          <Skeleton className="h-8 w-20 rounded-xl" />
        </div>
      ))}
    </div>
  );
}
