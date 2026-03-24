import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { AlertTriangle, Bell, Clock3, Eye, Megaphone, MessageCircle, MousePointerClick, Plus, Search, Send, UsersRound } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { campaignsApi, clientsApi, notificationsApi } from '@/services/api';
import { fadeInUp, staggerContainer } from '@/utils/animations';
import { cn, formatDateTime, toDateInputValue } from '@/utils';
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
  { label: 'Store', value: 'nexofitness://store' },
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
  action_url: 'nexofitness://store',
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
  if (trigger === 'scheduled') return 'scheduler';
  if (trigger === 'manual') return 'manual';
  return 'sin trigger';
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
    action_url: campaign.action_url ?? 'nexofitness://store',
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
    campaign_name: campaign?.name ?? 'Broadcast libre',
    title: campaign?.subject?.trim() || campaign?.name || 'Nueva campana',
    message: campaign?.content ?? '',
    type: campaign?.notification_type ?? 'info',
    action_url: campaign?.action_url ?? 'nexofitness://store',
    send_push: campaign?.send_push ?? true,
    user_ids: [],
    segment_filter: campaign?.segment_filter ? normalizeSegmentFilter(campaign.segment_filter) : undefined,
  };
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

  const { data: overviewData } = useQuery<CampaignOverview>({
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
        total_recipients: Number(form.total_recipients),
        total_sent: Number(form.total_sent),
        total_opened: Number(form.total_opened),
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

      const response = await campaignsApi.create(payload);
      return response.data;
    },
    onSuccess: () => {
      toast.success(form.id ? 'Campana actualizada' : 'Campana creada');
      setShowModal(false);
      setForm(emptyForm);
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['campaigns-overview'] });
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.detail || 'No se pudo guardar la campana');
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
    onSuccess: (result) => {
      setLastBroadcastResult(result);
      setLastBroadcastUsedPush(broadcastForm.send_push);
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['campaigns-overview'] });

      if (!broadcastForm.send_push) {
        toast.success(`Broadcast creado para ${result.total_recipients} cliente(s) sin envio push.`);
        return;
      }
      if (!result.total_push_deliveries) {
        toast.success(`Broadcast creado para ${result.total_recipients} cliente(s). Ninguno tenia push activo.`);
        return;
      }
      toast.success(`Broadcast enviado. ${result.accepted_push_deliveries}/${result.total_push_deliveries} delivery(s) aceptadas por Expo.`);
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.detail || 'No se pudo enviar el broadcast');
    },
  });

  const campaigns = data?.items ?? [];
  const overview = overviewData ?? emptyOverview;
  const clientItems = clientsData?.items ?? [];
  const editingCampaign = useMemo(
    () => (form.id ? campaigns.find((campaign) => campaign.id === form.id) : undefined),
    [campaigns, form.id],
  );

  const filteredClients = useMemo(() => {
    const normalizedSearch = recipientSearch.trim().toLowerCase();
    if (!normalizedSearch) return clientItems;
    return clientItems.filter((client) =>
      `${client.first_name} ${client.last_name} ${client.email}`.toLowerCase().includes(normalizedSearch),
    );
  }, [clientItems, recipientSearch]);

  const segmentMatchedClients = useMemo(() => {
    if (!broadcastForm.segment_filter) return [];
    return clientItems.filter((client) => matchesCampaignSegment(client, normalizeSegmentFilter(broadcastForm.segment_filter)));
  }, [clientItems, broadcastForm.segment_filter]);

  useEffect(() => {
    if (!showBroadcastModal || hasAppliedInitialSegmentSelection || !clientItems.length) return;
    if (!broadcastForm.segment_filter) {
      setHasAppliedInitialSegmentSelection(true);
      return;
    }

    setBroadcastForm((current) => ({
      ...current,
      user_ids: segmentMatchedClients.map((client) => client.id),
    }));
    setHasAppliedInitialSegmentSelection(true);
  }, [showBroadcastModal, hasAppliedInitialSegmentSelection, clientItems.length, broadcastForm.segment_filter, segmentMatchedClients]);

  const stats = {
    active: overview.scheduled_pending + overview.sending_now,
    sent: overview.sent_total,
    clicked: overview.clicked_total,
    openRate: overview.open_rate,
    clickRate: overview.click_rate,
  };

  const toggleRecipient = (userId: string) => {
    setBroadcastForm((current) => ({
      ...current,
      user_ids: current.user_ids.includes(userId)
        ? current.user_ids.filter((currentUserId) => currentUserId !== userId)
        : [...current.user_ids, userId],
    }));
  };

  const selectAllFilteredRecipients = () => {
    setBroadcastForm((current) => ({
      ...current,
      user_ids: Array.from(new Set([...current.user_ids, ...filteredClients.map((client) => client.id)])),
    }));
  };

  const clearRecipients = () => {
    setBroadcastForm((current) => ({ ...current, user_ids: [] }));
  };

  const applySavedSegment = () => {
    setBroadcastForm((current) => ({
      ...current,
      user_ids: segmentMatchedClients.map((client) => client.id),
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

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-6">
      <motion.div variants={fadeInUp} className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Marketing</h1>
          <p className="mt-1 text-sm text-surface-500">Campanas persistentes por tenant, con segmentos reutilizables, broadcast real y engagement medido por aperturas/clicks desde mobile</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => openBroadcastModal()} className="btn-secondary">
            <Bell size={16} />
            Composer push
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
            Nueva campana
          </button>
        </div>
      </motion.div>

      {isError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-600 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
          No pudimos cargar las campanas del tenant.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
          <div className="flex items-center gap-3"><Megaphone size={18} className="text-brand-500" /><span className="text-sm text-surface-500">Activas</span></div>
          <p className="mt-3 text-3xl font-bold font-display text-surface-900 dark:text-white">{stats.active}</p>
        </div>
        <div className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
          <div className="flex items-center gap-3"><Send size={18} className="text-emerald-500" /><span className="text-sm text-surface-500">Enviados</span></div>
          <p className="mt-3 text-3xl font-bold font-display text-surface-900 dark:text-white">{stats.sent}</p>
        </div>
        <div className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
          <div className="flex items-center gap-3"><Eye size={18} className="text-violet-500" /><span className="text-sm text-surface-500">Apertura</span></div>
          <p className="mt-3 text-3xl font-bold font-display text-surface-900 dark:text-white">{stats.openRate}%</p>
        </div>
        <div className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
          <div className="flex items-center gap-3"><MousePointerClick size={18} className="text-amber-500" /><span className="text-sm text-surface-500">CTR</span></div>
          <p className="mt-3 text-3xl font-bold font-display text-surface-900 dark:text-white">{stats.clickRate}%</p>
          <p className="mt-1 text-xs text-surface-500">{stats.clicked} click(s) registrados</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
          <div className="flex items-center gap-3"><Clock3 size={18} className="text-sky-500" /><span className="text-sm text-surface-500">Pendientes</span></div>
          <p className="mt-3 text-3xl font-bold font-display text-surface-900 dark:text-white">{overview.scheduled_pending}</p>
          <p className="mt-1 text-xs text-surface-500">{overview.total_campaigns} campana(s) persistidas</p>
        </div>
        <div className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
          <div className="flex items-center gap-3"><Send size={18} className="text-emerald-500" /><span className="text-sm text-surface-500">Scheduler OK</span></div>
          <p className="mt-3 text-3xl font-bold font-display text-surface-900 dark:text-white">{overview.scheduler_runs}</p>
          <p className="mt-1 text-xs text-surface-500">{overview.manual_runs} corrida(s) manuales exitosas</p>
        </div>
        <div className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
          <div className="flex items-center gap-3"><AlertTriangle size={18} className="text-amber-500" /><span className="text-sm text-surface-500">Scheduler error</span></div>
          <p className="mt-3 text-3xl font-bold font-display text-surface-900 dark:text-white">{overview.scheduler_failures}</p>
          <p className="mt-1 text-xs text-surface-500">{overview.sending_now} campana(s) en envio ahora</p>
        </div>
        <div className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
          <div className="flex items-center gap-3"><Bell size={18} className="text-brand-500" /><span className="text-sm text-surface-500">Receipts push</span></div>
          <p className="mt-3 text-3xl font-bold font-display text-surface-900 dark:text-white">{overview.pending_push_receipts}</p>
          <p className="mt-1 text-xs text-surface-500">{overview.failed_push_receipts} con receipt final en error</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, index) => <div key={index} className="shimmer h-64 rounded-3xl" />)
        ) : campaigns.map((campaign) => (
          <motion.div
            key={campaign.id}
            variants={fadeInUp}
            className="rounded-3xl border border-surface-200/50 bg-white p-6 transition-all hover:-translate-y-1 hover:shadow-xl dark:border-surface-800/50 dark:bg-surface-900"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${campaign.channel === 'email' ? 'bg-brand-50 text-brand-500 dark:bg-brand-950/40' : 'bg-emerald-50 text-emerald-500 dark:bg-emerald-950/40'}`}>
                    {campaign.channel === 'email' ? <Send size={18} /> : <MessageCircle size={18} />}
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-surface-900 dark:text-white">{campaign.name}</h2>
                    <p className="text-sm text-surface-500">{campaign.subject || 'Sin asunto definido'}</p>
                  </div>
                </div>
              </div>
              <span className={`badge ${campaign.status === 'sent' ? 'badge-success' : campaign.status === 'scheduled' ? 'badge-info' : campaign.status === 'sending' ? 'badge-warning' : campaign.status === 'cancelled' ? 'badge-danger' : 'badge-neutral'}`}>
                {campaign.status}
              </span>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div className="rounded-2xl bg-surface-50 px-4 py-4 dark:bg-surface-950/60">
                <p className="text-surface-500">Destinatarios</p>
                <p className="mt-2 font-semibold text-surface-900 dark:text-white">{campaign.total_recipients}</p>
              </div>
              <div className="rounded-2xl bg-surface-50 px-4 py-4 dark:bg-surface-950/60">
                <p className="text-surface-500">Enviados</p>
                <p className="mt-2 font-semibold text-surface-900 dark:text-white">{campaign.total_sent}</p>
              </div>
              <div className="rounded-2xl bg-surface-50 px-4 py-4 dark:bg-surface-950/60">
                <p className="text-surface-500">Abiertos</p>
                <p className="mt-2 font-semibold text-surface-900 dark:text-white">{campaign.total_opened}</p>
              </div>
              <div className="rounded-2xl bg-surface-50 px-4 py-4 dark:bg-surface-950/60">
                <p className="text-surface-500">Clicks</p>
                <p className="mt-2 font-semibold text-surface-900 dark:text-white">{campaign.total_clicked}</p>
              </div>
            </div>

            <div className="mt-4 space-y-2 text-sm text-surface-500">
              <p className="line-clamp-3 leading-6">{campaign.content || 'Sin contenido guardado todavia.'}</p>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full bg-surface-100 px-3 py-1 text-xs dark:bg-surface-800">
                  <UsersRound size={12} className="mr-1 inline-block" />
                  {buildSegmentSummary(campaign.segment_filter)}
                </span>
                <span className="rounded-full bg-surface-100 px-3 py-1 text-xs dark:bg-surface-800">
                  {campaign.send_push ? 'Push remoto activo' : 'Solo bandeja'}
                </span>
                {campaign.scheduled_at ? (
                  <span className="rounded-full bg-surface-100 px-3 py-1 text-xs dark:bg-surface-800">
                    <Clock3 size={12} className="mr-1 inline-block" />
                    {formatDateTime(campaign.scheduled_at)}
                  </span>
                ) : null}
                {campaign.dispatch_attempts ? (
                  <span className="rounded-full bg-surface-100 px-3 py-1 text-xs dark:bg-surface-800">
                    Intentos: {campaign.dispatch_attempts}
                  </span>
                ) : null}
                {campaign.total_sent ? (
                  <span className="rounded-full bg-surface-100 px-3 py-1 text-xs dark:bg-surface-800">
                    Open rate: {calculateRate(campaign.total_opened, campaign.total_sent)}%
                  </span>
                ) : null}
                {campaign.total_sent ? (
                  <span className="rounded-full bg-surface-100 px-3 py-1 text-xs dark:bg-surface-800">
                    CTR: {calculateRate(campaign.total_clicked, campaign.total_sent)}%
                  </span>
                ) : null}
              </div>
            </div>

            {campaign.last_dispatch_error ? (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
                <div className="flex items-start gap-3">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold">
                      Ultimo intento por {formatDispatchTrigger(campaign.last_dispatch_trigger)}
                      {campaign.last_dispatch_attempted_at ? ` el ${formatDateTime(campaign.last_dispatch_attempted_at)}` : ''}
                    </p>
                    <p className="mt-1 leading-6">{campaign.last_dispatch_error}</p>
                  </div>
                </div>
              </div>
            ) : campaign.last_dispatch_finished_at ? (
              <div className="mt-4 rounded-2xl border border-surface-200/70 bg-surface-50 px-4 py-4 text-sm text-surface-600 dark:border-surface-800/70 dark:bg-surface-950/60 dark:text-surface-300">
                Ultima ejecucion por {formatDispatchTrigger(campaign.last_dispatch_trigger)} finalizada el {formatDateTime(campaign.last_dispatch_finished_at)}.
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap gap-2">
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
              <button type="button" onClick={() => openBroadcastModal(campaign)} className="btn-primary">
                <Bell size={16} />
                Enviar
              </button>
            </div>
          </motion.div>
        ))}
      </div>

      <Modal
        open={showModal}
        title={form.id ? 'Editar campana' : 'Nueva campana'}
        description="La campana ahora guarda audiencia, payload y fecha de envio para que el scheduler pueda ejecutarla sin volver al composer."
        onClose={() => {
          if (!saveMutation.isPending) {
            setShowModal(false);
          }
        }}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            saveMutation.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Nombre</label>
              <input className="input" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Canal</label>
              <select className="input" value={form.channel} onChange={(event) => setForm((current) => ({ ...current, channel: event.target.value as Campaign['channel'] }))}>
                <option value="email">Email</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="sms">SMS</option>
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Asunto</label>
              <input className="input" value={form.subject} onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))} />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Estado</label>
              <select className="input" value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as Campaign['status'] }))}>
                <option value="draft">draft</option>
                <option value="scheduled">scheduled</option>
                <option value="sending">sending</option>
                <option value="sent">sent</option>
                <option value="cancelled">cancelled</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Contenido</label>
            <textarea className="input min-h-32 resize-y" value={form.content} onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))} />
          </div>

          <div className="rounded-3xl border border-surface-200/60 bg-surface-50 p-5 dark:border-surface-800/60 dark:bg-surface-950/60">
            <h3 className="text-base font-semibold text-surface-900 dark:text-white">Payload reutilizable</h3>
            <p className="mt-1 text-sm text-surface-500">Estos datos se usarán tanto al abrir el composer como cuando la campaña se ejecute automáticamente por `scheduled_at`.</p>

            <div className="mt-4 grid gap-4 sm:grid-cols-[220px_1fr]">
              <div>
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Tipo</label>
                <select className="input" value={form.notification_type} onChange={(event) => setForm((current) => ({ ...current, notification_type: event.target.value as AppNotification['type'] }))}>
                  <option value="info">info</option>
                  <option value="success">success</option>
                  <option value="warning">warning</option>
                  <option value="error">error</option>
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Action URL</label>
                <input
                  className="input"
                  value={form.action_url}
                  onChange={(event) => setForm((current) => ({ ...current, action_url: event.target.value }))}
                  placeholder="nexofitness://store"
                />
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {actionUrlPresets.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => setForm((current) => ({ ...current, action_url: preset.value }))}
                  className={cn('rounded-xl px-3 py-2 text-sm transition-colors', form.action_url === preset.value ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300' : 'bg-white text-surface-600 hover:bg-surface-100 dark:bg-surface-900 dark:text-surface-300 dark:hover:bg-surface-800')}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <label className="mt-4 flex items-center gap-3 rounded-2xl border border-surface-200 bg-white px-4 py-3 dark:border-surface-800 dark:bg-surface-900">
              <input type="checkbox" checked={form.send_push} onChange={(event) => setForm((current) => ({ ...current, send_push: event.target.checked }))} />
              <span className="text-sm text-surface-700 dark:text-surface-300">Intentar tambien envio push remoto cuando esta campana se dispare</span>
            </label>
          </div>

          <div className="rounded-3xl border border-surface-200/60 bg-surface-50 p-5 dark:border-surface-800/60 dark:bg-surface-950/60">
            <h3 className="text-base font-semibold text-surface-900 dark:text-white">Audiencia persistida</h3>
            <p className="mt-1 text-sm text-surface-500">La campana puede guardar una audiencia base reutilizable para el broadcast, sin tener que volver a filtrar clientes desde cero.</p>

            <div className="mt-4 grid gap-4 sm:grid-cols-[220px_1fr]">
              <div>
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Estado clientes</label>
                <select
                  className="input"
                  value={form.audience_status}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      audience_status: event.target.value as CampaignForm['audience_status'],
                    }))
                  }
                >
                  <option value="active">Activos</option>
                  <option value="all">Todos</option>
                  <option value="inactive">Inactivos</option>
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Busqueda base</label>
                <input
                  className="input"
                  value={form.audience_search}
                  onChange={(event) => setForm((current) => ({ ...current, audience_search: event.target.value }))}
                  placeholder="Nombre, email o telefono que se usara al abrir el composer"
                />
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Destinatarios</label>
                <input type="number" min="0" className="input" value={form.total_recipients} onChange={(event) => setForm((current) => ({ ...current, total_recipients: event.target.value }))} />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Enviados</label>
                <input type="number" min="0" className="input" value={form.total_sent} onChange={(event) => setForm((current) => ({ ...current, total_sent: event.target.value }))} />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Abiertos</label>
                <input type="number" min="0" className="input" value={form.total_opened} onChange={(event) => setForm((current) => ({ ...current, total_opened: event.target.value }))} />
              </div>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Programar para</label>
              <input
                type="datetime-local"
                className="input"
                value={form.scheduled_at}
                onChange={(event) => setForm((current) => ({ ...current, scheduled_at: event.target.value }))}
              />
            </div>
          </div>

          {editingCampaign ? (
            <div className="rounded-3xl border border-surface-200/60 bg-surface-50 p-5 dark:border-surface-800/60 dark:bg-surface-950/60">
              <h3 className="text-base font-semibold text-surface-900 dark:text-white">Observabilidad</h3>
              <p className="mt-1 text-sm text-surface-500">Resumen del ultimo intento de envio y del engagement real que devolvio mobile para esta campana.</p>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl bg-white px-4 py-4 dark:bg-surface-900">
                  <p className="text-xs uppercase tracking-wide text-surface-500">Trigger</p>
                  <p className="mt-2 font-semibold text-surface-900 dark:text-white">{formatDispatchTrigger(editingCampaign.last_dispatch_trigger)}</p>
                </div>
                <div className="rounded-2xl bg-white px-4 py-4 dark:bg-surface-900">
                  <p className="text-xs uppercase tracking-wide text-surface-500">Intentos</p>
                  <p className="mt-2 font-semibold text-surface-900 dark:text-white">{editingCampaign.dispatch_attempts}</p>
                </div>
                <div className="rounded-2xl bg-white px-4 py-4 dark:bg-surface-900">
                  <p className="text-xs uppercase tracking-wide text-surface-500">Abiertos</p>
                  <p className="mt-2 font-semibold text-surface-900 dark:text-white">{editingCampaign.total_opened}</p>
                </div>
                <div className="rounded-2xl bg-white px-4 py-4 dark:bg-surface-900">
                  <p className="text-xs uppercase tracking-wide text-surface-500">Clicks</p>
                  <p className="mt-2 font-semibold text-surface-900 dark:text-white">{editingCampaign.total_clicked}</p>
                </div>
                <div className="rounded-2xl bg-white px-4 py-4 dark:bg-surface-900">
                  <p className="text-xs uppercase tracking-wide text-surface-500">Ultimo inicio</p>
                  <p className="mt-2 font-semibold text-surface-900 dark:text-white">
                    {editingCampaign.last_dispatch_attempted_at ? formatDateTime(editingCampaign.last_dispatch_attempted_at) : 'Sin ejecuciones'}
                  </p>
                </div>
                <div className="rounded-2xl bg-white px-4 py-4 dark:bg-surface-900">
                  <p className="text-xs uppercase tracking-wide text-surface-500">Ultimo fin</p>
                  <p className="mt-2 font-semibold text-surface-900 dark:text-white">
                    {editingCampaign.last_dispatch_finished_at ? formatDateTime(editingCampaign.last_dispatch_finished_at) : 'Sin cierre registrado'}
                  </p>
                </div>
              </div>

              {editingCampaign.last_dispatch_error ? (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
                  <p className="font-semibold">Ultimo error</p>
                  <p className="mt-1 leading-6">{editingCampaign.last_dispatch_error}</p>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Guardando...' : form.id ? 'Guardar cambios' : 'Crear campana'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={showBroadcastModal}
        size="lg"
        title="Composer de broadcast"
        description="Selecciona clientes, reutiliza la audiencia guardada de la campana y dispara notificaciones o push por lote con feedback agregado."
        onClose={() => {
          if (!broadcastMutation.isPending) {
            setShowBroadcastModal(false);
          }
        }}
      >
        <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); broadcastMutation.mutate(); }}>
          <div className="rounded-2xl border border-surface-200 bg-surface-50 px-4 py-4 dark:border-surface-800 dark:bg-surface-950/60">
            <p className="text-sm font-semibold text-surface-900 dark:text-white">{broadcastForm.campaign_name}</p>
            <p className="mt-1 text-sm text-surface-500">
              {broadcastForm.campaign_id ? 'Broadcast vinculado a una campana existente; al enviarlo se actualizan sus metricas base.' : 'Broadcast libre no vinculado a una campana persistida.'}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Titulo</label>
              <input className="input" value={broadcastForm.title} onChange={(event) => setBroadcastForm((current) => ({ ...current, title: event.target.value }))} required />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Tipo</label>
              <select className="input" value={broadcastForm.type} onChange={(event) => setBroadcastForm((current) => ({ ...current, type: event.target.value as AppNotification['type'] }))}>
                <option value="info">info</option>
                <option value="success">success</option>
                <option value="warning">warning</option>
                <option value="error">error</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Mensaje</label>
            <textarea className="input min-h-32 resize-y" value={broadcastForm.message} onChange={(event) => setBroadcastForm((current) => ({ ...current, message: event.target.value }))} placeholder="Oferta, recordatorio o anuncio que se guardara como notificacion del cliente." />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Action URL</label>
            <input className="input" value={broadcastForm.action_url} onChange={(event) => setBroadcastForm((current) => ({ ...current, action_url: event.target.value }))} placeholder="nexofitness://store" />
            <div className="mt-3 flex flex-wrap gap-2">
              {actionUrlPresets.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => setBroadcastForm((current) => ({ ...current, action_url: preset.value }))}
                  className={cn('rounded-xl px-3 py-2 text-sm transition-colors', broadcastForm.action_url === preset.value ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300' : 'bg-surface-100 text-surface-600 hover:bg-surface-200 dark:bg-surface-900 dark:text-surface-300 dark:hover:bg-surface-800')}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-3 rounded-2xl border border-surface-200 px-4 py-3 dark:border-surface-800">
            <input type="checkbox" checked={broadcastForm.send_push} onChange={(event) => setBroadcastForm((current) => ({ ...current, send_push: event.target.checked }))} />
            <span className="text-sm text-surface-700 dark:text-surface-300">Intentar envio push remoto via Expo para todos los clientes seleccionados</span>
          </label>

          <div className="rounded-3xl border border-surface-200/60 bg-surface-50 p-5 dark:border-surface-800/60 dark:bg-surface-950/60">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-base font-semibold text-surface-900 dark:text-white">Audiencia</h3>
                <p className="mt-1 text-sm text-surface-500">
                  {broadcastForm.segment_filter ? `La campana trae guardado este segmento: ${buildSegmentSummary(broadcastForm.segment_filter)}.` : 'Este broadcast no tiene segmento persistido; puedes seleccionar clientes manualmente.'}
                </p>
              </div>
              {broadcastForm.segment_filter ? (
                <button type="button" className="btn-secondary" onClick={applySavedSegment}>
                  Aplicar segmento
                </button>
              ) : null}
            </div>

            {broadcastForm.segment_filter ? (
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-surface-500">
                <span className="rounded-full bg-white px-3 py-1 dark:bg-surface-900">{buildSegmentSummary(broadcastForm.segment_filter)}</span>
                <span className="rounded-full bg-white px-3 py-1 dark:bg-surface-900">{segmentMatchedClients.length} coincidencia(s) actuales</span>
              </div>
            ) : null}

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-surface-400" />
                <input className="input pl-10" value={recipientSearch} onChange={(event) => setRecipientSearch(event.target.value)} placeholder="Buscar cliente por nombre o email" />
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-secondary" onClick={selectAllFilteredRecipients}>Seleccionar filtrados</button>
                <button type="button" className="btn-secondary" onClick={clearRecipients}>Limpiar</button>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between text-sm text-surface-500">
              <span>{broadcastForm.user_ids.length} cliente(s) seleccionados</span>
              <span>Base cargada: hasta 100 clientes del tenant</span>
            </div>

            <div className="mt-4 max-h-72 space-y-3 overflow-y-auto pr-1">
              {isLoadingClients ? Array.from({ length: 4 }).map((_, index) => <div key={index} className="shimmer h-16 rounded-2xl" />) : null}
              {isClientsError ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-600 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
                  No pudimos cargar clientes para esta campana.
                </div>
              ) : null}
              {!isLoadingClients && !isClientsError && !filteredClients.length ? (
                <div className="rounded-2xl border border-dashed border-surface-300 px-4 py-6 text-sm text-surface-500 dark:border-surface-700">
                  No hay clientes que coincidan con la busqueda actual.
                </div>
              ) : null}
              {!isLoadingClients && !isClientsError ? filteredClients.map((client) => {
                const selected = broadcastForm.user_ids.includes(client.id);
                const matchesSegment = broadcastForm.segment_filter ? matchesCampaignSegment(client, normalizeSegmentFilter(broadcastForm.segment_filter)) : false;
                return (
                  <button
                    key={client.id}
                    type="button"
                    onClick={() => toggleRecipient(client.id)}
                    className={cn('flex w-full items-center justify-between rounded-2xl border px-4 py-4 text-left transition-colors', selected ? 'border-brand-300 bg-brand-50 dark:border-brand-700 dark:bg-brand-950/30' : 'border-surface-200 bg-white hover:border-surface-300 dark:border-surface-800 dark:bg-surface-900')}
                  >
                    <div>
                      <p className="font-medium text-surface-900 dark:text-white">{client.first_name} {client.last_name}</p>
                      <p className="mt-1 text-sm text-surface-500">{client.email}</p>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-surface-500">
                        <span className={cn('rounded-full px-2 py-1', client.is_active ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-surface-100 dark:bg-surface-800')}>
                          {client.is_active ? 'Activo' : 'Inactivo'}
                        </span>
                        {matchesSegment ? (
                          <span className="rounded-full bg-brand-50 px-2 py-1 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">
                            Coincide con segmento
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <span className={cn('badge', selected ? 'badge-success' : 'badge-neutral')}>{selected ? 'Incluido' : 'Disponible'}</span>
                  </button>
                );
              }) : null}
            </div>
          </div>

          {lastBroadcastResult ? (
            <div className="space-y-4 rounded-3xl border border-surface-200/60 bg-surface-50 p-5 dark:border-surface-800/60 dark:bg-surface-950/60">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-base font-semibold text-surface-900 dark:text-white">Resultado del ultimo broadcast</h3>
                  <p className="mt-1 text-sm text-surface-500">
                    {lastBroadcastResult.total_notifications} notificacion(es) creadas para {lastBroadcastResult.total_recipients} cliente(s).
                  </p>
                </div>
                <span className={cn('badge', lastBroadcastResult.errored_push_deliveries ? 'badge-warning' : 'badge-success')}>
                  {lastBroadcastResult.accepted_push_deliveries}/{lastBroadcastResult.total_push_deliveries} delivery(s) ok
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-4">
                <div className="rounded-2xl bg-white px-4 py-4 dark:bg-surface-900">
                  <p className="text-sm text-surface-500">Clientes</p>
                  <p className="mt-2 text-2xl font-bold font-display text-surface-900 dark:text-white">{lastBroadcastResult.total_recipients}</p>
                </div>
                <div className="rounded-2xl bg-white px-4 py-4 dark:bg-surface-900">
                  <p className="text-sm text-surface-500">Notifications</p>
                  <p className="mt-2 text-2xl font-bold font-display text-surface-900 dark:text-white">{lastBroadcastResult.total_notifications}</p>
                </div>
                <div className="rounded-2xl bg-white px-4 py-4 dark:bg-surface-900">
                  <p className="text-sm text-surface-500">Push OK</p>
                  <p className="mt-2 text-2xl font-bold font-display text-surface-900 dark:text-white">{lastBroadcastResult.accepted_push_deliveries}</p>
                </div>
                <div className="rounded-2xl bg-white px-4 py-4 dark:bg-surface-900">
                  <p className="text-sm text-surface-500">Push error</p>
                  <p className="mt-2 text-2xl font-bold font-display text-surface-900 dark:text-white">{lastBroadcastResult.errored_push_deliveries}</p>
                </div>
              </div>

              <div className="space-y-3">
                {lastBroadcastResult.recipients.map((recipient) => (
                  <div key={recipient.user_id} className="rounded-2xl border border-surface-200/60 bg-white px-4 py-4 dark:border-surface-800/60 dark:bg-surface-900">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-medium text-surface-900 dark:text-white">{recipient.user_name || recipient.user_id}</p>
                        <p className="mt-1 text-sm text-surface-500">
                          {recipient.notification.title} · {formatDateTime(recipient.notification.created_at)}
                        </p>
                      </div>
                      <span className={cn('badge', recipient.push_deliveries.some((delivery) => delivery.status !== 'ok') ? 'badge-warning' : recipient.push_deliveries.length ? 'badge-success' : 'badge-neutral')}>
                        {recipient.push_deliveries.length
                          ? `${recipient.push_deliveries.filter((delivery) => delivery.status === 'ok').length}/${recipient.push_deliveries.length} ok`
                          : lastBroadcastUsedPush
                            ? 'Sin push'
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
              disabled={broadcastMutation.isPending || !broadcastForm.title.trim() || !broadcastForm.user_ids.length}
            >
              {broadcastMutation.isPending ? 'Enviando...' : broadcastForm.send_push ? 'Enviar broadcast push' : 'Crear broadcast'}
            </button>
          </div>
        </form>
      </Modal>
    </motion.div>
  );
}
