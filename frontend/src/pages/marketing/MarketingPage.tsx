import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock3,
  Eye,
  Megaphone,
  MessageCircle,
  MessageSquare,
  MousePointerClick,
  Plus,
  Search,
  Send,
  UsersRound,
  Zap,
} from 'lucide-react';
import Modal from '@/components/ui/Modal';
import Tooltip from '@/components/ui/Tooltip';
import { campaignsApi, clientsApi, notificationsApi } from '@/services/api';
import { fadeInUp, staggerContainer } from '@/utils/animations';
import { cn, formatDateTime, toDateInputValue, getApiError } from '@/utils';
import type { AppNotification, Campaign, CampaignOverview, NotificationBroadcastResponse, PaginatedResponse, User } from '@/types';

type CampaignSegmentFilter = NonNullable<Campaign['segment_filter']>;

type CampaignForm = {
  id?: string;
  name: string;
  subject: string;
  content: string;
  channel: Campaign['channel'];
  status: Campaign['status'];
  notification_type: AppNotification['type'];
  action_url: string;
  send_push: boolean;
  total_recipients: string;
  total_sent: string;
  total_opened: string;
  audience_status: 'all' | 'active' | 'inactive';
  audience_search: string;
  scheduled_at: string;
};

type BroadcastForm = {
  campaign_id?: string;
  campaign_name: string;
  title: string;
  message: string;
  type: AppNotification['type'];
  action_url: string;
  send_push: boolean;
  user_ids: string[];
  segment_filter?: CampaignSegmentFilter;
};

const actionUrlPresets = [
  { label: 'Planes', value: 'nexofitness://store' },
  { label: 'Perfil', value: 'nexofitness://account/profile' },
  { label: 'Pagos', value: 'nexofitness://payments' },
  { label: 'Agenda', value: 'nexofitness://agenda' },
];

const emptyForm: CampaignForm = {
  name: '',
  subject: '',
  content: '',
  channel: 'email',
  status: 'draft',
  notification_type: 'info',
  action_url: '',
  send_push: true,
  total_recipients: '0',
  total_sent: '0',
  total_opened: '0',
  audience_status: 'active',
  audience_search: '',
  scheduled_at: '',
};

const emptyOverview: CampaignOverview = {
  total_campaigns: 0,
  scheduled_pending: 0,
  sending_now: 0,
  sent_total: 0,
  opened_total: 0,
  clicked_total: 0,
  manual_runs: 0,
  scheduler_runs: 0,
  scheduler_failures: 0,
  pending_push_receipts: 0,
  failed_push_receipts: 0,
  open_rate: 0,
  click_rate: 0,
};

function normalizeSegmentFilter(segmentFilter?: Campaign['segment_filter'] | null): CampaignSegmentFilter {
  return {
    status: segmentFilter?.status ?? 'active',
    search: segmentFilter?.search ?? '',
  };
}

function matchesCampaignSegment(client: User, segmentFilter: CampaignSegmentFilter) {
  const statusFilter = segmentFilter.status ?? 'active';
  if (statusFilter === 'active' && !client.is_active) return false;
  if (statusFilter === 'inactive' && client.is_active) return false;

  const normalizedSearch = (segmentFilter.search ?? '').trim().toLowerCase();
  if (!normalizedSearch) return true;

  return `${client.first_name} ${client.last_name} ${client.email} ${client.phone ?? ''}`
    .toLowerCase()
    .includes(normalizedSearch);
}

function buildSegmentSummary(segmentFilter?: Campaign['segment_filter'] | null) {
  const normalized = normalizeSegmentFilter(segmentFilter);
  const statusLabel =
    normalized.status === 'inactive'
      ? 'Clientes inactivos'
      : normalized.status === 'all'
        ? 'Todos los clientes'
        : 'Clientes activos';

  return normalized.search?.trim()
    ? `${statusLabel} que coincidan con "${normalized.search.trim()}"`
    : statusLabel;
}

function formatDispatchTrigger(trigger?: Campaign['last_dispatch_trigger']) {
  if (trigger === 'scheduled') return 'programación automática';
  if (trigger === 'manual') return 'envío manual';
  return 'sin registro';
}

function formatCampaignStatus(status: Campaign['status']) {
  if (status === 'draft') return 'Borrador';
  if (status === 'scheduled') return 'Programada';
  if (status === 'sending') return 'Enviando';
  if (status === 'sent') return 'Enviada';
  if (status === 'cancelled') return 'Cancelada';
  return status;
}

function calculateRate(total: number, base: number) {
  return base ? Math.round((total / base) * 100) : 0;
}

function toForm(campaign?: Campaign): CampaignForm {
  if (!campaign) return emptyForm;
  const segmentFilter = normalizeSegmentFilter(campaign.segment_filter);

  return {
    id: campaign.id,
    name: campaign.name,
    subject: campaign.subject ?? '',
    content: campaign.content ?? '',
    channel: campaign.channel,
    status: campaign.status,
    notification_type: campaign.notification_type,
    action_url: campaign.action_url ?? '',
    send_push: campaign.send_push,
    total_recipients: String(campaign.total_recipients),
    total_sent: String(campaign.total_sent),
    total_opened: String(campaign.total_opened),
    audience_status: segmentFilter.status ?? 'active',
    audience_search: segmentFilter.search ?? '',
    scheduled_at: campaign.scheduled_at ? toDateInputValue(campaign.scheduled_at) : '',
  };
}

function createBroadcastForm(campaign?: Campaign): BroadcastForm {
  return {
    campaign_id: campaign?.id,
    campaign_name: campaign?.name ?? 'Envío libre',
    title: campaign?.subject?.trim() || campaign?.name || 'Nueva campaña',
    message: campaign?.content ?? '',
    type: campaign?.notification_type ?? 'info',
    action_url: campaign?.action_url ?? '',
    send_push: campaign?.send_push ?? true,
    user_ids: [],
    segment_filter: campaign?.segment_filter ? normalizeSegmentFilter(campaign.segment_filter) : undefined,
  };
}

function ChannelIcon({ channel, size = 18 }: { channel: Campaign['channel']; size?: number }) {
  if (channel === 'email') return <Send size={size} />;
  if (channel === 'whatsapp') return <MessageCircle size={size} />;
  return <MessageSquare size={size} />;
}

function channelColors(channel: Campaign['channel']) {
  if (channel === 'email') return 'bg-brand-50 text-brand-500 dark:bg-brand-950/40';
  if (channel === 'whatsapp') return 'bg-emerald-50 text-emerald-500 dark:bg-emerald-950/40';
  return 'bg-sky-50 text-sky-500 dark:bg-sky-950/40';
}

export default function MarketingPage() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [showBroadcastModal, setShowBroadcastModal] = useState(false);
  const [form, setForm] = useState<CampaignForm>(emptyForm);
  const [broadcastForm, setBroadcastForm] = useState<BroadcastForm>(createBroadcastForm());
  const [recipientSearch, setRecipientSearch] = useState('');
  const [lastBroadcastResult, setLastBroadcastResult] = useState<NotificationBroadcastResponse | null>(null);
  const [lastBroadcastUsedPush, setLastBroadcastUsedPush] = useState<boolean | null>(null);
  const [hasAppliedInitialSegmentSelection, setHasAppliedInitialSegmentSelection] = useState(false);

  const { data, isLoading, isError } = useQuery<PaginatedResponse<Campaign>>({
    queryKey: ['campaigns'],
    queryFn: async () => {
      const response = await campaignsApi.list({ page: 1, per_page: 50 });
      return response.data;
    },
  });

  const { data: overviewData, isLoading: isLoadingOverview } = useQuery<CampaignOverview>({
    queryKey: ['campaigns-overview'],
    queryFn: async () => {
      const response = await campaignsApi.overview();
      return response.data;
    },
  });

  const { data: clientsData, isLoading: isLoadingClients, isError: isClientsError } = useQuery<PaginatedResponse<User>>({
    queryKey: ['marketing-clients'],
    enabled: showBroadcastModal,
    queryFn: async () => {
      const response = await clientsApi.list({ page: 1, per_page: 100 });
      return response.data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        subject: form.subject || null,
        content: form.content || null,
        channel: form.channel,
        status: form.status,
        notification_type: form.notification_type,
        action_url: form.action_url || null,
        send_push: form.send_push,
        segment_filter: normalizeSegmentFilter({
          status: form.audience_status,
          search: form.audience_search.trim(),
        }),
        scheduled_at: form.scheduled_at ? new Date(form.scheduled_at).toISOString() : null,
      };

      if (form.id) {
        const response = await campaignsApi.update(form.id, payload);
        return response.data;
      }

      const response = await campaignsApi.create({
        ...payload,
        total_recipients: 0,
        total_sent: 0,
        total_opened: 0,
        total_clicked: 0,
      });
      return response.data;
    },
    onSuccess: () => {
      toast.success(form.id ? 'Campaña actualizada' : 'Campaña creada');
      setShowModal(false);
      setForm(emptyForm);
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['campaigns-overview'] });
    },
    onError: (error: unknown) => {
      toast.error(getApiError(error, 'No se pudo guardar la campaña'));
    },
  });

  const broadcastMutation = useMutation({
    mutationFn: async () => {
      const response = await notificationsApi.broadcast({
        campaign_id: broadcastForm.campaign_id || null,
        user_ids: broadcastForm.user_ids,
        title: broadcastForm.title,
        message: broadcastForm.message || null,
        type: broadcastForm.type,
        action_url: broadcastForm.action_url || null,
        send_push: broadcastForm.send_push,
      });
      return response.data as NotificationBroadcastResponse;
    },
    onSuccess: (result: NotificationBroadcastResponse) => {
      setLastBroadcastResult(result);
      setLastBroadcastUsedPush(broadcastForm.send_push);
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['campaigns-overview'] });

      if (!broadcastForm.send_push) {
        toast.success(`Envío creado para ${result.total_recipients} cliente(s) sin aviso al dispositivo.`);
        return;
      }
      if (!result.total_push_deliveries) {
        toast.success(`Envío creado para ${result.total_recipients} cliente(s). Nadie tenía avisos activados.`);
        return;
      }
      toast.success(`Envío realizado. ${result.accepted_push_deliveries}/${result.total_push_deliveries} entrega(s) correctas.`);
    },
    onError: (error: unknown) => {
      toast.error(getApiError(error, 'No se pudo enviar el aviso'));
    },
  });

  const campaigns = data?.items ?? [];
  const overview = overviewData ?? emptyOverview;
  const clientItems = clientsData?.items ?? [];
  const editingCampaign = useMemo(
    () => (form.id ? campaigns.find((campaign: Campaign) => campaign.id === form.id) : undefined),
    [campaigns, form.id],
  );

  const filteredClients = useMemo(() => {
    const normalizedSearch = recipientSearch.trim().toLowerCase();
    if (!normalizedSearch) return clientItems;
    return clientItems.filter((client: User) =>
      `${client.first_name} ${client.last_name} ${client.email}`.toLowerCase().includes(normalizedSearch),
    );
  }, [clientItems, recipientSearch]);

  const segmentMatchedClients = useMemo(() => {
    if (!broadcastForm.segment_filter) return [];
    return clientItems.filter((client: User) =>
      matchesCampaignSegment(client, normalizeSegmentFilter(broadcastForm.segment_filter)),
    );
  }, [clientItems, broadcastForm.segment_filter]);

  useEffect(() => {
    if (!showBroadcastModal || hasAppliedInitialSegmentSelection || !clientItems.length) return;
    if (!broadcastForm.segment_filter) {
      setHasAppliedInitialSegmentSelection(true);
      return;
    }
    setBroadcastForm((current) => ({
      ...current,
      user_ids: segmentMatchedClients.map((client: User) => client.id),
    }));
    setHasAppliedInitialSegmentSelection(true);
  }, [showBroadcastModal, hasAppliedInitialSegmentSelection, clientItems.length, broadcastForm.segment_filter, segmentMatchedClients]);

  const toggleRecipient = (userId: string) => {
    setBroadcastForm((current) => ({
      ...current,
      user_ids: current.user_ids.includes(userId)
        ? current.user_ids.filter((id) => id !== userId)
        : [...current.user_ids, userId],
    }));
  };

  const selectAllFilteredRecipients = () => {
    setBroadcastForm((current) => ({
      ...current,
      user_ids: Array.from(new Set([...current.user_ids, ...filteredClients.map((c: User) => c.id)])),
    }));
  };

  const clearRecipients = () => {
    setBroadcastForm((current) => ({ ...current, user_ids: [] }));
  };

  const applySavedSegment = () => {
    setBroadcastForm((current) => ({
      ...current,
      user_ids: segmentMatchedClients.map((c: User) => c.id),
    }));
  };

  const openBroadcastModal = (campaign?: Campaign) => {
    setBroadcastForm(createBroadcastForm(campaign));
    setRecipientSearch('');
    setLastBroadcastResult(null);
    setLastBroadcastUsedPush(null);
    setHasAppliedInitialSegmentSelection(false);
    setShowBroadcastModal(true);
  };

  const resetBroadcastForNew = () => {
    const campaign = campaigns.find((c: Campaign) => c.id === broadcastForm.campaign_id);
    setBroadcastForm(createBroadcastForm(campaign));
    setRecipientSearch('');
    setLastBroadcastResult(null);
    setLastBroadcastUsedPush(null);
    setHasAppliedInitialSegmentSelection(false);
  };

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-6">

      {/* ── Encabezado ── */}
      <motion.div variants={fadeInUp} className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Marketing</h1>
          <p className="mt-1 text-sm text-surface-500">
            Crea campañas, reutiliza grupos de clientes y revisa sus resultados con un lenguaje simple.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => openBroadcastModal()} className="btn-secondary">
            <Zap size={16} />
            Envío rápido
          </button>
          <button
            type="button"
            onClick={() => {
              setForm(emptyForm);
              setShowModal(true);
            }}
            className="btn-primary"
          >
            <Plus size={16} />
            Nueva campaña
          </button>
        </div>
      </motion.div>

      {isError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-600 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
          No pudimos cargar las campañas de la cuenta.
        </div>
      ) : null}

      {/* ── Dashboard KPIs primarios ── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {isLoadingOverview ? (
          Array.from({ length: 4 }).map((_, i) => <div key={i} className="shimmer h-28 rounded-2xl" />)
        ) : (
          <>
            <div className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
              <div className="flex items-center gap-2">
                <Megaphone size={15} className="text-brand-500" />
                <span className="text-xs font-medium uppercase tracking-wide text-surface-500">Activas</span>
              </div>
              <p className="mt-3 text-3xl font-bold font-display text-surface-900 dark:text-white">
                {overview.scheduled_pending + overview.sending_now}
              </p>
              <p className="mt-1 text-xs text-surface-400">{overview.total_campaigns} campaña(s) guardadas</p>
            </div>

            <div className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
              <div className="flex items-center gap-2">
                <Send size={15} className="text-emerald-500" />
                <span className="text-xs font-medium uppercase tracking-wide text-surface-500">Enviados</span>
              </div>
              <p className="mt-3 text-3xl font-bold font-display text-surface-900 dark:text-white">{overview.sent_total}</p>
              <p className="mt-1 text-xs text-surface-400">
                {overview.manual_runs} manual · {overview.scheduler_runs} auto
              </p>
            </div>

            <div className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
              <div className="flex items-center gap-2">
                <Eye size={15} className="text-violet-500" />
                <span className="text-xs font-medium uppercase tracking-wide text-surface-500">Apertura</span>
              </div>
              <p className="mt-3 text-3xl font-bold font-display text-surface-900 dark:text-white">{overview.open_rate}%</p>
              <p className="mt-1 text-xs text-surface-400">{overview.opened_total} abiertos</p>
            </div>

            <div className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
              <div className="flex items-center gap-2">
                <MousePointerClick size={15} className="text-amber-500" />
                <span className="text-xs font-medium uppercase tracking-wide text-surface-500">Tasa de clics</span>
              </div>
              <p className="mt-3 text-3xl font-bold font-display text-surface-900 dark:text-white">{overview.click_rate}%</p>
              <p className="mt-1 text-xs text-surface-400">{overview.clicked_total} clic(s)</p>
            </div>
          </>
        )}
      </div>

      {/* ── Dashboard métricas operativas ── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {isLoadingOverview ? (
          Array.from({ length: 4 }).map((_, i) => <div key={i} className="shimmer h-24 rounded-2xl" />)
        ) : (
          <>
            <div className="rounded-2xl border border-surface-200/50 bg-white p-4 dark:border-surface-800/50 dark:bg-surface-900">
              <div className="flex items-center gap-2">
                <Clock3 size={14} className="text-sky-500" />
                <span className="text-xs font-medium text-surface-500">Pendientes de envío</span>
              </div>
              <p className="mt-2 text-2xl font-bold font-display text-surface-900 dark:text-white">
                {overview.scheduled_pending}
              </p>
              {overview.sending_now > 0 && (
                <p className="mt-1 text-xs text-amber-500">{overview.sending_now} enviándose ahora</p>
              )}
            </div>

            <div className="rounded-2xl border border-surface-200/50 bg-white p-4 dark:border-surface-800/50 dark:bg-surface-900">
              <div className="flex items-center gap-2">
                <Send size={14} className="text-emerald-500" />
                <span className="text-xs font-medium text-surface-500">Envíos automáticos</span>
              </div>
              <p className="mt-2 text-2xl font-bold font-display text-surface-900 dark:text-white">
                {overview.scheduler_runs}
              </p>
              {overview.scheduler_failures > 0 ? (
                <p className="mt-1 text-xs text-rose-500">{overview.scheduler_failures} con error</p>
              ) : (
                <p className="mt-1 text-xs text-surface-400">sin errores registrados</p>
              )}
            </div>

            <div className="rounded-2xl border border-surface-200/50 bg-white p-4 dark:border-surface-800/50 dark:bg-surface-900">
              <div className="flex items-center gap-2">
                <Bell size={14} className="text-brand-500" />
                <span className="text-xs font-medium text-surface-500">Push pendientes</span>
              </div>
              <p className="mt-2 text-2xl font-bold font-display text-surface-900 dark:text-white">
                {overview.pending_push_receipts}
              </p>
              {overview.failed_push_receipts > 0 ? (
                <p className="mt-1 text-xs text-rose-500">{overview.failed_push_receipts} con error final</p>
              ) : (
                <p className="mt-1 text-xs text-surface-400">confirmaciones en espera</p>
              )}
            </div>

            <div className="rounded-2xl border border-surface-200/50 bg-white p-4 dark:border-surface-800/50 dark:bg-surface-900">
              <div className="flex items-center gap-2">
                <AlertTriangle size={14} className="text-amber-500" />
                <span className="text-xs font-medium text-surface-500">Errores scheduler</span>
              </div>
              <p className="mt-2 text-2xl font-bold font-display text-surface-900 dark:text-white">
                {overview.scheduler_failures}
              </p>
              <p className="mt-1 text-xs text-surface-400">fallos en envío automático</p>
            </div>
          </>
        )}
      </div>

      {/* ── Lista de campañas ── */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="shimmer h-64 rounded-3xl" />
          ))
        ) : campaigns.length === 0 ? (
          <motion.div
            variants={fadeInUp}
            className="col-span-full flex flex-col items-center justify-center rounded-3xl border border-dashed border-surface-300 bg-white py-16 text-center dark:border-surface-700 dark:bg-surface-900"
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-500 dark:bg-brand-950/40">
              <Megaphone size={24} />
            </div>
            <h3 className="mt-4 text-base font-semibold text-surface-900 dark:text-white">Sin campañas todavía</h3>
            <p className="mt-1 max-w-sm text-sm text-surface-500">
              Crea tu primera campaña para guardar mensajes, audiencias y enviarlos cuando quieras.
            </p>
            <button
              type="button"
              className="btn-primary mt-6"
              onClick={() => {
                setForm(emptyForm);
                setShowModal(true);
              }}
            >
              <Plus size={16} />
              Nueva campaña
            </button>
          </motion.div>
        ) : (
          campaigns.map((campaign: Campaign) => (
            <motion.div
              key={campaign.id}
              variants={fadeInUp}
              className="rounded-3xl border border-surface-200/50 bg-white p-6 transition-all hover:-translate-y-1 hover:shadow-xl dark:border-surface-800/50 dark:bg-surface-900"
            >
              {/* Cabecera de tarjeta */}
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${channelColors(campaign.channel)}`}>
                    <ChannelIcon channel={campaign.channel} />
                  </div>
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold text-surface-900 dark:text-white">{campaign.name}</h2>
                    <p className="truncate text-sm text-surface-500">{campaign.subject || 'Sin asunto definido'}</p>
                  </div>
                </div>
                <span
                  className={`badge shrink-0 ${
                    campaign.status === 'sent'
                      ? 'badge-success'
                      : campaign.status === 'scheduled'
                        ? 'badge-info'
                        : campaign.status === 'sending'
                          ? 'badge-warning'
                          : campaign.status === 'cancelled'
                            ? 'badge-danger'
                            : 'badge-neutral'
                  }`}
                >
                  {formatCampaignStatus(campaign.status)}
                </span>
              </div>

              {/* Métricas */}
              <div className="mt-5 grid grid-cols-4 gap-2 text-center">
                <div className="rounded-2xl bg-surface-50 py-3 dark:bg-surface-950/60">
                  <p className="text-xs text-surface-400">Destinatarios</p>
                  <p className="mt-1 text-sm font-semibold text-surface-900 dark:text-white">{campaign.total_recipients}</p>
                </div>
                <div className="rounded-2xl bg-surface-50 py-3 dark:bg-surface-950/60">
                  <p className="text-xs text-surface-400">Enviados</p>
                  <p className="mt-1 text-sm font-semibold text-surface-900 dark:text-white">{campaign.total_sent}</p>
                </div>
                <div className="rounded-2xl bg-surface-50 py-3 dark:bg-surface-950/60">
                  <p className="text-xs text-surface-400">Apertura</p>
                  <p className="mt-1 text-sm font-semibold text-surface-900 dark:text-white">
                    {campaign.total_sent
                      ? `${calculateRate(campaign.total_opened, campaign.total_sent)}%`
                      : campaign.total_opened}
                  </p>
                </div>
                <div className="rounded-2xl bg-surface-50 py-3 dark:bg-surface-950/60">
                  <p className="text-xs text-surface-400">CTR</p>
                  <p className="mt-1 text-sm font-semibold text-surface-900 dark:text-white">
                    {campaign.total_sent
                      ? `${calculateRate(campaign.total_clicked, campaign.total_sent)}%`
                      : campaign.total_clicked}
                  </p>
                </div>
              </div>

              {/* Etiquetas e info adicional */}
              <div className="mt-4 space-y-2">
                <p className="line-clamp-2 text-sm leading-6 text-surface-500">
                  {campaign.content || 'Sin contenido guardado todavía.'}
                </p>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full bg-surface-100 px-3 py-1 text-xs text-surface-600 dark:bg-surface-800 dark:text-surface-400">
                    <UsersRound size={11} className="mr-1 inline-block" />
                    {buildSegmentSummary(campaign.segment_filter)}
                  </span>
                  <span className="rounded-full bg-surface-100 px-3 py-1 text-xs text-surface-600 dark:bg-surface-800 dark:text-surface-400">
                    {campaign.send_push ? 'Push activo' : 'Solo bandeja'}
                  </span>
                  {campaign.scheduled_at ? (
                    <span className="rounded-full bg-sky-50 px-3 py-1 text-xs text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
                      <Clock3 size={11} className="mr-1 inline-block" />
                      {formatDateTime(campaign.scheduled_at)}
                    </span>
                  ) : null}
                  {campaign.dispatch_attempts > 0 ? (
                    <span className="rounded-full bg-surface-100 px-3 py-1 text-xs text-surface-600 dark:bg-surface-800 dark:text-surface-400">
                      {campaign.dispatch_attempts} intento(s)
                    </span>
                  ) : null}
                </div>
              </div>

              {/* Estado último dispatch */}
              {campaign.last_dispatch_error ? (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium">
                        Error en {formatDispatchTrigger(campaign.last_dispatch_trigger)}
                        {campaign.last_dispatch_attempted_at
                          ? ` — ${formatDateTime(campaign.last_dispatch_attempted_at)}`
                          : ''}
                      </p>
                      <p className="mt-1 leading-5">{campaign.last_dispatch_error}</p>
                    </div>
                  </div>
                </div>
              ) : campaign.last_dispatch_finished_at ? (
                <div className="mt-4 flex items-center gap-2 rounded-2xl border border-emerald-200/60 bg-emerald-50/50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300">
                  <CheckCircle2 size={14} className="shrink-0" />
                  <span>
                    Último envío por {formatDispatchTrigger(campaign.last_dispatch_trigger)} completado
                    el {formatDateTime(campaign.last_dispatch_finished_at)}.
                  </span>
                </div>
              ) : null}

              {/* Acciones */}
              <div className="mt-5 flex flex-wrap gap-2">
                <Tooltip content="Editar esta campaña">
                  <button
                    type="button"
                    onClick={() => {
                      setForm(toForm(campaign));
                      setShowModal(true);
                    }}
                    className="btn-secondary"
                  >
                    Editar
                  </button>
                </Tooltip>
                <Tooltip content="Enviar esta campaña ahora">
                  <button type="button" onClick={() => openBroadcastModal(campaign)} className="btn-primary">
                    <Send size={15} />
                    Enviar ahora
                  </button>
                </Tooltip>
              </div>
            </motion.div>
          ))
        )}
      </div>

      {/* ── Modal: Nueva / Editar campaña ── */}
      <Modal
        open={showModal}
        title={form.id ? 'Editar campaña' : 'Nueva campaña'}
        description="Guarda el mensaje, el grupo de clientes y la fecha para enviarlo ahora o más adelante."
        onClose={() => {
          if (!saveMutation.isPending) setShowModal(false);
        }}
      >
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            saveMutation.mutate();
          }}
        >
          {/* Nombre + canal */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">
                Nombre <span className="text-rose-500">*</span>
              </label>
              <input
                className="input"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Ej. Promo de verano"
                required
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Canal</label>
              <select
                className="input"
                value={form.channel}
                onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value as Campaign['channel'] }))}
              >
                <option value="email">Email</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="sms">SMS</option>
              </select>
            </div>
          </div>

          {/* Asunto + estado */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">
                Asunto / Título del aviso
              </label>
              <input
                className="input"
                value={form.subject}
                onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                placeholder="Lo que verá el cliente primero"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Estado</label>
              <select
                className="input"
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as Campaign['status'] }))}
              >
                <option value="draft">Borrador</option>
                <option value="scheduled">Programada</option>
                <option value="cancelled">Cancelada</option>
                {form.status === 'sending' && (
                  <option value="sending" disabled>Enviando (sistema)</option>
                )}
                {form.status === 'sent' && (
                  <option value="sent" disabled>Enviada (sistema)</option>
                )}
              </select>
              <p className="mt-1 text-xs text-surface-400">
                "Enviando" y "Enviada" los gestiona el sistema automáticamente.
              </p>
            </div>
          </div>

          {/* Contenido */}
          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">
              Contenido del mensaje
            </label>
            <textarea
              className="input min-h-28 resize-y"
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              placeholder="Texto que se guardará en la bandeja del cliente y se enviará como aviso."
            />
          </div>

          {/* Configuración del aviso */}
          <div className="rounded-3xl border border-surface-200/60 bg-surface-50 p-5 dark:border-surface-800/60 dark:bg-surface-950/60">
            <h3 className="text-sm font-semibold text-surface-900 dark:text-white">Configuración del aviso</h3>
            <p className="mt-0.5 text-xs text-surface-500">
              Estos datos se usan cuando se envía la campaña, manual o automáticamente.
            </p>

            <div className="mt-4 grid gap-4 sm:grid-cols-[180px_1fr]">
              <div>
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Tipo</label>
                <select
                  className="input"
                  value={form.notification_type}
                  onChange={(e) => setForm((f) => ({ ...f, notification_type: e.target.value as AppNotification['type'] }))}
                >
                  <option value="info">Informativo</option>
                  <option value="success">Confirmación</option>
                  <option value="warning">Importante</option>
                  <option value="error">Urgente</option>
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">
                  Abrir al tocar el aviso (opcional)
                </label>
                <input
                  className="input"
                  value={form.action_url}
                  onChange={(e) => setForm((f) => ({ ...f, action_url: e.target.value }))}
                  placeholder="Déjalo vacío si la campaña solo debe informar"
                />
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {actionUrlPresets.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, action_url: preset.value }))}
                  className={cn(
                    'rounded-xl px-3 py-1.5 text-sm transition-colors',
                    form.action_url === preset.value
                      ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300'
                      : 'bg-white text-surface-600 hover:bg-surface-100 dark:bg-surface-900 dark:text-surface-300 dark:hover:bg-surface-800',
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <label className="mt-4 flex cursor-pointer items-center gap-3 rounded-2xl border border-surface-200 bg-white px-4 py-3 dark:border-surface-800 dark:bg-surface-900">
              <input
                type="checkbox"
                checked={form.send_push}
                onChange={(e) => setForm((f) => ({ ...f, send_push: e.target.checked }))}
              />
              <span className="text-sm text-surface-700 dark:text-surface-300">
                Enviar también al dispositivo del cliente (push remoto)
              </span>
            </label>
          </div>

          {/* Audiencia guardada */}
          <div className="rounded-3xl border border-surface-200/60 bg-surface-50 p-5 dark:border-surface-800/60 dark:bg-surface-950/60">
            <h3 className="text-sm font-semibold text-surface-900 dark:text-white">Audiencia guardada</h3>
            <p className="mt-0.5 text-xs text-surface-500">
              Define un grupo base para no tener que seleccionar clientes cada vez que envíes.
            </p>

            <div className="mt-4 grid gap-4 sm:grid-cols-[180px_1fr]">
              <div>
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">
                  Estado de clientes
                </label>
                <select
                  className="input"
                  value={form.audience_status}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, audience_status: e.target.value as CampaignForm['audience_status'] }))
                  }
                >
                  <option value="active">Activos</option>
                  <option value="all">Todos</option>
                  <option value="inactive">Inactivos</option>
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">
                  Filtro de búsqueda base
                </label>
                <input
                  className="input"
                  value={form.audience_search}
                  onChange={(e) => setForm((f) => ({ ...f, audience_search: e.target.value }))}
                  placeholder="Nombre, correo o teléfono (opcional)"
                />
              </div>
            </div>
          </div>

          {/* Programar envío */}
          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">
              <Clock3 size={14} className="mr-1.5 inline-block text-sky-500" />
              Programar para (opcional)
            </label>
            <input
              type="datetime-local"
              className="input"
              value={form.scheduled_at}
              onChange={(e) => setForm((f) => ({ ...f, scheduled_at: e.target.value }))}
            />
            <p className="mt-1 text-xs text-surface-400">
              Si eliges una fecha, la campaña se enviará automáticamente en ese momento.
            </p>
          </div>

          {/* Seguimiento — solo al editar */}
          {editingCampaign ? (
            <div className="rounded-3xl border border-surface-200/60 bg-surface-50 p-5 dark:border-surface-800/60 dark:bg-surface-950/60">
              <h3 className="text-sm font-semibold text-surface-900 dark:text-white">Seguimiento</h3>
              <p className="mt-0.5 text-xs text-surface-500">Historial del último intento de envío de esta campaña.</p>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl bg-white px-4 py-3 dark:bg-surface-900">
                  <p className="text-xs uppercase tracking-wide text-surface-400">Origen</p>
                  <p className="mt-1.5 text-sm font-semibold capitalize text-surface-900 dark:text-white">
                    {formatDispatchTrigger(editingCampaign.last_dispatch_trigger)}
                  </p>
                </div>
                <div className="rounded-2xl bg-white px-4 py-3 dark:bg-surface-900">
                  <p className="text-xs uppercase tracking-wide text-surface-400">Intentos</p>
                  <p className="mt-1.5 text-sm font-semibold text-surface-900 dark:text-white">
                    {editingCampaign.dispatch_attempts}
                  </p>
                </div>
                <div className="rounded-2xl bg-white px-4 py-3 dark:bg-surface-900">
                  <p className="text-xs uppercase tracking-wide text-surface-400">Destinatarios</p>
                  <p className="mt-1.5 text-sm font-semibold text-surface-900 dark:text-white">
                    {editingCampaign.total_recipients}
                  </p>
                </div>
                <div className="rounded-2xl bg-white px-4 py-3 dark:bg-surface-900">
                  <p className="text-xs uppercase tracking-wide text-surface-400">Abiertos / CTR</p>
                  <p className="mt-1.5 text-sm font-semibold text-surface-900 dark:text-white">
                    {editingCampaign.total_opened} / {calculateRate(editingCampaign.total_clicked, editingCampaign.total_sent)}%
                  </p>
                </div>
                <div className="rounded-2xl bg-white px-4 py-3 dark:bg-surface-900">
                  <p className="text-xs uppercase tracking-wide text-surface-400">Último inicio</p>
                  <p className="mt-1.5 text-sm font-semibold text-surface-900 dark:text-white">
                    {editingCampaign.last_dispatch_attempted_at
                      ? formatDateTime(editingCampaign.last_dispatch_attempted_at)
                      : '—'}
                  </p>
                </div>
                <div className="rounded-2xl bg-white px-4 py-3 dark:bg-surface-900">
                  <p className="text-xs uppercase tracking-wide text-surface-400">Último fin</p>
                  <p className="mt-1.5 text-sm font-semibold text-surface-900 dark:text-white">
                    {editingCampaign.last_dispatch_finished_at
                      ? formatDateTime(editingCampaign.last_dispatch_finished_at)
                      : '—'}
                  </p>
                </div>
              </div>

              {editingCampaign.last_dispatch_error ? (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
                  <p className="font-semibold">Último error</p>
                  <p className="mt-1 leading-5">{editingCampaign.last_dispatch_error}</p>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Guardando…' : form.id ? 'Guardar cambios' : 'Crear campaña'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── Modal: Envío rápido ── */}
      <Modal
        open={showBroadcastModal}
        size="lg"
        title="Envío rápido"
        description="Selecciona clientes y envía el mismo aviso de una sola vez."
        onClose={() => {
          if (!broadcastMutation.isPending) setShowBroadcastModal(false);
        }}
      >
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            broadcastMutation.mutate();
          }}
        >
          {/* Contexto de campaña */}
          <div
            className={cn(
              'rounded-2xl border px-4 py-3',
              broadcastForm.campaign_id
                ? 'border-brand-200 bg-brand-50 dark:border-brand-800/50 dark:bg-brand-950/20'
                : 'border-surface-200 bg-surface-50 dark:border-surface-800 dark:bg-surface-950/60',
            )}
          >
            <div className="flex items-center gap-2">
              {broadcastForm.campaign_id ? (
                <Megaphone size={14} className="shrink-0 text-brand-500" />
              ) : (
                <Zap size={14} className="shrink-0 text-surface-400" />
              )}
              <p className="text-sm font-semibold text-surface-900 dark:text-white">{broadcastForm.campaign_name}</p>
            </div>
            <p className="mt-0.5 text-xs text-surface-500">
              {broadcastForm.campaign_id
                ? 'Los resultados de este envío se sumarán a la campaña vinculada.'
                : 'Este envío es independiente y no se vincula a ninguna campaña guardada.'}
            </p>
          </div>

          {/* Título + tipo */}
          <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">
                Título del aviso <span className="text-rose-500">*</span>
              </label>
              <input
                className="input"
                value={broadcastForm.title}
                onChange={(e) => setBroadcastForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Lo que verá el cliente"
                required
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Tipo</label>
              <select
                className="input"
                value={broadcastForm.type}
                onChange={(e) =>
                  setBroadcastForm((f) => ({ ...f, type: e.target.value as AppNotification['type'] }))
                }
              >
                <option value="info">Informativo</option>
                <option value="success">Confirmación</option>
                <option value="warning">Importante</option>
                <option value="error">Urgente</option>
              </select>
            </div>
          </div>

          {/* Mensaje */}
          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">
              Mensaje (opcional)
            </label>
            <textarea
              className="input min-h-24 resize-y"
              value={broadcastForm.message}
              onChange={(e) => setBroadcastForm((f) => ({ ...f, message: e.target.value }))}
              placeholder="Detalle de la oferta, recordatorio o anuncio."
            />
          </div>

          {/* Destino */}
          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">
              Abrir al tocar el aviso (opcional)
            </label>
            <input
              className="input"
              value={broadcastForm.action_url}
              onChange={(e) => setBroadcastForm((f) => ({ ...f, action_url: e.target.value }))}
              placeholder="Déjalo vacío si el aviso solo debe informar"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {actionUrlPresets.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => setBroadcastForm((f) => ({ ...f, action_url: preset.value }))}
                  className={cn(
                    'rounded-xl px-3 py-1.5 text-sm transition-colors',
                    broadcastForm.action_url === preset.value
                      ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300'
                      : 'bg-surface-100 text-surface-600 hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-300 dark:hover:bg-surface-700',
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Push toggle */}
          <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-surface-200 px-4 py-3 dark:border-surface-800">
            <input
              type="checkbox"
              checked={broadcastForm.send_push}
              onChange={(e) => setBroadcastForm((f) => ({ ...f, send_push: e.target.checked }))}
            />
            <span className="text-sm text-surface-700 dark:text-surface-300">
              Enviar también al dispositivo de cada cliente (push remoto)
            </span>
          </label>

          {/* Audiencia */}
          <div className="rounded-3xl border border-surface-200/60 bg-surface-50 p-5 dark:border-surface-800/60 dark:bg-surface-950/60">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-surface-900 dark:text-white">Destinatarios</h3>
                  {broadcastForm.user_ids.length > 0 && (
                    <span className="rounded-full bg-brand-500 px-2 py-0.5 text-xs font-bold text-white">
                      {broadcastForm.user_ids.length}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-surface-500">
                  {broadcastForm.segment_filter
                    ? `Segmento guardado: ${buildSegmentSummary(broadcastForm.segment_filter)}.`
                    : 'Selecciona clientes manualmente para este envío.'}
                </p>
              </div>
              {broadcastForm.segment_filter ? (
                <Tooltip content={`Seleccionar los ${segmentMatchedClients.length} clientes del segmento guardado`}>
                  <button type="button" className="btn-secondary shrink-0" onClick={applySavedSegment}>
                    <UsersRound size={14} />
                    Usar segmento ({segmentMatchedClients.length})
                  </button>
                </Tooltip>
              ) : null}
            </div>

            {/* Barra de progreso */}
            {clientItems.length > 0 && (
              <div className="mt-3">
                <div className="flex items-center justify-between text-xs text-surface-400">
                  <span>
                    {broadcastForm.user_ids.length} de {clientItems.length} seleccionados
                  </span>
                  <span>máx. 100 clientes cargados</span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-200 dark:bg-surface-700">
                  <div
                    className="h-full rounded-full bg-brand-500 transition-all duration-300"
                    style={{
                      width: `${clientItems.length ? (broadcastForm.user_ids.length / clientItems.length) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {/* Búsqueda + acciones */}
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-surface-400" />
                <input
                  className="input pl-10"
                  value={recipientSearch}
                  onChange={(e) => setRecipientSearch(e.target.value)}
                  placeholder="Buscar por nombre o email…"
                />
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary" onClick={selectAllFilteredRecipients}>
                  Seleccionar todos
                </button>
                {broadcastForm.user_ids.length > 0 && (
                  <button type="button" className="btn-secondary" onClick={clearRecipients}>
                    Limpiar
                  </button>
                )}
              </div>
            </div>

            {/* Lista de clientes */}
            <div className="mt-4 max-h-64 space-y-2 overflow-y-auto pr-1">
              {isLoadingClients
                ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="shimmer h-16 rounded-2xl" />)
                : null}

              {isClientsError ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-600 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
                  No pudimos cargar los clientes. Intenta cerrar y abrir el modal de nuevo.
                </div>
              ) : null}

              {!isLoadingClients && !isClientsError && filteredClients.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-surface-300 px-4 py-6 text-center text-sm text-surface-500 dark:border-surface-700">
                  No hay clientes que coincidan con la búsqueda.
                </div>
              ) : null}

              {!isLoadingClients && !isClientsError
                ? filteredClients.map((client: User) => {
                    const selected = broadcastForm.user_ids.includes(client.id);
                    const matchesSegment = broadcastForm.segment_filter
                      ? matchesCampaignSegment(client, normalizeSegmentFilter(broadcastForm.segment_filter))
                      : false;
                    return (
                      <button
                        key={client.id}
                        type="button"
                        onClick={() => toggleRecipient(client.id)}
                        className={cn(
                          'flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition-colors',
                          selected
                            ? 'border-brand-300 bg-brand-50 dark:border-brand-700 dark:bg-brand-950/30'
                            : 'border-surface-200 bg-white hover:border-surface-300 dark:border-surface-800 dark:bg-surface-900 dark:hover:border-surface-700',
                        )}
                      >
                        <div>
                          <p className="text-sm font-medium text-surface-900 dark:text-white">
                            {client.first_name} {client.last_name}
                          </p>
                          <p className="mt-0.5 text-xs text-surface-500">{client.email}</p>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            <span
                              className={cn(
                                'rounded-full px-2 py-0.5 text-xs',
                                client.is_active
                                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                                  : 'bg-surface-100 text-surface-500 dark:bg-surface-800',
                              )}
                            >
                              {client.is_active ? 'Activo' : 'Inactivo'}
                            </span>
                            {matchesSegment ? (
                              <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">
                                En segmento
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <span className={cn('badge ml-3 shrink-0', selected ? 'badge-success' : 'badge-neutral')}>
                          {selected ? 'Incluido' : 'Disponible'}
                        </span>
                      </button>
                    );
                  })
                : null}
            </div>
          </div>

          {/* Resultado del último envío */}
          {lastBroadcastResult ? (
            <div className="space-y-4 rounded-3xl border border-emerald-200/60 bg-emerald-50/40 p-5 dark:border-emerald-900/40 dark:bg-emerald-950/10">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={17} className="text-emerald-500" />
                    <h3 className="text-sm font-semibold text-surface-900 dark:text-white">Envío completado</h3>
                  </div>
                  <p className="mt-1 text-xs text-surface-500">
                    {lastBroadcastResult.total_notifications} notificación(es) para{' '}
                    {lastBroadcastResult.total_recipients} cliente(s).
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'badge shrink-0',
                      lastBroadcastResult.errored_push_deliveries ? 'badge-warning' : 'badge-success',
                    )}
                  >
                    {lastBroadcastResult.accepted_push_deliveries}/{lastBroadcastResult.total_push_deliveries} push
                    correctas
                  </span>
                  <button type="button" className="btn-secondary shrink-0" onClick={resetBroadcastForNew}>
                    Nuevo envío
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-2xl bg-white px-4 py-3 dark:bg-surface-900">
                  <p className="text-xs text-surface-500">Clientes</p>
                  <p className="mt-1 text-xl font-bold font-display text-surface-900 dark:text-white">
                    {lastBroadcastResult.total_recipients}
                  </p>
                </div>
                <div className="rounded-2xl bg-white px-4 py-3 dark:bg-surface-900">
                  <p className="text-xs text-surface-500">Notificaciones</p>
                  <p className="mt-1 text-xl font-bold font-display text-surface-900 dark:text-white">
                    {lastBroadcastResult.total_notifications}
                  </p>
                </div>
                <div className="rounded-2xl bg-white px-4 py-3 dark:bg-surface-900">
                  <p className="text-xs text-surface-500">Push correctas</p>
                  <p className="mt-1 text-xl font-bold font-display text-emerald-600 dark:text-emerald-400">
                    {lastBroadcastResult.accepted_push_deliveries}
                  </p>
                </div>
                <div className="rounded-2xl bg-white px-4 py-3 dark:bg-surface-900">
                  <p className="text-xs text-surface-500">Con problemas</p>
                  <p
                    className={cn(
                      'mt-1 text-xl font-bold font-display',
                      lastBroadcastResult.errored_push_deliveries
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-surface-900 dark:text-white',
                    )}
                  >
                    {lastBroadcastResult.errored_push_deliveries}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                {lastBroadcastResult.recipients.map((recipient) => (
                  <div
                    key={recipient.user_id}
                    className="rounded-2xl border border-surface-200/60 bg-white px-4 py-3 dark:border-surface-800/60 dark:bg-surface-900"
                  >
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-medium text-surface-900 dark:text-white">
                          {recipient.user_name || 'Cliente sin nombre'}
                        </p>
                        <p className="text-xs text-surface-500">
                          {recipient.notification.title} · {formatDateTime(recipient.notification.created_at)}
                        </p>
                      </div>
                      <span
                        className={cn(
                          'badge shrink-0',
                          recipient.push_deliveries.some((d) => d.status !== 'ok')
                            ? 'badge-warning'
                            : recipient.push_deliveries.length
                              ? 'badge-success'
                              : 'badge-neutral',
                        )}
                      >
                        {recipient.push_deliveries.length
                          ? `${recipient.push_deliveries.filter((d) => d.status === 'ok').length}/${recipient.push_deliveries.length} push`
                          : lastBroadcastUsedPush
                            ? 'Sin dispositivo'
                            : 'Solo bandeja'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setShowBroadcastModal(false)}>
              Cerrar
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={broadcastMutation.isPending || !broadcastForm.title.trim() || broadcastForm.user_ids.length === 0}
            >
              {broadcastMutation.isPending
                ? 'Enviando…'
                : broadcastForm.user_ids.length === 0
                  ? 'Selecciona destinatarios'
                  : broadcastForm.send_push
                    ? `Enviar a ${broadcastForm.user_ids.length} cliente(s)`
                    : `Guardar para ${broadcastForm.user_ids.length} cliente(s)`}
            </button>
          </div>
        </form>
      </Modal>
    </motion.div>
  );
}
