import { useEffect, useMemo, useState } from 'react';
import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  CalendarDays,
  Camera,
  CheckCheck,
  ChevronDown,
  Copy,
  CreditCard,
  Download,
  Dumbbell,
  ExternalLink,
  Home,
  ImageOff,
  LifeBuoy,
  LogOut,
  Mail,
  MapPin,
  Menu,
  Moon,
  Sun,
  Pencil,
  Phone,
  Plus,
  QrCode,
  RefreshCcw,
  Search,
  ShieldCheck,
  Ticket,
  Trash2,
  Trophy,
  TrendingUp,
  Upload,
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
import WhatsAppIcon from '@/components/icons/WhatsAppIcon';
import Modal from '@/components/ui/Modal';
import Tooltip from '@/components/ui/Tooltip';
import { browserSupportsWebPush, ensureWebPushSubscription, subscriptionToApiPayload } from '@/lib/webPush';
import { authApi, classesApi, mobileApi, notificationsApi, promoCodesApi, publicApi, reservationsApi } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { useThemeStore } from '@/stores/themeStore';
import type {
  AppNotification,
  BodyMeasurement,
  GymClass,
  MobilePaymentHistoryItem,
  TrainingProgram,
  MobileWallet,
  PaginatedResponse,
  PersonalRecord,
  Plan,
  ProgressPhoto,
  PromoCodeValidateResponse,
  PushSubscriptionRecord,
  PublicCheckoutSession,
  Reservation,
  SupportInteraction,
  TenantPublicProfile,
  WebPushConfig,
} from '@/types';
import {
  classStatusColor,
  cn,
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_SECONDARY_COLOR,
  formatClassModalityLabel,
  formatClassStatusLabel,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatDurationLabel,
  formatMembershipStatusLabel,
  formatRelative,
  formatSupportChannelLabel,
  formatTime,
  formatUserRoleLabel,
  membershipStatusColor,
  paymentStatusColor,
  supportChannelBadgeColor,
  getApiError,
  getPublicAppOrigin,
  normalizeHexColor,
  withAlpha,
} from '@/utils';
import type { SupportTimelineEntry } from '@/utils/support';
import { getSupportLastActivityAt, getSupportLastTimelineEntry, getSupportTraceCount, parseSupportTimeline } from '@/utils/support';

type MemberTabId = 'home' | 'agenda' | 'programs' | 'support' | 'plans' | 'payments' | 'notifications' | 'profile' | 'progress';
type SupportFilter = 'all' | 'pending' | 'resolved';
type NotificationFilter = 'all' | 'unread' | 'read' | 'actionable';
type NotificationDatePreset = '7d' | '30d' | '90d' | 'custom';
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
  programs?: TrainingProgram[];
  classes?: PaginatedResponse<GymClass>;
  reservations?: PaginatedResponse<Reservation>;
  payments?: MobilePaymentHistoryItem[];
  supportInteractions?: SupportInteraction[];
  notifications?: AppNotification[];
};
type MemberServiceWorkerMessage = {
  type?: 'member-push-received' | 'member-notification-clicked';
  payload?: {
    title?: string;
    url?: string;
    notificationId?: string | null;
  };
};
type SupportRequestForm = {
  channel: SupportInteraction['channel'];
  subject: string;
  notes: string;
};

const TABS: Array<{
  id: MemberTabId;
  label: string;
  icon: typeof Home;
  primary: boolean;
  description: string;
}> = [
  { id: 'home', label: 'Inicio', icon: Home, primary: true, description: 'Pase digital y accesos rápidos' },
  { id: 'agenda', label: 'Agenda', icon: CalendarDays, primary: true, description: 'Clases, reservas y próximas actividades' },
  { id: 'programs', label: 'Programas', icon: Dumbbell, primary: false, description: 'Programas de entrenamiento e inscripción personal' },
  { id: 'progress', label: 'Progreso', icon: TrendingUp, primary: true, description: 'Registro de medidas y evolución corporal' },
  { id: 'support', label: 'Soporte', icon: LifeBuoy, primary: true, description: 'Ayuda, respuestas y seguimiento de tus casos' },
  { id: 'plans', label: 'Planes', icon: Ticket, primary: false, description: 'Planes disponibles y compra online' },
  { id: 'payments', label: 'Pagos', icon: CreditCard, primary: false, description: 'Historial de pagos y comprobantes' },
  { id: 'notifications', label: 'Bandeja', icon: Bell, primary: false, description: 'Avisos, recordatorios y acciones pendientes' },
  { id: 'profile', label: 'Perfil', icon: UserRound, primary: false, description: 'Cuenta, dispositivo y preferencias personales' },
];
// El backend actual guarda esta preferencia, pero todavía no procesa cobros
// recurrentes para membresías de clientes.
const MEMBER_AUTO_RENEW_AVAILABLE = false;

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
  const [showSupportRequestModal, setShowSupportRequestModal] = useState(false);
  const [supportRequestForm, setSupportRequestForm] = useState<SupportRequestForm>(() => createSupportRequestForm());
  const [supportFilter, setSupportFilter] = useState<SupportFilter>('all');
  const [selectedSupportInteractionId, setSelectedSupportInteractionId] = useState<string | null>(null);
  const initialSupportDateRange = useMemo(() => getNotificationPresetDateRange('30d'), []);
  const [supportDatePreset, setSupportDatePreset] = useState<NotificationDatePreset>('30d');
  const [supportDateFrom, setSupportDateFrom] = useState(initialSupportDateRange.from);
  const [supportDateTo, setSupportDateTo] = useState(initialSupportDateRange.to);
  const [agendaDateFilter, setAgendaDateFilter] = useState<'all' | 'today' | 'week'>('all');
  const [agendaModalityFilter, setAgendaModalityFilter] = useState<string>('all');
  const [agendaBranchFilter, setAgendaBranchFilter] = useState<string>('all');
  const [notificationFilter, setNotificationFilter] = useState<NotificationFilter>('all');
  const [notificationSearch, setNotificationSearch] = useState('');
  const initialNotificationDateRange = useMemo(() => getNotificationPresetDateRange('30d'), []);
  const [notificationDatePreset, setNotificationDatePreset] = useState<NotificationDatePreset>('30d');
  const [notificationDateFrom, setNotificationDateFrom] = useState(initialNotificationDateRange.from);
  const [notificationDateTo, setNotificationDateTo] = useState(initialNotificationDateRange.to);
  const [selectedNotificationId, setSelectedNotificationId] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [expandedDrawerSections, setExpandedDrawerSections] = useState<Set<string>>(new Set(['nav']));
  const [pendingCancelReservationId, setPendingCancelReservationId] = useState<string | null>(null);
  const [cancelReasonText, setCancelReasonText] = useState('');
  const [promoInputByPlan, setPromoInputByPlan] = useState<Record<string, string>>({});
  const [promoResultByPlan, setPromoResultByPlan] = useState<Record<string, PromoCodeValidateResponse | null>>({});
  const [promoValidatingPlan, setPromoValidatingPlan] = useState<string | null>(null);
  const [showAddMeasurement, setShowAddMeasurement] = useState(false);
  const [measurementForm, setMeasurementForm] = useState({
    recorded_at: new Date().toISOString().slice(0, 10),
    weight_kg: '',
    body_fat_pct: '',
    muscle_mass_kg: '',
    chest_cm: '',
    waist_cm: '',
    hip_cm: '',
    arm_cm: '',
    thigh_cm: '',
    notes: '',
  });
  const [showAddPR, setShowAddPR] = useState(false);
  const [prForm, setPrForm] = useState({ exercise_name: '', record_value: '', unit: 'kg', recorded_at: new Date().toISOString().slice(0, 10), notes: '' });
  const [prExerciseFilter, setPrExerciseFilter] = useState('');
  const [showPhotoUpload, setShowPhotoUpload] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoNotes, setPhotoNotes] = useState('');
  const [photoRecordedAt, setPhotoRecordedAt] = useState(new Date().toISOString().slice(0, 10));
  const [progressSubTab, setProgressSubTab] = useState<'measurements' | 'photos' | 'records'>('measurements');
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

  const supportInteractionsQuery = useQuery<SupportInteraction[]>({
    queryKey: ['member-support-interactions', supportDateFrom, supportDateTo],
    queryFn: async () => (
      await mobileApi.listSupportInteractions({
        limit: 50,
        date_from: supportDateFrom,
        date_to: supportDateTo,
      })
    ).data,
    enabled: Boolean(user),
    initialData:
      supportDatePreset === '30d'
      && supportDateFrom === initialSupportDateRange.from
      && supportDateTo === initialSupportDateRange.to
        ? memberSnapshot?.supportInteractions?.filter((interaction) =>
          isDateKeyWithinRange(getAgendaDateKey(interaction.created_at), initialSupportDateRange.from, initialSupportDateRange.to))
        : undefined,
    initialDataUpdatedAt:
      supportDatePreset === '30d'
      && supportDateFrom === initialSupportDateRange.from
      && supportDateTo === initialSupportDateRange.to
      && memberSnapshot?.updatedAt
        ? Date.parse(memberSnapshot.updatedAt)
        : undefined,
    refetchInterval: isOnline ? 30000 : false,
    refetchIntervalInBackground: false,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
  });

  const notificationsQuery = useQuery<AppNotification[]>({
    queryKey: ['member-notifications', notificationDateFrom, notificationDateTo],
    queryFn: async () => (
      await notificationsApi.list({
        date_from: notificationDateFrom,
        date_to: notificationDateTo,
        limit: 100,
      })
    ).data,
    enabled: Boolean(user),
    initialData:
      notificationDatePreset === '30d'
      && notificationDateFrom === initialNotificationDateRange.from
      && notificationDateTo === initialNotificationDateRange.to
        ? memberSnapshot?.notifications
        : undefined,
    initialDataUpdatedAt:
      notificationDatePreset === '30d'
      && notificationDateFrom === initialNotificationDateRange.from
      && notificationDateTo === initialNotificationDateRange.to
      && memberSnapshot?.updatedAt
        ? Date.parse(memberSnapshot.updatedAt)
        : undefined,
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

  const measurementsQuery = useQuery<BodyMeasurement[]>({
    queryKey: ['member-measurements'],
    queryFn: async () => (await mobileApi.listMeasurements()).data,
    enabled: Boolean(user),
  });

  const addMeasurementMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => mobileApi.createMeasurement(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['member-measurements'] });
      setShowAddMeasurement(false);
      setMeasurementForm({
        recorded_at: new Date().toISOString().slice(0, 10),
        weight_kg: '', body_fat_pct: '', muscle_mass_kg: '',
        chest_cm: '', waist_cm: '', hip_cm: '', arm_cm: '', thigh_cm: '', notes: '',
      });
      toast.success('Medición registrada.');
    },
    onError: () => toast.error('No se pudo guardar la medición.'),
  });

  const deleteMeasurementMutation = useMutation({
    mutationFn: (id: string) => mobileApi.deleteMeasurement(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['member-measurements'] }),
    onError: () => toast.error('No se pudo eliminar.'),
  });

  const personalRecordsQuery = useQuery<PersonalRecord[]>({
    queryKey: ['member-personal-records', prExerciseFilter],
    queryFn: async () => (await mobileApi.listPersonalRecords(prExerciseFilter || undefined)).data,
    enabled: Boolean(user),
  });

  const addPRMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => mobileApi.createPersonalRecord(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['member-personal-records'] });
      setShowAddPR(false);
      setPrForm({ exercise_name: '', record_value: '', unit: 'kg', recorded_at: new Date().toISOString().slice(0, 10), notes: '' });
      toast.success('Récord guardado.');
    },
    onError: () => toast.error('No se pudo guardar el récord.'),
  });

  const deletePRMutation = useMutation({
    mutationFn: (id: string) => mobileApi.deletePersonalRecord(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['member-personal-records'] }),
    onError: () => toast.error('No se pudo eliminar el récord.'),
  });

  const progressPhotosQuery = useQuery<ProgressPhoto[]>({
    queryKey: ['member-progress-photos'],
    queryFn: async () => (await mobileApi.listProgressPhotos()).data,
    enabled: Boolean(user),
  });

  const uploadPhotoMutation = useMutation({
    mutationFn: (formData: FormData) => mobileApi.uploadProgressPhoto(formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['member-progress-photos'] });
      setShowPhotoUpload(false);
      setPhotoFile(null);
      setPhotoNotes('');
      setPhotoRecordedAt(new Date().toISOString().slice(0, 10));
      toast.success('Foto guardada.');
    },
    onError: () => toast.error('No se pudo subir la foto.'),
  });

  const deletePhotoMutation = useMutation({
    mutationFn: (id: string) => mobileApi.deleteProgressPhoto(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['member-progress-photos'] }),
    onError: () => toast.error('No se pudo eliminar la foto.'),
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
    mutationFn: async ({ reservationId, reason }: { reservationId: string; reason?: string }) =>
      reservationsApi.cancel(reservationId, reason),
    onSuccess: async () => {
      toast.success('Reserva cancelada.');
      setPendingCancelReservationId(null);
      setCancelReasonText('');
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
    onError: (error: any) => {
      toast.error(getApiError(error, 'No se pudo actualizar la notificación.'));
    },
  });

  const markAllNotificationsReadMutation = useMutation({
    mutationFn: async (notificationIds: string[]) =>
      Promise.all(
        notificationIds.map((notificationId) =>
          notificationsApi.update(notificationId, { is_read: true, mark_opened: true }),
        ),
      ),
    onSuccess: async (_, notificationIds) => {
      await queryClient.invalidateQueries({ queryKey: ['member-notifications'] });
      toast.success(
        notificationIds.length === 1
          ? 'La notificación quedó marcada como leída.'
          : 'Las notificaciones nuevas quedaron marcadas como leídas.',
      );
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No se pudieron actualizar las notificaciones.'));
    },
  });

  const checkoutMutation = useMutation({
    mutationFn: async (planId: string) => {
      if (!tenantSlug || !user) {
        throw new Error('No hay una cuenta lista para el pago.');
      }
      const memberUrl = `${getPublicAppOrigin()}/member`;
      const promoResult = promoResultByPlan[planId];
      const response = await publicApi.createCheckoutSession(tenantSlug, {
        plan_id: planId,
        customer_name: `${user.first_name} ${user.last_name}`.trim(),
        customer_email: user.email,
        customer_phone: user.phone || undefined,
        success_url: `${memberUrl}?tab=plans&checkout=success`,
        cancel_url: `${memberUrl}?tab=plans&checkout=cancelled`,
        ...(promoResult?.valid && promoResult.promo_code_id ? { promo_code_id: promoResult.promo_code_id } : {}),
      });
      return response.data as PublicCheckoutSession;
    },
    onSuccess: (session) => {
      setCheckoutSession(session);
      window.location.href = session.checkout_url;
    },
    onError: (error: any) => toast.error(error?.response?.data?.detail || error?.message || 'No se pudo iniciar el pago.'),
  });

  async function validatePromoCode(planId: string) {
    const code = (promoInputByPlan[planId] ?? '').trim();
    if (!code) return;
    setPromoValidatingPlan(planId);
    try {
      const resp = await promoCodesApi.validate(code, planId);
      const result: PromoCodeValidateResponse = resp.data;
      setPromoResultByPlan((prev) => ({ ...prev, [planId]: result }));
      if (!result.valid) {
        toast.error(result.reason ?? 'Código inválido');
      }
    } catch {
      toast.error('No se pudo validar el código.');
    } finally {
      setPromoValidatingPlan(null);
    }
  }

  const enrollProgramMutation = useMutation({
    mutationFn: async (programId: string) => (await mobileApi.enrollProgram(programId)).data,
    onSuccess: async () => {
      toast.success('Te inscribiste al programa.');
      await queryClient.invalidateQueries({ queryKey: ['member-programs'] });
    },
    onError: (error: any) => toast.error(getApiError(error, 'No se pudo completar la inscripción.')),
  });

  const leaveProgramMutation = useMutation({
    mutationFn: async (programId: string) => mobileApi.leaveProgram(programId),
    onSuccess: async () => {
      toast.success('Dejaste el programa.');
      await queryClient.invalidateQueries({ queryKey: ['member-programs'] });
    },
    onError: (error: any) => toast.error(getApiError(error, 'No se pudo quitar la inscripción.')),
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

  const createSupportInteractionMutation = useMutation({
    mutationFn: async () =>
      (
        await mobileApi.createSupportInteraction({
          channel: supportRequestForm.channel,
          subject: supportRequestForm.subject.trim(),
          notes: supportRequestForm.notes.trim() || null,
        })
      ).data,
    onSuccess: async (createdInteraction: SupportInteraction) => {
      setShowSupportRequestModal(false);
      setSupportRequestForm(createSupportRequestForm(preferredSupportChannel));
      setSelectedSupportInteractionId(createdInteraction.id);
      setSupportFilter('all');
      setTab(searchParams, setSearchParams, 'support');
      toast.success('Tu solicitud quedó enviada al gimnasio.');
      await queryClient.invalidateQueries({ queryKey: ['member-support-interactions'] });
    },
    onError: (error: any) => toast.error(getApiError(error, 'No pudimos enviar tu solicitud.')),
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
  const agendaBranches = useMemo(() => (
    Array.from(
      new Map(
        classes
          .filter((gymClass) => gymClass.branch_id && gymClass.branch_name)
          .map((gymClass) => [gymClass.branch_id!, { id: gymClass.branch_id!, name: gymClass.branch_name! }]),
      ).values(),
    ).sort((left, right) => left.name.localeCompare(right.name, 'es-CL'))
  ), [classes]);

  const filteredClasses = useMemo(() => {
    const now = new Date();
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, 23, 59, 59);
    return classes.filter((c) => {
      const start = new Date(c.start_time);
      if (agendaDateFilter === 'today' && start > todayEnd) return false;
      if (agendaDateFilter === 'week' && start > weekEnd) return false;
      if (agendaModalityFilter !== 'all' && c.modality !== agendaModalityFilter) return false;
      if (agendaBranchFilter !== 'all' && c.branch_id !== agendaBranchFilter) return false;
      return true;
    });
  }, [agendaBranchFilter, agendaDateFilter, agendaModalityFilter, classes]);
  const reservations = reservationsQuery.data?.items ?? [];
  const payments = paymentsQuery.data ?? [];
  const supportInteractions = supportInteractionsQuery.data ?? [];
  const notifications = notificationsQuery.data ?? [];
  const isDefaultNotificationDateRange =
    notificationDatePreset === '30d'
    && notificationDateFrom === initialNotificationDateRange.from
    && notificationDateTo === initialNotificationDateRange.to;
  const plans = plansQuery.data ?? [];
  const programs = programsQuery.data ?? [];
  const enrolledPrograms = programs.filter((program) => program.is_enrolled);
  const pushSubscriptions = pushSubscriptionsQuery.data ?? [];
  const accentColor = normalizeHexColor(profileQuery.data?.branding.primary_color, DEFAULT_PRIMARY_COLOR) ?? DEFAULT_PRIMARY_COLOR;
  const secondaryColor = normalizeHexColor(profileQuery.data?.branding.secondary_color, DEFAULT_SECONDARY_COLOR) ?? DEFAULT_SECONDARY_COLOR;
  const brandGradient = `linear-gradient(135deg, ${accentColor}, ${secondaryColor})`;
  const unreadNotifications = notifications.filter((item) => !item.is_read).length;
  const readNotifications = notifications.length - unreadNotifications;
  const actionableNotifications = notifications.filter((item) => Boolean(item.action_url)).length;
  const filteredNotifications = useMemo(() => {
    const query = notificationSearch.trim().toLowerCase();

    return [...notifications]
      .sort((left, right) => {
        if (left.is_read !== right.is_read) {
          return Number(left.is_read) - Number(right.is_read);
        }
        return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
      })
      .filter((notification) => {
        if (notificationFilter === 'unread' && notification.is_read) return false;
        if (notificationFilter === 'read' && !notification.is_read) return false;
        if (notificationFilter === 'actionable' && !notification.action_url) return false;
        if (!query) return true;
        const haystack = `${notification.title} ${notification.message ?? ''}`.toLowerCase();
        return haystack.includes(query);
      });
  }, [notificationFilter, notificationSearch, notifications]);
  const selectedNotification = useMemo(
    () => notifications.find((notification) => notification.id === selectedNotificationId) ?? null,
    [notifications, selectedNotificationId],
  );
  const notificationDateRangeSummary = useMemo(
    () => getNotificationDateRangeSummary(notificationDateFrom, notificationDateTo),
    [notificationDateFrom, notificationDateTo],
  );
  const supportDateRangeSummary = useMemo(
    () => getNotificationDateRangeSummary(supportDateFrom, supportDateTo),
    [supportDateFrom, supportDateTo],
  );
  const memberFullName = user ? `${user.first_name} ${user.last_name}`.trim() : 'Miembro';
  const installHint = getInstallHint({ isStandalone, canPromptInstall: Boolean(deferredPrompt) });
  const notificationPermissionMeta = getNotificationPermissionMeta(notificationPermission);
  const hasCheckinCode = Boolean(walletQuery.data?.qr_payload);
  const gymLocation = [profileQuery.data?.address, profileQuery.data?.city].filter(Boolean).join(', ');
  const supportPhone =
    sanitizeSupportContactValue(profileQuery.data?.branding.support_phone)
    || sanitizeSupportContactValue(profileQuery.data?.phone)
    || sanitizeSupportContactValue(profileQuery.data?.branches.find((branch) => branch.phone)?.phone);
  const supportEmail =
    sanitizeSupportContactValue(profileQuery.data?.branding.support_email)
    || sanitizeSupportContactValue(profileQuery.data?.email);
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
  const supportInteractionMetaMap = useMemo(
    () =>
      new Map(
        supportInteractions.map((interaction) => [
          interaction.id,
          {
            lastEntry: getSupportLastTimelineEntry(interaction.notes, {
              createdAt: interaction.created_at,
              authorName: interaction.client_name || 'Solicitud',
            }),
            lastActivityAt: getSupportLastActivityAt(interaction.notes, {
              createdAt: interaction.created_at,
              authorName: interaction.client_name || 'Solicitud',
            }) || interaction.created_at,
            traceCount: getSupportTraceCount(interaction.notes, {
              createdAt: interaction.created_at,
              authorName: interaction.client_name || 'Solicitud',
            }),
          },
        ]),
      ),
    [supportInteractions],
  );
  const pendingSupportInteractions = supportInteractions.filter((item) => !item.resolved);
  const resolvedSupportInteractions = supportInteractions.length - pendingSupportInteractions.length;
  const filteredSupportInteractions = useMemo(
    () =>
      [...supportInteractions]
        .filter((interaction) => {
          if (supportFilter === 'pending') return !interaction.resolved;
          if (supportFilter === 'resolved') return interaction.resolved;
          return true;
        })
        .sort((left, right) => {
          const leftActivityAt = supportInteractionMetaMap.get(left.id)?.lastActivityAt || left.created_at;
          const rightActivityAt = supportInteractionMetaMap.get(right.id)?.lastActivityAt || right.created_at;
          return new Date(rightActivityAt).getTime() - new Date(leftActivityAt).getTime();
        }),
    [supportFilter, supportInteractionMetaMap, supportInteractions],
  );
  const selectedSupportInteraction = supportInteractions.find((interaction) => interaction.id === selectedSupportInteractionId) ?? null;
  const selectedSupportMeta = selectedSupportInteraction
    ? supportInteractionMetaMap.get(selectedSupportInteraction.id) ?? null
    : null;
  const selectedSupportTimeline = useMemo(
    () => (
      selectedSupportInteraction
        ? parseSupportTimeline(selectedSupportInteraction.notes, {
            createdAt: selectedSupportInteraction.created_at,
            authorName: selectedSupportInteraction.client_name || memberFullName,
            authorRole: 'client',
          })
        : []
    ),
    [memberFullName, selectedSupportInteraction],
  );
  const latestSupportActivityAt = filteredSupportInteractions.length
    ? supportInteractionMetaMap.get(filteredSupportInteractions[0].id)?.lastActivityAt || filteredSupportInteractions[0].created_at
    : null;
  const webPushSupported = browserSupportsWebPush();
  const webPushConfigured = Boolean(pushConfigQuery.data?.enabled && pushConfigQuery.data?.public_vapid_key);
  const activeWebPushSubscription = pushSubscriptions.find((item) => item.provider === 'webpush' && item.is_active);
  const webPushStateLabel = activeWebPushSubscription
    ? 'Activa'
    : webPushSupported
      ? webPushConfigured
        ? 'Lista para activar'
        : 'Próximamente'
      : 'No disponible';
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
    supportInteractionsQuery.dataUpdatedAt,
    walletQuery.dataUpdatedAt,
  ]);
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

  useEffect(() => {
    if (notificationDatePreset === 'custom') {
      return;
    }
    const nextRange = getNotificationPresetDateRange(notificationDatePreset);
    setNotificationDateFrom(nextRange.from);
    setNotificationDateTo(nextRange.to);
  }, [notificationDatePreset]);

  useEffect(() => {
    if (supportDatePreset === 'custom') {
      return;
    }
    const nextRange = getNotificationPresetDateRange(supportDatePreset);
    setSupportDateFrom(nextRange.from);
    setSupportDateTo(nextRange.to);
  }, [supportDatePreset]);

  useEffect(() => {
    if (selectedSupportInteractionId && !supportInteractions.some((interaction) => interaction.id === selectedSupportInteractionId)) {
      setSelectedSupportInteractionId(null);
    }
  }, [selectedSupportInteractionId, supportInteractions]);

  useEffect(() => {
    if (activeTab !== 'progress') {
      if (showAddMeasurement) setShowAddMeasurement(false);
      if (showAddPR) setShowAddPR(false);
      if (showPhotoUpload) setShowPhotoUpload(false);
    }
  }, [activeTab, showAddMeasurement, showAddPR, showPhotoUpload]);

  const reservationByClassId = new Map(
    reservations.filter((item) => item.status !== 'cancelled').map((item) => [item.gym_class_id, item]),
  );
  const reservedVisibleClasses = filteredClasses.filter((gymClass) => reservationByClassId.has(gymClass.id)).length;
  const classesWithAvailableSpots = filteredClasses.filter((gymClass) => gymClass.current_bookings < gymClass.max_capacity).length;
  const agendaGroups = useMemo(() => {
    const groups = new Map<string, { key: string; date: string; items: GymClass[] }>();

    filteredClasses.forEach((gymClass) => {
      const key = getAgendaDateKey(gymClass.start_time);
      const current = groups.get(key);
      if (current) {
        current.items.push(gymClass);
        return;
      }
      groups.set(key, { key, date: gymClass.start_time, items: [gymClass] });
    });

    return Array.from(groups.values());
  }, [filteredClasses]);
  const pageBackground = isDark
    ? `radial-gradient(circle at top, ${withAlpha(accentColor, 0.28)}, transparent 28%), radial-gradient(circle at 86% 12%, ${withAlpha(secondaryColor, 0.2)}, transparent 20%), linear-gradient(180deg, #04141a 0%, #08161d 48%, #04141a 100%)`
    : `radial-gradient(circle at top, ${withAlpha(accentColor, 0.18)}, transparent 28%), radial-gradient(circle at 88% 12%, ${withAlpha(secondaryColor, 0.12)}, transparent 18%), linear-gradient(180deg, #f8fafc 0%, #eef6ff 48%, #f8fafc 100%)`;
  const activeTabMeta = TABS.find((tab) => tab.id === activeTab) ?? TABS[0];
  const tenantDisplayName = profileQuery.data?.tenant_name || walletQuery.data?.tenant_name || 'Nexo Fitness';
  const ownerLogoUrl = profileQuery.data?.branding.logo_url;
  const navBadgeByTab: Partial<Record<MemberTabId, string>> = {
    support: pendingSupportInteractions.length ? String(pendingSupportInteractions.length) : '',
    notifications: unreadNotifications ? (unreadNotifications > 9 ? '9+' : String(unreadNotifications)) : '',
    payments: payments.length ? String(payments.length) : '',
  };

  useEffect(() => {
    const checkoutState = searchParams.get('checkout');
    if (!checkoutState) {
      return;
    }
    toast(checkoutState === 'success' ? 'Tu pago fue confirmado.' : 'No se completó el pago.');
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
    if (typeof window === 'undefined' || typeof document === 'undefined' || !user) {
      return;
    }

    const refreshNotifications = () => {
      if (!navigator.onLine) {
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ['member-notifications'] });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshNotifications();
      }
    };

    const handleFocus = () => {
      refreshNotifications();
    };

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

  useEffect(() => {
    if (selectedNotificationId && !notifications.some((notification) => notification.id === selectedNotificationId)) {
      setSelectedNotificationId(null);
    }
  }, [notifications, selectedNotificationId]);

  useEffect(() => {
    if (!user) {
      return;
    }
    const nextSnapshot: Partial<MemberSnapshot> = {};
    if (walletQuery.data) nextSnapshot.wallet = walletQuery.data;
    if (profileQuery.data) nextSnapshot.profile = profileQuery.data;
    if (plansQuery.data) nextSnapshot.plans = plansQuery.data;
    if (programsQuery.data) nextSnapshot.programs = programsQuery.data;
    if (classesQuery.data) nextSnapshot.classes = classesQuery.data;
    if (reservationsQuery.data) nextSnapshot.reservations = reservationsQuery.data;
    if (paymentsQuery.data) nextSnapshot.payments = paymentsQuery.data;
    if (supportInteractionsQuery.data) nextSnapshot.supportInteractions = supportInteractionsQuery.data;
    if (notificationsQuery.data && isDefaultNotificationDateRange) nextSnapshot.notifications = notificationsQuery.data;

    if (Object.keys(nextSnapshot).length) {
      saveMemberSnapshot(user.id, nextSnapshot, lastSyncedAt?.toISOString());
    }
  }, [
    classesQuery.data,
    isDefaultNotificationDateRange,
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

  if (!user) {
    return null;
  }

  const openNotificationDetail = async (notification: AppNotification) => {
    setSelectedNotificationId(notification.id);
    if (notification.is_read) {
      return;
    }
    try {
      await notificationMutation.mutateAsync({
        notificationId: notification.id,
        payload: { is_read: true, mark_opened: true },
      });
    } catch {
      // Error toast handled by the mutation; keep the detail open anyway.
    }
  };

  const updateNotificationDateFrom = (value: string) => {
    setNotificationDatePreset('custom');
    setNotificationDateFrom(value);
    if (notificationDateTo && value > notificationDateTo) {
      setNotificationDateTo(value);
    }
  };

  const updateNotificationDateTo = (value: string) => {
    setNotificationDatePreset('custom');
    setNotificationDateTo(value);
    if (notificationDateFrom && value < notificationDateFrom) {
      setNotificationDateFrom(value);
    }
  };

  const updateSupportDateFrom = (value: string) => {
    setSupportDatePreset('custom');
    setSupportDateFrom(value);
    if (supportDateTo && value > supportDateTo) {
      setSupportDateTo(value);
    }
  };

  const updateSupportDateTo = (value: string) => {
    setSupportDatePreset('custom');
    setSupportDateTo(value);
    if (supportDateFrom && value < supportDateFrom) {
      setSupportDateFrom(value);
    }
  };

  const openNotificationAction = async (notification: AppNotification) => {
    setSelectedNotificationId(null);
    try {
      await notificationMutation.mutateAsync({
        notificationId: notification.id,
        payload: { is_read: true, mark_opened: true, mark_clicked: true },
      });
    } catch {
      // Error toast handled by the mutation; still try to open the destination.
    }
    const nextTab = getTabFromAction(notification.action_url);
    if (nextTab) {
      setTab(searchParams, setSearchParams, nextTab);
      return;
    }
    if (notification.action_url?.startsWith('http')) {
      window.open(notification.action_url, '_blank', 'noopener,noreferrer');
    }
  };

  const openSupportRequestModal = () => {
    setSupportRequestForm((current) => {
      if (current.subject.trim() || current.notes.trim()) {
        return current;
      }
      return createSupportRequestForm(preferredSupportChannel);
    });
    setShowSupportRequestModal(true);
  };

  const submitSupportRequest = async () => {
    if (!supportRequestForm.subject.trim()) {
      toast.error('Cuéntanos brevemente qué necesitas.');
      return;
    }
    await createSupportInteractionMutation.mutateAsync();
  };

  const toggleNotificationReadState = async (notification: AppNotification) => {
    try {
      await notificationMutation.mutateAsync({
        notificationId: notification.id,
        payload: {
          is_read: !notification.is_read,
          mark_opened: !notification.is_read,
        },
      });
    } catch {
      // Error toast handled by the mutation.
    }
  };

  const markAllNotificationsAsRead = async () => {
    const unreadNotificationIds = notifications.filter((notification) => !notification.is_read).map((notification) => notification.id);
    if (!unreadNotificationIds.length) {
      return;
    }
    await markAllNotificationsReadMutation.mutateAsync(unreadNotificationIds);
  };

  const installApp = async () => {
    if (!deferredPrompt) {
      toast('Usa el menú del navegador para agregar esta app a tu pantalla de inicio.');
      return;
    }
    await deferredPrompt.prompt();
    setDeferredPrompt(null);
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

  const syncMemberData = async () => {
    if (!isOnline) {
      toast('Sin conexión. Mostrando la última información guardada en este dispositivo.');
      return;
    }
    await refreshMemberQueries(queryClient);
    toast.success('Datos actualizados.');
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

  const toggleDrawerSection = (sectionId: string) => {
    setExpandedDrawerSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  };

  return (
    <div
      className="min-h-screen text-surface-900 transition-colors dark:text-white"
      style={{ background: pageBackground }}
    >

      {/* ── LEFT DRAWER ────────────────────────────────────────────────────── */}
      {isDrawerOpen && (
        <div
          className="fixed inset-0 z-50 flex"
          onClick={() => setIsDrawerOpen(false)}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          {/* Panel */}
          <div
            className="relative flex h-full w-[300px] max-w-[85vw] flex-col overflow-hidden bg-white shadow-2xl dark:bg-surface-950"
            style={{ paddingTop: 'env(safe-area-inset-top)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-1 w-full shrink-0" style={{ backgroundImage: brandGradient }} />

            {/* User card */}
            <div className="flex shrink-0 items-center gap-3 border-b border-surface-100 px-5 py-4 dark:border-white/10">
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl text-lg font-bold text-white shadow-sm"
                style={{ background: `linear-gradient(135deg, ${accentColor}, ${secondaryColor})` }}
              >
                {ownerLogoUrl
                  ? <img src={ownerLogoUrl} alt={tenantDisplayName} className="h-full w-full object-cover" />
                  : tenantDisplayName.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-surface-900 dark:text-white">{memberFullName}</p>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {walletQuery.data?.membership_status && (
                    <span className={cn('badge', membershipStatusColor(walletQuery.data.membership_status))}>
                      {formatMembershipStatusLabel(walletQuery.data.membership_status)}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsDrawerOpen(false)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-surface-500 hover:bg-surface-100 dark:text-surface-400 dark:hover:bg-white/10"
              >
                <X size={18} />
              </button>
            </div>

            {/* Scrollable nav */}
            <div className="flex-1 overflow-y-auto py-2">

              {/* Navegación accordion */}
              <div>
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-5 py-2.5 text-[11px] font-semibold uppercase tracking-widest text-surface-400 dark:text-surface-500"
                  onClick={() => toggleDrawerSection('nav')}
                >
                  Navegación
                  <ChevronDown size={13} className={cn('transition-transform duration-200', expandedDrawerSections.has('nav') && 'rotate-180')} />
                </button>
                {expandedDrawerSections.has('nav') && TABS.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = tab.id === activeTab;
                  const badge = navBadgeByTab[tab.id];
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => { setTab(searchParams, setSearchParams, tab.id); setIsDrawerOpen(false); }}
                      className={cn(
                        'flex w-full items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors',
                        isActive
                          ? 'text-surface-900 dark:text-white'
                          : 'text-surface-600 hover:text-surface-900 dark:text-surface-400 dark:hover:text-white',
                      )}
                      style={isActive ? { background: `linear-gradient(90deg, ${withAlpha(accentColor, isDark ? 0.18 : 0.1)}, transparent)` } : undefined}
                    >
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-all"
                        style={isActive ? { background: `linear-gradient(135deg, ${accentColor}, ${secondaryColor})`, color: 'white' } : undefined}
                      >
                        <Icon size={16} />
                      </span>
                      <span className="flex-1 text-left">{tab.label}</span>
                      {badge ? (
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-400 px-1 text-[10px] font-bold text-surface-950">
                          {badge}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>

              {/* Ajustes accordion */}
              <div className="mt-1 border-t border-surface-100 pt-1 dark:border-white/10">
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-5 py-2.5 text-[11px] font-semibold uppercase tracking-widest text-surface-400 dark:text-surface-500"
                  onClick={() => toggleDrawerSection('settings')}
                >
                  Ajustes
                  <ChevronDown size={13} className={cn('transition-transform duration-200', expandedDrawerSections.has('settings') && 'rotate-180')} />
                </button>
                {expandedDrawerSections.has('settings') && (
                  <div className="space-y-0.5 px-3">
                    <button
                      type="button"
                      onClick={toggleTheme}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-surface-700 transition-colors hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-white/10"
                    >
                      {isDark ? <Sun size={16} /> : <Moon size={16} />}
                      {isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { void installApp(); setIsDrawerOpen(false); }}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-surface-700 transition-colors hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-white/10"
                    >
                      <Download size={16} />
                      {isStandalone ? 'App instalada' : 'Instalar app'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void enableWebPush()}
                      disabled={!webPushSupported || !webPushConfigured || registerPushSubscriptionMutation.isPending}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-surface-700 transition-colors hover:bg-surface-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-surface-300 dark:hover:bg-white/10"
                    >
                      <Bell size={16} />
                      {!webPushSupported ? 'Avisos no disponibles' : !webPushConfigured ? 'Avisos próximamente' : activeWebPushSubscription ? 'Avisos activos' : 'Activar avisos'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void syncMemberData()}
                      disabled={isSyncing}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-surface-700 transition-colors hover:bg-surface-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-surface-300 dark:hover:bg-white/10"
                    >
                      <RefreshCcw size={16} className={cn(isSyncing && 'animate-spin')} />
                      Actualizar datos
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Cerrar sesión */}
            <div
              className="shrink-0 border-t border-surface-100 p-4 dark:border-white/10"
              style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
            >
              <button
                type="button"
                onClick={logoutMember}
                className="flex w-full items-center gap-3 rounded-2xl border border-surface-200 bg-surface-50 px-4 py-3 text-sm font-medium text-rose-600 transition-colors hover:border-rose-200 hover:bg-rose-50 dark:border-white/10 dark:bg-white/[0.03] dark:text-rose-400 dark:hover:border-rose-400/30 dark:hover:bg-rose-500/10"
              >
                <LogOut size={16} />
                Cerrar sesión
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── TOP BAR ────────────────────────────────────────────────────────── */}
      <header
        className="fixed inset-x-0 top-0 z-20 flex items-end border-b border-surface-200/80 bg-white/92 backdrop-blur-2xl dark:border-white/10 dark:bg-surface-950/90"
        style={{ paddingTop: 'env(safe-area-inset-top)', height: 'calc(56px + env(safe-area-inset-top))' }}
      >
        <div className="h-0.5 absolute inset-x-0 bottom-0 opacity-60" style={{ backgroundImage: brandGradient }} />
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
              {ownerLogoUrl
                ? <img src={ownerLogoUrl} alt={tenantDisplayName} className="h-full w-full object-cover" />
                : tenantDisplayName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold leading-tight text-surface-900 dark:text-white">{tenantDisplayName}</p>
              <p className="truncate text-[11px] leading-tight text-surface-400 dark:text-surface-500">{activeTabMeta.label}</p>
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
              onClick={() => setTab(searchParams, setSearchParams, 'notifications')}
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
      <div
        className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8"
        style={{
          paddingTop: 'calc(56px + env(safe-area-inset-top) + 1.25rem)',
          paddingBottom: 'calc(60px + env(safe-area-inset-bottom, 0px) + 1.25rem)',
        }}
      >
        {!isOnline ? (
          <section className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-50/90">
            <div className="flex items-center gap-2.5">
              <WifiOff size={15} className="shrink-0" />
              <p className="text-sm font-semibold">
                Sin conexión · Mostrando datos guardados{lastSyncedAt ? ` (${formatRelative(lastSyncedAt)})` : ''}
              </p>
            </div>
          </section>
        ) : null}

        <div className="space-y-4">
            {activeTab === 'home' ? (
              walletQuery.isLoading && !walletQuery.data ? (
                <SkeletonMetricCards />
              ) : (
                <section className="grid gap-3 md:grid-cols-3">
                  <MetricCard
                    icon={Wallet}
                    label="Plan"
                    value={walletQuery.data?.plan_name || 'Sin plan'}
                    caption={walletQuery.data?.membership_status ? formatMembershipStatusLabel(walletQuery.data.membership_status) : 'Membresía pendiente'}
                    accentColor={accentColor}
                    secondaryColor={secondaryColor}
                  />
                  <MetricCard icon={CalendarDays} label="Reservas" value={String(reservations.length)} caption={walletQuery.data?.next_class?.start_time ? formatDateTime(walletQuery.data.next_class.start_time) : 'Sin próxima clase'} accentColor={accentColor} secondaryColor={secondaryColor} />
                  <MetricCard icon={Bell} label="Sin leer" value={String(unreadNotifications)} caption={notificationPermissionMeta.label} accentColor={accentColor} secondaryColor={secondaryColor} />
                </section>
              )
            ) : null}

            <section className="rounded-[1.75rem] border border-surface-200/80 bg-white/82 p-4 shadow-[0_24px_80px_-50px_rgba(15,23,42,0.22)] backdrop-blur-2xl dark:border-white/10 dark:bg-white/5 dark:shadow-none sm:p-5">
          {activeTab === 'home' ? (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
              <Panel title="Pase digital">
                <p className="text-sm leading-6 text-surface-600 dark:text-surface-300">
                  Tu acceso, estado de membresía y código de respaldo viven ahora en una sola vista optimizada para el teléfono.
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
                          {walletQuery.data?.membership_status === 'expired' ? 'Tu membresía venció.' : 'No tienes una membresía activa.'}
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
                    icon={Dumbbell}
                    title="Programas"
                    description={
                      enrolledPrograms.length
                        ? `${enrolledPrograms.length} ${enrolledPrograms.length === 1 ? 'programa activo' : 'programas activos'}`
                        : programs.length
                          ? `${programs.length} programas para unirte`
                          : 'Revisa rutinas y objetivos del gimnasio'
                    }
                    accentColor={accentColor}
                    secondaryColor={secondaryColor}
                    onClick={() => setTab(searchParams, setSearchParams, 'programs')}
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
                  <QuickActionCard
                    icon={supportWhatsAppUrl ? WhatsAppIcon : hasDirectSupport ? Phone : LifeBuoy}
                    title="Soporte"
                    description={
                      pendingSupportInteractions.length
                        ? `${pendingSupportInteractions.length} ${pendingSupportInteractions.length === 1 ? 'solicitud en seguimiento' : 'solicitudes en seguimiento'}`
                        : hasDirectSupport
                          ? 'Habla directo con tu gimnasio o deja una solicitud'
                          : 'Pide ayuda desde la app cuando la necesites'
                    }
                    accentColor={accentColor}
                    secondaryColor={secondaryColor}
                    onClick={() => setTab(searchParams, setSearchParams, 'support')}
                  />
                </div>
              </Panel>
              <div className="space-y-4">
                <Panel title="Próxima actividad">
                  {walletQuery.data?.next_class ? (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="badge badge-info">{formatClassModalityLabel(walletQuery.data.next_class.modality)}</span>
                        <span className="badge badge-neutral">{formatRelative(walletQuery.data.next_class.start_time)}</span>
                    </div>
                    <p className="mt-4 text-xl font-semibold">{walletQuery.data.next_class.name}</p>
                    <p className="mt-2 text-sm text-surface-600 dark:text-surface-300">
                      {formatDateTime(walletQuery.data.next_class.start_time)} · {formatClassModalityLabel(walletQuery.data.next_class.modality)}
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
                    <p className="text-sm leading-6 text-surface-600 dark:text-surface-300">Todavía no hay una clase próxima vinculada.</p>
                    <button type="button" className="btn-secondary mt-4" onClick={() => setTab(searchParams, setSearchParams, 'agenda')}>
                      <CalendarDays size={16} />
                      Explorar clases
                    </button>
                  </>
                )}
                </Panel>

                {walletQuery.data?.next_program_class ? (
                  <Panel title="Mi programa">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="badge badge-success">Próxima clase</span>
                      <span className="badge badge-neutral">{formatRelative(walletQuery.data.next_program_class.start_time)}</span>
                    </div>
                    <p className="mt-4 text-xl font-semibold">{walletQuery.data.next_program_class.name}</p>
                    <p className="mt-2 text-sm text-surface-600 dark:text-surface-300">
                      {formatDateTime(walletQuery.data.next_program_class.start_time)} · {formatClassModalityLabel(walletQuery.data.next_program_class.modality)}
                    </p>
                    {gymLocation ? (
                      <div className="mt-4 flex items-start gap-3 rounded-2xl border border-surface-200 bg-surface-50 px-4 py-3 dark:border-white/10 dark:bg-surface-950/40">
                        <MapPin size={18} className="mt-0.5" style={{ color: accentColor }} />
                        <p className="text-sm leading-6 text-surface-600 dark:text-surface-300">{gymLocation}</p>
                      </div>
                    ) : null}
                    <button type="button" className="btn-secondary mt-4" onClick={() => setTab(searchParams, setSearchParams, 'programs')}>
                      <Dumbbell size={16} />
                      Ver mis programas
                    </button>
                  </Panel>
                ) : null}

                <Panel title="Tu dispositivo">
                  <div className="space-y-3">
                    <DeviceStatusItem label="Conexión" value={isOnline ? 'En línea' : 'Sin conexión'} tone={isOnline ? 'success' : 'warning'} />
                    <DeviceStatusItem label="App" value={isStandalone ? 'Instalada' : 'Modo navegador'} tone={isStandalone ? 'success' : 'neutral'} />
                    <DeviceStatusItem label="Avisos" value={notificationPermissionMeta.label} tone={notificationPermissionMeta.tone} />
                    <DeviceStatusItem label="Código QR" value={hasCheckinCode ? 'Disponible' : 'Sincroniza para obtenerlo'} tone={hasCheckinCode ? 'success' : 'warning'} />
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
              <Panel title="Tu agenda">
                <p className="text-sm leading-6 text-surface-600 dark:text-surface-300">
                  Revisa tus próximas clases, identifica rápido cuáles ya reservaste y encuentra dónde todavía hay cupos.
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <DeviceStatusItem label="Clases visibles" value={String(filteredClasses.length)} tone={filteredClasses.length ? 'info' : 'neutral'} />
                  <DeviceStatusItem label="Tus reservas" value={String(reservedVisibleClasses)} tone={reservedVisibleClasses ? 'success' : 'neutral'} />
                  <DeviceStatusItem label="Con cupos" value={String(classesWithAvailableSpots)} tone={classesWithAvailableSpots ? 'warning' : 'neutral'} />
                </div>
                <div className="mt-4">
                  <button
                    type="button"
                    className="btn-secondary text-sm"
                    onClick={async () => {
                      try {
                        const response = await mobileApi.downloadCalendar();
                        const blob = new Blob([response.data as BlobPart], { type: 'text/calendar' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'mis-clases.ics';
                        a.click();
                        URL.revokeObjectURL(url);
                        toast.success('Calendario descargado');
                      } catch {
                        toast.error('No se pudo descargar el calendario');
                      }
                    }}
                  >
                    <Download size={14} />
                    Guardar en calendario (.ics)
                  </button>
                </div>

                {/* Reservation quota bar */}
                {(() => {
                  const weekMax = walletQuery.data?.max_reservations_per_week;
                  const monthMax = walletQuery.data?.max_reservations_per_month;
                  const weekUsed = walletQuery.data?.weekly_reservations_used ?? 0;
                  const monthUsed = walletQuery.data?.monthly_reservations_used ?? 0;
                  if (!weekMax && !monthMax) return null;
                  return (
                    <div className="mt-4 space-y-3 rounded-2xl border border-surface-200 bg-surface-50 p-4 dark:border-white/10 dark:bg-surface-950/40">
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-surface-500">Cupo de reservas del plan</p>
                      {weekMax ? (
                        <div>
                          <div className="mb-1.5 flex items-center justify-between text-xs">
                            <span className="text-surface-600 dark:text-surface-400">Esta semana</span>
                            <span className={cn('font-semibold', weekUsed >= weekMax ? 'text-rose-500' : 'text-surface-900 dark:text-white')}>
                              {weekUsed} / {weekMax}
                            </span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-surface-200 dark:bg-white/10">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${Math.min(100, Math.round((weekUsed / weekMax) * 100))}%`,
                                background: weekUsed >= weekMax
                                  ? '#f43f5e'
                                  : `linear-gradient(90deg, ${accentColor}, ${secondaryColor})`,
                              }}
                            />
                          </div>
                          {weekUsed >= weekMax && (
                            <p className="mt-1 text-xs text-rose-500">Alcanzaste el límite semanal de tu plan.</p>
                          )}
                        </div>
                      ) : null}
                      {monthMax ? (
                        <div>
                          <div className="mb-1.5 flex items-center justify-between text-xs">
                            <span className="text-surface-600 dark:text-surface-400">Este mes</span>
                            <span className={cn('font-semibold', monthUsed >= monthMax ? 'text-rose-500' : 'text-surface-900 dark:text-white')}>
                              {monthUsed} / {monthMax}
                            </span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-surface-200 dark:bg-white/10">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${Math.min(100, Math.round((monthUsed / monthMax) * 100))}%`,
                                background: monthUsed >= monthMax
                                  ? '#f43f5e'
                                  : `linear-gradient(90deg, ${accentColor}, ${secondaryColor})`,
                              }}
                            />
                          </div>
                          {monthUsed >= monthMax && (
                            <p className="mt-1 text-xs text-rose-500">Alcanzaste el límite mensual de tu plan.</p>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })()}
                <div className="mt-4 flex flex-wrap gap-2">
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
                          {formatClassModalityLabel(m)}
                        </button>
                      ))}
                    </>
                  ) : null}
                  {agendaBranches.length > 1 ? (
                    <>
                      <span className="self-center text-surface-600">|</span>
                      <button
                        type="button"
                        onClick={() => setAgendaBranchFilter('all')}
                        style={agendaBranchFilter === 'all' ? { borderColor: `${accentColor}88`, background: `linear-gradient(135deg, ${withAlpha(accentColor, isDark ? 0.28 : 0.18)}, ${withAlpha(secondaryColor, isDark ? 0.22 : 0.12)})`, color: isDark ? '#e6fffb' : '#0f172a' } : undefined}
                        className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors', agendaBranchFilter === 'all' ? '' : 'border-surface-200 bg-white text-surface-500 hover:text-surface-900 dark:border-white/10 dark:bg-white/5 dark:text-surface-400 dark:hover:text-white')}
                      >
                        Todas las sedes
                      </button>
                      {agendaBranches.map((branch) => (
                        <button
                          key={branch.id}
                          type="button"
                          onClick={() => setAgendaBranchFilter(branch.id)}
                          style={agendaBranchFilter === branch.id ? { borderColor: `${accentColor}88`, background: `linear-gradient(135deg, ${withAlpha(accentColor, isDark ? 0.28 : 0.18)}, ${withAlpha(secondaryColor, isDark ? 0.22 : 0.12)})`, color: isDark ? '#e6fffb' : '#0f172a' } : undefined}
                          className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors', agendaBranchFilter === branch.id ? '' : 'border-surface-200 bg-white text-surface-500 hover:text-surface-900 dark:border-white/10 dark:bg-white/5 dark:text-surface-400 dark:hover:text-white')}
                        >
                          {branch.name}
                        </button>
                      ))}
                    </>
                  ) : null}
                </div>
              </Panel>

              {agendaGroups.length ? agendaGroups.map((group) => {
                const dayMeta = getAgendaDayMeta(group.date);
                return (
                  <section key={group.key} className="space-y-3">
                    <div className="flex items-end justify-between px-1">
                      <div>
                        <p className="text-lg font-semibold text-surface-900 dark:text-white">{dayMeta.title}</p>
                        <p className="text-sm text-surface-500 dark:text-surface-400">{dayMeta.subtitle}</p>
                      </div>
                      <span className="badge badge-neutral">{group.items.length} {group.items.length === 1 ? 'clase' : 'clases'}</span>
                    </div>

                    {group.items.map((gymClass) => {
                      const reservation = reservationByClassId.get(gymClass.id);
                      const occupancyRate = Math.min(100, Math.round((gymClass.current_bookings / Math.max(gymClass.max_capacity, 1)) * 100));
                      const availableSpots = Math.max(gymClass.max_capacity - gymClass.current_bookings, 0);

                      return (
                        <div
                          key={gymClass.id}
                          className={cn(
                            'rounded-[1.5rem] border p-5 shadow-sm dark:shadow-none',
                            reservation
                              ? 'border-emerald-200 bg-emerald-50/75 dark:border-emerald-400/20 dark:bg-emerald-500/10'
                              : 'border-surface-200/80 bg-white/85 dark:border-white/10 dark:bg-white/[0.04]',
                          )}
                        >
                          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                            <div className="shrink-0 rounded-[1.35rem] border border-surface-200 bg-surface-50 px-4 py-4 text-center dark:border-white/10 dark:bg-surface-950/35 sm:w-[120px]">
                              <p className="text-[11px] uppercase tracking-[0.18em] text-surface-500">{formatDate(gymClass.start_time, { day: '2-digit', month: 'short' })}</p>
                              <p className="mt-1 text-2xl font-bold font-display text-surface-900 dark:text-white">{formatTime(gymClass.start_time)}</p>
                              <p className="mt-1 text-xs text-surface-500 dark:text-surface-400">Hasta {formatTime(gymClass.end_time)}</p>
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={cn('badge', classStatusColor(gymClass.status))}>{formatClassStatusLabel(gymClass.status)}</span>
                                <span className="badge badge-neutral">{formatClassModalityLabel(gymClass.modality)}</span>
                                {reservation ? <span className={cn('badge', reservation.status === 'waitlisted' ? 'badge-warning' : 'badge-success')}>{getReservationStatusLabel(reservation)}</span> : null}
                              </div>

                              <h3 className="mt-3 text-lg font-semibold text-surface-900 dark:text-white">{gymClass.name}</h3>
                              <p className="mt-1 text-sm text-surface-600 dark:text-surface-300">
                                {gymClass.class_type || 'Clase del gimnasio'}
                                {gymClass.instructor_name ? ` · ${gymClass.instructor_name}` : ''}
                                {gymClass.branch_name ? ` · ${gymClass.branch_name}` : ''}
                                {gymClass.description ? ` · ${gymClass.description}` : ''}
                              </p>

                              <div
                                className={cn(
                                  'mt-4 grid gap-3',
                                  gymClass.instructor_name && gymClass.branch_name
                                    ? 'sm:grid-cols-5'
                                    : gymClass.instructor_name || gymClass.branch_name
                                      ? 'sm:grid-cols-4'
                                      : 'sm:grid-cols-3',
                                )}
                              >
                                <ProfileDetailItem label="Horario" value={formatAgendaTimeRange(gymClass.start_time, gymClass.end_time)} />
                                {gymClass.instructor_name && (
                                  <ProfileDetailItem label="Instructor" value={gymClass.instructor_name} />
                                )}
                                {gymClass.branch_name && (
                                  <ProfileDetailItem label="Sede" value={gymClass.branch_name} />
                                )}
                                <ProfileDetailItem label="Cupos" value={formatAgendaAvailabilityLabel(gymClass.current_bookings, gymClass.max_capacity)} />
                                <ProfileDetailItem label="Tu estado" value={reservation ? getReservationStatusLabel(reservation) : 'Disponible para reservar'} />
                              </div>

                              <div className="mt-4 rounded-2xl border border-surface-200 bg-surface-50 px-4 py-4 dark:border-white/10 dark:bg-surface-950/35">
                                <div className="flex flex-col gap-1 min-[360px]:flex-row min-[360px]:items-center min-[360px]:justify-between">
                                  <span className="text-[11px] uppercase tracking-[0.18em] text-surface-500">Ocupación</span>
                                  <span className="text-sm font-medium leading-5 text-surface-600 dark:text-surface-300 min-[360px]:text-right">
                                    {gymClass.current_bookings} de {gymClass.max_capacity} reservados
                                  </span>
                                </div>
                                <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-200 dark:bg-white/5">
                                  <div
                                    className="h-full rounded-full"
                                    style={{
                                      width: `${occupancyRate}%`,
                                      background: `linear-gradient(90deg, ${accentColor}, ${secondaryColor})`,
                                    }}
                                  />
                                </div>
                                <p className="mt-3 text-sm text-surface-600 dark:text-surface-300">
                                  {reservation?.status === 'waitlisted'
                                    ? reservation.waitlist_position
                                      ? `Estás en la lista de espera. Posición actual: ${reservation.waitlist_position}.`
                                      : 'Estás en la lista de espera para esta clase.'
                                    : availableSpots > 0
                                      ? `${availableSpots} ${availableSpots === 1 ? 'cupo disponible' : 'cupos disponibles'} en este horario.`
                                      : 'Por ahora no quedan cupos disponibles para esta clase.'}
                                </p>
                              </div>

                              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                                {gymClass.online_link ? (
                                  <a href={gymClass.online_link} target="_blank" rel="noreferrer" className="btn-secondary w-full justify-center sm:w-auto">
                                    <ExternalLink size={16} />
                                    Entrar a la clase
                                  </a>
                                ) : null}
                                {reservation ? (
                                  <button type="button" className="btn-danger w-full justify-center sm:w-auto" onClick={() => { setPendingCancelReservationId(reservation.id); setCancelReasonText(''); }}>
                                    <XCircle size={16} />
                                    {reservation.status === 'waitlisted' ? 'Salir de la lista' : 'Cancelar reserva'}
                                  </button>
                                ) : (
                                  <button type="button" className="btn-primary w-full justify-center sm:w-auto" style={{ backgroundImage: brandGradient }} onClick={() => reserveMutation.mutate(gymClass.id)}>
                                    <CalendarDays size={16} />
                                    Reservar esta clase
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </section>
                );
              }) : (
                <EmptyState
                  title={agendaDateFilter !== 'all' || agendaModalityFilter !== 'all' || agendaBranchFilter !== 'all' ? 'Sin clases con ese filtro' : 'Todavía no hay clases visibles'}
                  description={agendaDateFilter !== 'all' || agendaModalityFilter !== 'all' || agendaBranchFilter !== 'all' ? 'Prueba cambiando el filtro de fecha, modalidad o sede.' : 'La agenda aparecerá aquí cuando el gimnasio publique nuevas clases.'}
                />
              )}
            </div>
          ) : null}

          {activeTab === 'programs' ? (
            <div className="space-y-4">
              {programsQuery.isLoading && !programsQuery.data ? <SkeletonListItems count={4} /> : null}
              <Panel title="Programas de entrenamiento">
                <p className="text-sm leading-6 text-surface-600 dark:text-surface-300">
                  Únete a los programas activos del gimnasio para seguir una estructura semanal, conocer al trainer responsable y mantener tus objetivos claros.
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <DeviceStatusItem label="Disponibles" value={String(programs.length)} tone={programs.length ? 'info' : 'neutral'} />
                  <DeviceStatusItem label="Inscrito" value={String(enrolledPrograms.length)} tone={enrolledPrograms.length ? 'success' : 'neutral'} />
                  <DeviceStatusItem label="Activos" value={String(programs.filter((program) => program.is_active).length)} tone={programs.some((program) => program.is_active) ? 'warning' : 'neutral'} />
                </div>
              </Panel>

              {programs.length ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  {programs.map((program) => (
                    <Panel key={program.id} title={program.name}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn('badge', program.is_enrolled ? 'badge-success' : 'badge-neutral')}>
                          {program.is_enrolled ? 'Ya estás inscrito' : 'Disponible'}
                        </span>
                        <span className="badge badge-neutral">
                          {program.duration_weeks ? `${program.duration_weeks} semanas` : 'Duración flexible'}
                        </span>
                        <span className="badge badge-info">
                          {program.enrolled_count} {program.enrolled_count === 1 ? 'inscrito' : 'inscritos'}
                        </span>
                      </div>

                      <p className="mt-3 text-sm leading-6 text-surface-600 dark:text-surface-300">
                        {program.description || 'Programa activo del gimnasio para acompañar tu entrenamiento.'}
                      </p>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <ProfileDetailItem label="Trainer" value={program.trainer_name || 'Sin asignar'} />
                        <ProfileDetailItem label="Tipo" value={program.program_type || 'General'} />
                      </div>

                      <div className="mt-4 rounded-2xl border border-surface-200 bg-surface-50 px-4 py-4 dark:border-white/10 dark:bg-surface-950/35">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-surface-500">Horario semanal</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {program.schedule.length ? program.schedule.map((entry, index) => {
                            const day = typeof entry.day === 'string' && entry.day.trim() ? entry.day : `Día ${index + 1}`;
                            const focus = typeof entry.focus === 'string' && entry.focus.trim() ? entry.focus : 'Trabajo general';
                            return (
                              <span
                                key={`${program.id}-${day}-${index}`}
                                className="rounded-full border border-surface-200 bg-white px-3 py-1.5 text-xs font-medium text-surface-600 dark:border-white/10 dark:bg-white/5 dark:text-surface-300"
                              >
                                {day}: {focus}
                              </span>
                            );
                          }) : (
                            <span className="text-sm text-surface-500">El gimnasio aún no definió una rutina semanal visible.</span>
                          )}
                        </div>
                      </div>

                      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                        {program.is_enrolled ? (
                          <button
                            type="button"
                            className="btn-secondary w-full justify-center sm:w-auto"
                            onClick={() => leaveProgramMutation.mutate(program.id)}
                            disabled={leaveProgramMutation.isPending || enrollProgramMutation.isPending}
                          >
                            <XCircle size={16} />
                            Salir del programa
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn-primary w-full justify-center sm:w-auto"
                            style={{ backgroundImage: brandGradient }}
                            onClick={() => enrollProgramMutation.mutate(program.id)}
                            disabled={leaveProgramMutation.isPending || enrollProgramMutation.isPending}
                          >
                            <Dumbbell size={16} />
                            Inscribirme
                          </button>
                        )}
                      </div>
                    </Panel>
                  ))}
                </div>
              ) : !programsQuery.isLoading ? (
                <EmptyState
                  title="Todavía no hay programas publicados"
                  description="Cuando el gimnasio active programas de entrenamiento aparecerán aquí para que puedas sumarte."
                />
              ) : null}
            </div>
          ) : null}

          {activeTab === 'plans' ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {plans.length ? plans.map((plan) => (
                <Panel key={plan.id} title={plan.name}>
                  <p className="text-3xl font-bold font-display">{formatCurrency(plan.price, plan.currency)}</p>
                  <p className="mt-2 text-sm text-surface-600 dark:text-surface-300">{plan.description || 'Plan activo del gimnasio.'}</p>
                  <p className="mt-3 text-xs uppercase tracking-[0.18em] text-surface-400">{formatDurationLabel(plan.duration_type, plan.duration_days)}</p>
                  {/* Promo code input */}
                  <div className="mt-4 space-y-2">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        className="flex-1 rounded-lg border border-surface-200 dark:border-surface-600 bg-surface-50 dark:bg-surface-800 px-3 py-2 text-sm text-surface-800 dark:text-surface-100 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500 uppercase"
                        placeholder="Código promo"
                        value={promoInputByPlan[plan.id] ?? ''}
                        onChange={(e) => {
                          const v = e.target.value.toUpperCase();
                          setPromoInputByPlan((p) => ({ ...p, [plan.id]: v }));
                          if (promoResultByPlan[plan.id]) setPromoResultByPlan((p) => ({ ...p, [plan.id]: null }));
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && validatePromoCode(plan.id)}
                        maxLength={50}
                      />
                      <button
                        type="button"
                        onClick={() => validatePromoCode(plan.id)}
                        disabled={promoValidatingPlan === plan.id || !(promoInputByPlan[plan.id] ?? '').trim()}
                        className="px-3 py-2 rounded-lg bg-surface-200 dark:bg-surface-700 text-surface-700 dark:text-surface-200 text-sm font-medium hover:bg-surface-300 dark:hover:bg-surface-600 disabled:opacity-40"
                      >
                        {promoValidatingPlan === plan.id ? '…' : 'Aplicar'}
                      </button>
                    </div>
                    {promoResultByPlan[plan.id]?.valid && (
                      <div className="rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 px-3 py-2 text-sm">
                        <p className="text-emerald-700 dark:text-emerald-300 font-medium">
                          {promoResultByPlan[plan.id]!.discount_type === 'percent'
                            ? `${promoResultByPlan[plan.id]!.discount_value}% de descuento`
                            : `${formatCurrency(promoResultByPlan[plan.id]!.discount_amount ?? 0, plan.currency)} de descuento`}
                        </p>
                        <p className="text-emerald-600 dark:text-emerald-400 text-xs mt-0.5">
                          Total: {formatCurrency(promoResultByPlan[plan.id]!.final_price ?? plan.price, plan.currency)}
                        </p>
                      </div>
                    )}
                  </div>
                  <button type="button" className="btn-primary mt-3 w-full" style={{ backgroundImage: brandGradient }} onClick={() => checkoutMutation.mutate(plan.id)}>
                    <CreditCard size={16} />
                    {walletQuery.data?.plan_id === plan.id ? 'Renovar este plan' : 'Comprar este plan'}
                  </button>
                </Panel>
              )) : <div className="lg:col-span-2"><EmptyState title="Sin planes publicados" description="Los planes aparecerán aquí cuando el gimnasio los publique." /></div>}
              {checkoutSession ? (
                <div className="lg:col-span-2 rounded-[1.5rem] border border-emerald-200 bg-emerald-50 p-5 text-emerald-900 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-100">
                  <p className="text-sm">Tu pago está listo para continuar.</p>
                  <a href={checkoutSession.checkout_url} target="_blank" rel="noreferrer" className="btn-primary mt-4" style={{ backgroundImage: 'linear-gradient(135deg, #10b981, #0f766e)' }}>
                    <ExternalLink size={16} />
                    Continuar al pago
                  </a>
                </div>
              ) : null}
            </div>
          ) : null}

          {activeTab === 'progress' ? (
            <div className="space-y-4">
              {/* Sub-tab nav */}
              <div className="flex gap-1 rounded-2xl bg-surface-100 dark:bg-surface-800 p-1">
                {([
                  { id: 'measurements' as const, label: 'Medidas', icon: TrendingUp },
                  { id: 'photos' as const, label: 'Fotos', icon: Camera },
                  { id: 'records' as const, label: 'Récords', icon: Trophy },
                ] as const).map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setProgressSubTab(id)}
                    className={cn(
                      'flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-medium transition-all',
                      progressSubTab === id
                        ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-white shadow-sm'
                        : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200',
                    )}
                  >
                    <Icon size={14} />
                    {label}
                  </button>
                ))}
              </div>

              {/* ── Measurements sub-tab ── */}
              {progressSubTab === 'measurements' && (
                <>
                  <Panel title="Medidas corporales">
                    <p className="text-sm text-surface-600 dark:text-surface-300 leading-6">
                      Registra tus medidas periódicamente. Solo tú y tu entrenador pueden ver estos datos.
                    </p>
                    <button
                      type="button"
                      className="btn-primary mt-4 w-full"
                      style={{ backgroundImage: brandGradient }}
                      onClick={() => setShowAddMeasurement(true)}
                    >
                      <Plus size={16} />
                      Nueva medición
                    </button>
                  </Panel>

                  {/* Weight trend */}
                  {(() => {
                    const sorted = [...(measurementsQuery.data ?? [])]
                      .filter((m) => m.weight_kg != null)
                      .sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());
                    if (sorted.length < 2) return null;
                    const first = Number(sorted[0].weight_kg);
                    const last = Number(sorted[sorted.length - 1].weight_kg);
                    const diff = +(last - first).toFixed(1);
                    return (
                      <Panel title="Evolución de peso">
                        <div className="flex items-center gap-6 flex-wrap">
                          <div className="flex flex-col">
                            <span className="text-xs text-surface-400">Inicial</span>
                            <span className="text-xl font-bold text-surface-900 dark:text-white">{first} kg</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-xs text-surface-400">Actual</span>
                            <span className="text-xl font-bold text-surface-900 dark:text-white">{last} kg</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-xs text-surface-400">Cambio</span>
                            <span className={cn('text-xl font-bold', diff < 0 ? 'text-emerald-500' : diff > 0 ? 'text-rose-500' : 'text-surface-500')}>
                              {diff > 0 ? '+' : ''}{diff} kg
                            </span>
                          </div>
                        </div>
                      </Panel>
                    );
                  })()}

                  {measurementsQuery.isLoading && !measurementsQuery.data ? <SkeletonListItems count={3} /> : null}
                  {(measurementsQuery.data ?? []).length ? (
                    <div className="space-y-3">
                      {(measurementsQuery.data ?? []).map((m) => {
                        const fields: { label: string; value: string }[] = [];
                        if (m.weight_kg != null) fields.push({ label: 'Peso', value: `${m.weight_kg} kg` });
                        if (m.body_fat_pct != null) fields.push({ label: 'Grasa', value: `${m.body_fat_pct}%` });
                        if (m.muscle_mass_kg != null) fields.push({ label: 'Músculo', value: `${m.muscle_mass_kg} kg` });
                        if (m.waist_cm != null) fields.push({ label: 'Cintura', value: `${m.waist_cm} cm` });
                        if (m.chest_cm != null) fields.push({ label: 'Pecho', value: `${m.chest_cm} cm` });
                        if (m.hip_cm != null) fields.push({ label: 'Cadera', value: `${m.hip_cm} cm` });
                        if (m.arm_cm != null) fields.push({ label: 'Brazo', value: `${m.arm_cm} cm` });
                        if (m.thigh_cm != null) fields.push({ label: 'Muslo', value: `${m.thigh_cm} cm` });
                        return (
                          <Panel key={m.id} title={new Date(m.recorded_at).toLocaleDateString('es-CL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}>
                            <div className="flex flex-wrap gap-3 mt-2">
                              {fields.map((f) => (
                                <div key={f.label} className="flex flex-col items-center rounded-xl bg-surface-50 dark:bg-surface-800/40 px-3 py-2 min-w-[72px]">
                                  <span className="text-xs text-surface-400">{f.label}</span>
                                  <span className="text-sm font-semibold text-surface-900 dark:text-white">{f.value}</span>
                                </div>
                              ))}
                            </div>
                            {m.notes && <p className="mt-3 text-sm text-surface-500 italic">"{m.notes}"</p>}
                            <button type="button" onClick={() => deleteMeasurementMutation.mutate(m.id)} className="mt-3 flex items-center gap-1 text-xs text-red-400 hover:text-red-600">
                              <Trash2 size={12} /> Eliminar
                            </button>
                          </Panel>
                        );
                      })}
                    </div>
                  ) : !measurementsQuery.isLoading ? (
                    <EmptyState title="Sin mediciones aún" description="Registra tu primera medición para comenzar a ver tu evolución." />
                  ) : null}
                </>
              )}

              {/* ── Photos sub-tab ── */}
              {progressSubTab === 'photos' && (
                <>
                  <Panel title="Fotos de progreso">
                    <p className="text-sm text-surface-600 dark:text-surface-300 leading-6">
                      Guarda fotos de tu evolución. Solo tú y tu entrenador pueden verlas.
                    </p>
                    <button
                      type="button"
                      className="btn-primary mt-4 w-full"
                      style={{ backgroundImage: brandGradient }}
                      onClick={() => setShowPhotoUpload(true)}
                    >
                      <Upload size={16} />
                      Subir foto
                    </button>
                  </Panel>

                  {progressPhotosQuery.isLoading && !progressPhotosQuery.data ? <SkeletonListItems count={3} /> : null}
                  {(progressPhotosQuery.data ?? []).length ? (
                    <div className="grid grid-cols-2 gap-3">
                      {(progressPhotosQuery.data ?? []).map((photo) => (
                        <div key={photo.id} className="relative group rounded-2xl overflow-hidden bg-surface-100 dark:bg-surface-800 aspect-square">
                          <img
                            src={photo.photo_url}
                            alt={`Progreso ${new Date(photo.recorded_at).toLocaleDateString('es-CL')}`}
                            className="w-full h-full object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex flex-col items-center justify-end p-2 gap-1">
                            <p className="text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity text-center font-medium">
                              {new Date(photo.recorded_at).toLocaleDateString('es-CL')}
                            </p>
                            {photo.notes && (
                              <p className="text-white/80 text-xs opacity-0 group-hover:opacity-100 transition-opacity text-center line-clamp-2">
                                {photo.notes}
                              </p>
                            )}
                            <button
                              type="button"
                              onClick={() => deletePhotoMutation.mutate(photo.id)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity bg-red-500 hover:bg-red-600 text-white rounded-full p-1.5"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : !progressPhotosQuery.isLoading ? (
                    <div className="flex flex-col items-center justify-center gap-3 py-12 text-surface-400">
                      <ImageOff size={40} strokeWidth={1.5} />
                      <p className="text-sm font-medium">Sin fotos aún</p>
                      <p className="text-xs text-center">Sube tu primera foto para comenzar a ver tu transformación.</p>
                    </div>
                  ) : null}
                </>
              )}

              {/* ── Personal Records sub-tab ── */}
              {progressSubTab === 'records' && (
                <>
                  <Panel title="Marcas personales">
                    <p className="text-sm text-surface-600 dark:text-surface-300 leading-6">
                      Registra tus récords de ejercicios: peso máximo, repeticiones, tiempo, distancia, etc.
                    </p>
                    <button
                      type="button"
                      className="btn-primary mt-4 w-full"
                      style={{ backgroundImage: brandGradient }}
                      onClick={() => setShowAddPR(true)}
                    >
                      <Plus size={16} />
                      Nuevo récord
                    </button>
                  </Panel>

                  {/* Exercise filter */}
                  <div className="relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none" />
                    <input
                      type="text"
                      className="input pl-9"
                      placeholder="Buscar por ejercicio…"
                      value={prExerciseFilter}
                      onChange={(e) => setPrExerciseFilter(e.target.value)}
                    />
                  </div>

                  {personalRecordsQuery.isLoading && !personalRecordsQuery.data ? <SkeletonListItems count={3} /> : null}
                  {(personalRecordsQuery.data ?? []).length ? (
                    <div className="space-y-3">
                      {(personalRecordsQuery.data ?? []).map((pr) => (
                        <Panel key={pr.id} title={pr.exercise_name}>
                          <div className="flex items-center gap-3 mt-1 flex-wrap">
                            <div className="flex items-center gap-1.5 rounded-xl bg-surface-50 dark:bg-surface-800/40 px-4 py-2">
                              <Trophy size={14} className="text-amber-500" />
                              <span className="text-lg font-bold text-surface-900 dark:text-white">{Number(pr.record_value)}</span>
                              <span className="text-sm text-surface-500">{pr.unit}</span>
                            </div>
                            <span className="text-xs text-surface-400">
                              {new Date(pr.recorded_at).toLocaleDateString('es-CL', { year: 'numeric', month: 'short', day: 'numeric' })}
                            </span>
                          </div>
                          {pr.notes && <p className="mt-2 text-sm text-surface-500 italic">"{pr.notes}"</p>}
                          <button type="button" onClick={() => deletePRMutation.mutate(pr.id)} className="mt-3 flex items-center gap-1 text-xs text-red-400 hover:text-red-600">
                            <Trash2 size={12} /> Eliminar
                          </button>
                        </Panel>
                      ))}
                    </div>
                  ) : !personalRecordsQuery.isLoading ? (
                    <EmptyState title="Sin récords aún" description="Registra tu primer récord personal para comenzar a trackear tus marcas." />
                  ) : null}
                </>
              )}
            </div>
          ) : null}

          {/* ── Modals ── */}
          <Modal
            open={showAddMeasurement}
            title="Nueva medición"
            description="Registra una medición sin salir de la app. Puedes dejar campos vacíos si no los tienes ahora."
            onClose={() => { if (!addMeasurementMutation.isPending) setShowAddMeasurement(false); }}
          >
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                const payload: Record<string, unknown> = {
                  recorded_at: new Date(`${measurementForm.recorded_at}T12:00:00`).toISOString(),
                };
                const numFields = ['weight_kg', 'body_fat_pct', 'muscle_mass_kg', 'chest_cm', 'waist_cm', 'hip_cm', 'arm_cm', 'thigh_cm'] as const;
                numFields.forEach((key) => {
                  if (measurementForm[key]) payload[key] = parseFloat(measurementForm[key]);
                });
                if (measurementForm.notes.trim()) payload.notes = measurementForm.notes.trim();
                addMeasurementMutation.mutate(payload);
              }}
            >
              <div>
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Fecha</label>
                <input
                  type="date"
                  className="input"
                  value={measurementForm.recorded_at}
                  onChange={(e) => setMeasurementForm((current) => ({ ...current, recorded_at: e.target.value }))}
                  required
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {([
                  { key: 'weight_kg', label: 'Peso (kg)' },
                  { key: 'body_fat_pct', label: 'Grasa (%)' },
                  { key: 'muscle_mass_kg', label: 'Músculo (kg)' },
                  { key: 'chest_cm', label: 'Pecho (cm)' },
                  { key: 'waist_cm', label: 'Cintura (cm)' },
                  { key: 'hip_cm', label: 'Cadera (cm)' },
                  { key: 'arm_cm', label: 'Brazo (cm)' },
                  { key: 'thigh_cm', label: 'Muslo (cm)' },
                ] as const).map(({ key, label }) => (
                  <div key={key}>
                    <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">{label}</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      className="input"
                      value={measurementForm[key]}
                      onChange={(e) => setMeasurementForm((current) => ({ ...current, [key]: e.target.value }))}
                      placeholder="Opcional"
                    />
                  </div>
                ))}
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Notas</label>
                <textarea
                  className="input min-h-24 resize-y"
                  value={measurementForm.notes}
                  onChange={(e) => setMeasurementForm((current) => ({ ...current, notes: e.target.value }))}
                  placeholder="Observaciones opcionales..."
                  maxLength={500}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="btn-secondary" onClick={() => setShowAddMeasurement(false)}>
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  style={{ backgroundImage: brandGradient }}
                  disabled={addMeasurementMutation.isPending || !measurementForm.recorded_at}
                >
                  {addMeasurementMutation.isPending ? 'Guardando…' : 'Guardar medición'}
                </button>
              </div>
            </form>
          </Modal>

          {/* Add Personal Record Modal */}
          <Modal
            open={showAddPR}
            title="Nuevo récord personal"
            description="Registra tu marca personal en cualquier ejercicio."
            onClose={() => { if (!addPRMutation.isPending) setShowAddPR(false); }}
          >
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!prForm.exercise_name.trim() || !prForm.record_value) return;
                addPRMutation.mutate({
                  exercise_name: prForm.exercise_name.trim(),
                  record_value: parseFloat(prForm.record_value),
                  unit: prForm.unit.trim() || 'kg',
                  recorded_at: new Date(`${prForm.recorded_at}T12:00:00`).toISOString(),
                  notes: prForm.notes.trim() || undefined,
                });
              }}
            >
              <div>
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Ejercicio *</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Ej: Sentadilla, Peso muerto, Carrera 5K…"
                  value={prForm.exercise_name}
                  onChange={(e) => setPrForm((f) => ({ ...f, exercise_name: e.target.value }))}
                  required
                  maxLength={200}
                />
              </div>
              <div className="grid gap-4 grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Valor *</label>
                  <input
                    type="number"
                    className="input"
                    step="0.001"
                    min="0"
                    placeholder="100"
                    value={prForm.record_value}
                    onChange={(e) => setPrForm((f) => ({ ...f, record_value: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Unidad *</label>
                  <select
                    className="input"
                    value={prForm.unit}
                    onChange={(e) => setPrForm((f) => ({ ...f, unit: e.target.value }))}
                  >
                    <option value="kg">kg (peso)</option>
                    <option value="reps">reps</option>
                    <option value="seg">seg (tiempo)</option>
                    <option value="min">min (tiempo)</option>
                    <option value="metros">metros</option>
                    <option value="km">km</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Fecha *</label>
                <input
                  type="date"
                  className="input"
                  value={prForm.recorded_at}
                  onChange={(e) => setPrForm((f) => ({ ...f, recorded_at: e.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Notas</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Ej: 3 sets de 5 repeticiones, con pausa…"
                  value={prForm.notes}
                  onChange={(e) => setPrForm((f) => ({ ...f, notes: e.target.value }))}
                  maxLength={500}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="btn-secondary" onClick={() => setShowAddPR(false)}>Cancelar</button>
                <button type="submit" className="btn-primary" style={{ backgroundImage: brandGradient }} disabled={addPRMutation.isPending || !prForm.exercise_name.trim() || !prForm.record_value}>
                  {addPRMutation.isPending ? 'Guardando…' : 'Guardar récord'}
                </button>
              </div>
            </form>
          </Modal>

          {/* Upload Photo Modal */}
          <Modal
            open={showPhotoUpload}
            title="Subir foto de progreso"
            description="Sube una foto JPEG, PNG o WebP. Máximo 10 MB."
            onClose={() => { if (!uploadPhotoMutation.isPending) { setShowPhotoUpload(false); setPhotoFile(null); } }}
          >
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!photoFile) return;
                const fd = new FormData();
                fd.append('file', photoFile);
                fd.append('recorded_at', new Date(`${photoRecordedAt}T12:00:00`).toISOString());
                if (photoNotes.trim()) fd.append('notes', photoNotes.trim());
                uploadPhotoMutation.mutate(fd);
              }}
            >
              <div>
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Foto *</label>
                <label className={cn(
                  'flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-8 cursor-pointer transition-colors',
                  photoFile ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-500/10' : 'border-surface-300 dark:border-surface-600 hover:border-surface-400',
                )}>
                  {photoFile ? (
                    <>
                      <Camera size={32} className="text-emerald-500" />
                      <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">{photoFile.name}</p>
                      <p className="text-xs text-surface-400">{(photoFile.size / 1024 / 1024).toFixed(2)} MB</p>
                    </>
                  ) : (
                    <>
                      <Upload size={32} className="text-surface-400" />
                      <p className="text-sm text-surface-500">Toca para seleccionar imagen</p>
                      <p className="text-xs text-surface-400">JPEG, PNG o WebP — máx. 10 MB</p>
                    </>
                  )}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Fecha *</label>
                <input
                  type="date"
                  className="input"
                  value={photoRecordedAt}
                  onChange={(e) => setPhotoRecordedAt(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Notas</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Opcional…"
                  value={photoNotes}
                  onChange={(e) => setPhotoNotes(e.target.value)}
                  maxLength={500}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="btn-secondary" onClick={() => { setShowPhotoUpload(false); setPhotoFile(null); }}>Cancelar</button>
                <button type="submit" className="btn-primary" style={{ backgroundImage: brandGradient }} disabled={uploadPhotoMutation.isPending || !photoFile}>
                  {uploadPhotoMutation.isPending ? 'Subiendo…' : 'Subir foto'}
                </button>
              </div>
            </form>
          </Modal>

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
              )) : <EmptyState title="Aún no hay pagos" description="El historial aparecerá aquí apenas existan pagos para este miembro." />}
            </div>
          ) : null}

          {activeTab === 'support' ? (
            <div className="space-y-4">
              {supportInteractionsQuery.isLoading && !supportInteractionsQuery.data ? <SkeletonListItems count={4} /> : null}

              <Panel title="Soporte y seguimiento">
                <p className="text-sm leading-6 text-surface-600 dark:text-surface-300">
                  Desde aquí puedes pedir ayuda, revisar respuestas del gimnasio y seguir el historial completo de cada solicitud sin perder contexto.
                </p>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <ProfileDetailItem label="Solicitudes activas" value={String(pendingSupportInteractions.length)} />
                  <ProfileDetailItem label="Solicitudes resueltas" value={String(resolvedSupportInteractions)} />
                  <ProfileDetailItem label="Canal directo" value={hasDirectSupport ? 'Disponible' : 'Solo desde la app'} />
                  <ProfileDetailItem
                    label="Último avance"
                    value={latestSupportActivityAt ? formatRelative(latestSupportActivityAt) : 'Sin movimientos'}
                  />
                </div>

                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                  <button
                    type="button"
                    className="btn-primary w-full justify-center sm:w-auto"
                    style={{ backgroundImage: brandGradient }}
                    onClick={openSupportRequestModal}
                  >
                    <LifeBuoy size={16} />
                    Pedir ayuda desde la app
                  </button>
                  {supportWhatsAppUrl ? (
                    <a
                      href={supportWhatsAppUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-secondary w-full justify-center sm:w-auto"
                    >
                      <WhatsAppIcon size={16} />
                      Hablar por WhatsApp
                    </a>
                  ) : null}
                  {supportCallUrl ? (
                    <a href={supportCallUrl} className="btn-secondary w-full justify-center sm:w-auto">
                      <Phone size={16} />
                      Llamar ahora
                    </a>
                  ) : null}
                  {supportEmailUrl ? (
                    <a href={supportEmailUrl} className="btn-secondary w-full justify-center sm:w-auto">
                      <Mail size={16} />
                      Enviar correo
                    </a>
                  ) : null}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {([
                    { id: 'all', label: 'Todas' },
                    { id: 'pending', label: 'Pendientes' },
                    { id: 'resolved', label: 'Resueltas' },
                  ] as const).map((filterOption) => (
                    <button
                      key={filterOption.id}
                      type="button"
                      onClick={() => setSupportFilter(filterOption.id)}
                      style={supportFilter === filterOption.id ? { borderColor: `${accentColor}88`, background: `linear-gradient(135deg, ${withAlpha(accentColor, isDark ? 0.28 : 0.18)}, ${withAlpha(secondaryColor, isDark ? 0.22 : 0.12)})`, color: isDark ? '#e6fffb' : '#0f172a' } : undefined}
                      className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors', supportFilter === filterOption.id ? '' : 'border-surface-200 bg-white text-surface-500 hover:text-surface-900 dark:border-white/10 dark:bg-white/5 dark:text-surface-400 dark:hover:text-white')}
                    >
                      {filterOption.label}
                    </button>
                  ))}
                </div>

                <div className="mt-4 rounded-[1.25rem] border border-surface-200 bg-surface-50/80 p-4 dark:border-white/10 dark:bg-surface-950/35">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-surface-900 dark:text-white">Rango de fechas</p>
                      <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
                        Mostrando {supportInteractions.length} {supportInteractions.length === 1 ? 'solicitud' : 'solicitudes'} {supportDateRangeSummary}.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {([
                        { id: '7d', label: '7 días' },
                        { id: '30d', label: '30 días' },
                        { id: '90d', label: '90 días' },
                        { id: 'custom', label: 'Personalizado' },
                      ] as const).map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => setSupportDatePreset(option.id)}
                          style={supportDatePreset === option.id ? { borderColor: `${accentColor}88`, background: `linear-gradient(135deg, ${withAlpha(accentColor, isDark ? 0.28 : 0.18)}, ${withAlpha(secondaryColor, isDark ? 0.22 : 0.12)})`, color: isDark ? '#e6fffb' : '#0f172a' } : undefined}
                          className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors', supportDatePreset === option.id ? '' : 'border-surface-200 bg-white text-surface-500 hover:text-surface-900 dark:border-white/10 dark:bg-white/5 dark:text-surface-400 dark:hover:text-white')}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-surface-500">Desde</span>
                      <input
                        type="date"
                        className="input"
                        value={supportDateFrom}
                        max={supportDateTo}
                        onChange={(event) => updateSupportDateFrom(event.target.value)}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-surface-500">Hasta</span>
                      <input
                        type="date"
                        className="input"
                        value={supportDateTo}
                        min={supportDateFrom}
                        max={getAgendaDateKey(new Date())}
                        onChange={(event) => updateSupportDateTo(event.target.value)}
                      />
                    </label>
                  </div>
                </div>
              </Panel>

              {filteredSupportInteractions.length ? (
                <Panel title="Tus solicitudes" className="overflow-hidden">
                  <div className="-mx-4 -mb-4 mt-2 divide-y divide-surface-200/80 dark:divide-white/10">
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
                </Panel>
              ) : (
                <EmptyState
                  title={supportFilter === 'all' ? 'Aún no tienes solicitudes' : 'No hay solicitudes con ese filtro'}
                  description={
                    supportFilter === 'all'
                      ? 'Cuando pidas ayuda desde la app, aquí verás el historial de respuestas y el estado del seguimiento.'
                      : 'Prueba cambiando el filtro o crea una nueva solicitud si necesitas ayuda ahora.'
                  }
                />
              )}
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
                      <span className="badge badge-neutral">Rol {formatUserRoleLabel(user.role)}</span>
                      <span className={cn('badge', user.is_verified ? 'badge-success' : 'badge-warning')}>
                        {user.is_verified ? 'Cuenta verificada' : 'Verificación pendiente'}
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
                          <label className="mb-1.5 block text-xs uppercase tracking-[0.18em] text-surface-400">Teléfono</label>
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
                        <ProfileDetailItem label="Teléfono" value={user.phone || 'No informado'} />
                        <ProfileDetailItem label="Alta" value={formatDate(user.created_at)} />
                        <ProfileDetailItem
                          label="Último acceso"
                          value={user.last_login_at ? formatRelative(user.last_login_at) : 'Sin registro aún'}
                        />
                        <ProfileDetailItem label="Cuenta" value={walletQuery.data?.tenant_name || 'Sin cuenta cargada'} />
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

                <Panel title="Membresía y actividad">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <ProfileDetailItem label="Plan activo" value={walletQuery.data?.plan_name || 'Sin plan'} />
                    <ProfileDetailItem
                      label="Estado"
                      value={formatMembershipStatusLabel(walletQuery.data?.membership_status)}
                    />
                    <ProfileDetailItem
                      label="Vencimiento"
                      value={walletQuery.data?.expires_at ? formatDate(walletQuery.data.expires_at) : 'No informado'}
                    />
                    <div className="rounded-2xl border border-surface-200 bg-surface-50 px-4 py-3 dark:border-white/10 dark:bg-surface-950/35 sm:col-span-2">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-surface-500">Renovación automática</p>
                      <div className="mt-3 flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-surface-900 dark:text-white">
                            {MEMBER_AUTO_RENEW_AVAILABLE
                              ? walletQuery.data?.auto_renew ? 'Activada' : 'Desactivada'
                              : 'Próximamente'}
                          </p>
                          <p className="mt-1 text-sm leading-6 text-surface-600 dark:text-surface-300">
                            {MEMBER_AUTO_RENEW_AVAILABLE
                              ? walletQuery.data?.auto_renew
                                ? 'Cuando llegue el vencimiento, el sistema intentará renovar la membresía automáticamente.'
                                : 'La renovación seguirá siendo manual desde la pestaña Planes.'
                              : 'Hoy los cobros recurrentes para membresías de clientes no están automatizados. Por ahora la renovación sigue siendo manual desde la pestaña Planes.'}
                          </p>
                        </div>
                        {walletQuery.data?.membership_id ? (
                          <Tooltip
                            content={
                              MEMBER_AUTO_RENEW_AVAILABLE
                                ? walletQuery.data?.auto_renew
                                  ? 'Desactivar renovación automática'
                                  : 'Activar renovación automática'
                                : 'La renovación automática estará disponible próximamente.'
                            }
                          >
                            <button
                              type="button"
                              disabled={!MEMBER_AUTO_RENEW_AVAILABLE || toggleAutoRenewMutation.isPending}
                              onClick={() => {
                                if (!MEMBER_AUTO_RENEW_AVAILABLE) return;
                                toggleAutoRenewMutation.mutate(!walletQuery.data?.auto_renew);
                              }}
                              className={cn(
                                'relative inline-flex h-7 w-12 shrink-0 rounded-full border p-0.5 transition-all duration-200 focus:outline-none',
                                MEMBER_AUTO_RENEW_AVAILABLE
                                  ? 'border-transparent'
                                  : 'cursor-not-allowed border-surface-300 bg-surface-200/90 dark:border-white/10 dark:bg-white/10',
                                toggleAutoRenewMutation.isPending && 'opacity-60',
                              )}
                              style={MEMBER_AUTO_RENEW_AVAILABLE && walletQuery.data?.auto_renew
                                ? { backgroundColor: accentColor, borderColor: withAlpha(accentColor, 0.38) }
                                : undefined}
                              aria-label={MEMBER_AUTO_RENEW_AVAILABLE ? 'Cambiar renovación automática' : 'Renovación automática no disponible'}
                            >
                              <span
                                className={cn(
                                  'absolute left-0.5 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white shadow-sm transition-transform duration-200',
                                  MEMBER_AUTO_RENEW_AVAILABLE && walletQuery.data?.auto_renew ? 'translate-x-5' : 'translate-x-0',
                                )}
                              />
                            </button>
                          </Tooltip>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-[1.35rem] border border-surface-200 bg-surface-50 p-4 dark:border-white/10 dark:bg-surface-950/35">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-surface-500">Próxima actividad</p>
                    <p className="mt-2 text-sm leading-6 text-surface-600 dark:text-surface-300">
                      {walletQuery.data?.next_class
                        ? `${walletQuery.data.next_class.name} · ${formatDateTime(walletQuery.data.next_class.start_time)}`
                        : 'Todavía no hay una próxima clase vinculada a esta cuenta.'}
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
                      disabled={registerPushSubscriptionMutation.isPending || !webPushSupported || !webPushConfigured}
                    >
                      <Bell size={16} />
                      {!webPushSupported
                        ? 'No disponible'
                        : !webPushConfigured
                          ? 'Próximamente'
                          : activeWebPushSubscription
                            ? 'Avisos activos'
                            : registerPushSubscriptionMutation.isPending
                              ? 'Activando'
                              : 'Activar avisos'}
                    </button>
                  </div>
                  <div className="mt-4 rounded-[1.25rem] border border-surface-200 bg-surface-50 px-4 py-4 dark:border-white/10 dark:bg-surface-950/35">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-surface-500">Acciones rápidas</p>
                    <p className="mt-2 text-sm leading-6 text-surface-600 dark:text-surface-300">
                      Tema, actualización de datos y cierre de sesión ahora viven arriba para que siempre estén a mano sin bajar hasta esta sección.
                    </p>
                  </div>
                </Panel>

                <Panel title="Estado del dispositivo">
                  <div className="space-y-3">
                    <DeviceStatusItem label="Instalación" value={isStandalone ? 'App instalada' : 'Versión web'} tone={isStandalone ? 'success' : 'neutral'} />
                    <DeviceStatusItem label="Conexión" value={isOnline ? 'En línea' : 'Sin conexión'} tone={isOnline ? 'success' : 'warning'} />
                    <DeviceStatusItem label="Avisos" value={notificationPermissionMeta.label} tone={notificationPermissionMeta.tone} />
                    <DeviceStatusItem label="Avisos del navegador" value={webPushStateLabel} tone={activeWebPushSubscription ? 'success' : webPushConfigured ? 'info' : 'warning'} />
                    <DeviceStatusItem label="Última actualización" value={lastSyncedAt ? formatRelative(lastSyncedAt) : 'Sin datos aún'} tone={lastSyncedAt ? 'info' : 'neutral'} />
                  </div>

                  {!webPushConfigured ? (
                    <div className="mt-4 rounded-[1.35rem] border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-amber-700 dark:text-amber-200/80">Avisos no disponibles</p>
                      <p className="mt-2 text-sm leading-6">
                        Por ahora, los avisos del navegador todavía no están disponibles. Mientras tanto puedes revisar tus mensajes en la pestaña Bandeja.
                      </p>
                    </div>
                  ) : null}

                  <div className="mt-4 rounded-[1.35rem] border border-surface-200 bg-surface-50 p-4 dark:border-white/10 dark:bg-surface-950/35">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-surface-500">Soporte del gimnasio</p>
                    <p className="mt-2 text-sm leading-6 text-surface-600 dark:text-surface-300">
                      Usa el módulo Soporte para ver tus casos, revisar respuestas y pedir ayuda sin perder el seguimiento.
                    </p>
                    <div className="mt-4 grid gap-3 sm:grid-cols-4">
                      <ProfileDetailItem label="Correo de soporte" value={supportEmail || 'No informado'} />
                      <ProfileDetailItem label="Teléfono de soporte" value={supportPhone || 'No informado'} />
                      <ProfileDetailItem label="WhatsApp" value={supportWhatsAppUrl ? 'Disponible' : 'No disponible'} />
                      <ProfileDetailItem
                        label="Tus solicitudes"
                        value={
                          pendingSupportInteractions.length
                            ? `${pendingSupportInteractions.length} pendientes`
                            : supportInteractions.length
                              ? `${resolvedSupportInteractions} resueltas`
                              : 'Aún no envías'
                        }
                      />
                    </div>
                    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                      <button
                        type="button"
                        className="btn-primary w-full justify-center sm:w-auto"
                        style={{ backgroundImage: brandGradient }}
                        onClick={() => setTab(searchParams, setSearchParams, 'support')}
                      >
                        <LifeBuoy size={16} />
                        Abrir soporte
                      </button>
                      {supportWhatsAppUrl || supportCallUrl || supportEmailUrl ? (
                        <>
                        {supportWhatsAppUrl ? (
                          <a
                            href={supportWhatsAppUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="btn-secondary w-full justify-center sm:w-auto"
                          >
                            <WhatsAppIcon size={16} />
                            Hablar por WhatsApp
                          </a>
                        ) : null}
                        {supportCallUrl ? (
                          <a href={supportCallUrl} className="btn-secondary w-full justify-center sm:w-auto">
                            <Phone size={16} />
                            Llamar ahora
                          </a>
                        ) : null}
                        {supportEmailUrl ? (
                          <a href={supportEmailUrl} className="btn-secondary w-full justify-center sm:w-auto">
                            <Mail size={16} />
                            Enviar correo
                          </a>
                        ) : null}
                        </>
                      ) : null}
                    </div>
                    {gymLocation ? (
                      <p className="mt-3 text-sm leading-6 text-surface-500 dark:text-surface-400">{gymLocation}</p>
                    ) : null}
                  </div>
                </Panel>
              </div>
            </div>
          ) : null}

          {activeTab === 'notifications' ? (
            <div className="space-y-4">
              {notificationsQuery.isLoading && !notificationsQuery.data ? <SkeletonListItems count={4} /> : null}
              <Panel title="Tu bandeja">
                <p className="text-sm leading-6 text-surface-600 dark:text-surface-300">
                  Revisa tus avisos en un panel más liviano, abre el detalle solo cuando lo necesites y trabaja sobre un rango de fechas claro.
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <DeviceStatusItem label="Nuevas" value={String(unreadNotifications)} tone={unreadNotifications ? 'info' : 'neutral'} />
                  <DeviceStatusItem label="Leídas" value={String(readNotifications)} tone={readNotifications ? 'success' : 'neutral'} />
                  <DeviceStatusItem label="Con acción" value={String(actionableNotifications)} tone={actionableNotifications ? 'warning' : 'neutral'} />
                </div>
                <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center">
                  <div className="relative flex-1">
                    <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-surface-400" />
                    <input
                      type="text"
                      value={notificationSearch}
                      onChange={(event) => setNotificationSearch(event.target.value)}
                      placeholder="Buscar por título o mensaje"
                      className="w-full rounded-2xl border border-surface-200 bg-white py-3 pl-10 pr-4 text-sm text-surface-900 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 dark:border-white/10 dark:bg-surface-950/50 dark:text-white dark:placeholder-surface-500"
                    />
                  </div>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={!unreadNotifications || markAllNotificationsReadMutation.isPending}
                    onClick={() => void markAllNotificationsAsRead()}
                  >
                    <CheckCheck size={16} />
                    {markAllNotificationsReadMutation.isPending ? 'Actualizando...' : 'Marcar visibles como leídas'}
                  </button>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {([
                    { id: 'all', label: 'Todas' },
                    { id: 'unread', label: 'Nuevas' },
                    { id: 'read', label: 'Leídas' },
                    { id: 'actionable', label: 'Con acción' },
                  ] as const).map((filterOption) => (
                    <button
                      key={filterOption.id}
                      type="button"
                      onClick={() => setNotificationFilter(filterOption.id)}
                      style={notificationFilter === filterOption.id ? { borderColor: `${accentColor}88`, background: `linear-gradient(135deg, ${withAlpha(accentColor, isDark ? 0.28 : 0.18)}, ${withAlpha(secondaryColor, isDark ? 0.22 : 0.12)})`, color: isDark ? '#e6fffb' : '#0f172a' } : undefined}
                      className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors', notificationFilter === filterOption.id ? '' : 'border-surface-200 bg-white text-surface-500 hover:text-surface-900 dark:border-white/10 dark:bg-white/5 dark:text-surface-400 dark:hover:text-white')}
                    >
                      {filterOption.label}
                    </button>
                  ))}
                </div>
                <div className="mt-4 rounded-[1.25rem] border border-surface-200 bg-surface-50/80 p-4 dark:border-white/10 dark:bg-surface-950/35">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-surface-900 dark:text-white">Rango de fechas</p>
                      <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
                        Mostrando {notifications.length} {notifications.length === 1 ? 'notificación' : 'notificaciones'} {notificationDateRangeSummary}.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {([
                        { id: '7d', label: '7 días' },
                        { id: '30d', label: '30 días' },
                        { id: '90d', label: '90 días' },
                        { id: 'custom', label: 'Personalizado' },
                      ] as const).map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => setNotificationDatePreset(option.id)}
                          style={notificationDatePreset === option.id ? { borderColor: `${accentColor}88`, background: `linear-gradient(135deg, ${withAlpha(accentColor, isDark ? 0.28 : 0.18)}, ${withAlpha(secondaryColor, isDark ? 0.22 : 0.12)})`, color: isDark ? '#e6fffb' : '#0f172a' } : undefined}
                          className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors', notificationDatePreset === option.id ? '' : 'border-surface-200 bg-white text-surface-500 hover:text-surface-900 dark:border-white/10 dark:bg-white/5 dark:text-surface-400 dark:hover:text-white')}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-surface-500">Desde</span>
                      <input
                        type="date"
                        className="input"
                        value={notificationDateFrom}
                        max={notificationDateTo}
                        onChange={(event) => updateNotificationDateFrom(event.target.value)}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-surface-500">Hasta</span>
                      <input
                        type="date"
                        className="input"
                        value={notificationDateTo}
                        min={notificationDateFrom}
                        max={getAgendaDateKey(new Date())}
                        onChange={(event) => updateNotificationDateTo(event.target.value)}
                      />
                    </label>
                  </div>
                </div>

                <div className="mt-4 overflow-hidden rounded-[1.35rem] border border-surface-200/80 bg-white/85 shadow-sm dark:border-white/10 dark:bg-white/[0.04] dark:shadow-none">
                  {filteredNotifications.length ? (
                    <div className="divide-y divide-surface-200/80 dark:divide-white/10">
                      {filteredNotifications.map((notification) => (
                        <NotificationInboxItem
                          key={notification.id}
                          notification={notification}
                          onOpen={() => void openNotificationDetail(notification)}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="p-5">
                      <EmptyState
                        title={getNotificationEmptyStateTitle(notificationFilter, notificationSearch)}
                        description={getNotificationEmptyStateDescription(notificationFilter, notificationSearch, notificationDateRangeSummary)}
                      />
                    </div>
                  )}
                </div>
              </Panel>
            </div>
          ) : null}
        </section>
        </div>
      </div>

      {/* ── BOTTOM NAV ───────────────────────────────────────────────────── */}
      <nav
        className="fixed inset-x-0 bottom-0 z-20 border-t border-surface-200/80 bg-white/94 shadow-[0_-8px_32px_rgba(15,23,42,0.08)] backdrop-blur-2xl dark:border-white/10 dark:bg-surface-950/92 dark:shadow-none"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="h-px w-full" style={{ backgroundImage: brandGradient }} />
        <div className="mx-auto flex h-[60px] max-w-7xl items-stretch justify-around">
          {([
            { id: 'home' as MemberTabId, icon: Home, label: 'Inicio' },
            { id: 'agenda' as MemberTabId, icon: CalendarDays, label: 'Agenda' },
            { id: 'progress' as MemberTabId, icon: TrendingUp, label: 'Progreso' },
            { id: 'support' as MemberTabId, icon: LifeBuoy, label: 'Soporte' },
            { id: 'notifications' as MemberTabId, icon: Bell, label: 'Bandeja' },
          ] as const).map(({ id, icon: Icon, label }) => {
            const isActive = id === activeTab;
            const badge = navBadgeByTab[id];
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(searchParams, setSearchParams, id)}
                className={cn(
                  'flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-colors',
                  isActive ? 'text-surface-900 dark:text-white' : 'text-surface-400 hover:text-surface-700 dark:text-surface-500 dark:hover:text-surface-300',
                )}
              >
                <span className="relative">
                  <span
                    className={cn('flex h-7 w-7 items-center justify-center rounded-xl transition-all', isActive ? 'scale-110' : '')}
                    style={isActive ? { background: `linear-gradient(135deg, ${accentColor}, ${secondaryColor})`, color: 'white' } : undefined}
                  >
                    <Icon size={16} />
                  </span>
                  {badge ? (
                    <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-400 px-0.5 text-[9px] font-bold text-surface-950">
                      {badge}
                    </span>
                  ) : null}
                </span>
                {label}
              </button>
            );
          })}
          {/* Más — abre el drawer */}
          <button
            type="button"
            onClick={() => setIsDrawerOpen(true)}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-colors',
              ['programs', 'plans', 'payments', 'profile'].includes(activeTab)
                ? 'text-surface-900 dark:text-white'
                : 'text-surface-400 hover:text-surface-700 dark:text-surface-500 dark:hover:text-surface-300',
            )}
          >
            <span
              className={cn('flex h-7 w-7 items-center justify-center rounded-xl transition-all', ['programs', 'plans', 'payments', 'profile'].includes(activeTab) ? 'scale-110' : '')}
              style={['plans', 'payments', 'profile'].includes(activeTab) ? { background: `linear-gradient(135deg, ${accentColor}, ${secondaryColor})`, color: 'white' } : undefined}
            >
              <Menu size={16} />
            </span>
            Más
          </button>
        </div>
      </nav>

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
                <div className="min-w-0 flex items-start gap-3">
                  <div className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl', getNotificationTypeMeta(selectedNotification.type).panelIconClass)}>
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
                      {selectedNotification.action_url ? <span className="badge badge-warning">Con acción</span> : null}
                    </div>
                    <p className="mt-3 text-base font-semibold text-surface-900 dark:text-white">{selectedNotification.title}</p>
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
              <ProfileDetailItem label="Vista" value={selectedNotification.opened_at ? formatDateTime(selectedNotification.opened_at) : 'Pendiente'} />
              <ProfileDetailItem label="Acción ejecutada" value={selectedNotification.clicked_at ? formatDateTime(selectedNotification.clicked_at) : 'Sin ejecutar'} />
              <ProfileDetailItem label="Destino" value={selectedNotification.action_url ? getNotificationActionLabel(selectedNotification.action_url) : 'Sin acción'} />
            </div>

            {selectedNotification.action_url ? (
              <div className="rounded-[1.2rem] border border-surface-200 bg-surface-50/80 px-4 py-4 dark:border-white/10 dark:bg-surface-950/35">
                <p className="text-[11px] uppercase tracking-[0.18em] text-surface-500">Acción disponible</p>
                <p className="mt-2 text-sm leading-6 text-surface-600 dark:text-surface-300">
                  Este aviso incluye un acceso directo para continuar con el siguiente paso sugerido por el gimnasio.
                </p>
              </div>
            ) : null}

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

      <Modal
        open={showSupportRequestModal}
        title="Pedir ayuda"
        description="Tu solicitud quedará visible para el gimnasio y podrás seguir si sigue pendiente o si ya quedó resuelta."
        onClose={() => {
          if (!createSupportInteractionMutation.isPending) {
            setShowSupportRequestModal(false);
          }
        }}
      >
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void submitSupportRequest();
          }}
        >
          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">¿Cómo prefieres que te respondan?</label>
            <div className="grid gap-3 sm:grid-cols-2">
              {SUPPORT_CHANNEL_OPTIONS.map((option) => {
                const isSelected = supportRequestForm.channel === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setSupportRequestForm((current) => ({ ...current, channel: option.value }))}
                    className={cn(
                      'rounded-[1.15rem] border px-4 py-4 text-left transition-colors',
                      isSelected
                        ? 'border-brand-300 bg-brand-50 text-surface-900 dark:border-brand-400/30 dark:bg-brand-500/10 dark:text-white'
                        : 'border-surface-200 bg-white text-surface-600 hover:border-surface-300 dark:border-white/10 dark:bg-surface-950/30 dark:text-surface-300 dark:hover:border-white/20',
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-current/10 bg-white/80 dark:bg-white/10">
                        <MemberSupportChannelIcon channel={option.value} size={18} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">{option.label}</p>
                        <p className="mt-1 text-xs leading-5 opacity-80">{option.description}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Qué necesitas</label>
            <input
              className="input"
              value={supportRequestForm.subject}
              onChange={(event) => setSupportRequestForm((current) => ({ ...current, subject: event.target.value }))}
              placeholder="Ej. No puedo reservar una clase"
              required
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Más contexto</label>
            <textarea
              className="input min-h-28 resize-y"
              value={supportRequestForm.notes}
              onChange={(event) => setSupportRequestForm((current) => ({ ...current, notes: event.target.value }))}
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
            <button type="button" className="btn-secondary" onClick={() => setShowSupportRequestModal(false)}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" style={{ backgroundImage: brandGradient }} disabled={createSupportInteractionMutation.isPending}>
              <LifeBuoy size={16} />
              {createSupportInteractionMutation.isPending ? 'Enviando...' : 'Enviar solicitud'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!selectedSupportInteraction}
        size="lg"
        title={selectedSupportInteraction?.subject || 'Historial de la solicitud'}
        description="Aquí ves el seguimiento completo de esta solicitud, incluyendo respuestas y avances del gimnasio."
        onClose={() => setSelectedSupportInteractionId(null)}
      >
        {selectedSupportInteraction ? (
          <div className="space-y-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn('badge', supportChannelBadgeColor(selectedSupportInteraction.channel))}>
                    {formatSupportChannelLabel(selectedSupportInteraction.channel)}
                  </span>
                  <span className={cn('badge', selectedSupportInteraction.resolved ? 'badge-success' : 'badge-warning')}>
                    {selectedSupportInteraction.resolved ? 'Resuelta' : 'Pendiente'}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-surface-600 dark:text-surface-300">
                  Abre el detalle cuando quieras sin sobrecargar la bandeja principal.
                </p>
              </div>
              <div className="rounded-[1.2rem] border border-surface-200 bg-surface-50 px-4 py-3 text-sm text-surface-600 dark:border-white/10 dark:bg-surface-950/35 dark:text-surface-300">
                {selectedSupportMeta?.traceCount || 1} {(selectedSupportMeta?.traceCount || 1) === 1 ? 'entrada' : 'entradas'}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <ProfileDetailItem label="Estado" value={selectedSupportInteraction.resolved ? 'Resuelta' : 'Pendiente'} />
              <ProfileDetailItem label="Canal elegido" value={formatSupportChannelLabel(selectedSupportInteraction.channel)} />
              <ProfileDetailItem
                label="Último avance"
                value={selectedSupportMeta?.lastActivityAt ? formatRelative(selectedSupportMeta.lastActivityAt) : formatRelative(selectedSupportInteraction.created_at)}
              />
              <ProfileDetailItem label="Responsable" value={selectedSupportInteraction.handler_name || 'Aún sin asignar'} />
            </div>

            <div className="space-y-3">
              {selectedSupportTimeline.length ? selectedSupportTimeline.map((entry, index) => (
                <div
                  key={entry.id}
                  className={cn(
                    'relative rounded-[1.25rem] border px-4 py-4',
                    entry.kind === 'reply'
                      ? 'border-brand-200 bg-brand-50/70 dark:border-brand-400/20 dark:bg-brand-500/10'
                      : 'border-surface-200 bg-surface-50/85 dark:border-white/10 dark:bg-surface-950/35',
                  )}
                >
                  {index < selectedSupportTimeline.length - 1 ? (
                    <span className="absolute left-[1.15rem] top-full h-3 w-px bg-surface-200 dark:bg-white/10" />
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn('badge', entry.kind === 'reply' ? 'badge-info' : 'badge-neutral')}>
                      {entry.kind === 'reply' ? 'Respuesta' : entry.kind === 'initial' ? 'Solicitud' : 'Actualización'}
                    </span>
                    {entry.author_role ? (
                      <span className="badge badge-neutral">{formatUserRoleLabel(entry.author_role)}</span>
                    ) : null}
                    <span className="text-xs text-surface-500 dark:text-surface-400">
                      {formatDateTime(entry.created_at)}
                    </span>
                  </div>
                  <p className="mt-3 text-sm font-semibold text-surface-900 dark:text-white">{entry.author_name}</p>
                  <p className="mt-2 text-sm leading-6 text-surface-600 dark:text-surface-300">
                    {entry.message}
                  </p>
                </div>
              )) : (
                <div className="rounded-[1.25rem] border border-dashed border-surface-300 bg-surface-50/80 px-4 py-6 text-center dark:border-white/15 dark:bg-black/10">
                  <p className="text-sm font-medium text-surface-900 dark:text-white">Aún no hay respuestas registradas</p>
                  <p className="mt-2 text-sm leading-6 text-surface-600 dark:text-surface-300">
                    Cuando el gimnasio responda o avance tu caso, lo verás aquí en orden.
                  </p>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-end">
              {supportWhatsAppUrl ? (
                <a
                  href={supportWhatsAppUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-secondary w-full justify-center sm:w-auto"
                >
                  <WhatsAppIcon size={16} />
                  Hablar por WhatsApp
                </a>
              ) : null}
              <button type="button" className="btn-secondary" onClick={() => setSelectedSupportInteractionId(null)}>
                Cerrar
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Modal confirmación cancelación con motivo */}
      <Modal
        open={!!pendingCancelReservationId}
        title="Cancelar reserva"
        onClose={() => !cancelMutation.isPending && setPendingCancelReservationId(null)}
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!pendingCancelReservationId) return;
            cancelMutation.mutate({ reservationId: pendingCancelReservationId, reason: cancelReasonText.trim() || undefined });
          }}
        >
          <p className="text-sm text-surface-500 dark:text-surface-400">
            Tu lugar será liberado y otro miembro de la lista de espera podrá tomarlo.
          </p>
          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">
              Motivo de cancelación (opcional)
            </label>
            <textarea
              className="input min-h-20 resize-y text-sm"
              value={cancelReasonText}
              onChange={(e) => setCancelReasonText(e.target.value)}
              placeholder="Ej: No podré asistir por trabajo, lesión..."
              maxLength={500}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setPendingCancelReservationId(null)}>
              Volver
            </button>
            <button type="submit" className="btn-danger" disabled={cancelMutation.isPending}>
              {cancelMutation.isPending ? 'Cancelando...' : 'Confirmar cancelación'}
            </button>
          </div>
        </form>
      </Modal>
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
    <div className="rounded-[1.5rem] border border-surface-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-2xl dark:border-white/10 dark:bg-white/5 dark:shadow-none">
      <div className="flex h-10 w-10 items-center justify-center rounded-2xl text-white" style={{ background: `linear-gradient(135deg, ${accentColor}, ${secondaryColor})` }}>
        <Icon size={18} />
      </div>
      <p className="mt-3 text-[11px] uppercase tracking-[0.18em] text-surface-500 dark:text-surface-400">{label}</p>
      <p className="mt-1.5 text-[1.65rem] font-bold font-display text-surface-900 dark:text-white">{value}</p>
      <p className="mt-1 text-sm text-surface-600 dark:text-surface-300">{caption}</p>
    </div>
  );
}

function Panel({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-[1.4rem] border border-surface-200/80 bg-white/85 p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.04] dark:shadow-none', className)}>
      <h2 className="text-lg font-semibold text-surface-900 dark:text-white">{title}</h2>
      <div className="mt-2.5">{children}</div>
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
            <p className="text-[11px] uppercase tracking-[0.22em] text-surface-600 dark:text-teal-100/80">Acceso móvil</p>
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
          {membershipStatus ? (
            <span className={cn('badge', membershipStatusColor(membershipStatus))}>{formatMembershipStatusLabel(membershipStatus)}</span>
          ) : null}
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
                <p className="mt-1 text-sm font-semibold text-surface-900 dark:text-surface-100">Aún no hay un código sincronizado para esta credencial.</p>
              </div>
              <button type="button" onClick={onCopyCode} disabled className="btn-secondary shrink-0 cursor-not-allowed opacity-50">
                <Copy size={16} />
                Copiar código
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

function NotificationInboxItem({
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
        <div className={cn('mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl', typeMeta.panelIconClass)}>
          <NotificationTypeIcon type={notification.type} size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-surface-900 dark:text-white">{notification.title}</p>
                {!notification.is_read ? <span className="h-2.5 w-2.5 rounded-full bg-brand-500" /> : null}
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
            {notification.action_url ? <span className="badge badge-warning">Con acción</span> : null}
          </div>
        </div>
      </div>
    </button>
  );
}

function SupportInboxItem({
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
                {!interaction.resolved ? <span className="h-2.5 w-2.5 rounded-full bg-brand-500" /> : null}
              </div>
              <p className="mt-1 line-clamp-2 text-sm leading-6 text-surface-600 dark:text-surface-300">
                {lastEntry?.message || 'Tu gimnasio ya recibió esta solicitud y verás las respuestas aquí.'}
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
              {(traceCount || 1)} {(traceCount || 1) === 1 ? 'movimiento' : 'movimientos'}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-surface-500 dark:text-surface-400">
            <span>{lastEntry ? `${lastEntry.author_name} escribió ${formatRelative(lastActivityAt)}` : `Enviada ${formatRelative(interaction.created_at)}`}</span>
            <span>{interaction.handler_name ? `La está viendo ${interaction.handler_name}` : 'Aún sin responsable asignado'}</span>
          </div>
        </div>
      </div>
    </button>
  );
}

function NotificationTypeIcon({
  type,
  size = 16,
}: {
  type: AppNotification['type'];
  size?: number;
}) {
  if (type === 'success') {
    return <CheckCheck size={size} />;
  }
  if (type === 'error') {
    return <XCircle size={size} />;
  }
  if (type === 'warning') {
    return <ShieldCheck size={size} />;
  }
  return <Bell size={size} />;
}

function getAgendaDateKey(date: string | Date) {
  const value = typeof date === 'string' ? new Date(date) : date;
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getAgendaDayMeta(date: string | Date) {
  const value = typeof date === 'string' ? new Date(date) : date;
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  const weekdayLabel = formatDate(value, { weekday: 'long' });

  if (getAgendaDateKey(value) === getAgendaDateKey(today)) {
    return {
      title: 'Hoy',
      subtitle: formatDate(value, { weekday: 'long', day: '2-digit', month: 'short' }),
    };
  }

  if (getAgendaDateKey(value) === getAgendaDateKey(tomorrow)) {
    return {
      title: 'Mañana',
      subtitle: formatDate(value, { weekday: 'long', day: '2-digit', month: 'short' }),
    };
  }

  return {
    title: `${weekdayLabel.charAt(0).toUpperCase()}${weekdayLabel.slice(1)}`,
    subtitle: formatDate(value, { day: '2-digit', month: 'short', year: 'numeric' }),
  };
}

function formatAgendaTimeRange(startTime: string, endTime: string) {
  return `${formatTime(startTime)} a ${formatTime(endTime)}`;
}

function formatAgendaAvailabilityLabel(currentBookings: number, maxCapacity: number) {
  const availableSpots = Math.max(maxCapacity - currentBookings, 0);
  if (!availableSpots) {
    return 'Sin cupos disponibles';
  }
  return `${availableSpots} de ${maxCapacity} disponibles`;
}

function getReservationStatusLabel(reservation: Reservation) {
  if (reservation.status === 'waitlisted') {
    return reservation.waitlist_position ? `Lista de espera · #${reservation.waitlist_position}` : 'Lista de espera';
  }
  if (reservation.status === 'attended') return 'Asististe';
  if (reservation.status === 'no_show') return 'No asististe';
  return 'Reserva confirmada';
}

function buildSupportWhatsAppUrl(phone?: string | null, tenantName?: string | null) {
  const digits = normalizeWhatsAppPhone(phone);
  if (!digits) return null;
  const message = encodeURIComponent(`Hola, necesito ayuda con mi cuenta en ${tenantName || 'el gimnasio'}.`);
  return `https://wa.me/${digits}?text=${message}`;
}

function buildSupportCallUrl(phone?: string | null) {
  if (!phone) return null;
  const normalized = phone.replace(/[^\d+]/g, '');
  return normalized ? `tel:${normalized}` : null;
}

function buildSupportEmailUrl(email?: string | null, tenantName?: string | null) {
  if (!email) return null;
  const subject = encodeURIComponent(`Soporte ${tenantName || 'Nexo Fitness'}`);
  const body = encodeURIComponent(`Hola, necesito ayuda con mi cuenta en ${tenantName || 'el gimnasio'}.`);
  return `mailto:${email}?subject=${subject}&body=${body}`;
}

function sanitizeSupportContactValue(value?: string | null) {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (['none', 'null', 'undefined', 'n/a', 'na'].includes(normalized.toLowerCase())) {
    return null;
  }
  return normalized;
}

function normalizeWhatsAppPhone(phone?: string | null) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('56') && digits.length >= 11 && digits.length <= 15) {
    return digits;
  }
  if (digits.length === 9 && digits.startsWith('9')) {
    return `56${digits}`;
  }
  if (digits.length >= 10 && digits.length <= 15) {
    return digits;
  }
  return null;
}

const SUPPORT_CHANNEL_OPTIONS: Array<{
  value: SupportInteraction['channel'];
  label: string;
  description: string;
}> = [
  { value: 'whatsapp', label: 'WhatsApp', description: 'Para que te respondan más rápido por chat.' },
  { value: 'email', label: 'Correo', description: 'Si prefieres una respuesta más detallada.' },
  { value: 'phone', label: 'Teléfono', description: 'Para que te contacten directamente.' },
  { value: 'in_person', label: 'Presencial', description: 'Si quieres resolverlo al llegar al gimnasio.' },
];

function createSupportRequestForm(channel: SupportInteraction['channel'] = 'whatsapp'): SupportRequestForm {
  return {
    channel,
    subject: '',
    notes: '',
  };
}

function MemberSupportChannelIcon({
  channel,
  size = 16,
}: {
  channel: SupportInteraction['channel'];
  size?: number;
}) {
  if (channel === 'whatsapp') {
    return <WhatsAppIcon size={size} />;
  }
  if (channel === 'email') {
    return <Mail size={size} />;
  }
  if (channel === 'phone') {
    return <Phone size={size} />;
  }
  return <MapPin size={size} />;
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
  if (actionUrl.includes('support')) return 'support';
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
    queryClient.invalidateQueries({ queryKey: ['member-programs'] }),
    queryClient.invalidateQueries({ queryKey: ['member-classes'] }),
    queryClient.invalidateQueries({ queryKey: ['member-reservations'] }),
    queryClient.invalidateQueries({ queryKey: ['member-payments'] }),
    queryClient.invalidateQueries({ queryKey: ['member-support-interactions'] }),
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
    return 'La app ya está instalada y puedes abrirla directo desde la pantalla principal del teléfono.';
  }
  if (canPromptInstall) {
    return 'Toca Instalar para guardar esta app en tu dispositivo y abrirla más rápido.';
  }
  if (typeof navigator === 'undefined') {
    return 'Instala esta app desde el menú del navegador para tener una experiencia móvil más directa.';
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

function getNotificationTypeMeta(type: AppNotification['type']) {
  if (type === 'success') {
    return {
      label: 'Confirmación',
      badgeClass: 'badge-success',
      panelIconClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200',
    };
  }
  if (type === 'warning') {
    return {
      label: 'Importante',
      badgeClass: 'badge-warning',
      panelIconClass: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200',
    };
  }
  if (type === 'error') {
    return {
      label: 'Urgente',
      badgeClass: 'badge-danger',
      panelIconClass: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200',
    };
  }
  return {
    label: 'Aviso',
    badgeClass: 'badge-info',
    panelIconClass: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-200',
  };
}

function getNotificationActionLabel(actionUrl?: string | null) {
  const nextTab = getTabFromAction(actionUrl);
  if (nextTab === 'agenda') return 'Ver agenda';
  if (nextTab === 'payments') return 'Ver pagos';
  if (nextTab === 'plans') return 'Ver planes';
  if (nextTab === 'profile') return 'Ver perfil';
  return actionUrl?.startsWith('http') ? 'Abrir enlace' : 'Abrir aviso';
}

function getNotificationEmptyStateTitle(filter: NotificationFilter, query: string) {
  if (query.trim()) {
    return 'No encontramos avisos con esa búsqueda';
  }
  if (filter === 'unread') return 'No tienes avisos nuevos';
  if (filter === 'read') return 'Todavía no hay avisos leídos';
  if (filter === 'actionable') return 'No hay avisos con acción';
  return 'Tu bandeja está vacía';
}

function getNotificationEmptyStateDescription(filter: NotificationFilter, query: string, rangeSummary: string) {
  if (query.trim()) {
    return 'Prueba con otra palabra o revisa los filtros para encontrar el aviso que buscas.';
  }
  if (filter === 'unread') return `No hay avisos nuevos ${rangeSummary}.`;
  if (filter === 'read') return `Todavía no hay avisos leídos ${rangeSummary}.`;
  if (filter === 'actionable') return `No hay avisos con acción ${rangeSummary}.`;
  return `No encontramos avisos ${rangeSummary}.`;
}

function getNotificationPresetDateRange(preset: Exclude<NotificationDatePreset, 'custom'>) {
  const to = new Date();
  const from = new Date(to);
  const daysBack = preset === '7d' ? 6 : preset === '90d' ? 89 : 29;
  from.setDate(to.getDate() - daysBack);

  return {
    from: getAgendaDateKey(from),
    to: getAgendaDateKey(to),
  };
}

function getNotificationDateRangeSummary(from: string, to: string) {
  return `entre el ${formatDate(from)} y el ${formatDate(to)}`;
}

function isDateKeyWithinRange(value: string, from: string, to: string) {
  return value >= from && value <= to;
}
