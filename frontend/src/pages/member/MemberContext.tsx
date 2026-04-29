import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { browserSupportsWebPush, ensureWebPushSubscription, subscriptionToApiPayload } from '@/lib/webPush';
import { authApi, classesApi, mobileApi, notificationsApi, programBookingsApi, publicApi, reservationsApi } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { useThemeStore } from '@/stores/themeStore';
import type {
  AppNotification,
  GymClass,
  MobilePaymentHistoryItem,
  MobileWallet,
  PaginatedResponse,
  Plan,
  ProgramBooking,
  PushSubscriptionRecord,
  Reservation,
  SupportInteraction,
  TenantPublicProfile,
  TrainingProgram,
  User,
  WebPushConfig,
} from '@/types';
import {
  cn,
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_SECONDARY_COLOR,
  getApiError,
  normalizeHexColor,
  withAlpha,
} from '@/utils';
import {
  buildSupportCallUrl,
  buildSupportEmailUrl,
  buildSupportWhatsAppUrl,
  clearMemberSnapshot,
  createSupportRequestForm,
  getActiveTab,
  getInstallHint,
  getNotificationPermissionMeta,
  getNotificationPresetDateRange,
  loadMemberSnapshot,
  MEMBER_AGENDA_PAGE_SIZE,
  refreshMemberQueries,
  sanitizeSupportContactValue,
  saveMemberSnapshot,
  setTab,
} from './memberUtils';
import type {
  BeforeInstallPromptEvent,
  MemberTabId,
  NotificationPermissionState,
  SupportRequestForm,
} from './memberTypes';

// ─── Snapshot shape ───────────────────────────────────────────────────────────

type MemberSnapshot = {
  updatedAt?: string;
  wallet?: MobileWallet;
  profile?: TenantPublicProfile;
  plans?: Plan[];
  programs?: TrainingProgram[];
  classes?: PaginatedResponse<GymClass>;
  reservations?: PaginatedResponse<Reservation>;
  payments?: MobilePaymentHistoryItem[];
  supportInteractions?: SupportInteraction[];
  notifications?: AppNotification[];
};

type MemberServiceWorkerMessage = {
  type?: 'member-push-received' | 'member-notification-clicked';
  payload?: { title?: string; url?: string; notificationId?: string | null };
};

// ─── Context type ─────────────────────────────────────────────────────────────

export type MemberContextValue = {
  // Auth
  user: User;

  // Brand
  accentColor: string;
  secondaryColor: string;
  brandGradient: string;
  isDark: boolean;
  toggleTheme: () => void;
  tenantDisplayName: string;
  ownerLogoUrl: string | undefined;

  // Queries - data
  wallet: MobileWallet | undefined;
  profile: TenantPublicProfile | undefined;
  plans: Plan[];
  programs: TrainingProgram[];
  classes: GymClass[];
  reservations: Reservation[];
  payments: MobilePaymentHistoryItem[];
  notifications: AppNotification[];
  supportInteractions: SupportInteraction[];
  pushSubscriptions: PushSubscriptionRecord[];
  programBookings: ProgramBooking[];

  // Query objects (for loading/error states)
  walletQuery: ReturnType<typeof useQuery<MobileWallet>>;
  classesQuery: ReturnType<typeof useQuery<PaginatedResponse<GymClass>>>;
  paymentsQuery: ReturnType<typeof useQuery<MobilePaymentHistoryItem[]>>;
  supportInteractionsQuery: ReturnType<typeof useQuery<SupportInteraction[]>>;
  notificationsQuery: ReturnType<typeof useQuery<AppNotification[]>>;
  programsQuery: ReturnType<typeof useQuery<TrainingProgram[]>>;
  programBookingsQuery: ReturnType<typeof useQuery<ProgramBooking[]>>;
  plansQuery: ReturnType<typeof useQuery<Plan[]>>;
  reservationsQuery: ReturnType<typeof useQuery<PaginatedResponse<Reservation>>>;
  pushConfigQuery: ReturnType<typeof useQuery<WebPushConfig>>;

  // Computed
  unreadNotifications: number;
  readNotifications: number;
  actionableNotifications: number;
  pendingSupportInteractions: SupportInteraction[];
  resolvedSupportInteractions: number;
  enrolledPrograms: TrainingProgram[];
  enrolledProgramIds: Set<string>;
  memberFullName: string;
  hasCheckinCode: boolean;
  gymLocation: string;
  navBadgeByTab: Partial<Record<MemberTabId, string>>;

  // Support contact
  supportPhone: string | null;
  supportWhatsAppUrl: string | null;
  supportCallUrl: string | null;
  supportEmailUrl: string | null;
  hasDirectSupport: boolean;
  preferredSupportChannel: SupportInteraction['channel'];

  // App state
  isOnline: boolean;
  isSyncing: boolean;
  isStandalone: boolean;
  lastSyncedAt: Date | null;
  notificationPermission: NotificationPermissionState;
  notificationPermissionMeta: { label: string; tone: 'success' | 'warning' | 'info' | 'neutral' };
  webPushSupported: boolean;
  webPushConfigured: boolean;
  activeWebPushSubscription: PushSubscriptionRecord | undefined;
  installHint: string;

  // Navigation
  activeTab: MemberTabId;
  navigateTo: (tab: MemberTabId) => void;

  // Shared mutations
  reserveMutation: ReturnType<typeof useMutation<unknown, unknown, string>>;
  cancelMutation: ReturnType<typeof useMutation<unknown, unknown, { reservationId: string; reason?: string }>>;
  notificationMutation: ReturnType<typeof useMutation<unknown, unknown, { notificationId: string; payload: Record<string, unknown> }>>;
  markAllNotificationsReadMutation: ReturnType<typeof useMutation<unknown, unknown, string[]>>;
  registerPushSubscriptionMutation: ReturnType<typeof useMutation<unknown, unknown, Record<string, unknown>>>;

  // Modal state (cross-tab)
  selectedNotificationId: string | null;
  setSelectedNotificationId: (id: string | null) => void;
  showSupportRequestModal: boolean;
  setShowSupportRequestModal: (open: boolean) => void;
  supportRequestForm: SupportRequestForm;
  setSupportRequestForm: React.Dispatch<React.SetStateAction<SupportRequestForm>>;
  createSupportInteractionMutation: ReturnType<typeof useMutation<SupportInteraction, unknown, void>>;

  // Actions
  syncMemberData: () => Promise<void>;
  logoutMember: () => Promise<void>;
  copyCheckinCode: () => Promise<void>;
  enableWebPush: () => Promise<void>;
  installApp: () => Promise<void>;
  openSupportRequestModal: () => void;

  // Agenda state (shared for home tab preview and agenda tab)
  agendaWeekOffset: number;
  setAgendaWeekOffset: React.Dispatch<React.SetStateAction<number>>;
  agendaWeekDates: Date[];
  agendaProgramFilter: string;
  setAgendaProgramFilter: React.Dispatch<React.SetStateAction<string>>;

  // queryClient (for tabs that need direct access)
  queryClient: QueryClient;

  // utils
  cn: typeof cn;
  withAlpha: typeof withAlpha;
};

// ─── Context ──────────────────────────────────────────────────────────────────

const MemberContext = createContext<MemberContextValue | null>(null);

export function useMemberContext() {
  const ctx = useContext(MemberContext);
  if (!ctx) throw new Error('useMemberContext must be used within MemberProvider');
  return ctx;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function MemberProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, logout } = useAuthStore();
  const { isDark, toggle: toggleTheme } = useThemeStore();

  // PWA state
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(() => {
    if (typeof window === 'undefined') return false;
    const iosStandalone = Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    return window.matchMedia('(display-mode: standalone)').matches || iosStandalone;
  });
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const [notificationPermission, setNotificationPermission] =
    useState<NotificationPermissionState>('unsupported');

  // Modal state (cross-tab)
  const [selectedNotificationId, setSelectedNotificationId] = useState<string | null>(null);
  const [showSupportRequestModal, setShowSupportRequestModal] = useState(false);
  const [supportRequestForm, setSupportRequestForm] = useState<SupportRequestForm>(() =>
    createSupportRequestForm(),
  );

  // Agenda shared state
  const [agendaWeekOffset, setAgendaWeekOffset] = useState(0);
  const [agendaProgramFilter, setAgendaProgramFilter] = useState<string>('all');

  const memberSnapshot = useMemo(() => loadMemberSnapshot<MemberSnapshot>(user?.id), [user?.id]);
  const activeTab = getActiveTab(searchParams);

  // Ref that always holds the current active tab — used by the back-button handler
  // so the popstate callback sees the tab the user was ON before the back gesture,
  // not the URL the browser has already reverted to (which loses the ?tab param).
  const activeTabRef = useRef(activeTab);
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);

  const agendaWeekDates = useMemo(() => {
    const today = new Date();
    const dayOfWeek = (today.getDay() + 6) % 7;
    const monday = new Date(today);
    monday.setDate(today.getDate() - dayOfWeek + agendaWeekOffset * 7);
    monday.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d;
    });
  }, [agendaWeekOffset]);

  const agendaRange = useMemo(() => {
    const rangeStart = new Date(agendaWeekDates[0]);
    rangeStart.setHours(0, 0, 0, 0);
    const rangeEnd = new Date(agendaWeekDates[agendaWeekDates.length - 1]);
    rangeEnd.setHours(23, 59, 59, 999);
    return { rangeStart, rangeEnd };
  }, [agendaWeekDates]);

  // ── Queries ──────────────────────────────────────────────────────────────

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
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
  });

  const plansQuery = useQuery<Plan[]>({
    queryKey: ['member-plans', tenantSlug],
    queryFn: async () => (await publicApi.getTenantPlans(tenantSlug!)).data,
    enabled: Boolean(tenantSlug),
    initialData: memberSnapshot?.plans,
    initialDataUpdatedAt: memberSnapshot?.updatedAt ? Date.parse(memberSnapshot.updatedAt) : undefined,
  });

  const programsQuery = useQuery<TrainingProgram[]>({
    queryKey: ['member-programs'],
    queryFn: async () => (await mobileApi.listPrograms()).data,
    enabled: Boolean(user),
    initialData: memberSnapshot?.programs,
    initialDataUpdatedAt: memberSnapshot?.updatedAt ? Date.parse(memberSnapshot.updatedAt) : undefined,
  });

  const programBookingsQuery = useQuery<ProgramBooking[]>({
    queryKey: ['member-program-bookings'],
    queryFn: async () => (await programBookingsApi.list({ status: 'all' })).data,
    enabled: Boolean(user),
  });

  const memberPlanId = walletQuery.data?.plan_id;
  const classesQuery = useQuery<PaginatedResponse<GymClass>>({
    queryKey: [
      'member-classes',
      memberPlanId,
      agendaRange.rangeStart.toISOString(),
      agendaRange.rangeEnd.toISOString(),
    ],
    queryFn: async () => {
      const aggregatedItems: GymClass[] = [];
      let page = 1;
      let pages = 1;
      do {
        const response = await classesApi.list({
          page,
          per_page: MEMBER_AGENDA_PAGE_SIZE,
          date_from: agendaRange.rangeStart.toISOString(),
          date_to: agendaRange.rangeEnd.toISOString(),
          sort_order: 'asc',
          ...(memberPlanId ? { member_plan_id: memberPlanId } : {}),
        });
        const payload = response.data as PaginatedResponse<GymClass>;
        const visibleItems = (payload.items ?? []).filter(
          (c) => c.status === 'scheduled' || c.status === 'in_progress',
        );
        aggregatedItems.push(...visibleItems);
        pages = Math.max(payload.pages || 1, 1);
        page += 1;
      } while (page <= pages);
      return {
        items: aggregatedItems,
        total: aggregatedItems.length,
        page: 1,
        per_page: aggregatedItems.length || MEMBER_AGENDA_PAGE_SIZE,
        pages: 1,
      };
    },
    enabled: Boolean(user),
    initialData: agendaWeekOffset === 0 ? memberSnapshot?.classes : undefined,
    initialDataUpdatedAt:
      agendaWeekOffset === 0 && memberSnapshot?.updatedAt
        ? Date.parse(memberSnapshot.updatedAt)
        : undefined,
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

  const initialSupportDateRange = useMemo(() => getNotificationPresetDateRange('30d'), []);
  const supportInteractionsQuery = useQuery<SupportInteraction[]>({
    queryKey: ['member-support-interactions', initialSupportDateRange.from, initialSupportDateRange.to],
    queryFn: async () =>
      (await mobileApi.listSupportInteractions({ limit: 50, date_from: initialSupportDateRange.from, date_to: initialSupportDateRange.to })).data,
    enabled: Boolean(user),
    initialData: memberSnapshot?.supportInteractions,
    initialDataUpdatedAt: memberSnapshot?.updatedAt ? Date.parse(memberSnapshot.updatedAt) : undefined,
    refetchInterval: isOnline ? 30000 : false,
    refetchIntervalInBackground: false,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
  });

  const initialNotificationDateRange = useMemo(() => getNotificationPresetDateRange('30d'), []);
  const notificationsQuery = useQuery<AppNotification[]>({
    queryKey: ['member-notifications', initialNotificationDateRange.from, initialNotificationDateRange.to],
    queryFn: async () =>
      (await notificationsApi.list({ date_from: initialNotificationDateRange.from, date_to: initialNotificationDateRange.to, limit: 100 })).data,
    enabled: Boolean(user),
    initialData: memberSnapshot?.notifications,
    initialDataUpdatedAt: memberSnapshot?.updatedAt ? Date.parse(memberSnapshot.updatedAt) : undefined,
    refetchInterval: isOnline ? 20000 : false,
    refetchIntervalInBackground: false,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
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

  // ── Mutations ─────────────────────────────────────────────────────────────

  const reserveMutation = useMutation({
    mutationFn: async (gymClassId: string) => reservationsApi.create({ gym_class_id: gymClassId }),
    onSuccess: async () => {
      toast.success('Reserva creada.');
      await refreshMemberQueries(queryClient);
    },
    onError: (error: any) => toast.error(getApiError(error, 'No se pudo reservar la clase.')),
  });

  const cancelMutation = useMutation({
    mutationFn: async ({ reservationId, reason }: { reservationId: string; reason?: string }) =>
      reservationsApi.cancel(reservationId, reason),
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
    onError: (error: any) => toast.error(getApiError(error, 'No se pudo actualizar la notificación.')),
  });

  const markAllNotificationsReadMutation = useMutation({
    mutationFn: async (notificationIds: string[]) =>
      Promise.all(notificationIds.map((id) => notificationsApi.update(id, { is_read: true, mark_opened: true }))),
    onSuccess: async (_, notificationIds) => {
      await queryClient.invalidateQueries({ queryKey: ['member-notifications'] });
      toast.success(
        notificationIds.length === 1
          ? 'La notificación quedó marcada como leída.'
          : 'Las notificaciones nuevas quedaron marcadas como leídas.',
      );
    },
    onError: (error: any) => toast.error(getApiError(error, 'No se pudieron actualizar las notificaciones.')),
  });

  const registerPushSubscriptionMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) =>
      (await mobileApi.registerPushSubscription(payload)).data,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['member-push-subscriptions'] });
    },
  });

  const createSupportInteractionMutation = useMutation({
    mutationFn: async () =>
      (await mobileApi.createSupportInteraction({
        channel: supportRequestForm.channel,
        subject: supportRequestForm.subject.trim(),
        notes: supportRequestForm.notes.trim() || null,
      })).data,
    onSuccess: async () => {
      setShowSupportRequestModal(false);
      setSupportRequestForm(createSupportRequestForm(preferredSupportChannel));
      setSelectedNotificationId(null);
      setTab(searchParams, setSearchParams, 'support');
      toast.success('Tu solicitud quedó enviada al gimnasio.');
      await queryClient.invalidateQueries({ queryKey: ['member-support-interactions'] });
    },
    onError: (error: any) => toast.error(getApiError(error, 'No pudimos enviar tu solicitud.')),
  });

  // ── Computed values ───────────────────────────────────────────────────────

  const classes = useMemo(
    () =>
      [...(classesQuery.data?.items ?? [])].sort(
        (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
      ),
    [classesQuery.data?.items],
  );

  const reservations = reservationsQuery.data?.items ?? [];
  const payments = paymentsQuery.data ?? [];
  const supportInteractions = supportInteractionsQuery.data ?? [];
  const notifications = notificationsQuery.data ?? [];
  const plans = plansQuery.data ?? [];
  const programs = programsQuery.data ?? [];
  const programBookings = programBookingsQuery.data ?? [];
  const pushSubscriptions = pushSubscriptionsQuery.data ?? [];

  const unreadNotifications = notifications.filter((n) => !n.is_read).length;
  const readNotifications = notifications.length - unreadNotifications;
  const actionableNotifications = notifications.filter((n) => Boolean(n.action_url)).length;
  const enrolledPrograms = programs.filter((p) => p.is_enrolled);
  const enrolledProgramIds = useMemo(() => new Set(enrolledPrograms.map((p) => p.id)), [enrolledPrograms]);
  const pendingSupportInteractions = supportInteractions.filter((i) => !i.resolved);
  const resolvedSupportInteractions = supportInteractions.length - pendingSupportInteractions.length;
  const memberFullName = user ? `${user.first_name} ${user.last_name}`.trim() : 'Miembro';
  const hasCheckinCode = Boolean(walletQuery.data?.qr_payload);
  const gymLocation = [profileQuery.data?.address, profileQuery.data?.city].filter(Boolean).join(', ');

  const accentColor =
    normalizeHexColor(profileQuery.data?.branding.primary_color, DEFAULT_PRIMARY_COLOR) ??
    DEFAULT_PRIMARY_COLOR;
  const secondaryColor =
    normalizeHexColor(profileQuery.data?.branding.secondary_color, DEFAULT_SECONDARY_COLOR) ??
    DEFAULT_SECONDARY_COLOR;
  const brandGradient = `linear-gradient(135deg, ${accentColor}, ${secondaryColor})`;
  const tenantDisplayName =
    profileQuery.data?.tenant_name || walletQuery.data?.tenant_name || 'Nexo Fitness';
  const ownerLogoUrl = profileQuery.data?.branding.logo_url;

  const supportPhone =
    sanitizeSupportContactValue(profileQuery.data?.branding.support_phone) ||
    sanitizeSupportContactValue(profileQuery.data?.phone) ||
    sanitizeSupportContactValue(
      profileQuery.data?.branches.find((b) => b.phone)?.phone,
    );
  const supportEmail =
    sanitizeSupportContactValue(profileQuery.data?.branding.support_email) ||
    sanitizeSupportContactValue(profileQuery.data?.email);
  const supportWhatsAppUrl = useMemo(
    () => buildSupportWhatsAppUrl(supportPhone, profileQuery.data?.tenant_name),
    [supportPhone, profileQuery.data?.tenant_name],
  );
  const supportCallUrl = useMemo(() => buildSupportCallUrl(supportPhone), [supportPhone]);
  const supportEmailUrl = useMemo(
    () => buildSupportEmailUrl(supportEmail, profileQuery.data?.tenant_name),
    [supportEmail, profileQuery.data?.tenant_name],
  );
  const preferredSupportChannel: SupportInteraction['channel'] = supportWhatsAppUrl
    ? 'whatsapp'
    : supportEmailUrl
      ? 'email'
      : supportCallUrl
        ? 'phone'
        : 'in_person';
  const hasDirectSupport = Boolean(supportWhatsAppUrl || supportCallUrl || supportEmailUrl);

  const webPushSupported = browserSupportsWebPush();
  const webPushConfigured = Boolean(
    pushConfigQuery.data?.enabled && pushConfigQuery.data?.public_vapid_key,
  );
  const activeWebPushSubscription = pushSubscriptions.find(
    (s) => s.provider === 'webpush' && s.is_active,
  );
  const notificationPermissionMeta = getNotificationPermissionMeta(notificationPermission);
  const installHint = getInstallHint({
    isStandalone,
    canPromptInstall: Boolean(deferredPrompt),
  });

  const isSyncing = [
    walletQuery.isFetching,
    profileQuery.isFetching,
    plansQuery.isFetching,
    classesQuery.isFetching,
    reservationsQuery.isFetching,
    paymentsQuery.isFetching,
    supportInteractionsQuery.isFetching,
    notificationsQuery.isFetching,
    pushConfigQuery.isFetching,
    pushSubscriptionsQuery.isFetching,
  ].some(Boolean);

  const lastSyncedAt = useMemo(() => {
    const timestamps = [
      walletQuery.dataUpdatedAt,
      profileQuery.dataUpdatedAt,
      plansQuery.dataUpdatedAt,
      classesQuery.dataUpdatedAt,
      reservationsQuery.dataUpdatedAt,
      paymentsQuery.dataUpdatedAt,
      supportInteractionsQuery.dataUpdatedAt,
      notificationsQuery.dataUpdatedAt,
      pushSubscriptionsQuery.dataUpdatedAt,
    ].filter((v) => v > 0);
    if (timestamps.length) return new Date(Math.max(...timestamps));
    if (memberSnapshot?.updatedAt) return new Date(memberSnapshot.updatedAt);
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
    supportInteractionsQuery.dataUpdatedAt,
    walletQuery.dataUpdatedAt,
  ]);

  const navBadgeByTab: Partial<Record<MemberTabId, string>> = {
    support: pendingSupportInteractions.length ? String(pendingSupportInteractions.length) : '',
    notifications: unreadNotifications ? (unreadNotifications > 9 ? '9+' : String(unreadNotifications)) : '',
    payments: payments.length ? String(payments.length) : '',
  };

  // ── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    setNotificationPermission('Notification' in window ? Notification.permission : 'unsupported');
  }, []);

  useEffect(() => {
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
    if (typeof window === 'undefined' || typeof document === 'undefined' || !user) return;

    const refreshNotifications = () => {
      if (!navigator.onLine) return;
      void queryClient.invalidateQueries({ queryKey: ['member-notifications'] });
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshNotifications();
    };
    const handleFocus = () => refreshNotifications();
    const handleServiceWorkerMessage = (event: MessageEvent<MemberServiceWorkerMessage>) => {
      const messageType = event.data?.type;
      if (messageType === 'member-push-received' || messageType === 'member-notification-clicked') {
        refreshNotifications();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
    }
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage);
      }
    };
  }, [queryClient, user]);

  // Back button intercept — solo en PWA standalone (Android back / iOS edge swipe).
  //
  // Estrategia: el handler SIEMPRE hace pushState primero (para que la app nunca
  // cierre accidentalmente). Para el "doble back = salir" en inicio, el handler
  // deshace ese push con history.back() y usa ignoreNext para no re-interceptarlo.
  useEffect(() => {
    if (!isStandalone) return;

    window.history.pushState({ nexoPWA: true }, '');

    let exitPending = false;
    let exitTimer: ReturnType<typeof setTimeout> | null = null;
    let ignoreNext = false;

    const handlePopState = () => {
      if (ignoreNext) {
        ignoreNext = false;
        return;
      }

      // Re-push SIEMPRE primero — garantiza que el OS no cierre la app mientras
      // ejecutamos la lógica. Si decidimos salir, lo deshacemos con history.back().
      window.history.pushState({ nexoPWA: true }, '');

      const tab = activeTabRef.current;

      if (tab !== 'home') {
        exitPending = false;
        if (exitTimer) { clearTimeout(exitTimer); exitTimer = null; }
        setSearchParams(new URLSearchParams([['tab', 'home']]), { replace: true });
        return;
      }

      if (exitPending) {
        // Segunda pulsación en inicio: deshacer el push y dejar que el OS cierre
        exitPending = false;
        if (exitTimer) { clearTimeout(exitTimer); exitTimer = null; }
        ignoreNext = true;
        window.history.back();
        return;
      }

      exitPending = true;
      exitTimer = setTimeout(() => { exitPending = false; exitTimer = null; }, 2000);
      toast('Presiona de nuevo para salir');
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      if (exitTimer) clearTimeout(exitTimer);
    };
  }, [isStandalone, setSearchParams]);

  useEffect(() => {
    const checkoutState = searchParams.get('checkout');
    if (!checkoutState) return;
    toast(checkoutState === 'success' ? 'Tu pago fue confirmado.' : 'No se completó el pago.');
    const next = new URLSearchParams(searchParams);
    next.delete('checkout');
    setSearchParams(next, { replace: true });
    void refreshMemberQueries(queryClient);
  }, [queryClient, searchParams, setSearchParams]);

  useEffect(() => {
    if (!user) return;
    const nextSnapshot: Partial<MemberSnapshot> = {};
    if (walletQuery.data) nextSnapshot.wallet = walletQuery.data;
    if (profileQuery.data) nextSnapshot.profile = profileQuery.data;
    if (plansQuery.data) nextSnapshot.plans = plansQuery.data;
    if (programsQuery.data) nextSnapshot.programs = programsQuery.data;
    if (classesQuery.data && agendaWeekOffset === 0) nextSnapshot.classes = classesQuery.data;
    if (reservationsQuery.data) nextSnapshot.reservations = reservationsQuery.data;
    if (paymentsQuery.data) nextSnapshot.payments = paymentsQuery.data;
    if (supportInteractionsQuery.data) nextSnapshot.supportInteractions = supportInteractionsQuery.data;
    if (notificationsQuery.data) nextSnapshot.notifications = notificationsQuery.data;
    if (Object.keys(nextSnapshot).length) {
      saveMemberSnapshot<MemberSnapshot>(user.id, nextSnapshot, lastSyncedAt?.toISOString());
    }
  }, [
    agendaWeekOffset,
    classesQuery.data,
    lastSyncedAt,
    notificationsQuery.data,
    paymentsQuery.data,
    plansQuery.data,
    programsQuery.data,
    profileQuery.data,
    reservationsQuery.data,
    supportInteractionsQuery.data,
    user,
    walletQuery.data,
  ]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const syncMemberData = async () => {
    if (!isOnline) {
      toast('Sin conexión. Mostrando la última información guardada en este dispositivo.');
      return;
    }
    await refreshMemberQueries(queryClient);
    toast.success('Datos actualizados.');
  };

  const logoutMember = async () => {
    try {
      await authApi.logout();
    } catch {
      // Ignore transport errors on logout.
    }
    if (user) clearMemberSnapshot(user.id);
    logout();
    navigate('/login');
  };

  const copyCheckinCode = async () => {
    const code = walletQuery.data?.qr_payload;
    if (!code) {
      toast.error('Todavía no hay código de acceso sincronizado.');
      return;
    }
    if (!navigator.clipboard?.writeText) {
      toast.error('Este navegador no permite copiar automáticamente.');
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      toast.success('Código de check-in copiado.');
    } catch {
      toast.error('No se pudo copiar el código.');
    }
  };

  const enableWebPush = async () => {
    if (!webPushSupported) {
      toast.error('Este navegador no permite activar avisos.');
      return;
    }
    if (!isOnline) {
      toast('Necesitas conexión para activar los avisos en este dispositivo.');
      return;
    }
    const publicKey = pushConfigQuery.data?.public_vapid_key;
    if (!pushConfigQuery.data?.enabled || !publicKey) {
      toast.error('Los avisos todavía no están disponibles.');
      return;
    }
    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
      setNotificationPermission(permission);
    }
    if (permission !== 'granted') {
      toast.error('Debes permitir las notificaciones para activar los avisos.');
      return;
    }
    try {
      const subscription = await ensureWebPushSubscription(publicKey);
      await registerPushSubscriptionMutation.mutateAsync(subscriptionToApiPayload(subscription));
      toast.success('Avisos activados para este dispositivo.');
    } catch (error: any) {
      toast.error(error?.message || 'No se pudieron activar los avisos.');
    }
  };

  const installApp = async () => {
    if (!deferredPrompt) {
      toast('Usa el menú del navegador para agregar esta app a tu pantalla de inicio.');
      return;
    }
    await deferredPrompt.prompt();
    setDeferredPrompt(null);
  };

  const openSupportRequestModal = () => {
    setSupportRequestForm((current) => {
      if (current.subject.trim() || current.notes.trim()) return current;
      return createSupportRequestForm(preferredSupportChannel);
    });
    setShowSupportRequestModal(true);
  };

  const navigateTo = (tab: MemberTabId) => setTab(searchParams, setSearchParams, tab);

  if (!user) return null;

  const value: MemberContextValue = {
    user,
    accentColor,
    secondaryColor,
    brandGradient,
    isDark,
    toggleTheme,
    tenantDisplayName,
    ownerLogoUrl,
    wallet: walletQuery.data,
    profile: profileQuery.data,
    plans,
    programs,
    classes,
    reservations,
    payments,
    notifications,
    supportInteractions,
    pushSubscriptions,
    programBookings,
    walletQuery,
    classesQuery,
    paymentsQuery,
    supportInteractionsQuery,
    notificationsQuery,
    programsQuery,
    programBookingsQuery,
    plansQuery,
    reservationsQuery,
    pushConfigQuery,
    unreadNotifications,
    readNotifications,
    actionableNotifications,
    pendingSupportInteractions,
    resolvedSupportInteractions,
    enrolledPrograms,
    enrolledProgramIds,
    memberFullName,
    hasCheckinCode,
    gymLocation,
    navBadgeByTab,
    supportPhone,
    supportWhatsAppUrl,
    supportCallUrl,
    supportEmailUrl,
    hasDirectSupport,
    preferredSupportChannel,
    isOnline,
    isSyncing,
    isStandalone,
    lastSyncedAt,
    notificationPermission,
    notificationPermissionMeta,
    webPushSupported,
    webPushConfigured,
    activeWebPushSubscription,
    installHint,
    activeTab,
    navigateTo,
    reserveMutation,
    cancelMutation,
    notificationMutation,
    markAllNotificationsReadMutation,
    registerPushSubscriptionMutation,
    selectedNotificationId,
    setSelectedNotificationId,
    showSupportRequestModal,
    setShowSupportRequestModal,
    supportRequestForm,
    setSupportRequestForm,
    createSupportInteractionMutation,
    syncMemberData,
    logoutMember,
    copyCheckinCode,
    enableWebPush,
    installApp,
    openSupportRequestModal,
    agendaWeekOffset,
    setAgendaWeekOffset,
    agendaWeekDates,
    agendaProgramFilter,
    setAgendaProgramFilter,
    queryClient,
    cn,
    withAlpha,
  };

  return <MemberContext.Provider value={value}>{children}</MemberContext.Provider>;
}
