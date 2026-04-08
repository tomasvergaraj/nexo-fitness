import { useEffect, useMemo, useState } from 'react';
import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  CalendarDays,
  Copy,
  CreditCard,
  Download,
  ExternalLink,
  Home,
  LogOut,
  MapPin,
  Moon,
  Sun,
  Pencil,
  QrCode,
  RefreshCcw,
  ShieldCheck,
  Smartphone,
  Ticket,
  UserRound,
  Wallet,
  Wifi,
  WifiOff,
  X,
  XCircle,
} from 'lucide-react';
import QRCode from 'react-qr-code';
import toast from 'react-hot-toast';
import { SetURLSearchParams, useNavigate, useSearchParams } from 'react-router-dom';
import { browserSupportsWebPush, ensureWebPushSubscription, subscriptionToApiPayload } from '@/lib/webPush';
import { authApi, classesApi, mobileApi, notificationsApi, publicApi, reservationsApi } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { useThemeStore } from '@/stores/themeStore';
import type {
  AppNotification,
  GymClass,
  MobilePaymentHistoryItem,
  MobileWallet,
  PaginatedResponse,
  Plan,
  PushSubscriptionRecord,
  PublicCheckoutSession,
  Reservation,
  TenantPublicProfile,
  WebPushConfig,
} from '@/types';
import {
  classStatusColor,
  cn,
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_SECONDARY_COLOR,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatDurationLabel,
  formatRelative,
  membershipStatusColor,
  paymentStatusColor,
  getApiError,
  getPublicAppOrigin,
  normalizeHexColor,
  withAlpha,
} from '@/utils';

type MemberTabId = 'home' | 'agenda' | 'plans' | 'payments' | 'notifications' | 'profile';
type NotificationPermissionState = NotificationPermission | 'unsupported';
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};
type MemberSnapshot = {
  updatedAt?: string;
  wallet?: MobileWallet;
  profile?: TenantPublicProfile;
  plans?: Plan[];
  classes?: PaginatedResponse<GymClass>;
  reservations?: PaginatedResponse<Reservation>;
  payments?: MobilePaymentHistoryItem[];
  notifications?: AppNotification[];
};

const TABS: Array<{ id: MemberTabId; label: string; icon: typeof Home }> = [
  { id: 'home', label: 'Inicio', icon: Home },
  { id: 'agenda', label: 'Agenda', icon: CalendarDays },
  { id: 'plans', label: 'Planes', icon: Ticket },
  { id: 'payments', label: 'Pagos', icon: CreditCard },
  { id: 'notifications', label: 'Bandeja', icon: Bell },
  { id: 'profile', label: 'Perfil', icon: UserRound },
];

export default function MemberAppPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, logout } = useAuthStore();
  const { isDark, toggle: toggleTheme } = useThemeStore();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermissionState>('unsupported');
  const [checkoutSession, setCheckoutSession] = useState<PublicCheckoutSession | null>(null);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [profileEditForm, setProfileEditForm] = useState({ first_name: '', last_name: '', phone: '' });
  const [agendaDateFilter, setAgendaDateFilter] = useState<'all' | 'today' | 'week'>('all');
  const [agendaModalityFilter, setAgendaModalityFilter] = useState<string>('all');
  const memberSnapshot = useMemo(() => loadMemberSnapshot(user?.id), [user?.id]);
  const activeTab = getActiveTab(searchParams);

  const walletQuery = useQuery<MobileWallet>({
    queryKey: ['member-wallet'],
    queryFn: async () => (await mobileApi.wallet()).data,
    enabled: Boolean(user),
    initialData: memberSnapshot?.wallet,
    initialDataUpdatedAt: memberSnapshot?.updatedAt ? Date.parse(memberSnapshot.updatedAt) : undefined,
  });

  const tenantSlug = walletQuery.data?.tenant_slug;

  const profileQuery = useQuery<TenantPublicProfile>({
    queryKey: ['member-tenant-profile', tenantSlug],
    queryFn: async () => (await publicApi.getTenantProfile(tenantSlug!)).data,
    enabled: Boolean(tenantSlug),
    initialData: memberSnapshot?.profile,
    initialDataUpdatedAt: memberSnapshot?.updatedAt ? Date.parse(memberSnapshot.updatedAt) : undefined,
  });

  const plansQuery = useQuery<Plan[]>({
    queryKey: ['member-plans', tenantSlug],
    queryFn: async () => (await publicApi.getTenantPlans(tenantSlug!)).data,
    enabled: Boolean(tenantSlug),
    initialData: memberSnapshot?.plans,
    initialDataUpdatedAt: memberSnapshot?.updatedAt ? Date.parse(memberSnapshot.updatedAt) : undefined,
  });

  const classesQuery = useQuery<PaginatedResponse<GymClass>>({
    queryKey: ['member-classes'],
    queryFn: async () =>
      (
        await classesApi.list({
          status: 'scheduled',
          per_page: 24,
          date_from: new Date().toISOString(),
        })
      ).data,
    enabled: Boolean(user),
    initialData: memberSnapshot?.classes,
    initialDataUpdatedAt: memberSnapshot?.updatedAt ? Date.parse(memberSnapshot.updatedAt) : undefined,
  });

  const reservationsQuery = useQuery<PaginatedResponse<Reservation>>({
    queryKey: ['member-reservations'],
    queryFn: async () => (await reservationsApi.list({ upcoming_only: true, per_page: 24 })).data,
    enabled: Boolean(user),
    initialData: memberSnapshot?.reservations,
    initialDataUpdatedAt: memberSnapshot?.updatedAt ? Date.parse(memberSnapshot.updatedAt) : undefined,
  });

  const paymentsQuery = useQuery<MobilePaymentHistoryItem[]>({
    queryKey: ['member-payments'],
    queryFn: async () => (await mobileApi.listPayments({ limit: 12 })).data,
    enabled: Boolean(user),
    initialData: memberSnapshot?.payments,
    initialDataUpdatedAt: memberSnapshot?.updatedAt ? Date.parse(memberSnapshot.updatedAt) : undefined,
  });

  const notificationsQuery = useQuery<AppNotification[]>({
    queryKey: ['member-notifications'],
    queryFn: async () => (await notificationsApi.list()).data,
    enabled: Boolean(user),
    initialData: memberSnapshot?.notifications,
    initialDataUpdatedAt: memberSnapshot?.updatedAt ? Date.parse(memberSnapshot.updatedAt) : undefined,
  });

  const pushConfigQuery = useQuery<WebPushConfig>({
    queryKey: ['member-web-push-config'],
    queryFn: async () => (await mobileApi.getPushConfig()).data,
    enabled: Boolean(user),
  });

  const pushSubscriptionsQuery = useQuery<PushSubscriptionRecord[]>({
    queryKey: ['member-push-subscriptions'],
    queryFn: async () => (await mobileApi.listPushSubscriptions()).data,
    enabled: Boolean(user),
  });

  const reserveMutation = useMutation({
    mutationFn: async (gymClassId: string) => reservationsApi.create({ gym_class_id: gymClassId }),
    onSuccess: async () => {
      toast.success('Reserva creada.');
      await refreshMemberQueries(queryClient);
    },
    onError: (error: any) => toast.error(getApiError(error, 'No se pudo reservar la clase.')),
  });

  const cancelMutation = useMutation({
    mutationFn: async (reservationId: string) => reservationsApi.cancel(reservationId),
    onSuccess: async () => {
      toast.success('Reserva cancelada.');
      await refreshMemberQueries(queryClient);
    },
    onError: (error: any) => toast.error(getApiError(error, 'No se pudo cancelar la reserva.')),
  });

  const notificationMutation = useMutation({
    mutationFn: async ({ notificationId, payload }: { notificationId: string; payload: Record<string, unknown> }) =>
      notificationsApi.update(notificationId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['member-notifications'] });
    },
  });

  const checkoutMutation = useMutation({
    mutationFn: async (planId: string) => {
      if (!tenantSlug || !user) {
        throw new Error('No hay tenant listo para checkout.');
      }
      const memberUrl = `${getPublicAppOrigin()}/member`;
      const response = await publicApi.createCheckoutSession(tenantSlug, {
        plan_id: planId,
        customer_name: `${user.first_name} ${user.last_name}`.trim(),
        customer_email: user.email,
        customer_phone: user.phone || undefined,
        success_url: `${memberUrl}?tab=plans&checkout=success`,
        cancel_url: `${memberUrl}?tab=plans&checkout=cancelled`,
      });
      return response.data as PublicCheckoutSession;
    },
    onSuccess: (session) => {
      setCheckoutSession(session);
      window.location.href = session.checkout_url;
    },
    onError: (error: any) => toast.error(error?.response?.data?.detail || error?.message || 'No se pudo generar el checkout.'),
  });

  const registerPushSubscriptionMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => (await mobileApi.registerPushSubscription(payload)).data,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['member-push-subscriptions'] });
    },
  });

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
      toast.success(updatedWallet.auto_renew ? 'Renovacion automatica activada.' : 'Renovacion automatica desactivada.');
    },
    onError: (error: any) => toast.error(getApiError(error, 'No se pudo actualizar la membresia.')),
  });

  const classes = useMemo(
    () =>
      [...(classesQuery.data?.items ?? [])].sort(
        (left, right) => new Date(left.start_time).getTime() - new Date(right.start_time).getTime(),
      ),
    [classesQuery.data?.items],
  );

  const agendaModalities = useMemo(
    () => Array.from(new Set(classes.map((c) => c.modality).filter(Boolean))).sort(),
    [classes],
  );

  const filteredClasses = useMemo(() => {
    const now = new Date();
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, 23, 59, 59);
    return classes.filter((c) => {
      const start = new Date(c.start_time);
      if (agendaDateFilter === 'today' && start > todayEnd) return false;
      if (agendaDateFilter === 'week' && start > weekEnd) return false;
      if (agendaModalityFilter !== 'all' && c.modality !== agendaModalityFilter) return false;
      return true;
    });
  }, [classes, agendaDateFilter, agendaModalityFilter]);
  const reservations = reservationsQuery.data?.items ?? [];
  const payments = paymentsQuery.data ?? [];
  const notifications = notificationsQuery.data ?? [];
  const plans = plansQuery.data ?? [];
  const pushSubscriptions = pushSubscriptionsQuery.data ?? [];
  const accentColor = normalizeHexColor(profileQuery.data?.branding.primary_color, DEFAULT_PRIMARY_COLOR) ?? DEFAULT_PRIMARY_COLOR;
  const secondaryColor = normalizeHexColor(profileQuery.data?.branding.secondary_color, DEFAULT_SECONDARY_COLOR) ?? DEFAULT_SECONDARY_COLOR;
  const brandGradient = `linear-gradient(135deg, ${accentColor}, ${secondaryColor})`;
  const unreadNotifications = notifications.filter((item) => !item.is_read).length;
  const memberFullName = user ? `${user.first_name} ${user.last_name}`.trim() : 'Miembro';
  const installHint = getInstallHint({ isStandalone, canPromptInstall: Boolean(deferredPrompt) });
  const notificationPermissionMeta = getNotificationPermissionMeta(notificationPermission);
  const hasCheckinCode = Boolean(walletQuery.data?.qr_payload);
  const gymLocation = [profileQuery.data?.address, profileQuery.data?.city].filter(Boolean).join(', ');
  const webPushSupported = browserSupportsWebPush();
  const webPushConfigured = Boolean(pushConfigQuery.data?.enabled && pushConfigQuery.data?.public_vapid_key);
  const activeWebPushSubscription = pushSubscriptions.find((item) => item.provider === 'webpush' && item.is_active);
  const webPushStateLabel = activeWebPushSubscription
    ? 'Activa'
    : webPushSupported
      ? webPushConfigured
        ? 'Lista para activar'
        : 'Pendiente de backend'
      : 'No soportada';
  const lastSyncedAt = useMemo(() => {
    const timestamps = [
      walletQuery.dataUpdatedAt,
      profileQuery.dataUpdatedAt,
      plansQuery.dataUpdatedAt,
      classesQuery.dataUpdatedAt,
      reservationsQuery.dataUpdatedAt,
      paymentsQuery.dataUpdatedAt,
      notificationsQuery.dataUpdatedAt,
      pushSubscriptionsQuery.dataUpdatedAt,
    ].filter((value) => value > 0);

    if (timestamps.length) {
      return new Date(Math.max(...timestamps));
    }
    if (memberSnapshot?.updatedAt) {
      return new Date(memberSnapshot.updatedAt);
    }
    return null;
  }, [
    classesQuery.dataUpdatedAt,
    memberSnapshot?.updatedAt,
    notificationsQuery.dataUpdatedAt,
    paymentsQuery.dataUpdatedAt,
    plansQuery.dataUpdatedAt,
    profileQuery.dataUpdatedAt,
    pushSubscriptionsQuery.dataUpdatedAt,
    reservationsQuery.dataUpdatedAt,
    walletQuery.dataUpdatedAt,
  ]);
  const isSyncing = [
    walletQuery.isFetching,
    profileQuery.isFetching,
    plansQuery.isFetching,
    classesQuery.isFetching,
    reservationsQuery.isFetching,
    paymentsQuery.isFetching,
    notificationsQuery.isFetching,
    pushConfigQuery.isFetching,
    pushSubscriptionsQuery.isFetching,
  ].some(Boolean);
  const reservationByClassId = new Map(
    reservations.filter((item) => item.status !== 'cancelled').map((item) => [item.gym_class_id, item]),
  );
  const pageBackground = isDark
    ? `radial-gradient(circle at top, ${withAlpha(accentColor, 0.28)}, transparent 28%), radial-gradient(circle at 86% 12%, ${withAlpha(secondaryColor, 0.2)}, transparent 20%), linear-gradient(180deg, #04141a 0%, #08161d 48%, #04141a 100%)`
    : `radial-gradient(circle at top, ${withAlpha(accentColor, 0.18)}, transparent 28%), radial-gradient(circle at 88% 12%, ${withAlpha(secondaryColor, 0.12)}, transparent 18%), linear-gradient(180deg, #f8fafc 0%, #eef6ff 48%, #f8fafc 100%)`;

  useEffect(() => {
    const checkoutState = searchParams.get('checkout');
    if (!checkoutState) {
      return;
    }
    toast(checkoutState === 'success' ? 'Volviste desde checkout con pago confirmado.' : 'Volviste desde checkout sin completar el pago.');
    const next = new URLSearchParams(searchParams);
    next.delete('checkout');
    setSearchParams(next, { replace: true });
    void refreshMemberQueries(queryClient);
  }, [queryClient, searchParams, setSearchParams]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    setNotificationPermission('Notification' in window ? Notification.permission : 'unsupported');
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(display-mode: standalone)');
    const syncStandalone = () => {
      const iosStandalone = Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
      setIsStandalone(media.matches || iosStandalone);
    };
    syncStandalone();
    media.addEventListener('change', syncStandalone);

    const handlePrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
      toast.success('La app quedo instalada.');
    };

    window.addEventListener('beforeinstallprompt', handlePrompt);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      media.removeEventListener('change', syncStandalone);
      window.removeEventListener('beforeinstallprompt', handlePrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  useEffect(() => {
    if (!user) {
      return;
    }
    const nextSnapshot: Partial<MemberSnapshot> = {};
    if (walletQuery.data) nextSnapshot.wallet = walletQuery.data;
    if (profileQuery.data) nextSnapshot.profile = profileQuery.data;
    if (plansQuery.data) nextSnapshot.plans = plansQuery.data;
    if (classesQuery.data) nextSnapshot.classes = classesQuery.data;
    if (reservationsQuery.data) nextSnapshot.reservations = reservationsQuery.data;
    if (paymentsQuery.data) nextSnapshot.payments = paymentsQuery.data;
    if (notificationsQuery.data) nextSnapshot.notifications = notificationsQuery.data;

    if (Object.keys(nextSnapshot).length) {
      saveMemberSnapshot(user.id, nextSnapshot, lastSyncedAt?.toISOString());
    }
  }, [
    classesQuery.data,
    lastSyncedAt,
    notificationsQuery.data,
    paymentsQuery.data,
    plansQuery.data,
    profileQuery.data,
    reservationsQuery.data,
    user,
    walletQuery.data,
  ]);

  if (!user) {
    return null;
  }

  const openNotificationAction = async (notification: AppNotification) => {
    await notificationMutation.mutateAsync({
      notificationId: notification.id,
      payload: { is_read: true, mark_opened: true, mark_clicked: true },
    });
    const nextTab = getTabFromAction(notification.action_url);
    if (nextTab) {
      setTab(searchParams, setSearchParams, nextTab);
      return;
    }
    if (notification.action_url?.startsWith('http')) {
      window.open(notification.action_url, '_blank', 'noopener,noreferrer');
    }
  };

  const installApp = async () => {
    if (!deferredPrompt) {
      toast('Usa el menu del navegador para agregar esta app a tu pantalla de inicio.');
      return;
    }
    await deferredPrompt.prompt();
    setDeferredPrompt(null);
  };

  const enableWebPush = async () => {
    if (!webPushSupported) {
      toast.error('Este navegador no soporta Web Push.');
      return;
    }
    if (!isOnline) {
      toast('Necesitas conexion para registrar esta suscripcion web.');
      return;
    }
    const publicKey = pushConfigQuery.data?.public_vapid_key;
    if (!pushConfigQuery.data?.enabled || !publicKey) {
      toast.error('Web Push aun no esta configurado en backend.');
      return;
    }

    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
      setNotificationPermission(permission);
    }
    if (permission !== 'granted') {
      toast.error('Debes permitir las notificaciones para activar Web Push.');
      return;
    }

    try {
      const subscription = await ensureWebPushSubscription(publicKey);
      await registerPushSubscriptionMutation.mutateAsync(subscriptionToApiPayload(subscription));
      toast.success('Notificaciones web remotas activadas para este dispositivo.');
    } catch (error: any) {
      toast.error(error?.message || 'No se pudo registrar la suscripcion Web Push.');
    }
  };

  const syncMemberData = async () => {
    if (!isOnline) {
      toast('Sin conexion. Mostrando la ultima informacion guardada en este dispositivo.');
      return;
    }
    await refreshMemberQueries(queryClient);
    toast.success('Datos del miembro sincronizados.');
  };

  const copyCheckinCode = async () => {
    const code = walletQuery.data?.qr_payload;
    if (!code) {
      toast.error('Todavia no hay codigo de acceso sincronizado.');
      return;
    }
    if (!navigator.clipboard?.writeText) {
      toast.error('Este navegador no permite copiar automaticamente.');
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      toast.success('Codigo de check-in copiado.');
    } catch {
      toast.error('No se pudo copiar el codigo.');
    }
  };

  const logoutMember = async () => {
    try {
      await authApi.logout();
    } catch {
      // Ignore transport errors on logout.
    }
    if (user) {
      clearMemberSnapshot(user.id);
    }
    logout();
    navigate('/login');
  };

  return (
    <div
      className="min-h-screen text-surface-900 transition-colors dark:text-white"
      style={{ background: pageBackground }}
    >
      <div
        className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8"
        style={{
          paddingTop: 'max(1.25rem, env(safe-area-inset-top))',
          // pb-28 (7rem) + safe-area-inset-bottom para no quedar oculto bajo la barra fija en iOS
          paddingBottom: 'calc(7rem + env(safe-area-inset-bottom, 0px))',
        }}
      >
        {!isOnline ? (
          <section className="mb-5 rounded-[1.5rem] border border-amber-200 bg-amber-50 px-4 py-4 text-amber-900 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-50/90">
            <div className="flex items-start gap-3">
              <WifiOff size={18} className="mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold">Estas sin conexion.</p>
                <p className="mt-1 text-sm leading-6">
                  La app mostrara el ultimo snapshot guardado
                  {lastSyncedAt ? ` (${formatRelative(lastSyncedAt)}).` : '.'}
                </p>
              </div>
            </div>
          </section>
        ) : null}

        <section className="rounded-[2rem] border border-surface-200/80 bg-white/80 p-5 shadow-[0_24px_80px_-50px_rgba(15,23,42,0.35)] backdrop-blur-2xl dark:border-white/10 dark:bg-white/5 dark:shadow-none sm:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-surface-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-surface-600 dark:border-white/10 dark:bg-white/5 dark:text-teal-100/85">
                <Smartphone size={14} />
                Member PWA
              </div>
              <h1 className="mt-4 text-3xl font-bold font-display text-surface-900 dark:text-white sm:text-4xl">
                {profileQuery.data?.tenant_name || walletQuery.data?.tenant_name || 'Nexo Fitness'}
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-surface-600 dark:text-surface-300">
                Wallet, agenda, pagos y bandeja del miembro sobre una app web instalable, con modo claro por defecto y opcion de tema oscuro.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="badge badge-neutral">{memberFullName}</span>
                {walletQuery.data?.membership_status ? (
                  <span className={cn('badge', membershipStatusColor(walletQuery.data.membership_status))}>
                    {walletQuery.data.membership_status}
                  </span>
                ) : null}
                {walletQuery.data?.expires_at ? (
                  <span className="badge badge-neutral">Vence {formatDate(walletQuery.data.expires_at)}</span>
                ) : null}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:w-[420px]">
              <button type="button" onClick={installApp} className="btn-primary" style={{ backgroundImage: brandGradient }}>
                <Download size={16} />
                {isStandalone ? 'Instalada' : 'Instalar app'}
              </button>
              <button type="button" onClick={toggleTheme} className="btn-secondary">
                {isDark ? <Sun size={16} /> : <Moon size={16} />}
                {isDark ? 'Modo claro' : 'Modo oscuro'}
              </button>
              <button type="button" onClick={() => void enableWebPush()} className="btn-secondary" disabled={registerPushSubscriptionMutation.isPending || !webPushSupported}>
                <Bell size={16} />
                {activeWebPushSubscription ? 'Avisos activos' : registerPushSubscriptionMutation.isPending ? 'Activando' : 'Activar avisos'}
              </button>
              <button type="button" onClick={() => void syncMemberData()} className="btn-secondary" disabled={isSyncing}>
                <RefreshCcw size={16} className={cn(isSyncing && 'animate-spin')} />
                {isSyncing ? 'Sincronizando' : 'Actualizar datos'}
              </button>
              <button type="button" onClick={logoutMember} className="btn-secondary">
                <LogOut size={16} />
                Cerrar sesion
              </button>
            </div>
          </div>
        </section>

        {walletQuery.isLoading && !walletQuery.data ? (
          <SkeletonMetricCards />
        ) : (
          <section className="mt-5 grid gap-4 md:grid-cols-3">
            <MetricCard icon={Wallet} label="Plan" value={walletQuery.data?.plan_name || 'Sin plan'} caption={walletQuery.data?.membership_status || 'Membresia pendiente'} accentColor={accentColor} secondaryColor={secondaryColor} />
            <MetricCard icon={CalendarDays} label="Reservas" value={String(reservations.length)} caption={walletQuery.data?.next_class?.start_time ? formatDateTime(walletQuery.data.next_class.start_time) : 'Sin proxima clase'} accentColor={accentColor} secondaryColor={secondaryColor} />
            <MetricCard icon={Bell} label="Sin leer" value={String(unreadNotifications)} caption={notificationPermissionMeta.label} accentColor={accentColor} secondaryColor={secondaryColor} />
          </section>
        )}

        <section className="mt-5 rounded-[2rem] border border-surface-200/80 bg-white/80 p-5 shadow-[0_24px_80px_-50px_rgba(15,23,42,0.25)] backdrop-blur-2xl dark:border-white/10 dark:bg-white/5 dark:shadow-none">
          {activeTab === 'home' ? (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
              <Panel title="Pase digital">
                <p className="text-sm leading-6 text-surface-600 dark:text-surface-300">
                  Tu acceso, estado de membresia y codigo de respaldo viven ahora en una sola vista optimizada para el telefono.
                </p>
                {walletQuery.isLoading && !walletQuery.data ? (
                  <SkeletonPassCard />
                ) : (
                  <>
                    <MemberPassCard
                      accentColor={accentColor}
                      secondaryColor={secondaryColor}
                      isDark={isDark}
                      expiresAt={walletQuery.data?.expires_at}
                      memberName={memberFullName}
                      membershipStatus={walletQuery.data?.membership_status}
                      planName={walletQuery.data?.plan_name || 'Sin plan activo'}
                      qrPayload={walletQuery.data?.qr_payload}
                      onCopyCode={() => void copyCheckinCode()}
                    />
                    {(walletQuery.data?.membership_status === 'expired' || walletQuery.data?.membership_status === 'inactive' || (!walletQuery.data?.membership_status && !walletQuery.isLoading)) ? (
                      <div className="mt-4 rounded-[1.5rem] border border-amber-400/20 bg-amber-500/10 px-4 py-4">
                        <p className="text-sm font-semibold text-amber-100">
                          {walletQuery.data?.membership_status === 'expired' ? 'Tu membresia vencio.' : 'No tienes una membresia activa.'}
                        </p>
                        <p className="mt-1 text-sm leading-6 text-amber-50/75">Renueva o adquiere un plan para seguir disfrutando del gimnasio.</p>
                        <button
                          type="button"
                          className="btn-primary mt-3"
                          style={{ backgroundImage: brandGradient }}
                          onClick={() => setTab(searchParams, setSearchParams, 'plans')}
                        >
                          <Ticket size={16} />
                          Ver planes
                        </button>
                      </div>
                    ) : null}
                  </>
                )}
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <QuickActionCard
                    icon={CalendarDays}
                    title="Agenda"
                    description={reservations.length ? `${reservations.length} reservas activas` : 'Ver clases y reservar'}
                    accentColor={accentColor}
                    secondaryColor={secondaryColor}
                    onClick={() => setTab(searchParams, setSearchParams, 'agenda')}
                  />
                  <QuickActionCard
                    icon={Ticket}
                    title="Planes"
                    description={plans.length ? `${plans.length} opciones disponibles` : 'Revisa tu plan actual'}
                    accentColor={accentColor}
                    secondaryColor={secondaryColor}
                    onClick={() => setTab(searchParams, setSearchParams, 'plans')}
                  />
                  <QuickActionCard
                    icon={CreditCard}
                    title="Pagos"
                    description={payments.length ? `${payments.length} movimientos recientes` : 'Historial y comprobantes'}
                    accentColor={accentColor}
                    secondaryColor={secondaryColor}
                    onClick={() => setTab(searchParams, setSearchParams, 'payments')}
                  />
                  <QuickActionCard
                    icon={Bell}
                    title="Bandeja"
                    description={unreadNotifications ? `${unreadNotifications} notificaciones nuevas` : 'Sin pendientes por leer'}
                    accentColor={accentColor}
                    secondaryColor={secondaryColor}
                    onClick={() => setTab(searchParams, setSearchParams, 'notifications')}
                  />
                  <QuickActionCard
                    icon={UserRound}
                    title="Perfil"
                    description="Datos de cuenta, estado del dispositivo y ajustes rapidos"
                    accentColor={accentColor}
                    secondaryColor={secondaryColor}
                    onClick={() => setTab(searchParams, setSearchParams, 'profile')}
                  />
                </div>
              </Panel>
              <div className="space-y-4">
                <Panel title="Proxima actividad">
                  {walletQuery.data?.next_class ? (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="badge badge-info">{walletQuery.data.next_class.modality}</span>
                        <span className="badge badge-neutral">{formatRelative(walletQuery.data.next_class.start_time)}</span>
                    </div>
                    <p className="mt-4 text-xl font-semibold">{walletQuery.data.next_class.name}</p>
                    <p className="mt-2 text-sm text-surface-600 dark:text-surface-300">
                      {formatDateTime(walletQuery.data.next_class.start_time)} | {walletQuery.data.next_class.modality}
                    </p>
                    {gymLocation ? (
                      <div className="mt-4 flex items-start gap-3 rounded-2xl border border-surface-200 bg-surface-50 px-4 py-3 dark:border-white/10 dark:bg-surface-950/40">
                        <MapPin size={18} className="mt-0.5" style={{ color: accentColor }} />
                        <p className="text-sm leading-6 text-surface-600 dark:text-surface-300">{gymLocation}</p>
                      </div>
                    ) : null}
                    <button type="button" className="btn-primary mt-4" style={{ backgroundImage: brandGradient }} onClick={() => setTab(searchParams, setSearchParams, 'agenda')}>
                      <CalendarDays size={16} />
                      Abrir agenda
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-sm leading-6 text-surface-600 dark:text-surface-300">Todavia no hay una clase proxima vinculada.</p>
                    <button type="button" className="btn-secondary mt-4" onClick={() => setTab(searchParams, setSearchParams, 'agenda')}>
                      <CalendarDays size={16} />
                      Explorar clases
                    </button>
                  </>
                )}
                </Panel>

                <Panel title="Tu dispositivo">
                  <div className="space-y-3">
                    <DeviceStatusItem label="Conexion" value={isOnline ? 'En linea' : 'Sin conexion'} tone={isOnline ? 'success' : 'warning'} />
                    <DeviceStatusItem label="App" value={isStandalone ? 'Instalada' : 'Modo navegador'} tone={isStandalone ? 'success' : 'neutral'} />
                    <DeviceStatusItem label="Avisos" value={notificationPermissionMeta.label} tone={notificationPermissionMeta.tone} />
                    <DeviceStatusItem label="Codigo QR" value={hasCheckinCode ? 'Disponible' : 'Sincroniza para obtenerlo'} tone={hasCheckinCode ? 'success' : 'warning'} />
                  </div>
                  <div className="mt-4 rounded-2xl border border-surface-200 bg-surface-50 px-4 py-4 dark:border-white/10 dark:bg-surface-950/40">
                    <div className="flex items-start gap-3">
                      {isOnline ? <Wifi size={18} className="mt-0.5" style={{ color: accentColor }} /> : <ShieldCheck size={18} className="mt-0.5" style={{ color: accentColor }} />}
                      <p className="text-sm leading-6 text-surface-600 dark:text-surface-300">{installHint}</p>
                    </div>
                  </div>
                </Panel>
              </div>
            </div>
          ) : null}

          {activeTab === 'agenda' ? (
            <div className="space-y-4">
              {classesQuery.isLoading && !classesQuery.data ? <SkeletonListItems count={4} /> : null}
              <div className="flex flex-wrap gap-2">
                {(['all', 'today', 'week'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setAgendaDateFilter(f)}
                    style={agendaDateFilter === f ? { borderColor: `${accentColor}88`, background: `linear-gradient(135deg, ${withAlpha(accentColor, isDark ? 0.28 : 0.18)}, ${withAlpha(secondaryColor, isDark ? 0.22 : 0.12)})`, color: isDark ? '#e6fffb' : '#0f172a' } : undefined}
                    className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors', agendaDateFilter === f ? '' : 'border-surface-200 bg-white text-surface-500 hover:text-surface-900 dark:border-white/10 dark:bg-white/5 dark:text-surface-400 dark:hover:text-white')}
                  >
                    {f === 'all' ? 'Todas' : f === 'today' ? 'Hoy' : 'Esta semana'}
                  </button>
                ))}
                {agendaModalities.length > 1 ? (
                  <>
                    <span className="self-center text-surface-600">|</span>
                    <button
                      type="button"
                      onClick={() => setAgendaModalityFilter('all')}
                      style={agendaModalityFilter === 'all' ? { borderColor: `${accentColor}88`, background: `linear-gradient(135deg, ${withAlpha(accentColor, isDark ? 0.28 : 0.18)}, ${withAlpha(secondaryColor, isDark ? 0.22 : 0.12)})`, color: isDark ? '#e6fffb' : '#0f172a' } : undefined}
                      className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors', agendaModalityFilter === 'all' ? '' : 'border-surface-200 bg-white text-surface-500 hover:text-surface-900 dark:border-white/10 dark:bg-white/5 dark:text-surface-400 dark:hover:text-white')}
                    >
                      Todas las modalidades
                    </button>
                    {agendaModalities.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setAgendaModalityFilter(m)}
                        style={agendaModalityFilter === m ? { borderColor: `${accentColor}88`, background: `linear-gradient(135deg, ${withAlpha(accentColor, isDark ? 0.28 : 0.18)}, ${withAlpha(secondaryColor, isDark ? 0.22 : 0.12)})`, color: isDark ? '#e6fffb' : '#0f172a' } : undefined}
                        className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors', agendaModalityFilter === m ? '' : 'border-surface-200 bg-white text-surface-500 hover:text-surface-900 dark:border-white/10 dark:bg-white/5 dark:text-surface-400 dark:hover:text-white')}
                      >
                        {m}
                      </button>
                    ))}
                  </>
                ) : null}
              </div>
              {filteredClasses.length ? filteredClasses.map((gymClass) => {
                const reservation = reservationByClassId.get(gymClass.id);
                return (
                  <Panel key={gymClass.id} title={gymClass.name}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn('badge', classStatusColor(gymClass.status))}>{gymClass.status}</span>
                      {reservation ? <span className="badge badge-success">{reservation.status === 'waitlisted' ? 'Lista de espera' : 'Reservada'}</span> : null}
                    </div>
                    <p className="mt-3 text-sm text-surface-600 dark:text-surface-300">
                      {formatDateTime(gymClass.start_time)} | {gymClass.modality} | Cupos {gymClass.current_bookings}/{gymClass.max_capacity}
                    </p>
                    <div className="mt-4">
                      <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-surface-500">
                        <span>Ocupacion</span>
                        <span>{Math.min(100, Math.round((gymClass.current_bookings / Math.max(gymClass.max_capacity, 1)) * 100))}%</span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-200 dark:bg-white/5">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min(100, Math.round((gymClass.current_bookings / Math.max(gymClass.max_capacity, 1)) * 100))}%`,
                            background: `linear-gradient(90deg, ${accentColor}, ${secondaryColor})`,
                          }}
                        />
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-3">
                      {gymClass.online_link ? <a href={gymClass.online_link} target="_blank" rel="noreferrer" className="btn-secondary"><ExternalLink size={16} />Abrir link</a> : null}
                      {reservation ? (
                        <button type="button" className="btn-danger" onClick={() => cancelMutation.mutate(reservation.id)}>
                          <XCircle size={16} />
                          Cancelar
                        </button>
                      ) : (
                        <button type="button" className="btn-primary" style={{ backgroundImage: brandGradient }} onClick={() => reserveMutation.mutate(gymClass.id)}>
                          <CalendarDays size={16} />
                          Reservar
                        </button>
                      )}
                    </div>
                  </Panel>
                );
              }) : (
                <EmptyState
                  title={agendaDateFilter !== 'all' || agendaModalityFilter !== 'all' ? 'Sin clases con ese filtro' : 'Todavia no hay clases visibles'}
                  description={agendaDateFilter !== 'all' || agendaModalityFilter !== 'all' ? 'Prueba cambiando el filtro de fecha o modalidad.' : 'La agenda quedara lista apenas el backend tenga clases programadas.'}
                />
              )}
            </div>
          ) : null}

          {activeTab === 'plans' ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {plans.length ? plans.map((plan) => (
                <Panel key={plan.id} title={plan.name}>
                  <p className="text-3xl font-bold font-display">{formatCurrency(plan.price, plan.currency)}</p>
                  <p className="mt-2 text-sm text-surface-600 dark:text-surface-300">{plan.description || 'Plan activo del gimnasio.'}</p>
                  <p className="mt-3 text-xs uppercase tracking-[0.18em] text-surface-400">{formatDurationLabel(plan.duration_type, plan.duration_days)}</p>
                  <button type="button" className="btn-primary mt-4 w-full" style={{ backgroundImage: brandGradient }} onClick={() => checkoutMutation.mutate(plan.id)}>
                    <CreditCard size={16} />
                    {walletQuery.data?.plan_id === plan.id ? 'Renovar este plan' : 'Comprar este plan'}
                  </button>
                </Panel>
              )) : <div className="lg:col-span-2"><EmptyState title="Sin planes publicados" description="La PWA podra vender en cuanto el storefront tenga planes activos." /></div>}
              {checkoutSession ? (
                <div className="lg:col-span-2 rounded-[1.5rem] border border-emerald-200 bg-emerald-50 p-5 text-emerald-900 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-100">
                  <p className="text-sm">Sesion generada: {checkoutSession.session_reference}</p>
                  <a href={checkoutSession.checkout_url} target="_blank" rel="noreferrer" className="btn-primary mt-4" style={{ backgroundImage: 'linear-gradient(135deg, #10b981, #0f766e)' }}>
                    <ExternalLink size={16} />
                    Abrir checkout
                  </a>
                </div>
              ) : null}
            </div>
          ) : null}

          {activeTab === 'payments' ? (
            <div className="space-y-4">
              {paymentsQuery.isLoading && !paymentsQuery.data ? <SkeletonListItems count={3} /> : null}
              {payments.length ? payments.map((payment) => (
                <Panel key={payment.id} title={payment.plan_name || payment.description || 'Pago del miembro'}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn('badge', paymentStatusColor(payment.status))}>{payment.status}</span>
                    <span className="badge badge-neutral">{payment.method}</span>
                  </div>
                  <p className="mt-3 text-2xl font-bold font-display">{formatCurrency(payment.amount, payment.currency)}</p>
                  <p className="mt-2 text-sm text-surface-600 dark:text-surface-300">
                    {payment.paid_at ? `Pagado ${formatDateTime(payment.paid_at)}` : `Creado ${formatDateTime(payment.created_at)}`}
                  </p>
                  {payment.receipt_url ? <a href={payment.receipt_url} target="_blank" rel="noreferrer" className="btn-secondary mt-4"><ExternalLink size={16} />Ver comprobante</a> : null}
                </Panel>
              )) : <EmptyState title="Aun no hay pagos" description="El historial aparecera aqui apenas existan pagos para este miembro." />}
            </div>
          ) : null}

          {activeTab === 'profile' ? (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
              <div className="space-y-4">
                <Panel title="Perfil del miembro">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-center gap-4">
                      <div
                        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[1.25rem] text-white"
                        style={{ background: brandGradient }}
                      >
                        <UserRound size={24} />
                      </div>
                      <div>
                        <p className="text-xl font-semibold text-surface-900 dark:text-white">{memberFullName}</p>
                        <p className="mt-1 text-sm text-surface-600 dark:text-surface-300">{user.email}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className="badge badge-neutral">Rol {user.role}</span>
                      <span className={cn('badge', user.is_verified ? 'badge-success' : 'badge-warning')}>
                        {user.is_verified ? 'Cuenta verificada' : 'Verificacion pendiente'}
                      </span>
                    </div>
                  </div>

                  {isEditingProfile ? (
                    <div className="mt-5 space-y-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1.5 block text-xs uppercase tracking-[0.18em] text-surface-400">Nombre</label>
                          <input
                            className="w-full rounded-2xl border border-surface-200 bg-white px-4 py-3 text-sm text-surface-900 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 dark:border-white/10 dark:bg-surface-950/50 dark:text-white dark:placeholder-surface-500"
                            value={profileEditForm.first_name}
                            onChange={(e) => setProfileEditForm((f) => ({ ...f, first_name: e.target.value }))}
                            placeholder={user.first_name}
                          />
                        </div>
                        <div>
                          <label className="mb-1.5 block text-xs uppercase tracking-[0.18em] text-surface-400">Apellido</label>
                          <input
                            className="w-full rounded-2xl border border-surface-200 bg-white px-4 py-3 text-sm text-surface-900 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 dark:border-white/10 dark:bg-surface-950/50 dark:text-white dark:placeholder-surface-500"
                            value={profileEditForm.last_name}
                            onChange={(e) => setProfileEditForm((f) => ({ ...f, last_name: e.target.value }))}
                            placeholder={user.last_name}
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="mb-1.5 block text-xs uppercase tracking-[0.18em] text-surface-400">Telefono</label>
                          <input
                            className="w-full rounded-2xl border border-surface-200 bg-white px-4 py-3 text-sm text-surface-900 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 dark:border-white/10 dark:bg-surface-950/50 dark:text-white dark:placeholder-surface-500"
                            value={profileEditForm.phone}
                            onChange={(e) => setProfileEditForm((f) => ({ ...f, phone: e.target.value }))}
                            placeholder={user.phone || '+56 9 ...'}
                          />
                        </div>
                      </div>
                      <div className="flex gap-3">
                        <button
                          type="button"
                          className="btn-primary"
                          style={{ backgroundImage: brandGradient }}
                          disabled={updateProfileMutation.isPending}
                          onClick={() => {
                            const payload: { first_name?: string; last_name?: string; phone?: string } = {};
                            if (profileEditForm.first_name.trim()) payload.first_name = profileEditForm.first_name.trim();
                            if (profileEditForm.last_name.trim()) payload.last_name = profileEditForm.last_name.trim();
                            if (profileEditForm.phone.trim() !== (user.phone ?? '')) payload.phone = profileEditForm.phone.trim() || undefined;
                            if (Object.keys(payload).length === 0) { setIsEditingProfile(false); return; }
                            updateProfileMutation.mutate(payload);
                          }}
                        >
                          {updateProfileMutation.isPending ? 'Guardando...' : 'Guardar cambios'}
                        </button>
                        <button type="button" className="btn-secondary" onClick={() => setIsEditingProfile(false)}>
                          <X size={16} />
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-5 space-y-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <ProfileDetailItem label="Telefono" value={user.phone || 'No informado'} />
                        <ProfileDetailItem label="Alta" value={formatDate(user.created_at)} />
                        <ProfileDetailItem
                          label="Ultimo acceso"
                          value={user.last_login_at ? formatRelative(user.last_login_at) : 'Sin registro aun'}
                        />
                        <ProfileDetailItem label="Tenant" value={walletQuery.data?.tenant_name || 'Sin tenant cargado'} />
                      </div>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => {
                          setProfileEditForm({ first_name: user.first_name, last_name: user.last_name, phone: user.phone ?? '' });
                          setIsEditingProfile(true);
                        }}
                      >
                        <Pencil size={16} />
                        Editar perfil
                      </button>
                    </div>
                  )}
                </Panel>

                <Panel title="Membresia y actividad">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <ProfileDetailItem label="Plan activo" value={walletQuery.data?.plan_name || 'Sin plan'} />
                    <ProfileDetailItem
                      label="Estado"
                      value={walletQuery.data?.membership_status || 'Pendiente'}
                    />
                    <ProfileDetailItem
                      label="Vencimiento"
                      value={walletQuery.data?.expires_at ? formatDate(walletQuery.data.expires_at) : 'No informado'}
                    />
                    <div className="rounded-2xl border border-surface-200 bg-surface-50 px-4 py-3 dark:border-white/10 dark:bg-surface-950/35">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-surface-500">Renovacion</p>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-surface-900 dark:text-white">
                          {walletQuery.data?.auto_renew ? 'Automatica' : 'Manual'}
                        </p>
                        {walletQuery.data?.membership_id ? (
                          <button
                            type="button"
                            disabled={toggleAutoRenewMutation.isPending}
                            onClick={() => toggleAutoRenewMutation.mutate(!walletQuery.data?.auto_renew)}
                            className={cn(
                              'relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-50',
                              walletQuery.data?.auto_renew ? '' : 'bg-surface-200 dark:bg-white/10',
                            )}
                            style={walletQuery.data?.auto_renew ? { backgroundColor: accentColor } : undefined}
                          >
                            <span
                              className={cn(
                                'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200',
                                walletQuery.data?.auto_renew ? 'translate-x-5' : 'translate-x-0.5',
                              )}
                            />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-3">
                    <DeviceStatusItem
                      label="Reservas activas"
                      value={String(reservations.length)}
                      tone={reservations.length ? 'success' : 'neutral'}
                    />
                    <DeviceStatusItem
                      label="Pagos visibles"
                      value={String(payments.length)}
                      tone={payments.length ? 'info' : 'neutral'}
                    />
                    <DeviceStatusItem
                      label="Sin leer"
                      value={String(unreadNotifications)}
                      tone={unreadNotifications ? 'warning' : 'success'}
                    />
                  </div>

                  <div className="mt-5 rounded-[1.35rem] border border-surface-200 bg-surface-50 p-4 dark:border-white/10 dark:bg-surface-950/35">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-surface-500">Proxima actividad</p>
                    <p className="mt-2 text-sm leading-6 text-surface-600 dark:text-surface-300">
                      {walletQuery.data?.next_class
                        ? `${walletQuery.data.next_class.name} · ${formatDateTime(walletQuery.data.next_class.start_time)}`
                        : 'Todavia no hay una proxima clase vinculada a esta cuenta.'}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setTab(searchParams, setSearchParams, 'agenda')}
                      >
                        <CalendarDays size={16} />
                        Abrir agenda
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setTab(searchParams, setSearchParams, 'plans')}
                      >
                        <Ticket size={16} />
                        Ver planes
                      </button>
                    </div>
                  </div>
                </Panel>
              </div>

              <div className="space-y-4">
                <Panel title="Ajustes">
                  <div className="mt-2 grid gap-3">
                    <button
                      type="button"
                      onClick={installApp}
                      className="btn-primary"
                      style={{ backgroundImage: brandGradient }}
                    >
                      <Download size={16} />
                      {isStandalone ? 'App instalada' : 'Instalar app'}
                    </button>
                    <button type="button" onClick={toggleTheme} className="btn-secondary">
                      {isDark ? <Sun size={16} /> : <Moon size={16} />}
                      {isDark ? 'Cambiar a claro' : 'Cambiar a oscuro'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void enableWebPush()}
                      className="btn-secondary"
                      disabled={registerPushSubscriptionMutation.isPending || !webPushSupported}
                    >
                      <Bell size={16} />
                      {activeWebPushSubscription
                        ? 'Avisos activos'
                        : registerPushSubscriptionMutation.isPending
                          ? 'Activando'
                          : 'Activar avisos'}
                    </button>
                    <button type="button" onClick={() => void syncMemberData()} className="btn-secondary" disabled={isSyncing}>
                      <RefreshCcw size={16} className={cn(isSyncing && 'animate-spin')} />
                      {isSyncing ? 'Actualizando' : 'Actualizar datos'}
                    </button>
                    <button type="button" onClick={logoutMember} className="btn-secondary">
                      <LogOut size={16} />
                      Cerrar sesion
                    </button>
                  </div>
                </Panel>

                <Panel title="Estado del dispositivo">
                  <div className="space-y-3">
                    <DeviceStatusItem label="Instalacion" value={isStandalone ? 'PWA instalada' : 'Modo navegador'} tone={isStandalone ? 'success' : 'neutral'} />
                    <DeviceStatusItem label="Conexion" value={isOnline ? 'En linea' : 'Offline'} tone={isOnline ? 'success' : 'warning'} />
                    <DeviceStatusItem label="Avisos" value={notificationPermissionMeta.label} tone={notificationPermissionMeta.tone} />
                    <DeviceStatusItem label="Push web" value={webPushStateLabel} tone={activeWebPushSubscription ? 'success' : webPushConfigured ? 'info' : 'warning'} />
                    <DeviceStatusItem label="Ultima actualizacion" value={lastSyncedAt ? formatRelative(lastSyncedAt) : 'Sin datos aun'} tone={lastSyncedAt ? 'info' : 'neutral'} />
                  </div>

                  <div className="mt-4 rounded-[1.35rem] border border-surface-200 bg-surface-50 p-4 dark:border-white/10 dark:bg-surface-950/35">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-surface-500">Soporte del gimnasio</p>
                    <p className="mt-2 text-sm leading-6 text-surface-600 dark:text-surface-300">
                      {profileQuery.data?.email || profileQuery.data?.phone
                        ? [profileQuery.data?.email, profileQuery.data?.phone].filter(Boolean).join(' · ')
                        : 'Contacta a tu gimnasio directamente para consultas.'}
                    </p>
                    {gymLocation ? (
                      <p className="mt-2 text-sm leading-6 text-surface-500 dark:text-surface-400">{gymLocation}</p>
                    ) : null}
                  </div>
                </Panel>
              </div>
            </div>
          ) : null}

          {activeTab === 'notifications' ? (
            <div className="space-y-4">
              {notifications.length ? notifications.map((notification) => (
                <Panel key={notification.id} title={notification.title}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn('badge', notification.is_read ? 'badge-neutral' : 'badge-info')}>
                      {notification.is_read ? 'Leida' : 'Nueva'}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-surface-600 dark:text-surface-300">
                    {notification.message || 'Notificacion sin mensaje adicional.'}
                  </p>
                  <p className="mt-2 text-xs text-surface-400">
                    {formatRelative(notification.created_at)}
                    {notification.opened_at ? ` | Apertura ${formatRelative(notification.opened_at)}` : ''}
                    {notification.clicked_at ? ` | Click ${formatRelative(notification.clicked_at)}` : ''}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    {notification.action_url ? <button type="button" className="btn-primary" style={{ backgroundImage: brandGradient }} onClick={() => void openNotificationAction(notification)}><ExternalLink size={16} />Abrir accion</button> : null}
                    <button type="button" className="btn-secondary" onClick={() => notificationMutation.mutate({ notificationId: notification.id, payload: { is_read: !notification.is_read, mark_opened: !notification.is_read } })}>
                      {notification.is_read ? 'Marcar no leida' : 'Marcar leida'}
                    </button>
                  </div>
                </Panel>
              )) : <EmptyState title="Bandeja vacia" description="Las notificaciones del miembro apareceran aqui con sus acciones correspondientes." />}
            </div>
          ) : null}
        </section>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-surface-200/80 bg-white/92 px-3 pt-3 shadow-[0_-10px_30px_rgba(15,23,42,0.08)] backdrop-blur-2xl dark:border-white/10 dark:bg-surface-950/90 dark:shadow-none" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <div className="mx-auto grid max-w-5xl grid-cols-6 gap-2">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.id === activeTab;
            return (
              <button key={tab.id} type="button" onClick={() => setTab(searchParams, setSearchParams, tab.id)} style={isActive ? { backgroundImage: `linear-gradient(135deg, ${withAlpha(accentColor, isDark ? 0.22 : 0.18)}, ${withAlpha(secondaryColor, isDark ? 0.18 : 0.1)})`, borderColor: `${accentColor}55` } : undefined} className={cn('flex flex-col items-center gap-1 rounded-2xl border px-2 py-3 text-[11px] font-semibold transition-all', isActive ? 'border-surface-200 text-surface-900 dark:border-white/10 dark:text-white' : 'border-transparent bg-surface-100/60 text-surface-500 hover:bg-white hover:text-surface-900 dark:bg-white/[0.04] dark:text-surface-400 dark:hover:bg-white/[0.08] dark:hover:text-white')}>
                <span className="relative">
                  <Icon size={18} />
                  {tab.id === 'notifications' && unreadNotifications ? (
                    <span className="absolute -right-3 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-400 px-1 text-[10px] font-bold text-surface-950">
                      {unreadNotifications > 9 ? '9+' : unreadNotifications}
                    </span>
                  ) : null}
                </span>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

function ProfileDetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-surface-200 bg-surface-50 px-4 py-3 dark:border-white/10 dark:bg-surface-950/35">
      <p className="text-[11px] uppercase tracking-[0.18em] text-surface-500">{label}</p>
      <p className="mt-2 text-sm font-semibold text-surface-900 dark:text-white">{value}</p>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  caption,
  accentColor,
  secondaryColor,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  caption: string;
  accentColor: string;
  secondaryColor: string;
}) {
  return (
    <div className="rounded-[1.75rem] border border-surface-200/80 bg-white/80 p-5 shadow-sm backdrop-blur-2xl dark:border-white/10 dark:bg-white/5 dark:shadow-none">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl text-white" style={{ background: `linear-gradient(135deg, ${accentColor}, ${secondaryColor})` }}>
        <Icon size={20} />
      </div>
      <p className="mt-4 text-xs uppercase tracking-[0.18em] text-surface-500 dark:text-surface-400">{label}</p>
      <p className="mt-2 text-2xl font-bold font-display text-surface-900 dark:text-white">{value}</p>
      <p className="mt-1 text-sm text-surface-600 dark:text-surface-300">{caption}</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[1.5rem] border border-surface-200/80 bg-white/85 p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.04] dark:shadow-none">
      <h2 className="text-xl font-semibold text-surface-900 dark:text-white">{title}</h2>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function MemberPassCard({
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
      <div className="absolute bottom-0 left-0 h-28 w-28 rounded-full blur-3xl" style={{ backgroundColor: withAlpha(secondaryColor, isDark ? 0.16 : 0.14) }} />
      <div className="relative">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.22em] text-surface-600 dark:text-teal-100/80">Acceso movil</p>
            <p className="mt-2 text-2xl font-bold font-display text-surface-900 dark:text-white">{planName}</p>
            <p className="mt-2 truncate text-sm text-surface-600 dark:text-surface-200">{memberName}</p>
          </div>
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-surface-200 bg-white/90 text-surface-700 dark:border-white/10 dark:bg-white/10 dark:text-teal-50">
            {hasCode ? (
              <QRCode value={qrPayload!} size={40} bgColor="transparent" fgColor={isDark ? '#ccfbf1' : '#0f172a'} level="M" />
            ) : (
              <QrCode size={22} />
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {membershipStatus ? <span className={cn('badge', membershipStatusColor(membershipStatus))}>{membershipStatus}</span> : null}
          <span className={cn('badge', hasCode ? 'badge-success' : 'badge-neutral')}>
            {hasCode ? 'Codigo sincronizado' : 'Sin codigo'}
          </span>
          {expiresAt ? <span className="badge badge-neutral">Vence {formatDate(expiresAt)}</span> : null}
        </div>

        <div className="mt-5 rounded-[1.5rem] border border-surface-200 bg-white/85 p-4 dark:border-white/10 dark:bg-surface-950/55">
          {hasCode ? (
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
              <div className="rounded-2xl bg-white p-3 shadow-lg">
                <QRCode value={qrPayload!} size={148} bgColor="#ffffff" fgColor="#0a0f14" level="M" />
              </div>
              <div className="flex-1 space-y-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-surface-500">Credencial de check-in</p>
                  <p className="mt-1 text-sm font-semibold text-surface-900 dark:text-surface-100">Muestra este codigo al personal del gimnasio o usa el escaner en la entrada.</p>
                </div>
                <p className="break-all font-mono text-[11px] leading-5 text-surface-500 dark:text-surface-400">{qrPayload}</p>
                <button type="button" onClick={onCopyCode} className="btn-secondary">
                  <Copy size={16} />
                  Copiar codigo
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-surface-500">Credencial lista para check-in</p>
                <p className="mt-1 text-sm font-semibold text-surface-900 dark:text-surface-100">Aun no hay un codigo sincronizado para esta credencial.</p>
              </div>
              <button type="button" onClick={onCopyCode} disabled className="btn-secondary shrink-0 cursor-not-allowed opacity-50">
                <Copy size={16} />
                Copiar codigo
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function QuickActionCard({
  accentColor,
  description,
  icon: Icon,
  onClick,
  secondaryColor,
  title,
}: {
  accentColor: string;
  description: string;
  icon: typeof Home;
  onClick: () => void;
  secondaryColor: string;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[1.35rem] border border-surface-200 bg-surface-50/85 p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-surface-300 hover:bg-white dark:border-white/10 dark:bg-surface-950/35 dark:hover:border-white/20 dark:hover:bg-surface-950/55"
    >
      <div className="flex items-start justify-between gap-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white"
          style={{ background: `linear-gradient(135deg, ${accentColor}, ${secondaryColor})` }}
        >
          <Icon size={18} />
        </div>
        <span className="text-[11px] uppercase tracking-[0.18em] text-surface-500">Abrir</span>
      </div>
      <p className="mt-4 text-base font-semibold text-surface-900 dark:text-white">{title}</p>
      <p className="mt-1 text-sm leading-6 text-surface-600 dark:text-surface-300">{description}</p>
    </button>
  );
}

function DeviceStatusItem({
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

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-[1.5rem] border border-dashed border-surface-300 bg-surface-50/80 px-5 py-8 text-center dark:border-white/15 dark:bg-black/10">
      <p className="text-lg font-semibold text-surface-900 dark:text-white">{title}</p>
      <p className="mt-2 text-sm leading-6 text-surface-600 dark:text-surface-300">{description}</p>
    </div>
  );
}

function getActiveTab(searchParams: URLSearchParams): MemberTabId {
  const value = searchParams.get('tab');
  return TABS.some((tab) => tab.id === value) ? (value as MemberTabId) : 'home';
}

// ─── Skeleton loaders ─────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('animate-pulse rounded-2xl bg-surface-200/80 dark:bg-white/8', className)} />
  );
}

export function SkeletonMetricCards() {
  return (
    <section className="mt-5 grid gap-4 md:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-[1.75rem] border border-surface-200/80 bg-white/80 p-5 shadow-sm backdrop-blur-2xl dark:border-white/10 dark:bg-white/5 dark:shadow-none">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl">
            <Skeleton className="h-11 w-11 rounded-2xl" />
          </div>
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
        <div key={i} className="flex items-center gap-4 rounded-2xl border border-surface-200 bg-surface-50 p-4 dark:border-white/10 dark:bg-surface-950/30">
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

function setTab(searchParams: URLSearchParams, setSearchParams: SetURLSearchParams, tab: MemberTabId) {
  const next = new URLSearchParams(searchParams);
  next.set('tab', tab);
  setSearchParams(next, { replace: true });
}

function getTabFromAction(actionUrl?: string | null): MemberTabId | null {
  if (!actionUrl) {
    return null;
  }
  if (actionUrl.includes('agenda/class/')) return 'agenda';
  if (actionUrl.includes('payments')) return 'payments';
  if (actionUrl.includes('checkout') || actionUrl.includes('store')) return 'plans';
  if (actionUrl.includes('account/profile')) return 'profile';
  return actionUrl.startsWith('nexofitness://') ? 'notifications' : null;
}

async function refreshMemberQueries(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['member-wallet'] }),
    queryClient.invalidateQueries({ queryKey: ['member-tenant-profile'] }),
    queryClient.invalidateQueries({ queryKey: ['member-plans'] }),
    queryClient.invalidateQueries({ queryKey: ['member-classes'] }),
    queryClient.invalidateQueries({ queryKey: ['member-reservations'] }),
    queryClient.invalidateQueries({ queryKey: ['member-payments'] }),
    queryClient.invalidateQueries({ queryKey: ['member-notifications'] }),
    queryClient.invalidateQueries({ queryKey: ['member-web-push-config'] }),
    queryClient.invalidateQueries({ queryKey: ['member-push-subscriptions'] }),
  ]);
}

function loadMemberSnapshot(userId?: string | null): MemberSnapshot | null {
  if (!userId || typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(getMemberSnapshotStorageKey(userId));
    return raw ? (JSON.parse(raw) as MemberSnapshot) : null;
  } catch {
    return null;
  }
}

function saveMemberSnapshot(userId: string, partialSnapshot: Partial<MemberSnapshot>, updatedAt?: string) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const current = loadMemberSnapshot(userId) ?? {};
    const next: MemberSnapshot = {
      ...current,
      ...partialSnapshot,
      updatedAt: updatedAt || new Date().toISOString(),
    };
    window.localStorage.setItem(getMemberSnapshotStorageKey(userId), JSON.stringify(next));
  } catch {
    // Ignore quota/storage errors; the app still works online.
  }
}

function clearMemberSnapshot(userId: string) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.removeItem(getMemberSnapshotStorageKey(userId));
  } catch {
    // Ignore storage errors on logout cleanup.
  }
}

function getMemberSnapshotStorageKey(userId: string) {
  return `nexo.member.snapshot.${userId}`;
}

function getInstallHint({ isStandalone, canPromptInstall }: { isStandalone: boolean; canPromptInstall: boolean }) {
  if (isStandalone) {
    return 'La app ya esta instalada y puede usarse como acceso directo desde la pantalla principal del telefono.';
  }
  if (canPromptInstall) {
    return 'Toca Instalar para guardar esta PWA en tu dispositivo y entrar sin depender del navegador completo.';
  }
  if (typeof navigator === 'undefined') {
    return 'Instala esta app desde el menu del navegador para tener una experiencia movil mas directa.';
  }

  const userAgent = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(userAgent)) {
    return 'En Safari usa Compartir y luego Agregar a pantalla de inicio para instalar esta app.';
  }
  return 'En Chrome o Edge usa el menu del navegador y elige Instalar app para guardar este acceso.';
}

function getNotificationPermissionMeta(permission: NotificationPermissionState) {
  if (permission === 'granted') {
    return { label: 'Avisos permitidos', tone: 'success' as const };
  }
  if (permission === 'denied') {
    return { label: 'Avisos bloqueados', tone: 'warning' as const };
  }
  if (permission === 'default') {
    return { label: 'Permiso pendiente', tone: 'info' as const };
  }
  return { label: 'Avisos no disponibles', tone: 'neutral' as const };
}

