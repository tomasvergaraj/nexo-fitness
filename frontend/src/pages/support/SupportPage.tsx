import { useDeferredValue, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  CheckCircle2,
  Clock3,
  Filter,
  History,
  LifeBuoy,
  Mail,
  MapPin,
  Phone,
  Plus,
  Search,
  SendHorizonal,
  Sparkles,
  UserCheck,
  UserRound,
} from 'lucide-react';
import toast from 'react-hot-toast';
import WhatsAppIcon from '@/components/icons/WhatsAppIcon';
import Modal from '@/components/ui/Modal';
import { clientsApi, staffApi, supportApi } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import type { PaginatedResponse, SupportInteraction, User } from '@/types';
import { cn, formatDate, formatDateTime, formatRelative, formatSupportChannelLabel, getApiError, supportChannelBadgeColor } from '@/utils';
import { fadeInUp, staggerContainer } from '@/utils/animations';
import {
  createSupportTimelineEntry,
  getSupportLastActivityAt,
  getSupportLastTimelineEntry,
  getSupportTraceCount,
  parseSupportTimeline,
  serializeSupportTimeline,
  type SupportTimelineEntry,
} from '@/utils/support';

type InteractionCreateForm = {
  channel: SupportInteraction['channel'];
  subject: string;
  notes: string;
  user_id: string;
  handled_by: string;
  resolved: boolean;
};

type InteractionDetailForm = {
  channel: SupportInteraction['channel'];
  subject: string;
  handled_by: string;
  resolved: boolean;
};

type FilterStatus = 'all' | 'pending' | 'resolved';
type SupportDatePreset = '7d' | '30d' | '90d' | 'custom';

const CHANNEL_OPTIONS: Array<{
  value: SupportInteraction['channel'];
  label: string;
  description: string;
}> = [
  { value: 'whatsapp', label: 'WhatsApp', description: 'Ideal para respuestas rápidas.' },
  { value: 'email', label: 'Correo', description: 'Útil para seguimiento más formal.' },
  { value: 'phone', label: 'Teléfono', description: 'Para resolverlo hablando directo.' },
  { value: 'in_person', label: 'Presencial', description: 'Atención hecha en el gimnasio.' },
];

function createEmptyForm(defaultHandlerId?: string): InteractionCreateForm {
  return {
    channel: 'whatsapp',
    subject: '',
    notes: '',
    user_id: '',
    handled_by: defaultHandlerId ?? '',
    resolved: false,
  };
}

function toDetailForm(interaction: SupportInteraction): InteractionDetailForm {
  return {
    channel: interaction.channel,
    subject: interaction.subject ?? '',
    handled_by: interaction.handled_by ?? '',
    resolved: interaction.resolved,
  };
}

export default function SupportPage() {
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((state) => state.user);
  const currentUserFullName = [currentUser?.first_name, currentUser?.last_name].filter(Boolean).join(' ').trim() || currentUser?.email || 'Equipo';
  const replyTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [createForm, setCreateForm] = useState<InteractionCreateForm>(() => createEmptyForm(currentUser?.id));
  const [selectedInteractionId, setSelectedInteractionId] = useState<string | null>(null);
  const [detailForm, setDetailForm] = useState<InteractionDetailForm | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [channelFilter, setChannelFilter] = useState<'all' | SupportInteraction['channel']>('all');
  const [clientFilter, setClientFilter] = useState('all');
  const [handlerFilter, setHandlerFilter] = useState('all');
  const initialSupportDateRange = useMemo(() => getSupportPresetDateRange('30d'), []);
  const [supportDatePreset, setSupportDatePreset] = useState<SupportDatePreset>('30d');
  const [supportDateFrom, setSupportDateFrom] = useState(initialSupportDateRange.from);
  const [supportDateTo, setSupportDateTo] = useState(initialSupportDateRange.to);
  const deferredSearch = useDeferredValue(search);

  const supportQuery = useQuery<PaginatedResponse<SupportInteraction>>({
    queryKey: ['support-interactions', supportDateFrom, supportDateTo],
    queryFn: async () => (
      await supportApi.list({
        page: 1,
        per_page: 100,
        date_from: supportDateFrom,
        date_to: supportDateTo,
      })
    ).data,
  });

  const clientsQuery = useQuery<PaginatedResponse<User>>({
    queryKey: ['support-clients'],
    queryFn: async () => (await clientsApi.list({ page: 1, per_page: 100 })).data,
  });

  const staffQuery = useQuery<Array<{ id: string; full_name: string; role: string; email: string }>>({
    queryKey: ['support-staff'],
    queryFn: async () => (await staffApi.list()).data,
  });

  const interactions = supportQuery.data?.items ?? [];
  const clients = clientsQuery.data?.items ?? [];
  const staff = staffQuery.data ?? [];
  const searchTerm = deferredSearch.trim().toLowerCase();
  const supportDateRangeSummary = useMemo(
    () => getSupportDateRangeSummary(supportDateFrom, supportDateTo),
    [supportDateFrom, supportDateTo],
  );
  const isDefaultSupportDateRange =
    supportDatePreset === '30d'
    && supportDateFrom === initialSupportDateRange.from
    && supportDateTo === initialSupportDateRange.to;

  const interactionMetaMap = useMemo(() => {
    return new Map(
      interactions.map((interaction) => {
        const timeline = parseSupportTimeline(interaction.notes, {
          createdAt: interaction.created_at,
          authorName: interaction.client_name || (interaction.user_id ? 'Cliente' : 'Equipo'),
        });
        const lastEntry = getSupportLastTimelineEntry(interaction.notes, {
          createdAt: interaction.created_at,
          authorName: interaction.client_name || (interaction.user_id ? 'Cliente' : 'Equipo'),
        });
        const lastActivityAt = getSupportLastActivityAt(interaction.notes, {
          createdAt: interaction.created_at,
          authorName: interaction.client_name || (interaction.user_id ? 'Cliente' : 'Equipo'),
        }) || interaction.created_at;
        const traceCount = getSupportTraceCount(interaction.notes, {
          createdAt: interaction.created_at,
          authorName: interaction.client_name || (interaction.user_id ? 'Cliente' : 'Equipo'),
        });
        const searchText = [
          interaction.subject,
          interaction.client_name,
          interaction.handler_name,
          ...timeline.map((entry) => `${entry.author_name} ${entry.message}`),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        return [
          interaction.id,
          {
            timeline,
            lastEntry,
            lastActivityAt,
            traceCount,
            searchText,
          },
        ] as const;
      }),
    );
  }, [interactions]);

  const filteredInteractions = useMemo(
    () =>
      [...interactions]
        .filter((interaction) => {
          if (statusFilter === 'pending' && interaction.resolved) return false;
          if (statusFilter === 'resolved' && !interaction.resolved) return false;
          if (channelFilter !== 'all' && interaction.channel !== channelFilter) return false;
          if (clientFilter !== 'all' && interaction.user_id !== clientFilter) return false;
          if (handlerFilter !== 'all' && interaction.handled_by !== handlerFilter) return false;
          if (!searchTerm) return true;
          return interactionMetaMap.get(interaction.id)?.searchText.includes(searchTerm) ?? false;
        })
        .sort((left, right) => {
          if (left.resolved !== right.resolved) {
            return Number(left.resolved) - Number(right.resolved);
          }
          const leftLastActivity = interactionMetaMap.get(left.id)?.lastActivityAt || left.created_at;
          const rightLastActivity = interactionMetaMap.get(right.id)?.lastActivityAt || right.created_at;
          return new Date(rightLastActivity).getTime() - new Date(leftLastActivity).getTime();
        }),
    [channelFilter, clientFilter, handlerFilter, interactionMetaMap, interactions, searchTerm, statusFilter],
  );

  const selectedInteraction = useMemo(
    () => filteredInteractions.find((interaction) => interaction.id === selectedInteractionId) ?? interactions.find((interaction) => interaction.id === selectedInteractionId) ?? null,
    [filteredInteractions, interactions, selectedInteractionId],
  );

  useEffect(() => {
    if (!selectedInteraction) {
      return;
    }
    setDetailForm(toDetailForm(selectedInteraction));
    setReplyDraft('');
  }, [selectedInteraction]);

  useEffect(() => {
    if (selectedInteractionId && !interactions.some((interaction) => interaction.id === selectedInteractionId)) {
      setSelectedInteractionId(null);
      setDetailForm(null);
      setReplyDraft('');
      setShowDetailModal(false);
      setShowHistoryModal(false);
    }
  }, [interactions, selectedInteractionId]);

  useEffect(() => {
    if (supportDatePreset === 'custom') {
      return;
    }

    const nextRange = getSupportPresetDateRange(supportDatePreset);
    setSupportDateFrom(nextRange.from);
    setSupportDateTo(nextRange.to);
  }, [supportDatePreset]);

  useEffect(() => {
    if (!showDetailModal || !selectedInteraction) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      replyTextareaRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [selectedInteraction, showDetailModal]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const initialNotes = createForm.notes.trim()
        ? serializeSupportTimeline([
            createSupportTimelineEntry({
              kind: 'initial',
              authorName: currentUserFullName,
              authorRole: currentUser?.role ?? null,
              message: createForm.notes.trim(),
            }),
          ])
        : null;

      return (
        await supportApi.create({
          channel: createForm.channel,
          subject: createForm.subject.trim(),
          notes: initialNotes,
          user_id: createForm.user_id || null,
          handled_by: createForm.handled_by || null,
          resolved: createForm.resolved,
        })
      ).data;
    },
    onSuccess: async () => {
      toast.success('Solicitud registrada.');
      setShowCreateModal(false);
      setCreateForm(createEmptyForm(currentUser?.id));
      await queryClient.invalidateQueries({ queryKey: ['support-interactions'] });
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No pudimos guardar esta solicitud.'));
    },
  });

  const detailSaveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedInteraction || !detailForm) {
        throw new Error('No hay una solicitud seleccionada.');
      }

      return (
        await supportApi.update(selectedInteraction.id, {
          channel: detailForm.channel,
          subject: detailForm.subject.trim(),
          handled_by: detailForm.handled_by || null,
          resolved: detailForm.resolved,
        })
      ).data;
    },
    onSuccess: async () => {
      toast.success('Seguimiento actualizado.');
      await queryClient.invalidateQueries({ queryKey: ['support-interactions'] });
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No pudimos guardar los cambios.'));
    },
  });

  const replyMutation = useMutation({
    mutationFn: async () => {
      if (!selectedInteraction || !detailForm) {
        throw new Error('No hay una solicitud seleccionada.');
      }
      if (!replyDraft.trim()) {
        throw new Error('Escribe una respuesta antes de enviarla.');
      }

      const nextTimeline = [
        ...parseSupportTimeline(selectedInteraction.notes, {
          createdAt: selectedInteraction.created_at,
          authorName: selectedInteraction.client_name || (selectedInteraction.user_id ? 'Cliente' : 'Equipo'),
        }),
        createSupportTimelineEntry({
          kind: 'reply',
          authorName: currentUserFullName,
          authorRole: currentUser?.role ?? null,
          message: replyDraft.trim(),
        }),
      ];

      return (
        await supportApi.update(selectedInteraction.id, {
          channel: detailForm.channel,
          subject: detailForm.subject.trim(),
          handled_by: detailForm.handled_by || selectedInteraction.handled_by || currentUser?.id || null,
          resolved: detailForm.resolved,
          notes: serializeSupportTimeline(nextTimeline),
        })
      ).data;
    },
    onSuccess: async () => {
      toast.success('Respuesta guardada en el historial.');
      setReplyDraft('');
      await queryClient.invalidateQueries({ queryKey: ['support-interactions'] });
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No pudimos guardar la respuesta.'));
    },
  });

  const quickUpdateMutation = useMutation({
    mutationFn: async ({
      interactionId,
      payload,
      successMessage,
    }: {
      interactionId: string;
      payload: Record<string, unknown>;
      successMessage: string;
    }) => {
      await supportApi.update(interactionId, payload);
      return successMessage;
    },
    onSuccess: async (message) => {
      toast.success(message);
      await queryClient.invalidateQueries({ queryKey: ['support-interactions'] });
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No pudimos actualizar esta solicitud.'));
    },
  });

  const pendingCount = interactions.filter((item) => !item.resolved).length;
  const resolvedCount = interactions.length - pendingCount;
  const unassignedCount = interactions.filter((item) => !item.handled_by).length;
  const whatsappCount = interactions.filter((item) => item.channel === 'whatsapp').length;
  const hasSearchOrSelectionFilters = Boolean(
    searchTerm || statusFilter !== 'all' || channelFilter !== 'all' || clientFilter !== 'all' || handlerFilter !== 'all',
  );
  const hasActiveFilters = Boolean(
    hasSearchOrSelectionFilters || !isDefaultSupportDateRange,
  );

  const selectedTimeline = selectedInteraction
    ? interactionMetaMap.get(selectedInteraction.id)?.timeline ?? []
    : [];
  const selectedLastEntry = selectedInteraction
    ? interactionMetaMap.get(selectedInteraction.id)?.lastEntry ?? null
    : null;
  const selectedTraceCount = selectedInteraction
    ? interactionMetaMap.get(selectedInteraction.id)?.traceCount ?? 0
    : 0;
  const selectedDisplayedTraceCount = Math.max(selectedTraceCount, 1);

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

  const openInteractionModal = (
    interactionId: string,
    options?: {
      preserveDraft?: boolean;
      preserveDetail?: boolean;
    },
  ) => {
    const interaction = interactions.find((item) => item.id === interactionId) ?? null;
    setSelectedInteractionId(interactionId);
    setDetailForm((current) => {
      if (options?.preserveDetail && selectedInteractionId === interactionId && current) {
        return current;
      }
      return interaction ? toDetailForm(interaction) : null;
    });
    if (!(options?.preserveDraft && selectedInteractionId === interactionId)) {
      setReplyDraft('');
    }
    setShowHistoryModal(false);
    setShowDetailModal(true);
  };

  const openHistoryModal = (interactionId: string) => {
    const interaction = interactions.find((item) => item.id === interactionId) ?? null;
    setSelectedInteractionId(interactionId);
    setDetailForm((current) => {
      if (selectedInteractionId === interactionId && current) {
        return current;
      }
      return interaction ? toDetailForm(interaction) : null;
    });
    setShowDetailModal(false);
    setShowHistoryModal(true);
  };

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-6">
      <motion.section
        variants={fadeInUp}
        className="rounded-[1.75rem] border border-surface-200/70 bg-white/90 p-6 shadow-sm dark:border-white/10 dark:bg-white/[0.04] dark:shadow-none"
      >
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-surface-200 bg-surface-50 px-3 py-1 text-xs font-semibold text-surface-600 dark:border-white/10 dark:bg-white/5 dark:text-surface-300">
              <LifeBuoy size={14} />
              Soporte con trazabilidad
            </div>
            <h1 className="mt-4 text-2xl font-bold font-display text-surface-900 dark:text-white">Gestiona solicitudes como una bandeja de seguimiento real</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-surface-500 dark:text-surface-400">
              Ordena por tabla, responde desde un solo lugar y deja visible cada movimiento del caso para tu equipo y para el cliente.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setCreateForm(createEmptyForm(currentUser?.id));
              setShowCreateModal(true);
            }}
            className="btn-primary"
          >
            <Plus size={16} />
            Registrar solicitud manual
          </button>
        </div>
      </motion.section>

      {supportQuery.isError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-600 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
          No pudimos cargar el historial de soporte.
        </div>
      ) : null}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SupportMetricCard icon={Clock3} label="Pendientes" value={pendingCount} caption="Casos que siguen abiertos." accentClass="text-amber-500" />
        <SupportMetricCard icon={CheckCircle2} label="Resueltas" value={resolvedCount} caption="Solicitudes ya cerradas." accentClass="text-emerald-500" />
        <SupportMetricCard icon={WhatsAppIcon} label="WhatsApp" value={whatsappCount} caption="Canal más usado por tus clientes." accentClass="text-emerald-500" />
        <SupportMetricCard icon={UserCheck} label="Sin asignar" value={unassignedCount} caption="Casos esperando responsable." accentClass="text-cyan-500" />
      </section>

      <motion.section
        variants={fadeInUp}
        className="rounded-[1.5rem] border border-surface-200/70 bg-white/90 p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.04] dark:shadow-none"
      >
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex-1">
            <p className="text-sm font-semibold text-surface-900 dark:text-white">Filtra la bandeja como quieras</p>
            <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">Busca por cliente, asunto o texto de seguimiento para llegar más rápido al caso correcto.</p>
          </div>
          <div className="relative w-full xl:max-w-sm">
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-surface-400" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por asunto, cliente o respuesta"
              className="w-full rounded-2xl border border-surface-200 bg-white py-3 pl-10 pr-4 text-sm text-surface-900 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 dark:border-white/10 dark:bg-surface-950/40 dark:text-white dark:placeholder-surface-500"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {([
            { id: 'all', label: 'Todas' },
            { id: 'pending', label: 'Pendientes' },
            { id: 'resolved', label: 'Resueltas' },
          ] as const).map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setStatusFilter(option.id)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                statusFilter === option.id
                  ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-400/30 dark:bg-brand-500/10 dark:text-brand-100'
                  : 'border-surface-200 bg-white text-surface-500 hover:text-surface-900 dark:border-white/10 dark:bg-white/5 dark:text-surface-400 dark:hover:text-white',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <label className="block">
            <span className="mb-2 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-surface-500">
              <Filter size={13} />
              Canal
            </span>
            <select
              className="input"
              value={channelFilter}
              onChange={(event) => setChannelFilter(event.target.value as 'all' | SupportInteraction['channel'])}
            >
              <option value="all">Todos los canales</option>
              {CHANNEL_OPTIONS.map((channel) => (
                <option key={channel.value} value={channel.value}>
                  {channel.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-surface-500">
              <UserRound size={13} />
              Cliente
            </span>
            <select className="input" value={clientFilter} onChange={(event) => setClientFilter(event.target.value)}>
              <option value="all">Todos los clientes</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {`${client.first_name} ${client.last_name}`.trim() || client.email}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-surface-500">
              <UserCheck size={13} />
              Responsable
            </span>
            <select className="input" value={handlerFilter} onChange={(event) => setHandlerFilter(event.target.value)}>
              <option value="all">Todo el equipo</option>
              {staff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.full_name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4 rounded-[1.25rem] border border-surface-200 bg-surface-50/80 p-4 dark:border-white/10 dark:bg-surface-950/35">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-surface-900 dark:text-white">Rango de fechas</p>
              <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
                Mostrando {interactions.length} {interactions.length === 1 ? 'solicitud' : 'solicitudes'} {supportDateRangeSummary}.
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
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                    supportDatePreset === option.id
                      ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-400/30 dark:bg-brand-500/10 dark:text-brand-100'
                      : 'border-surface-200 bg-white text-surface-500 hover:text-surface-900 dark:border-white/10 dark:bg-white/5 dark:text-surface-400 dark:hover:text-white',
                  )}
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
                max={getSupportDateKey(new Date())}
                onChange={(event) => updateSupportDateTo(event.target.value)}
              />
            </label>
          </div>
        </div>
      </motion.section>

      {!supportQuery.isLoading && !filteredInteractions.length ? (
        <div className="rounded-[1.5rem] border border-dashed border-surface-300 bg-surface-50/80 px-5 py-10 text-center dark:border-white/15 dark:bg-black/10">
          <p className="text-lg font-semibold text-surface-900 dark:text-white">
            {hasSearchOrSelectionFilters ? 'No encontramos solicitudes con ese filtro' : 'No encontramos solicitudes en este rango'}
          </p>
          <p className="mt-2 text-sm leading-6 text-surface-600 dark:text-surface-300">
            {hasActiveFilters && hasSearchOrSelectionFilters
              ? 'Prueba cambiando el cliente, el canal, el estado o el rango de fechas para encontrar lo que buscas.'
              : `No encontramos solicitudes ${supportDateRangeSummary}. Cuando un cliente pida ayuda desde la app o registres un caso manual, aparecerá aquí con su historial.`}
          </p>
        </div>
      ) : null}

      {filteredInteractions.length ? (
        <motion.section
          variants={fadeInUp}
          className="overflow-hidden rounded-[1.65rem] border border-surface-200/70 bg-white/90 shadow-sm dark:border-white/10 dark:bg-white/[0.04] dark:shadow-none"
        >
          <div className="overflow-x-auto">
            <table className="min-w-[1100px] w-full">
              <thead className="bg-surface-50/90 dark:bg-white/[0.03]">
                <tr className="text-left text-xs uppercase tracking-[0.18em] text-surface-500 dark:text-surface-400">
                  <th className="px-5 py-4 font-semibold">Solicitud</th>
                  <th className="px-4 py-4 font-semibold">Cliente</th>
                  <th className="px-4 py-4 font-semibold">Canal</th>
                  <th className="px-4 py-4 font-semibold">Responsable</th>
                  <th className="px-4 py-4 font-semibold">Traza</th>
                  <th className="px-4 py-4 font-semibold">Último movimiento</th>
                  <th className="px-4 py-4 font-semibold">Estado</th>
                  <th className="px-5 py-4 font-semibold text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-200/70 dark:divide-white/10">
                {supportQuery.isLoading && !supportQuery.data ? (
                  Array.from({ length: 6 }).map((_, index) => (
                    <tr key={index}>
                      <td colSpan={8} className="px-5 py-4">
                        <div className="shimmer h-14 rounded-2xl" />
                      </td>
                    </tr>
                  ))
                ) : (
                  filteredInteractions.map((interaction) => {
                    const meta = interactionMetaMap.get(interaction.id);
                    const lastEntry = meta?.lastEntry;
                    const lastActivityAt = meta?.lastActivityAt || interaction.created_at;
                    const traceCount = meta?.traceCount ?? 0;
                    const displayedTraceCount = Math.max(traceCount, 1);

                    return (
                      <tr key={interaction.id} className="transition-colors hover:bg-surface-50/80 dark:hover:bg-white/[0.03]">
                        <td className="px-5 py-4 align-top">
                          <button
                            type="button"
                            onClick={() => openInteractionModal(interaction.id)}
                            className="w-full text-left"
                          >
                            <p className="text-sm font-semibold text-surface-900 dark:text-white">
                              {interaction.subject || 'Solicitud sin asunto'}
                            </p>
                            <p className="mt-1 line-clamp-2 text-sm leading-6 text-surface-600 dark:text-surface-300">
                              {lastEntry?.message || 'Todavía no hay detalle en el seguimiento.'}
                            </p>
                          </button>
                        </td>
                        <td className="px-4 py-4 align-top">
                          <p className="text-sm font-medium text-surface-900 dark:text-white">
                            {interaction.client_name || 'Seguimiento interno'}
                          </p>
                          <p className="mt-1 text-xs text-surface-500 dark:text-surface-400">
                            {interaction.user_id ? 'Cliente vinculado' : 'Caso interno'}
                          </p>
                        </td>
                        <td className="px-4 py-4 align-top">
                          <span className={cn('badge', supportChannelBadgeColor(interaction.channel))}>
                            {formatSupportChannelLabel(interaction.channel)}
                          </span>
                        </td>
                        <td className="px-4 py-4 align-top">
                          <p className="text-sm text-surface-700 dark:text-surface-200">
                            {interaction.handler_name || 'Sin asignar'}
                          </p>
                        </td>
                        <td className="px-4 py-4 align-top">
                          <p className="text-sm font-semibold text-surface-900 dark:text-white">
                            {displayedTraceCount}
                          </p>
                          <p className="mt-1 text-xs text-surface-500 dark:text-surface-400">
                            {displayedTraceCount === 1 ? 'movimiento' : 'movimientos'}
                          </p>
                        </td>
                        <td className="px-4 py-4 align-top">
                          <p className="text-sm text-surface-700 dark:text-surface-200">
                            {formatRelative(lastActivityAt)}
                          </p>
                          <p className="mt-1 text-xs text-surface-500 dark:text-surface-400">
                            {lastEntry ? `por ${lastEntry.author_name}` : 'sin detalle'}
                          </p>
                        </td>
                        <td className="px-4 py-4 align-top">
                          <div className="flex flex-wrap gap-2">
                            <span className={cn('badge', interaction.resolved ? 'badge-success' : 'badge-warning')}>
                              {interaction.resolved ? 'Resuelta' : 'Pendiente'}
                            </span>
                            {!interaction.handled_by ? <span className="badge badge-info">Sin asignar</span> : null}
                          </div>
                        </td>
                        <td className="px-5 py-4 align-top">
                          <div className="flex justify-end gap-2">
                            {!interaction.handled_by && currentUser?.id ? (
                              <button
                                type="button"
                                className="btn-secondary"
                                disabled={quickUpdateMutation.isPending}
                                onClick={() =>
                                  quickUpdateMutation.mutate({
                                    interactionId: interaction.id,
                                    payload: { handled_by: currentUser.id },
                                    successMessage: 'Quedó asignada a tu nombre.',
                                  })
                                }
                              >
                                Asignarme
                              </button>
                            ) : null}
                            <button type="button" className="btn-secondary" onClick={() => openHistoryModal(interaction.id)}>
                              Historial
                            </button>
                            <button type="button" className="btn-secondary" onClick={() => openInteractionModal(interaction.id)}>
                              Responder
                            </button>
                            {!interaction.resolved ? (
                              <button
                                type="button"
                                className="btn-secondary"
                                disabled={quickUpdateMutation.isPending}
                                onClick={() =>
                                  quickUpdateMutation.mutate({
                                    interactionId: interaction.id,
                                    payload: { resolved: true },
                                    successMessage: 'La solicitud quedó marcada como resuelta.',
                                  })
                                }
                              >
                                Cerrar
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="border-t border-surface-200/70 bg-surface-50/70 px-5 py-3 text-sm text-surface-500 dark:border-white/10 dark:bg-white/[0.02] dark:text-surface-400">
            Abre cada solicitud en una ventana aparte y consulta el historial completo solo cuando lo necesites.
          </div>
        </motion.section>
      ) : null}

      <Modal
        open={showDetailModal && Boolean(selectedInteraction && detailForm)}
        title={selectedInteraction?.subject || 'Solicitud de soporte'}
        description={selectedInteraction?.client_name ? `Caso de ${selectedInteraction.client_name}` : 'Actualiza el caso y abre el historial aparte cuando necesites revisar toda la trazabilidad.'}
        onClose={() => {
          if (!detailSaveMutation.isPending && !replyMutation.isPending) {
            setShowDetailModal(false);
          }
        }}
        size="lg"
      >
        {selectedInteraction && detailForm ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-[1.3rem] border border-surface-200 bg-surface-50/80 p-4 dark:border-white/10 dark:bg-surface-950/35">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn('badge', supportChannelBadgeColor(detailForm.channel))}>
                    {formatSupportChannelLabel(detailForm.channel)}
                  </span>
                  <span className={cn('badge', detailForm.resolved ? 'badge-success' : 'badge-warning')}>
                    {detailForm.resolved ? 'Resuelta' : 'Pendiente'}
                  </span>
                </div>
                <p className="mt-3 text-sm font-semibold text-surface-900 dark:text-white">
                  {selectedInteraction.client_name || 'Seguimiento interno'}
                </p>
                <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
                  Creada el {formatDateTime(selectedInteraction.created_at)}
                </p>
              </div>
              <div className="grid min-w-[220px] gap-3 sm:grid-cols-2">
                <SupportMetaItem label="Último movimiento" value={selectedLastEntry ? formatDateTime(selectedLastEntry.created_at) : formatDateTime(selectedInteraction.created_at)} />
                <SupportMetaItem label="Trazabilidad" value={`${selectedDisplayedTraceCount} ${selectedDisplayedTraceCount === 1 ? 'movimiento' : 'movimientos'}`} />
              </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-5">
                <div className="rounded-[1.25rem] border border-surface-200 bg-surface-50/80 p-4 dark:border-white/10 dark:bg-surface-950/35">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-surface-900 dark:text-white">Historial del caso</p>
                      <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
                        Revísalo en una ventana aparte para no sobrecargar esta gestión.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => openHistoryModal(selectedInteraction.id)}
                    >
                      <History size={16} />
                      Ver historial
                    </button>
                  </div>

                  {selectedLastEntry ? (
                    <div className="mt-4 rounded-[1.15rem] border border-surface-200 bg-white/80 px-4 py-4 dark:border-white/10 dark:bg-white/5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn('badge', selectedLastEntry.kind === 'reply' ? 'badge-info' : 'badge-neutral')}>
                          {selectedLastEntry.kind === 'reply' ? 'Respuesta' : selectedLastEntry.kind === 'initial' ? 'Inicio' : 'Nota'}
                        </span>
                        <span className="text-xs text-surface-500 dark:text-surface-400">
                          {formatDateTime(selectedLastEntry.created_at)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm font-semibold text-surface-900 dark:text-white">
                        {selectedLastEntry.author_name}
                      </p>
                      <p className="mt-2 line-clamp-3 text-sm leading-6 text-surface-600 dark:text-surface-300">
                        {selectedLastEntry.message}
                      </p>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-[1.15rem] border border-dashed border-surface-300 bg-surface-50/80 px-4 py-5 text-center dark:border-white/15 dark:bg-black/10">
                      <p className="text-sm font-medium text-surface-900 dark:text-white">Aún no hay movimientos registrados</p>
                      <p className="mt-2 text-sm leading-6 text-surface-600 dark:text-surface-300">
                        Cuando quieras revisar toda la trazabilidad, el historial se abrirá en este caso aparte.
                      </p>
                    </div>
                  )}
                </div>

                <div className="space-y-3 rounded-[1.25rem] border border-surface-200 bg-surface-50/80 p-4 dark:border-white/10 dark:bg-surface-950/35">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-surface-900 dark:text-white">Responder y dejar trazabilidad</p>
                      <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">Esta respuesta quedará guardada en el historial del caso.</p>
                    </div>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => {
                        const response = selectedInteraction.handler_name
                          ? `Hola, estoy revisando tu caso. ${selectedInteraction.handler_name} te ayudará con esto.`
                          : 'Hola, ya estamos revisando tu caso y te responderemos pronto.';
                        setReplyDraft(response);
                        replyTextareaRef.current?.focus();
                      }}
                    >
                      Respuesta rápida
                    </button>
                  </div>
                  <textarea
                    ref={replyTextareaRef}
                    className="input min-h-32 resize-y"
                    value={replyDraft}
                    onChange={(event) => setReplyDraft(event.target.value)}
                    placeholder="Escribe una respuesta, el siguiente paso o una actualización para dejar el caso bien documentado."
                  />
                  <div className="flex flex-wrap justify-end gap-2">
                    <button type="button" className="btn-secondary" onClick={() => setShowDetailModal(false)} disabled={replyMutation.isPending}>
                      Cerrar
                    </button>
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={replyMutation.isPending}
                      onClick={() => void replyMutation.mutateAsync()}
                    >
                      <SendHorizonal size={16} />
                      {replyMutation.isPending ? 'Guardando respuesta...' : 'Guardar respuesta'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-4 rounded-[1.25rem] border border-surface-200 bg-surface-50/80 p-4 dark:border-white/10 dark:bg-surface-950/35">
                <p className="text-[11px] uppercase tracking-[0.18em] text-surface-500">Seguimiento del caso</p>
                <div>
                  <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Asunto</label>
                  <input
                    className="input"
                    value={detailForm.subject}
                    onChange={(event) => setDetailForm((current) => (current ? { ...current, subject: event.target.value } : current))}
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Canal</label>
                  <select
                    className="input"
                    value={detailForm.channel}
                    onChange={(event) => setDetailForm((current) => (current ? { ...current, channel: event.target.value as SupportInteraction['channel'] } : current))}
                  >
                    {CHANNEL_OPTIONS.map((channel) => (
                      <option key={channel.value} value={channel.value}>
                        {channel.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Responsable</label>
                  <select
                    className="input"
                    value={detailForm.handled_by}
                    onChange={(event) => setDetailForm((current) => (current ? { ...current, handled_by: event.target.value } : current))}
                  >
                    <option value="">Sin asignar por ahora</option>
                    {staff.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.full_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium text-surface-700 dark:text-surface-300">Estado</p>
                  <div className="flex flex-wrap gap-2">
                    {([
                      { value: false, label: 'Pendiente' },
                      { value: true, label: 'Resuelta' },
                    ] as const).map((option) => (
                      <button
                        key={option.label}
                        type="button"
                        onClick={() => setDetailForm((current) => (current ? { ...current, resolved: option.value } : current))}
                        className={cn(
                          'rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                          detailForm.resolved === option.value
                            ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-400/30 dark:bg-brand-500/10 dark:text-brand-100'
                            : 'border-surface-200 bg-white text-surface-500 hover:text-surface-900 dark:border-white/10 dark:bg-white/5 dark:text-surface-400 dark:hover:text-white',
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-secondary w-full justify-center"
                  disabled={detailSaveMutation.isPending}
                  onClick={() => void detailSaveMutation.mutateAsync()}
                >
                  <Sparkles size={16} />
                  {detailSaveMutation.isPending ? 'Guardando...' : 'Guardar seguimiento'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={showHistoryModal && Boolean(selectedInteraction)}
        title={selectedInteraction?.subject || 'Historial de soporte'}
        description={selectedInteraction?.client_name ? `Trazabilidad completa del caso de ${selectedInteraction.client_name}` : 'Revisa todos los movimientos del caso en una vista dedicada.'}
        onClose={() => setShowHistoryModal(false)}
        size="lg"
      >
        {selectedInteraction ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-[1.3rem] border border-surface-200 bg-surface-50/80 p-4 dark:border-white/10 dark:bg-surface-950/35">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn('badge', supportChannelBadgeColor(selectedInteraction.channel))}>
                    {formatSupportChannelLabel(selectedInteraction.channel)}
                  </span>
                  <span className={cn('badge', selectedInteraction.resolved ? 'badge-success' : 'badge-warning')}>
                    {selectedInteraction.resolved ? 'Resuelta' : 'Pendiente'}
                  </span>
                </div>
                <p className="mt-3 text-sm font-semibold text-surface-900 dark:text-white">
                  {selectedInteraction.client_name || 'Seguimiento interno'}
                </p>
                <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
                  Creada el {formatDateTime(selectedInteraction.created_at)}
                </p>
              </div>
              <div className="grid min-w-[220px] gap-3 sm:grid-cols-2">
                <SupportMetaItem label="Último movimiento" value={selectedLastEntry ? formatDateTime(selectedLastEntry.created_at) : formatDateTime(selectedInteraction.created_at)} />
                <SupportMetaItem label="Trazabilidad" value={`${selectedDisplayedTraceCount} ${selectedDisplayedTraceCount === 1 ? 'movimiento' : 'movimientos'}`} />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-surface-500">Historial de la solicitud</p>
                <span className="text-xs text-surface-500 dark:text-surface-400">
                  {selectedDisplayedTraceCount} {selectedDisplayedTraceCount === 1 ? 'entrada' : 'entradas'}
                </span>
              </div>
              <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
                <SupportTimelineList timeline={selectedTimeline} />
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setShowHistoryModal(false)}>
                Cerrar
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => openInteractionModal(selectedInteraction.id, { preserveDraft: true, preserveDetail: true })}
              >
                Gestionar caso
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={showCreateModal}
        title="Registrar solicitud manual"
        description="Crea un caso interno o deja registrado un contacto que llegó por otro canal."
        onClose={() => {
          if (!createMutation.isPending) {
            setShowCreateModal(false);
          }
        }}
      >
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            createMutation.mutate();
          }}
        >
          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Canal principal</label>
            <div className="grid gap-3 sm:grid-cols-2">
              {CHANNEL_OPTIONS.map((channel) => {
                const isSelected = createForm.channel === channel.value;
                return (
                  <button
                    key={channel.value}
                    type="button"
                    onClick={() => setCreateForm((current) => ({ ...current, channel: channel.value }))}
                    className={cn(
                      'rounded-[1.25rem] border px-4 py-4 text-left transition-colors',
                      isSelected
                        ? 'border-brand-300 bg-brand-50 text-surface-900 dark:border-brand-400/30 dark:bg-brand-500/10 dark:text-white'
                        : 'border-surface-200 bg-white text-surface-600 hover:border-surface-300 dark:border-white/10 dark:bg-surface-950/30 dark:text-surface-300 dark:hover:border-white/20',
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-current/10 bg-white/80 dark:bg-white/10">
                        <SupportChannelIcon channel={channel.value} size={18} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">{channel.label}</p>
                        <p className="mt-1 text-xs leading-5 opacity-80">{channel.description}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Asunto</label>
            <input
              className="input"
              value={createForm.subject}
              onChange={(event) => setCreateForm((current) => ({ ...current, subject: event.target.value }))}
              placeholder="Ej. Problema para reservar clases"
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Cliente</label>
              <select
                className="input"
                value={createForm.user_id}
                onChange={(event) => setCreateForm((current) => ({ ...current, user_id: event.target.value }))}
              >
                <option value="">Sin cliente vinculado</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {`${client.first_name} ${client.last_name}`.trim() || client.email}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Responsable</label>
              <select
                className="input"
                value={createForm.handled_by}
                onChange={(event) => setCreateForm((current) => ({ ...current, handled_by: event.target.value }))}
              >
                <option value="">Sin asignar por ahora</option>
                {staff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.full_name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Detalle inicial</label>
            <textarea
              className="input min-h-32 resize-y"
              value={createForm.notes}
              onChange={(event) => setCreateForm((current) => ({ ...current, notes: event.target.value }))}
              placeholder="Deja aquí el contexto inicial para que el caso arranque con trazabilidad desde el primer registro."
            />
          </div>

          <div className="rounded-[1.25rem] border border-surface-200 bg-surface-50 px-4 py-4 dark:border-white/10 dark:bg-surface-950/35">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-surface-900 dark:text-white">Estado del caso</p>
                <p className="mt-1 text-sm leading-6 text-surface-600 dark:text-surface-300">
                  {createForm.resolved
                    ? 'Este caso se registrará como resuelto.'
                    : 'Este caso se registrará como pendiente para darle seguimiento.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCreateForm((current) => ({ ...current, resolved: !current.resolved }))}
                className={cn(
                  'relative inline-flex h-7 w-12 shrink-0 rounded-full border p-0.5 transition-all duration-200 focus:outline-none',
                  createForm.resolved
                    ? 'border-transparent bg-emerald-500'
                    : 'border-surface-300 bg-surface-200/90 dark:border-white/10 dark:bg-white/10',
                )}
                aria-label="Cambiar estado del caso"
              >
                <span
                  className={cn(
                    'absolute left-0.5 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white shadow-sm transition-transform duration-200',
                    createForm.resolved ? 'translate-x-5' : 'translate-x-0',
                  )}
                />
              </button>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setShowCreateModal(false)}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Guardando...' : 'Crear solicitud'}
            </button>
          </div>
        </form>
      </Modal>
    </motion.div>
  );
}

function SupportMetricCard({
  icon: Icon,
  label,
  value,
  caption,
  accentClass,
}: {
  icon: ComponentType<{ size?: number | string; className?: string; title?: string }>;
  label: string;
  value: number;
  caption: string;
  accentClass: string;
}) {
  return (
    <div className="rounded-[1.5rem] border border-surface-200/70 bg-white/90 p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.04] dark:shadow-none">
      <div className="flex items-center gap-3">
        <div className={cn('flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-100 dark:bg-white/10', accentClass)}>
          <Icon size={18} />
        </div>
        <span className="text-sm font-medium text-surface-500 dark:text-surface-400">{label}</span>
      </div>
      <p className="mt-4 text-3xl font-bold font-display text-surface-900 dark:text-white">{value}</p>
      <p className="mt-2 text-sm leading-6 text-surface-600 dark:text-surface-300">{caption}</p>
    </div>
  );
}

function SupportMetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-surface-200 bg-surface-50 px-4 py-3 dark:border-white/10 dark:bg-surface-950/35">
      <p className="text-[11px] uppercase tracking-[0.18em] text-surface-500">{label}</p>
      <p className="mt-2 text-sm font-semibold text-surface-900 dark:text-white">{value}</p>
    </div>
  );
}

function SupportTimelineList({ timeline }: { timeline: SupportTimelineEntry[] }) {
  if (!timeline.length) {
    return (
      <div className="rounded-[1.2rem] border border-dashed border-surface-300 bg-surface-50/80 px-4 py-6 text-center dark:border-white/15 dark:bg-black/10">
        <p className="text-sm font-medium text-surface-900 dark:text-white">Aún no hay movimientos registrados</p>
        <p className="mt-2 text-sm leading-6 text-surface-600 dark:text-surface-300">
          Usa la gestión del caso para dejar respuestas y notas visibles para todo el equipo.
        </p>
      </div>
    );
  }

  return (
    <>
      {timeline.map((entry, index) => (
        <div key={entry.id} className="relative rounded-[1.2rem] border border-surface-200 bg-surface-50/90 px-4 py-4 dark:border-white/10 dark:bg-surface-950/35">
          {index < timeline.length - 1 ? (
            <span className="absolute left-[1.15rem] top-full h-3 w-px bg-surface-200 dark:bg-white/10" />
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('badge', entry.kind === 'reply' ? 'badge-info' : 'badge-neutral')}>
              {entry.kind === 'reply' ? 'Respuesta' : entry.kind === 'initial' ? 'Inicio' : 'Nota'}
            </span>
            <span className="text-xs text-surface-500 dark:text-surface-400">
              {formatDateTime(entry.created_at)}
            </span>
          </div>
          <p className="mt-2 text-sm font-semibold text-surface-900 dark:text-white">
            {entry.author_name}
          </p>
          <p className="mt-2 text-sm leading-6 text-surface-600 dark:text-surface-300">
            {entry.message}
          </p>
        </div>
      ))}
    </>
  );
}

function SupportChannelIcon({
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

function getSupportDateKey(date: string | Date) {
  const value = typeof date === 'string' ? new Date(date) : date;
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getSupportPresetDateRange(preset: Exclude<SupportDatePreset, 'custom'>) {
  const to = new Date();
  const from = new Date(to);
  const daysBack = preset === '7d' ? 6 : preset === '90d' ? 89 : 29;
  from.setDate(to.getDate() - daysBack);

  return {
    from: getSupportDateKey(from),
    to: getSupportDateKey(to),
  };
}

function getSupportDateRangeSummary(from: string, to: string) {
  return `entre el ${formatDate(from)} y el ${formatDate(to)}`;
}
