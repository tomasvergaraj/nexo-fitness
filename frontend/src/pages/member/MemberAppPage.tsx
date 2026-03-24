import { useEffect, useMemo, useState } from 'react';
import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  CalendarDays,
  CheckCircle2,
  Copy,
  CreditCard,
  Download,
  ExternalLink,
  Home,
  LogOut,
  MapPin,
  QrCode,
  RefreshCcw,
  ShieldCheck,
  Smartphone,
  Ticket,
  Wallet,
  Wifi,
  WifiOff,
  XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { SetURLSearchParams, useNavigate, useSearchParams } from 'react-router-dom';
import { browserSupportsWebPush, ensureWebPushSubscription, subscriptionToApiPayload } from '@/lib/webPush';
import { authApi, classesApi, mobileApi, notificationsApi, publicApi, reservationsApi } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
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
  formatCurrency,
  formatDate,
  formatDateTime,
  formatDurationLabel,
  formatRelative,
  membershipStatusColor,
  paymentStatusColor,
} from '@/utils';

type MemberTabId = 'home' | 'agenda' | 'plans' | 'payments' | 'notifications';
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
];

export default function MemberAppPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, logout } = useAuthStore();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermissionState>('unsupported');
  const [checkoutSession, setCheckoutSession] = useState<PublicCheckoutSession | null>(null);
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
    onError: (error: any) => toast.error(error?.response?.data?.detail || 'No se pudo reservar la clase.'),
  });

  const cancelMutation = useMutation({
    mutationFn: async (reservationId: string) => reservationsApi.cancel(reservationId),
    onSuccess: async () => {
      toast.success('Reserva cancelada.');
      await refreshMemberQueries(queryClient);
    },
    onError: (error: any) => toast.error(error?.response?.data?.detail || 'No se pudo cancelar la reserva.'),
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
      const memberUrl = `${window.location.origin}/member`;
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
      toast.success('Checkout generado.');
      window.open(session.checkout_url, '_blank', 'noopener,noreferrer');
    },
    onError: (error: any) => toast.error(error?.response?.data?.detail || error?.message || 'No se pudo generar el checkout.'),
  });

  const registerPushSubscriptionMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => (await mobileApi.registerPushSubscription(payload)).data,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['member-push-subscriptions'] });
    },
  });

  const classes = useMemo(
    () =>
      [...(classesQuery.data?.items ?? [])].sort(
        (left, right) => new Date(left.start_time).getTime() - new Date(right.start_time).getTime(),
      ),
    [classesQuery.data?.items],
  );
  const reservations = reservationsQuery.data?.items ?? [];
  const payments = paymentsQuery.data ?? [];
  const notifications = notificationsQuery.data ?? [];
  const plans = plansQuery.data ?? [];
  const pushSubscriptions = pushSubscriptionsQuery.data ?? [];
  const accentColor = profileQuery.data?.branding.primary_color || '#0f766e';
  const unreadNotifications = notifications.filter((item) => !item.is_read).length;
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

  const showLocalNotification = async () => {
    if (!('Notification' in window)) {
      setNotificationPermission('unsupported');
      toast.error('Este navegador no soporta notificaciones web.');
      return;
    }
    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }
    setNotificationPermission(permission);
    if (permission !== 'granted') {
      toast.error('No se concedio permiso.');
      return;
    }
    const previewUrl = `${window.location.origin}/member?tab=notifications`;
    const registration = await navigator.serviceWorker.getRegistration();
    const title = profileQuery.data?.tenant_name || walletQuery.data?.tenant_name || 'Nexo Fitness';
    const body = walletQuery.data?.next_class?.name
      ? `Tu proxima clase es ${walletQuery.data.next_class.name}.`
      : 'La PWA ya puede mostrar notificaciones locales.';

    if (registration) {
      await registration.showNotification(title, {
        body,
        icon: '/icons/icon-192.svg',
        badge: '/icons/icon-192.svg',
        tag: 'nexo-member-preview',
        data: { url: previewUrl },
      });
    } else {
      const notification = new Notification(title, { body, icon: '/icons/icon-192.svg', tag: 'nexo-member-preview' });
      notification.onclick = () => window.location.assign(previewUrl);
    }
    toast.success('Notificacion web enviada.');
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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(15,118,110,0.26),_transparent_28%),linear-gradient(180deg,#04141a_0%,#08161d_48%,#04141a_100%)] text-white">
      <div className="mx-auto max-w-6xl px-4 pb-28 sm:px-6 lg:px-8" style={{ paddingTop: 'max(1.25rem, env(safe-area-inset-top))' }}>
        {!isOnline ? (
          <section className="mb-5 rounded-[1.5rem] border border-amber-400/20 bg-amber-500/10 px-4 py-4 text-amber-50/90">
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

        <section className="rounded-[2rem] border border-white/10 bg-white/5 p-5 backdrop-blur-2xl sm:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-teal-100/85">
                <Smartphone size={14} />
                Member PWA
              </div>
              <h1 className="mt-4 text-3xl font-bold font-display sm:text-4xl">
                {profileQuery.data?.tenant_name || walletQuery.data?.tenant_name || 'Nexo Fitness'}
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-surface-300">
                Wallet, agenda, pagos y bandeja del miembro sobre una app web instalable, sin depender del runtime nativo de Android.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="badge badge-neutral">{user.first_name} {user.last_name}</span>
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

            <div className="grid gap-3 sm:grid-cols-2 lg:w-[360px]">
              <button type="button" onClick={installApp} className="btn-primary" style={{ backgroundImage: `linear-gradient(135deg, ${accentColor}, #0f766e)` }}>
                <Download size={16} />
                {isStandalone ? 'Instalada' : 'Instalar'}
              </button>
              <button type="button" onClick={() => void enableWebPush()} className="btn-secondary" disabled={registerPushSubscriptionMutation.isPending || !webPushSupported}>
                <Bell size={16} />
                {activeWebPushSubscription ? 'Push web activa' : registerPushSubscriptionMutation.isPending ? 'Activando' : 'Activar push web'}
              </button>
              <button type="button" onClick={showLocalNotification} className="btn-secondary">
                <Bell size={16} />
                Probar aviso
              </button>
              <button type="button" onClick={() => void syncMemberData()} className="btn-secondary" disabled={isSyncing}>
                <RefreshCcw size={16} className={cn(isSyncing && 'animate-spin')} />
                {isSyncing ? 'Sincronizando' : isOnline ? 'Sincronizar' : 'Usar cache'}
              </button>
              <button type="button" onClick={logoutMember} className="btn-secondary">
                <LogOut size={16} />
                Salir
              </button>
            </div>
          </div>
        </section>

        <section className="mt-5 grid gap-4 md:grid-cols-3">
          <MetricCard icon={Wallet} label="Plan" value={walletQuery.data?.plan_name || 'Sin plan'} caption={walletQuery.data?.membership_status || 'Membresia pendiente'} accentColor={accentColor} />
          <MetricCard icon={CalendarDays} label="Reservas" value={String(reservations.length)} caption={walletQuery.data?.next_class?.start_time ? formatDateTime(walletQuery.data.next_class.start_time) : 'Sin proxima clase'} accentColor={accentColor} />
          <MetricCard icon={Bell} label="Sin leer" value={String(unreadNotifications)} caption={notificationPermissionMeta.label} accentColor={accentColor} />
        </section>

        <section className="mt-5 rounded-[2rem] border border-white/10 bg-white/5 p-5 backdrop-blur-2xl">
          {activeTab === 'home' ? (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
              <Panel title="Pase digital">
                <p className="text-sm leading-6 text-surface-300">
                  Tu acceso, estado de membresia y codigo de respaldo viven ahora en una sola vista optimizada para el telefono.
                </p>
                <MemberPassCard
                  accentColor={accentColor}
                  expiresAt={walletQuery.data?.expires_at}
                  memberName={`${user.first_name} ${user.last_name}`.trim()}
                  membershipStatus={walletQuery.data?.membership_status}
                  planName={walletQuery.data?.plan_name || 'Sin plan activo'}
                  qrPayload={walletQuery.data?.qr_payload}
                  onCopyCode={() => void copyCheckinCode()}
                />
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <QuickActionCard
                    icon={CalendarDays}
                    title="Agenda"
                    description={reservations.length ? `${reservations.length} reservas activas` : 'Ver clases y reservar'}
                    accentColor={accentColor}
                    onClick={() => setTab(searchParams, setSearchParams, 'agenda')}
                  />
                  <QuickActionCard
                    icon={Ticket}
                    title="Planes"
                    description={plans.length ? `${plans.length} opciones disponibles` : 'Revisa tu plan actual'}
                    accentColor={accentColor}
                    onClick={() => setTab(searchParams, setSearchParams, 'plans')}
                  />
                  <QuickActionCard
                    icon={CreditCard}
                    title="Pagos"
                    description={payments.length ? `${payments.length} movimientos recientes` : 'Historial y comprobantes'}
                    accentColor={accentColor}
                    onClick={() => setTab(searchParams, setSearchParams, 'payments')}
                  />
                  <QuickActionCard
                    icon={Bell}
                    title="Bandeja"
                    description={unreadNotifications ? `${unreadNotifications} notificaciones nuevas` : 'Sin pendientes por leer'}
                    accentColor={accentColor}
                    onClick={() => setTab(searchParams, setSearchParams, 'notifications')}
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
                    <p className="mt-2 text-sm text-surface-300">
                      {formatDateTime(walletQuery.data.next_class.start_time)} | {walletQuery.data.next_class.modality}
                    </p>
                    {gymLocation ? (
                      <div className="mt-4 flex items-start gap-3 rounded-2xl border border-white/10 bg-surface-950/40 px-4 py-3">
                        <MapPin size={18} className="mt-0.5 text-teal-200" />
                        <p className="text-sm leading-6 text-surface-300">{gymLocation}</p>
                      </div>
                    ) : null}
                    <button type="button" className="btn-primary mt-4" style={{ backgroundImage: `linear-gradient(135deg, ${accentColor}, #0f766e)` }} onClick={() => setTab(searchParams, setSearchParams, 'agenda')}>
                      <CalendarDays size={16} />
                      Abrir agenda
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-sm leading-6 text-surface-300">Todavia no hay una clase proxima vinculada.</p>
                    <button type="button" className="btn-secondary mt-4" onClick={() => setTab(searchParams, setSearchParams, 'agenda')}>
                      <CalendarDays size={16} />
                      Explorar clases
                    </button>
                  </>
                )}
                </Panel>

                <Panel title="Estado del dispositivo">
                  <div className="space-y-3">
                    <DeviceStatusItem label="Conexion" value={isOnline ? 'En linea' : 'Sin conexion'} tone={isOnline ? 'success' : 'warning'} />
                    <DeviceStatusItem label="Instalacion" value={isStandalone ? 'App instalada' : 'Modo navegador'} tone={isStandalone ? 'success' : 'neutral'} />
                    <DeviceStatusItem label="Notificaciones" value={notificationPermissionMeta.label} tone={notificationPermissionMeta.tone} />
                    <DeviceStatusItem label="Push remota" value={webPushStateLabel} tone={activeWebPushSubscription ? 'success' : webPushConfigured ? 'info' : 'warning'} />
                    <DeviceStatusItem label="Ultima sync" value={lastSyncedAt ? formatRelative(lastSyncedAt) : 'Sin snapshot aun'} tone={lastSyncedAt ? 'info' : 'neutral'} />
                    <DeviceStatusItem label="Checkout" value={profileQuery.data?.checkout_enabled ? 'Listo para compras' : 'Pendiente de configurar'} tone={profileQuery.data?.checkout_enabled ? 'success' : 'warning'} />
                    <DeviceStatusItem label="Check-in" value={hasCheckinCode ? 'Codigo listo para respaldo' : 'Pendiente de sincronizar'} tone={hasCheckinCode ? 'success' : 'warning'} />
                  </div>
                  <div className="mt-4 rounded-2xl border border-white/10 bg-surface-950/40 px-4 py-4">
                    <div className="flex items-start gap-3">
                      {isOnline ? <Wifi size={18} className="mt-0.5 text-teal-200" /> : <ShieldCheck size={18} className="mt-0.5 text-teal-200" />}
                      <p className="text-sm leading-6 text-surface-300">{installHint}</p>
                    </div>
                  </div>
                </Panel>
              </div>
            </div>
          ) : null}

          {activeTab === 'agenda' ? (
            <div className="space-y-4">
              {classes.length ? classes.map((gymClass) => {
                const reservation = reservationByClassId.get(gymClass.id);
                return (
                  <Panel key={gymClass.id} title={gymClass.name}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn('badge', classStatusColor(gymClass.status))}>{gymClass.status}</span>
                      {reservation ? <span className="badge badge-success">{reservation.status === 'waitlisted' ? 'Lista de espera' : 'Reservada'}</span> : null}
                    </div>
                    <p className="mt-3 text-sm text-surface-300">
                      {formatDateTime(gymClass.start_time)} | {gymClass.modality} | Cupos {gymClass.current_bookings}/{gymClass.max_capacity}
                    </p>
                    <div className="mt-4">
                      <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-surface-500">
                        <span>Ocupacion</span>
                        <span>{Math.min(100, Math.round((gymClass.current_bookings / Math.max(gymClass.max_capacity, 1)) * 100))}%</span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/5">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min(100, Math.round((gymClass.current_bookings / Math.max(gymClass.max_capacity, 1)) * 100))}%`,
                            background: `linear-gradient(90deg, ${accentColor}, #14b8a6)`,
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
                        <button type="button" className="btn-primary" style={{ backgroundImage: `linear-gradient(135deg, ${accentColor}, #0f766e)` }} onClick={() => reserveMutation.mutate(gymClass.id)}>
                          <CalendarDays size={16} />
                          Reservar
                        </button>
                      )}
                    </div>
                  </Panel>
                );
              }) : <EmptyState title="Todavia no hay clases visibles" description="La agenda quedara lista apenas el backend tenga clases programadas." />}
            </div>
          ) : null}

          {activeTab === 'plans' ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {plans.length ? plans.map((plan) => (
                <Panel key={plan.id} title={plan.name}>
                  <p className="text-3xl font-bold font-display">{formatCurrency(plan.price, plan.currency)}</p>
                  <p className="mt-2 text-sm text-surface-300">{plan.description || 'Plan activo del gimnasio.'}</p>
                  <p className="mt-3 text-xs uppercase tracking-[0.18em] text-surface-400">{formatDurationLabel(plan.duration_type, plan.duration_days)}</p>
                  <button type="button" className="btn-primary mt-4 w-full" style={{ backgroundImage: `linear-gradient(135deg, ${accentColor}, #0f766e)` }} onClick={() => checkoutMutation.mutate(plan.id)}>
                    <CreditCard size={16} />
                    {walletQuery.data?.plan_id === plan.id ? 'Renovar este plan' : 'Comprar este plan'}
                  </button>
                </Panel>
              )) : <div className="lg:col-span-2"><EmptyState title="Sin planes publicados" description="La PWA podra vender en cuanto el storefront tenga planes activos." /></div>}
              {checkoutSession ? (
                <div className="lg:col-span-2 rounded-[1.5rem] border border-emerald-400/20 bg-emerald-500/10 p-5">
                  <p className="text-sm text-emerald-100">Sesion generada: {checkoutSession.session_reference}</p>
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
              {payments.length ? payments.map((payment) => (
                <Panel key={payment.id} title={payment.plan_name || payment.description || 'Pago del miembro'}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn('badge', paymentStatusColor(payment.status))}>{payment.status}</span>
                    <span className="badge badge-neutral">{payment.method}</span>
                  </div>
                  <p className="mt-3 text-2xl font-bold font-display">{formatCurrency(payment.amount, payment.currency)}</p>
                  <p className="mt-2 text-sm text-surface-300">
                    {payment.paid_at ? `Pagado ${formatDateTime(payment.paid_at)}` : `Creado ${formatDateTime(payment.created_at)}`}
                  </p>
                  {payment.receipt_url ? <a href={payment.receipt_url} target="_blank" rel="noreferrer" className="btn-secondary mt-4"><ExternalLink size={16} />Ver comprobante</a> : null}
                </Panel>
              )) : <EmptyState title="Aun no hay pagos" description="El historial aparecera aqui apenas existan pagos para este miembro." />}
            </div>
          ) : null}

          {activeTab === 'notifications' ? (
            <div className="space-y-4">
              <div className="rounded-[1.5rem] border border-amber-400/20 bg-amber-500/10 p-4 text-sm leading-6 text-amber-50/90">
                La app web ya maneja instalacion y notificaciones locales. La migracion de push remota desde Expo a Web Push queda como siguiente etapa del backend.
              </div>
              {notifications.length ? notifications.map((notification) => (
                <Panel key={notification.id} title={notification.title}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn('badge', notification.is_read ? 'badge-neutral' : 'badge-info')}>
                      {notification.is_read ? 'Leida' : 'Nueva'}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-surface-300">
                    {notification.message || 'Notificacion sin mensaje adicional.'}
                  </p>
                  <p className="mt-2 text-xs text-surface-400">
                    {formatRelative(notification.created_at)}
                    {notification.opened_at ? ` | Apertura ${formatRelative(notification.opened_at)}` : ''}
                    {notification.clicked_at ? ` | Click ${formatRelative(notification.clicked_at)}` : ''}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    {notification.action_url ? <button type="button" className="btn-primary" style={{ backgroundImage: `linear-gradient(135deg, ${accentColor}, #0f766e)` }} onClick={() => void openNotificationAction(notification)}><ExternalLink size={16} />Abrir accion</button> : null}
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

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-surface-950/90 px-3 pt-3 backdrop-blur-2xl" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <div className="mx-auto grid max-w-5xl grid-cols-5 gap-2">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.id === activeTab;
            return (
              <button key={tab.id} type="button" onClick={() => setTab(searchParams, setSearchParams, tab.id)} className={cn('flex flex-col items-center gap-1 rounded-2xl px-2 py-3 text-[11px] font-semibold transition-all', isActive ? 'bg-white text-surface-950' : 'bg-white/[0.04] text-surface-400 hover:bg-white/[0.08] hover:text-white')}>
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

function MetricCard({ icon: Icon, label, value, caption, accentColor }: { icon: typeof Wallet; label: string; value: string; caption: string; accentColor: string }) {
  return (
    <div className="rounded-[1.75rem] border border-white/10 bg-white/5 p-5 backdrop-blur-2xl">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl" style={{ background: `linear-gradient(135deg, ${accentColor}, #0f766e)` }}>
        <Icon size={20} />
      </div>
      <p className="mt-4 text-xs uppercase tracking-[0.18em] text-surface-400">{label}</p>
      <p className="mt-2 text-2xl font-bold font-display">{value}</p>
      <p className="mt-1 text-sm text-surface-300">{caption}</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-5">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function MemberPassCard({
  accentColor,
  expiresAt,
  memberName,
  membershipStatus,
  onCopyCode,
  planName,
  qrPayload,
}: {
  accentColor: string;
  expiresAt?: string;
  memberName: string;
  membershipStatus?: string;
  onCopyCode: () => void;
  planName: string;
  qrPayload?: string;
}) {
  const hasCode = Boolean(qrPayload);

  return (
    <div
      className="relative mt-4 overflow-hidden rounded-[1.75rem] border border-white/10 p-5 shadow-[0_24px_80px_rgba(4,20,26,0.38)]"
      style={{ background: `radial-gradient(circle at top right, ${accentColor}55, transparent 34%), linear-gradient(135deg, rgba(6,10,15,0.94), rgba(6,24,31,0.96))` }}
    >
      <div className="absolute -right-10 top-0 h-40 w-40 rounded-full bg-white/5 blur-3xl" />
      <div className="absolute bottom-0 left-0 h-28 w-28 rounded-full bg-teal-400/10 blur-3xl" />
      <div className="relative">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.22em] text-teal-100/80">Acceso movil</p>
            <p className="mt-2 text-2xl font-bold font-display text-white">{planName}</p>
            <p className="mt-2 truncate text-sm text-surface-200">{memberName}</p>
          </div>
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/10 text-teal-50">
            <QrCode size={22} />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {membershipStatus ? <span className={cn('badge', membershipStatusColor(membershipStatus))}>{membershipStatus}</span> : null}
          <span className={cn('badge', hasCode ? 'badge-success' : 'badge-neutral')}>
            {hasCode ? 'Codigo sincronizado' : 'Sin codigo'}
          </span>
          {expiresAt ? <span className="badge badge-neutral">Vence {formatDate(expiresAt)}</span> : null}
        </div>

        <div className="mt-5 rounded-[1.5rem] border border-white/10 bg-surface-950/55 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-surface-500">Credencial lista para check-in</p>
              <p className="mt-1 text-sm font-semibold text-surface-100">
                {hasCode ? 'Usa este codigo como respaldo rapido de acceso.' : 'Aun no hay un codigo sincronizado para esta credencial.'}
              </p>
            </div>
            <button type="button" onClick={onCopyCode} disabled={!hasCode} className="btn-secondary shrink-0 disabled:cursor-not-allowed disabled:opacity-50">
              <Copy size={16} />
              Copiar codigo
            </button>
          </div>

          <div className="mt-4 rounded-[1.35rem] border border-dashed border-white/10 bg-white/[0.03] p-4">
            <div className="grid grid-cols-[auto,1fr] items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-teal-100">
                <CheckCircle2 size={20} />
              </div>
              <div className="min-w-0 space-y-1">
                <p className="text-[11px] uppercase tracking-[0.18em] text-surface-500">Codigo del miembro</p>
                <p className="break-all font-mono text-xs leading-5 text-surface-300">
                  {qrPayload || 'Pendiente de sincronizar'}
                </p>
              </div>
            </div>
          </div>
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
  title,
}: {
  accentColor: string;
  description: string;
  icon: typeof Home;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[1.35rem] border border-white/10 bg-surface-950/35 p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:bg-surface-950/55"
    >
      <div className="flex items-start justify-between gap-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white"
          style={{ background: `linear-gradient(135deg, ${accentColor}, #0f766e)` }}
        >
          <Icon size={18} />
        </div>
        <span className="text-[11px] uppercase tracking-[0.18em] text-surface-500">Abrir</span>
      </div>
      <p className="mt-4 text-base font-semibold text-white">{title}</p>
      <p className="mt-1 text-sm leading-6 text-surface-300">{description}</p>
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
    success: 'text-emerald-200',
    info: 'text-cyan-200',
    warning: 'text-amber-200',
    neutral: 'text-surface-200',
  }[tone];

  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl border border-white/10 bg-surface-950/30 px-4 py-3">
      <p className="text-sm text-surface-400">{label}</p>
      <p className={cn('text-right text-sm font-semibold', valueColorClass)}>{value}</p>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-[1.5rem] border border-dashed border-white/15 bg-black/10 px-5 py-8 text-center">
      <p className="text-lg font-semibold text-white">{title}</p>
      <p className="mt-2 text-sm leading-6 text-surface-300">{description}</p>
    </div>
  );
}

function getActiveTab(searchParams: URLSearchParams): MemberTabId {
  const value = searchParams.get('tab');
  return TABS.some((tab) => tab.id === value) ? (value as MemberTabId) : 'home';
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
  if (actionUrl.includes('account/profile')) return 'home';
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

