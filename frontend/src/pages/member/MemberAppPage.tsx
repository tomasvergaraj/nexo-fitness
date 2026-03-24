import { useEffect, useMemo, useState } from 'react';
import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  CalendarDays,
  CreditCard,
  Download,
  ExternalLink,
  Home,
  LogOut,
  QrCode,
  RefreshCcw,
  Smartphone,
  Ticket,
  Wallet,
  XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { SetURLSearchParams, useNavigate, useSearchParams } from 'react-router-dom';
import { authApi, classesApi, mobileApi, notificationsApi, publicApi, reservationsApi } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import type {
  AppNotification,
  GymClass,
  MobilePaymentHistoryItem,
  MobileWallet,
  PaginatedResponse,
  Plan,
  PublicCheckoutSession,
  Reservation,
  TenantPublicProfile,
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
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
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
  const [checkoutSession, setCheckoutSession] = useState<PublicCheckoutSession | null>(null);
  const activeTab = getActiveTab(searchParams);

  const walletQuery = useQuery<MobileWallet>({
    queryKey: ['member-wallet'],
    queryFn: async () => (await mobileApi.wallet()).data,
  });

  const tenantSlug = walletQuery.data?.tenant_slug;

  const profileQuery = useQuery<TenantPublicProfile>({
    queryKey: ['member-tenant-profile', tenantSlug],
    queryFn: async () => (await publicApi.getTenantProfile(tenantSlug!)).data,
    enabled: Boolean(tenantSlug),
  });

  const plansQuery = useQuery<Plan[]>({
    queryKey: ['member-plans', tenantSlug],
    queryFn: async () => (await publicApi.getTenantPlans(tenantSlug!)).data,
    enabled: Boolean(tenantSlug),
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
  });

  const reservationsQuery = useQuery<PaginatedResponse<Reservation>>({
    queryKey: ['member-reservations'],
    queryFn: async () => (await reservationsApi.list({ upcoming_only: true, per_page: 24 })).data,
  });

  const paymentsQuery = useQuery<MobilePaymentHistoryItem[]>({
    queryKey: ['member-payments'],
    queryFn: async () => (await mobileApi.listPayments({ limit: 12 })).data,
  });

  const notificationsQuery = useQuery<AppNotification[]>({
    queryKey: ['member-notifications'],
    queryFn: async () => (await notificationsApi.list()).data,
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
  const accentColor = profileQuery.data?.branding.primary_color || '#0f766e';
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
      toast.error('Este navegador no soporta notificaciones web.');
      return;
    }
    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }
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

  const logoutMember = async () => {
    try {
      await authApi.logout();
    } catch {
      // Ignore transport errors on logout.
    }
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(15,118,110,0.26),_transparent_28%),linear-gradient(180deg,#04141a_0%,#08161d_48%,#04141a_100%)] text-white">
      <div className="mx-auto max-w-6xl px-4 pb-28 pt-5 sm:px-6 lg:px-8">
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
              <button type="button" onClick={showLocalNotification} className="btn-secondary">
                <Bell size={16} />
                Probar aviso
              </button>
              <button type="button" onClick={() => void refreshMemberQueries(queryClient)} className="btn-secondary">
                <RefreshCcw size={16} />
                Sincronizar
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
          <MetricCard icon={Bell} label="Sin leer" value={String(notifications.filter((item) => !item.is_read).length)} caption={isStandalone ? 'App instalada' : 'Lista para instalar'} accentColor={accentColor} />
        </section>

        <section className="mt-5 rounded-[2rem] border border-white/10 bg-white/5 p-5 backdrop-blur-2xl">
          {activeTab === 'home' ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Wallet">
                <p className="text-xl font-semibold">{walletQuery.data?.plan_name || 'Sin plan activo'}</p>
                <p className="mt-2 text-sm text-surface-300">
                  Renovacion {walletQuery.data?.auto_renew ? 'automatica' : 'manual'}.
                </p>
                <div className="mt-4 rounded-2xl border border-white/10 bg-surface-950/40 p-4">
                  <div className="grid grid-cols-[auto,1fr] items-start gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
                      <QrCode size={22} />
                    </div>
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm font-semibold leading-5 text-surface-100">Credencial lista para check-in</p>
                      <p className="text-[11px] uppercase tracking-[0.18em] text-surface-500">QR del miembro</p>
                      <p className="break-all font-mono text-xs leading-5 text-surface-400">
                        {walletQuery.data?.qr_payload || 'Pendiente de sincronizar'}
                      </p>
                    </div>
                  </div>
                </div>
              </Panel>
              <Panel title="Proxima actividad">
                {walletQuery.data?.next_class ? (
                  <>
                    <p className="text-xl font-semibold">{walletQuery.data.next_class.name}</p>
                    <p className="mt-2 text-sm text-surface-300">
                      {formatDateTime(walletQuery.data.next_class.start_time)} · {walletQuery.data.next_class.modality}
                    </p>
                    <button type="button" className="btn-primary mt-4" style={{ backgroundImage: `linear-gradient(135deg, ${accentColor}, #0f766e)` }} onClick={() => setTab(searchParams, setSearchParams, 'agenda')}>
                      <CalendarDays size={16} />
                      Abrir agenda
                    </button>
                  </>
                ) : (
                  <p className="text-sm leading-6 text-surface-300">Todavia no hay una clase proxima vinculada.</p>
                )}
              </Panel>
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
                      {formatDateTime(gymClass.start_time)} · {gymClass.modality} · Cupos {gymClass.current_bookings}/{gymClass.max_capacity}
                    </p>
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
                    {notification.opened_at ? ` · Apertura ${formatRelative(notification.opened_at)}` : ''}
                    {notification.clicked_at ? ` · Click ${formatRelative(notification.clicked_at)}` : ''}
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

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-surface-950/90 px-3 py-3 backdrop-blur-2xl">
        <div className="mx-auto grid max-w-5xl grid-cols-5 gap-2">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.id === activeTab;
            return (
              <button key={tab.id} type="button" onClick={() => setTab(searchParams, setSearchParams, tab.id)} className={cn('flex flex-col items-center gap-1 rounded-2xl px-2 py-3 text-[11px] font-semibold transition-all', isActive ? 'bg-white text-surface-950' : 'bg-white/[0.04] text-surface-400 hover:bg-white/[0.08] hover:text-white')}>
                <Icon size={18} />
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
  ]);
}
