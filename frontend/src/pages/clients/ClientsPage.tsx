import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  AlertTriangle,
  BarChart2,
  Bell,
  Cake,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  FileText,
  History,
  KeyRound,
  Mail,
  MoreHorizontal,
  Pencil,
  Phone,
  PlayCircle,
  Plus,
  Power,
  RefreshCcw,
  Search,
  Snowflake,
  TrendingDown,
  Upload,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Modal from '@/components/ui/Modal';
import Tooltip from '@/components/ui/Tooltip';
import { clientsApi, membershipsApi, notificationsApi } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { fadeInUp, staggerContainer } from '@/utils/animations';
import { cn, formatDate, formatDateTime, getInitials , getApiError } from '@/utils';
import type { AppNotification, NotificationDispatchResponse, PaginatedResponse, PushDelivery, User, UserRole } from '@/types';

const filters = [
  { label: 'Todos', value: '' },
  { label: 'Activos', value: 'active' },
  { label: 'Inactivos', value: 'inactive' },
  { label: 'Cumpleaños', value: 'birthday', icon: Cake },
  { label: 'En riesgo', value: 'churn_high', icon: TrendingDown },
  { label: 'Riesgo medio', value: 'churn_medium', icon: TrendingDown },
];

const notificationActionPresets = [
  { label: 'Perfil', value: 'nexofitness://account/profile' },
  { label: 'Pagos', value: 'nexofitness://payments' },
  { label: 'Agenda', value: 'nexofitness://agenda' },
  { label: 'Pago', value: 'nexofitness://store' },
];

type ClientFormState = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  password: string;
  date_of_birth: string;
};

type ClientEditFormState = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  date_of_birth: string;
};

const emptyForm: ClientFormState = {
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  password: 'Client123!',
  date_of_birth: '',
};

const clientCreateRoles: UserRole[] = ['owner', 'admin', 'reception'];
const clientResetPasswordRoles: UserRole[] = ['owner', 'admin'];

type NotificationForm = {
  user_id: string;
  client_name: string;
  client_email: string;
  title: string;
  message: string;
  type: AppNotification['type'];
  action_url: string;
  send_push: boolean;
};

function createNotificationForm(client?: User): NotificationForm {
  return {
    user_id: client?.id ?? '',
    client_name: client ? `${client.first_name} ${client.last_name}` : '',
    client_email: client?.email ?? '',
    title: client ? `Actualización para ${client.first_name}` : 'Actualización de tu cuenta',
    message: '',
    type: 'info',
    action_url: 'nexofitness://account/profile',
    send_push: true,
  };
}

function getPushProviderLabel(provider: PushDelivery['provider']) {
  if (provider === 'webpush') return 'Navegador';
  if (provider === 'expo') return 'App del cliente';
  return 'Dispositivo';
}

function getPushTargetLabel(delivery: PushDelivery) {
  return delivery.delivery_target || delivery.expo_push_token || 'Sin dispositivo registrado';
}

function getDateInputValue(value?: string | null) {
  if (!value) {
    return '';
  }
  return value.slice(0, 10);
}

function getDateOnlyParts(value?: string | null) {
  const normalized = getDateInputValue(value);
  if (!normalized) {
    return null;
  }

  const [year, month, day] = normalized.split('-').map(Number);
  if (!year || !month || !day) {
    return null;
  }

  return { year, month, day };
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows
    .map((row) =>
      row
        .map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`)
        .join(','),
    )
    .join('\n');

  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function ClientsPage() {
  const queryClient = useQueryClient();
  const userRole = useAuthStore((state) => state.user?.role);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showNotificationModal, setShowNotificationModal] = useState(false);
  const [actionsClient, setActionsClient] = useState<User | null>(null);
  const [editContactClient, setEditContactClient] = useState<User | null>(null);
  const [editContactForm, setEditContactForm] = useState<ClientEditFormState>({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    date_of_birth: '',
  });
  const [resetPasswordClient, setResetPasswordClient] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [notificationForm, setNotificationForm] = useState<NotificationForm>(createNotificationForm());
  const [lastDispatchResult, setLastDispatchResult] = useState<NotificationDispatchResponse | null>(null);
  const [lastDispatchUsedPush, setLastDispatchUsedPush] = useState<boolean | null>(null);
  const [freezeClient, setFreezeClient] = useState<User | null>(null);
  const [freezeUntilDate, setFreezeUntilDate] = useState('');
  const [statsClient, setStatsClient] = useState<User | null>(null);
  const [historyClient, setHistoryClient] = useState<User | null>(null);
  const [notesClient, setNotesClient] = useState<User | null>(null);
  const [notesText, setNotesText] = useState('');
  const deferredSearch = useDeferredValue(search);
  const canCreateClients = Boolean(userRole && clientCreateRoles.includes(userRole));
  const canResetClientPasswords = Boolean(userRole && clientResetPasswordRoles.includes(userRole));
  const readOnlyClientAccess = Boolean(userRole && !canCreateClients);

  useEffect(() => {
    setPage(1);
  }, [deferredSearch, statusFilter]);

  const { data, isLoading, isError } = useQuery<PaginatedResponse<User>>({
    queryKey: ['clients', page, deferredSearch, statusFilter],
    queryFn: async () => {
      const isChurnFilter = statusFilter === 'churn_high' || statusFilter === 'churn_medium';
      const response = await clientsApi.list({
        page,
        per_page: 10,
        ...(deferredSearch ? { search: deferredSearch } : {}),
        ...(statusFilter && !['birthday', 'churn_high', 'churn_medium'].includes(statusFilter) ? { status: statusFilter } : {}),
        ...(statusFilter === 'birthday' ? { birthday_month: true } : {}),
        ...(isChurnFilter ? { churn_risk: statusFilter === 'churn_high' ? 'high' : 'medium' } : {}),
      });
      return response.data;
    },
  });

  const createClient = useMutation({
    mutationFn: async () => {
      const payload = {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password.trim(),
        ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
        ...(form.date_of_birth ? { date_of_birth: form.date_of_birth } : {}),
      };
      const response = await clientsApi.create(payload);
      return response.data;
    },
    onSuccess: () => {
      toast.success('Cliente creado correctamente');
      setShowCreateModal(false);
      setForm(emptyForm);
      setSearch('');
      setStatusFilter('');
      setPage(1);
      queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No se pudo crear el cliente'));
    },
  });

  const updateClient = useMutation({
    mutationFn: async ({ clientId, isActive }: { clientId: string; isActive: boolean }) => {
      const response = await clientsApi.update(clientId, { is_active: isActive });
      return response.data;
    },
    onSuccess: (_, variables) => {
      toast.success(variables.isActive ? 'Cliente activado' : 'Cliente desactivado');
      queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No se pudo actualizar el cliente'));
    },
  });

  const updateContactInfo = useMutation({
    mutationFn: async ({
      clientId,
      data,
    }: {
      clientId: string;
      data: Partial<{
        first_name: string;
        last_name: string;
        email: string;
        phone: string;
        date_of_birth: string | null;
      }>;
    }) => {
      const response = await clientsApi.update(clientId, data);
      return response.data;
    },
    onSuccess: () => {
      toast.success('Ficha del cliente actualizada');
      setEditContactClient(null);
      queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No se pudo actualizar la ficha'));
    },
  });

  const resetPassword = useMutation({
    mutationFn: async ({ clientId, password }: { clientId: string; password: string }) => {
      await clientsApi.resetPassword(clientId, password);
    },
    onSuccess: () => {
      toast.success('Contraseña restablecida correctamente');
      setResetPasswordClient(null);
      setNewPassword('');
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No se pudo restablecer la contraseña'));
    },
  });

  const notifyClient = useMutation({
    mutationFn: async () => {
      const response = await notificationsApi.create({
        user_id: notificationForm.user_id,
        title: notificationForm.title,
        message: notificationForm.message || null,
        type: notificationForm.type,
        action_url: notificationForm.action_url || null,
        send_push: notificationForm.send_push,
      });
      return response.data as NotificationDispatchResponse;
    },
    onSuccess: (dispatch) => {
      const accepted = dispatch.push_deliveries.filter((delivery) => delivery.status === 'ok').length;
      setLastDispatchResult(dispatch);
      setLastDispatchUsedPush(notificationForm.send_push);

      if (!notificationForm.send_push) {
        toast.success('Notificación guardada sin enviar aviso al dispositivo.');
        return;
      }

      if (!dispatch.push_deliveries.length) {
        toast.success('Notificación creada. El cliente todavía no tiene avisos activados en su dispositivo.');
        return;
      }

      if (accepted === dispatch.push_deliveries.length) {
        toast.success(`Notificación enviada. ${accepted} entrega(s) correctas.`);
        return;
      }

      toast.success(`Notificación creada con ${accepted}/${dispatch.push_deliveries.length} entrega(s) correctas.`);
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No se pudo crear la notificación'));
    },
  });

  const refreshDispatchTracking = useMutation({
    mutationFn: async () => {
      if (!lastDispatchResult) {
        throw new Error('No hay notificacion para refrescar');
      }
      const response = await notificationsApi.getDispatch(lastDispatchResult.notification.id, {
        refresh_receipts: true,
      });
      return response.data as NotificationDispatchResponse;
    },
    onSuccess: (dispatch) => {
      setLastDispatchResult(dispatch);
      toast.success('Estado actualizado');
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.detail || error?.message || 'No se pudo actualizar el estado del aviso');
    },
  });

  type MembershipHistoryItem = {
    id: string;
    plan_name: string;
    status: string;
    starts_at: string | null;
    expires_at: string | null;
    frozen_until: string | null;
    notes: string | null;
    created_at: string;
  };

  const { data: historyData, isLoading: historyLoading } = useQuery<MembershipHistoryItem[]>({
    queryKey: ['client-membership-history', historyClient?.id],
    queryFn: async () => {
      const response = await clientsApi.membershipHistory(historyClient!.id);
      return response.data;
    },
    enabled: !!historyClient,
  });

  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ['client-stats', statsClient?.id],
    queryFn: async () => {
      const response = await clientsApi.stats(statsClient!.id);
      return response.data as {
        total_reservations: number;
        confirmed_reservations: number;
        cancelled_reservations: number;
        total_checkins: number;
        attendance_rate: number;
        last_visit: string | null;
      };
    },
    enabled: !!statsClient,
  });

  const freezeMembership = useMutation({
    mutationFn: async ({ membershipId, unfreeze }: { membershipId: string; unfreeze: boolean }) => {
      const payload = unfreeze
        ? { status: 'active', frozen_until: null }
        : { status: 'frozen', ...(freezeUntilDate ? { frozen_until: freezeUntilDate } : {}) };
      const response = await membershipsApi.update(membershipId, payload);
      return response.data;
    },
    onSuccess: (_, variables) => {
      toast.success(variables.unfreeze ? 'Membresía reactivada' : 'Membresía pausada');
      setFreezeClient(null);
      setFreezeUntilDate('');
      queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No se pudo actualizar la membresía'));
    },
  });

  const saveMembershipNotes = useMutation({
    mutationFn: async ({ membershipId }: { membershipId: string }) => {
      const response = await membershipsApi.update(membershipId, { notes: notesText || null });
      return response.data;
    },
    onSuccess: () => {
      toast.success('Nota guardada');
      setNotesClient(null);
      setNotesText('');
      queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No se pudo guardar la nota'));
    },
  });

  const items = data?.items ?? [];

  const dispatchSummary = useMemo(() => {
    if (!lastDispatchResult) {
      return null;
    }

    const accepted = lastDispatchResult.push_deliveries.filter((delivery) => delivery.status === 'ok').length;
    const receiptDelivered = lastDispatchResult.push_deliveries.filter((delivery) => delivery.receipt_status === 'ok').length;
    const receiptPending = lastDispatchResult.push_deliveries.filter((delivery) => delivery.receipt_status === 'pending').length;
    const receiptErrored = lastDispatchResult.push_deliveries.filter((delivery) => delivery.receipt_status === 'error').length;
    const errored = lastDispatchResult.push_deliveries.length - accepted;

    return {
      accepted,
      errored,
      receiptDelivered,
      receiptPending,
      receiptErrored,
      total: lastDispatchResult.push_deliveries.length,
    };
  }, [lastDispatchResult]);

  const openEditClientModal = (client: User) => {
    setActionsClient(null);
    setEditContactClient(client);
    setEditContactForm({
      first_name: client.first_name,
      last_name: client.last_name,
      email: client.email,
      phone: client.phone ?? '',
      date_of_birth: getDateInputValue(client.date_of_birth),
    });
  };

  const openResetPasswordModal = (client: User) => {
    setActionsClient(null);
    setResetPasswordClient(client);
    setNewPassword('');
    setShowNewPassword(false);
  };

  const openNotificationComposer = (client: User) => {
    setActionsClient(null);
    setNotificationForm(createNotificationForm(client));
    setLastDispatchResult(null);
    setLastDispatchUsedPush(null);
    setShowNotificationModal(true);
  };

  const exportClients = () => {
    if (!items.length) {
      toast('No hay clientes para exportar con los filtros actuales');
      return;
    }

    downloadCsv(
      `clientes-nexo-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        ['Nombre', 'Email', 'Teléfono', 'Estado', 'Registrado'],
        ...items.map((client) => [
          `${client.first_name} ${client.last_name}`,
          client.email,
          client.phone ?? '',
          client.is_active ? 'Activo' : 'Inactivo',
          formatDate(client.created_at),
        ]),
      ],
    );
    toast.success('CSV exportado');
  };

  const title = useMemo(() => {
    if (isLoading) return 'Cargando clientes...';
    return `${data?.total ?? 0} clientes registrados`;
  }, [data?.total, isLoading]);

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-6">
      <motion.div variants={fadeInUp} className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Clientes</h1>
          <p className="mt-1 text-sm text-surface-500">{title}</p>
          {readOnlyClientAccess ? (
            <p className="mt-2 text-sm text-amber-600 dark:text-amber-300">
              Tu rol puede revisar clientes y enviar notificaciones, pero solo propietario, admin o recepción pueden registrar o editar fichas.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => toast('La importación masiva aún no está conectada')}
            className="btn-ghost text-sm"
          >
            <Upload size={16} /> Importar
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={exportClients}
            className="btn-ghost text-sm"
          >
            <Download size={16} /> Exportar
          </motion.button>
          {canCreateClients ? (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setShowCreateModal(true)}
              className="btn-primary text-sm"
            >
              <Plus size={16} /> Nuevo Cliente
            </motion.button>
          ) : null}
        </div>
      </motion.div>

      <motion.div
        variants={fadeInUp}
        className="rounded-3xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Notificaciones a clientes</h2>
            <p className="mt-1 text-sm text-surface-500">
              Envía avisos a tus clientes y revisa si llegaron correctamente a su dispositivo.
            </p>
          </div>
          <div className="rounded-2xl bg-surface-50 px-4 py-3 text-sm text-surface-500 dark:bg-surface-950/60">
            Puedes enviar un aviso ahora mismo y revisar su estado desde aquí.
          </div>
        </div>
      </motion.div>

      <motion.div variants={fadeInUp} className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-surface-400" />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nombre, email o telefono..."
            className="input pl-10 text-sm"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {filters.map((filter) => {
            const Icon = filter.icon;
            return (
              <button
                key={filter.value || 'all'}
                onClick={() => setStatusFilter(filter.value)}
                className={cn(
                  'inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-200',
                  statusFilter === filter.value
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/50 dark:text-brand-300'
                    : 'text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800',
                )}
              >
                {Icon ? <Icon size={14} className="shrink-0" /> : null}
                <span>{filter.label}</span>
              </button>
            );
          })}
        </div>
      </motion.div>

      <motion.div
        variants={fadeInUp}
        className="overflow-hidden rounded-2xl border border-surface-200/50 bg-white dark:border-surface-800/50 dark:bg-surface-900"
      >
        <div className="hidden grid-cols-12 gap-4 border-b border-surface-100 bg-surface-50 px-5 py-3 text-xs font-semibold uppercase tracking-wider text-surface-500 dark:border-surface-800 dark:bg-surface-800/50 md:grid">
          <div className="col-span-4">Cliente</div>
          <div className="col-span-3">Contacto</div>
          <div className="col-span-2">Estado</div>
          <div className="col-span-1">Registrado</div>
          <div className="col-span-2 text-right">Acciones</div>
        </div>

        <div className="divide-y divide-surface-100 dark:divide-surface-800">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="grid grid-cols-1 gap-4 px-5 py-4 md:grid-cols-12">
                <div className="shimmer h-14 rounded-xl md:col-span-4" />
                <div className="shimmer h-14 rounded-xl md:col-span-3" />
                <div className="shimmer h-14 rounded-xl md:col-span-2" />
                <div className="shimmer h-14 rounded-xl md:col-span-1" />
                <div className="shimmer h-14 rounded-xl md:col-span-2" />
              </div>
            ))
          ) : null}

          {!isLoading && isError ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm text-rose-500">No pudimos cargar los clientes.</p>
            </div>
          ) : null}

          {!isLoading && !isError && !items.length ? (
            <div className="px-5 py-10 text-center">
              <Users size={28} className="mx-auto mb-3 text-surface-300 dark:text-surface-700" />
              <p className="font-medium text-surface-700 dark:text-surface-200">No hay clientes para mostrar</p>
              <p className="mt-1 text-sm text-surface-500">Prueba con otros filtros o crea un cliente nuevo.</p>
            </div>
          ) : null}

          {!isLoading && !isError
            ? items.map((client, index) => (
                <motion.div
                  key={client.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.03 }}
                  className="grid grid-cols-1 gap-4 px-5 py-4 md:grid-cols-12 md:items-center"
                >
                  <div className="col-span-4 flex items-center gap-3">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-sm font-bold text-white shadow-md">
                      {getInitials(client.first_name, client.last_name)}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-surface-900 dark:text-white">
                        {client.first_name} {client.last_name}
                      </p>
                      <p className="truncate text-xs text-surface-500">{client.email}</p>
                    </div>
                  </div>

                  <div className="col-span-3">
                    <p className="text-sm font-medium text-surface-700 dark:text-surface-300">{client.phone || 'Sin telefono'}</p>
                    <p className="text-xs text-surface-500">{client.role}</p>
                  </div>

                  <div className="col-span-2 flex flex-wrap items-center gap-1">
                    <span className={cn('badge', client.is_active ? 'badge-success' : 'badge-warning')}>
                      {client.is_active ? 'Activo' : 'Inactivo'}
                    </span>
                    {client.membership_status === 'frozen' && (
                      <span className="badge badge-info flex items-center gap-1">
                        <Snowflake size={10} />
                        Pausada
                      </span>
                    )}
                    {client.date_of_birth && (() => {
                      const dob = getDateOnlyParts(client.date_of_birth);
                      if (!dob) {
                        return null;
                      }
                      const now = new Date();
                      const currentMonth = now.getMonth() + 1;
                      const currentDay = now.getDate();
                      const isToday = dob.month === currentMonth && dob.day === currentDay;
                      const isThisMonth = dob.month === currentMonth;
                      if (isToday) {
                        return (
                          <Tooltip content="¡Cumpleaños hoy!">
                            <span className="badge bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300 flex items-center gap-1">
                              <Cake size={10} />
                              ¡Hoy!
                            </span>
                          </Tooltip>
                        );
                      }
                      if (isThisMonth) {
                        return (
                          <Tooltip content={`Cumpleaños el ${dob.day} de este mes`}>
                            <span className="badge badge-neutral flex items-center gap-1">
                              <Cake size={10} />
                              {dob.day}
                            </span>
                          </Tooltip>
                        );
                      }
                      return null;
                    })()}
                    {client.membership_expires_at && (() => {
                      const daysLeft = Math.ceil((new Date(client.membership_expires_at).getTime() - Date.now()) / 86400000);
                      if (daysLeft <= 7 && daysLeft >= 0) {
                        return (
                          <Tooltip content={`Membresía vence ${daysLeft === 0 ? 'hoy' : `en ${daysLeft} día${daysLeft === 1 ? '' : 's'}`}`}>
                            <span className="badge badge-warning flex items-center gap-1">
                              <AlertTriangle size={10} />
                              {daysLeft === 0 ? 'Vence hoy' : `${daysLeft}d`}
                            </span>
                          </Tooltip>
                        );
                      }
                      return null;
                    })()}
                    {client.churn_risk === 'high' && (
                      <Tooltip content="Alto riesgo de churn: sin actividad reciente o membresía vencida">
                        <span className="badge bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 flex items-center gap-1">
                          <TrendingDown size={10} />
                          En riesgo
                        </span>
                      </Tooltip>
                    )}
                    {client.churn_risk === 'medium' && (
                      <Tooltip content="Riesgo medio: sin actividad en más de 14 días">
                        <span className="badge bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 flex items-center gap-1">
                          <TrendingDown size={10} />
                          Riesgo
                        </span>
                      </Tooltip>
                    )}
                    {client.plan_name && (
                      <span className="badge badge-neutral inline-flex max-w-full items-center truncate" title={client.plan_name}>
                        {client.plan_name}
                      </span>
                    )}
                  </div>

                  <div className="col-span-1">
                    <span className="text-sm text-surface-500">{formatDate(client.created_at)}</span>
                  </div>

                  <div className="col-span-2 flex justify-start md:justify-end">
                    <button
                      type="button"
                      onClick={() => setActionsClient(client)}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-surface-200 bg-surface-50 px-3 py-2 text-sm font-medium text-surface-700 transition-colors hover:border-surface-300 hover:bg-white dark:border-surface-800 dark:bg-surface-950/40 dark:text-surface-200 dark:hover:bg-surface-900 md:w-auto"
                      aria-label={`Ver acciones de ${client.first_name}`}
                    >
                      <MoreHorizontal size={16} />
                      Gestionar
                    </button>
                  </div>
                </motion.div>
              ))
            : null}
        </div>

        <div className="flex items-center justify-between border-t border-surface-100 bg-surface-50 px-5 py-3 dark:border-surface-800 dark:bg-surface-800/50">
          <span className="text-sm text-surface-500">
            Pagina {data?.page ?? 1} de {Math.max(data?.pages ?? 1, 1)}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={(data?.page ?? 1) <= 1}
              className="rounded-lg p-2 transition-colors hover:bg-surface-200 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-surface-700"
            >
              <ChevronLeft size={16} className="text-surface-500" />
            </button>
            <button
              type="button"
              onClick={() => setPage((current) => current + 1)}
              disabled={(data?.page ?? 1) >= (data?.pages ?? 1)}
              className="rounded-lg p-2 transition-colors hover:bg-surface-200 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-surface-700"
            >
              <ChevronRight size={16} className="text-surface-500" />
            </button>
          </div>
        </div>
      </motion.div>

      <Modal
        open={!!actionsClient}
        size="lg"
        title={`Gestionar cliente — ${actionsClient?.first_name ?? ''} ${actionsClient?.last_name ?? ''}`}
        description="Centraliza las acciones del cliente en un solo lugar para mantener la tabla liviana."
        onClose={() => setActionsClient(null)}
      >
        {actionsClient ? (
          <div className="space-y-5">
            <div className="rounded-2xl border border-surface-200 bg-surface-50 px-4 py-4 dark:border-surface-800 dark:bg-surface-950/60">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold text-surface-900 dark:text-white">
                    {actionsClient.first_name} {actionsClient.last_name}
                  </p>
                  <p className="mt-1 text-sm text-surface-500">{actionsClient.email}</p>
                  <p className="mt-1 text-sm text-surface-500">{actionsClient.phone || 'Sin teléfono registrado'}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className={cn('badge', actionsClient.is_active ? 'badge-success' : 'badge-warning')}>
                    {actionsClient.is_active ? 'Activo' : 'Inactivo'}
                  </span>
                  {actionsClient.plan_name ? (
                    <span className="badge badge-neutral">{actionsClient.plan_name}</span>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <ClientActionTile
                icon={Bell}
                title="Enviar aviso"
                description="Crea una notificación y, si corresponde, envíala al dispositivo."
                accentClass="text-brand-600"
                onClick={() => openNotificationComposer(actionsClient)}
              />
              <ClientActionTile
                icon={BarChart2}
                title="Ver estadísticas"
                description="Revisa reservas, check-ins y asistencia del cliente."
                accentClass="text-violet-500"
                onClick={() => {
                  setActionsClient(null);
                  setStatsClient(actionsClient);
                }}
              />
              <ClientActionTile
                icon={History}
                title="Historial de membresías"
                description="Consulta planes anteriores, vencimientos y pausas."
                accentClass="text-surface-500"
                onClick={() => {
                  setActionsClient(null);
                  setHistoryClient(actionsClient);
                }}
              />
              <ClientActionTile
                icon={Mail}
                title="Enviar correo"
                description="Abre tu cliente de correo con el email del cliente."
                accentClass="text-surface-500"
                href={`mailto:${actionsClient.email}`}
              />
              <ClientActionTile
                icon={Phone}
                title="Llamar"
                description={actionsClient.phone ? 'Llama con el teléfono registrado.' : 'Este cliente todavía no tiene teléfono cargado.'}
                accentClass="text-surface-500"
                href={actionsClient.phone ? `tel:${actionsClient.phone}` : undefined}
                disabled={!actionsClient.phone}
              />
              {canCreateClients ? (
                <ClientActionTile
                  icon={Pencil}
                  title="Editar ficha"
                  description="Actualiza nombre, contacto y fecha de nacimiento."
                  accentClass="text-surface-500"
                  onClick={() => openEditClientModal(actionsClient)}
                />
              ) : null}
              {canResetClientPasswords ? (
                <ClientActionTile
                  icon={KeyRound}
                  title="Restablecer contraseña"
                  description="Define una nueva clave y cierra la sesión activa."
                  accentClass="text-surface-500"
                  onClick={() => openResetPasswordModal(actionsClient)}
                />
              ) : null}
              {canCreateClients ? (
                <ClientActionTile
                  icon={Power}
                  title={actionsClient.is_active ? 'Desactivar cliente' : 'Activar cliente'}
                  description={actionsClient.is_active ? 'Impide nuevas reservas hasta reactivarlo.' : 'Vuelve a habilitar el acceso del cliente.'}
                  accentClass={actionsClient.is_active ? 'text-amber-500' : 'text-emerald-500'}
                  onClick={() => {
                    setActionsClient(null);
                    updateClient.mutate({ clientId: actionsClient.id, isActive: !actionsClient.is_active });
                  }}
                />
              ) : null}
              {canCreateClients && actionsClient.membership_id && (actionsClient.membership_status === 'active' || actionsClient.membership_status === 'frozen') ? (
                <ClientActionTile
                  icon={actionsClient.membership_status === 'frozen' ? PlayCircle : Snowflake}
                  title={actionsClient.membership_status === 'frozen' ? 'Reactivar membresía' : 'Pausar membresía'}
                  description={actionsClient.membership_status === 'frozen' ? 'Vuelve a dejar la membresía activa de inmediato.' : 'Pausa la membresía sin salir de esta vista.'}
                  accentClass={actionsClient.membership_status === 'frozen' ? 'text-emerald-500' : 'text-sky-400'}
                  onClick={() => {
                    setActionsClient(null);
                    setFreezeClient(actionsClient);
                    setFreezeUntilDate('');
                  }}
                />
              ) : null}
              {canCreateClients && actionsClient.membership_id ? (
                <ClientActionTile
                  icon={FileText}
                  title={actionsClient.membership_notes ? 'Editar nota de membresía' : 'Agregar nota de membresía'}
                  description="Guarda contexto interno visible solo para el equipo."
                  accentClass={actionsClient.membership_notes ? 'text-amber-400' : 'text-surface-500'}
                  onClick={() => {
                    setActionsClient(null);
                    setNotesClient(actionsClient);
                    setNotesText(actionsClient.membership_notes ?? '');
                  }}
                />
              ) : null}
            </div>

            <div className="flex justify-end">
              <button type="button" className="btn-secondary" onClick={() => setActionsClient(null)}>
                Cerrar
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={showCreateModal}
        title="Nuevo cliente"
        description="Registra un nuevo cliente para gestionar sus reservas, pagos y asistencia."
        onClose={() => {
          if (!createClient.isPending) {
            setShowCreateModal(false);
          }
        }}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            createClient.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Nombre</label>
              <input
                className="input"
                value={form.first_name}
                onChange={(event) => setForm((current) => ({ ...current, first_name: event.target.value }))}
                required
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Apellido</label>
              <input
                className="input"
                value={form.last_name}
                onChange={(event) => setForm((current) => ({ ...current, last_name: event.target.value }))}
                required
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Email</label>
              <input
                type="email"
                className="input"
                value={form.email}
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                required
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Teléfono</label>
              <input
                className="input"
                value={form.phone}
                onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Fecha de nacimiento</label>
            <input
              type="date"
              className="input"
              value={form.date_of_birth}
              onChange={(event) => setForm((current) => ({ ...current, date_of_birth: event.target.value }))}
            />
            <p className="mt-1 text-xs text-surface-500">Opcional. Sirve para filtros y recordatorios de cumpleaños.</p>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Contraseña inicial</label>
            <input
              type="text"
              className="input"
              value={form.password}
              onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
              required
            />
            <p className="mt-1 text-xs text-surface-500">Debe tener al menos 8 caracteres, una mayúscula y un número.</p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setShowCreateModal(false)}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={createClient.isPending}>
              {createClient.isPending ? 'Creando...' : 'Crear cliente'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal editar ficha */}
      <Modal
        open={!!editContactClient}
        title={`Editar ficha — ${editContactClient?.first_name ?? ''} ${editContactClient?.last_name ?? ''}`}
        description="Actualiza datos básicos del cliente y su fecha de nacimiento si la tienes."
        onClose={() => !updateContactInfo.isPending && setEditContactClient(null)}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!editContactClient) return;
            const payload: Partial<{
              first_name: string;
              last_name: string;
              email: string;
              phone: string;
              date_of_birth: string | null;
            }> = {};
            const firstName = editContactForm.first_name.trim();
            const lastName = editContactForm.last_name.trim();
            const email = editContactForm.email.trim().toLowerCase();
            const phone = editContactForm.phone.trim();
            const currentDateOfBirth = getDateInputValue(editContactClient.date_of_birth);
            const nextDateOfBirth = editContactForm.date_of_birth.trim();

            if (firstName !== editContactClient.first_name) payload.first_name = firstName;
            if (lastName !== editContactClient.last_name) payload.last_name = lastName;
            if (email !== editContactClient.email) payload.email = email;
            if (phone !== (editContactClient.phone ?? '')) payload.phone = phone;
            if (nextDateOfBirth !== currentDateOfBirth) payload.date_of_birth = nextDateOfBirth || null;
            if (!Object.keys(payload).length) {
              setEditContactClient(null);
              return;
            }
            updateContactInfo.mutate({ clientId: editContactClient.id, data: payload });
          }}
          className="space-y-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">
                Nombre
              </label>
              <input
                className="input"
                value={editContactForm.first_name}
                onChange={(e) => setEditContactForm((f) => ({ ...f, first_name: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">
                Apellido
              </label>
              <input
                className="input"
                value={editContactForm.last_name}
                onChange={(e) => setEditContactForm((f) => ({ ...f, last_name: e.target.value }))}
                required
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">
                Correo electrónico
              </label>
              <input
                type="email"
                className="input"
                value={editContactForm.email}
                onChange={(e) => setEditContactForm((f) => ({ ...f, email: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">
                Teléfono
              </label>
              <input
                type="tel"
                className="input"
                value={editContactForm.phone}
                onChange={(e) => setEditContactForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="+56 9 1234 5678"
              />
            </div>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">
              Fecha de nacimiento
            </label>
            <input
              type="date"
              className="input"
              value={editContactForm.date_of_birth}
              onChange={(e) => setEditContactForm((f) => ({ ...f, date_of_birth: e.target.value }))}
            />
            <p className="mt-1 text-xs text-surface-500">
              Opcional. Puedes dejarla vacía o quitarla si no quieres registrarla.
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setEditContactClient(null)}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={updateContactInfo.isPending}>
              {updateContactInfo.isPending ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal restablecer contraseña */}
      <Modal
        open={!!resetPasswordClient}
        title={`Restablecer contraseña — ${resetPasswordClient?.first_name ?? ''} ${resetPasswordClient?.last_name ?? ''}`}
        onClose={() => !resetPassword.isPending && setResetPasswordClient(null)}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!resetPasswordClient) return;
            resetPassword.mutate({ clientId: resetPasswordClient.id, password: newPassword });
          }}
          className="space-y-4"
        >
          <p className="text-sm text-surface-500 dark:text-surface-400">
            La sesión activa del cliente será cerrada al guardar.
          </p>
          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">
              Nueva contraseña
            </label>
            <div className="relative">
              <input
                type={showNewPassword ? 'text' : 'password'}
                className="input pr-10"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={6}
                required
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowNewPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-600"
              >
                {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setResetPasswordClient(null)}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={resetPassword.isPending || newPassword.length < 6}>
              {resetPassword.isPending ? 'Guardando...' : 'Restablecer contraseña'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={showNotificationModal}
        size="lg"
        title="Nueva notificación al cliente"
        description="Crea un aviso para este cliente y, si tiene notificaciones activadas, intenta enviarlo también a su dispositivo."
        onClose={() => {
          if (!notifyClient.isPending) {
            setShowNotificationModal(false);
          }
        }}
      >
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            notifyClient.mutate();
          }}
        >
          <div className="rounded-2xl border border-surface-200 bg-surface-50 px-4 py-4 dark:border-surface-800 dark:bg-surface-950/60">
            <p className="text-sm font-semibold text-surface-900 dark:text-white">{notificationForm.client_name || 'Cliente seleccionado'}</p>
            <p className="mt-1 text-sm text-surface-500">{notificationForm.client_email || 'Sin email cargado'}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Título</label>
              <input
                className="input"
                value={notificationForm.title}
                onChange={(event) =>
                  setNotificationForm((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                required
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Tipo</label>
              <select
                className="input"
                value={notificationForm.type}
                onChange={(event) =>
                  setNotificationForm((current) => ({
                    ...current,
                    type: event.target.value as AppNotification['type'],
                  }))
                }
              >
                <option value="info">info</option>
                <option value="success">success</option>
                <option value="warning">warning</option>
                <option value="error">error</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Mensaje</label>
            <textarea
              className="input min-h-32 resize-y"
              value={notificationForm.message}
              onChange={(event) =>
                setNotificationForm((current) => ({
                  ...current,
                  message: event.target.value,
                }))
              }
              placeholder="Ejemplo: Tu pago fue confirmado. Toca para revisar tu wallet."
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Abrir al tocar el aviso</label>
            <input
              className="input"
              value={notificationForm.action_url}
              onChange={(event) =>
                setNotificationForm((current) => ({
                  ...current,
                  action_url: event.target.value,
                }))
              }
              placeholder="Elige una sección sugerida o ingresa un destino personalizado"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              {notificationActionPresets.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() =>
                    setNotificationForm((current) => ({
                      ...current,
                      action_url: preset.value,
                    }))
                  }
                  className={cn(
                    'rounded-xl px-3 py-2 text-sm transition-colors',
                    notificationForm.action_url === preset.value
                      ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300'
                      : 'bg-surface-100 text-surface-600 hover:bg-surface-200 dark:bg-surface-900 dark:text-surface-300 dark:hover:bg-surface-800',
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-3 rounded-2xl border border-surface-200 px-4 py-3 dark:border-surface-800">
            <input
              type="checkbox"
              checked={notificationForm.send_push}
              onChange={(event) =>
                setNotificationForm((current) => ({
                  ...current,
                  send_push: event.target.checked,
                }))
              }
            />
            <span className="text-sm text-surface-700 dark:text-surface-300">Intentar enviar este aviso al dispositivo del cliente, además de guardarlo en su bandeja</span>
          </label>

          {lastDispatchResult ? (
            <div className="space-y-4 rounded-3xl border border-surface-200/60 bg-surface-50 p-5 dark:border-surface-800/60 dark:bg-surface-950/60">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-base font-semibold text-surface-900 dark:text-white">Resultado del último envío</h3>
                  <p className="mt-1 text-sm text-surface-500">
                    {lastDispatchResult.notification.title} · {formatDateTime(lastDispatchResult.notification.created_at)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {lastDispatchResult.push_deliveries.length ? (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => refreshDispatchTracking.mutate()}
                      disabled={refreshDispatchTracking.isPending}
                    >
                      <RefreshCcw size={14} className={cn(refreshDispatchTracking.isPending ? 'animate-spin' : '')} />
                      {refreshDispatchTracking.isPending ? 'Actualizando...' : 'Actualizar estado'}
                    </button>
                  ) : null}
                  <span className={cn('badge', dispatchSummary?.receiptErrored ? 'badge-warning' : dispatchSummary?.receiptPending ? 'badge-info' : 'badge-success')}>
                    {dispatchSummary?.total
                      ? `${dispatchSummary.accepted}/${dispatchSummary.total} entrega(s) correctas`
                      : lastDispatchUsedPush
                        ? 'Sin entregas'
                        : 'Solo bandeja'}
                  </span>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-4">
                <div className="rounded-2xl bg-white px-4 py-4 dark:bg-surface-900">
                  <p className="text-sm text-surface-500">Envíos correctos</p>
                  <p className="mt-2 text-2xl font-bold font-display text-surface-900 dark:text-white">{dispatchSummary?.accepted ?? 0}</p>
                </div>
                <div className="rounded-2xl bg-white px-4 py-4 dark:bg-surface-900">
                  <p className="text-sm text-surface-500">Entregas confirmadas</p>
                  <p className="mt-2 text-2xl font-bold font-display text-surface-900 dark:text-white">{dispatchSummary?.receiptDelivered ?? 0}</p>
                </div>
                <div className="rounded-2xl bg-white px-4 py-4 dark:bg-surface-900">
                  <p className="text-sm text-surface-500">Entregas pendientes</p>
                  <p className="mt-2 text-2xl font-bold font-display text-surface-900 dark:text-white">{dispatchSummary?.receiptPending ?? 0}</p>
                </div>
                <div className="rounded-2xl bg-white px-4 py-4 dark:bg-surface-900">
                  <p className="text-sm text-surface-500">Abrir en</p>
                  <p className="mt-2 truncate text-sm font-semibold text-surface-900 dark:text-white">
                    {lastDispatchResult.notification.action_url || 'Sin destino configurado'}
                  </p>
                </div>
              </div>

              {lastDispatchResult.push_deliveries.length ? (
                <div className="space-y-3">
                  {lastDispatchResult.push_deliveries.map((delivery) => (
                    <div
                      key={delivery.subscription_id}
                      className="rounded-2xl border border-surface-200/60 bg-white px-4 py-4 dark:border-surface-800/60 dark:bg-surface-900"
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-surface-900 dark:text-white">
                              {delivery.ticket_id || delivery.subscription_id}
                            </p>
                            <span className="badge badge-neutral">{getPushProviderLabel(delivery.provider)}</span>
                          </div>
                          <p className="mt-1 break-all text-xs text-surface-500">{getPushTargetLabel(delivery)}</p>
                          {delivery.receipt_checked_at ? (
                            <p className="mt-1 text-xs text-surface-500">Último comprobante: {formatDateTime(delivery.receipt_checked_at)}</p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <span className={cn('badge', delivery.status === 'ok' ? 'badge-success' : 'badge-danger')}>
                            {delivery.status === 'ok' ? 'Enviado' : 'Con problema'}
                          </span>
                          {delivery.receipt_status ? (
                            <span className={cn('badge', delivery.receipt_status === 'ok' ? 'badge-success' : delivery.receipt_status === 'pending' ? 'badge-info' : 'badge-warning')}>
                              {delivery.receipt_status === 'ok' ? 'Confirmado' : delivery.receipt_status === 'pending' ? 'Pendiente' : 'Con problema'}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <p className="mt-3 text-sm text-surface-500">
                        {delivery.receipt_error
                          || delivery.receipt_message
                          || delivery.error
                          || delivery.message
                          || (delivery.receipt_status === 'pending'
                            ? 'El aviso fue enviado y estamos esperando la confirmación final.'
                            : delivery.is_active
                              ? 'Los avisos siguen activos en este dispositivo.'
                              : 'Este dispositivo ya no recibe avisos.')}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-surface-300 px-4 py-6 text-sm text-surface-500 dark:border-surface-700">
                  {lastDispatchUsedPush
                    ? 'Este cliente todavía no tiene notificaciones activadas en su dispositivo.'
                    : 'El aviso se guardó solo en la bandeja del cliente.'}
                </div>
              )}
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setShowNotificationModal(false)}>
              Cerrar
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={notifyClient.isPending || !notificationForm.user_id || !notificationForm.title.trim()}
            >
              {notifyClient.isPending ? 'Enviando...' : notificationForm.send_push ? 'Guardar y enviar aviso' : 'Crear notificación'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal historial de planes/membresías */}
      <Modal
        open={!!historyClient}
        title={`Historial de membresías — ${historyClient?.first_name ?? ''} ${historyClient?.last_name ?? ''}`}
        onClose={() => setHistoryClient(null)}
      >
        {historyLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="shimmer h-16 rounded-2xl" />)}
          </div>
        ) : !historyData?.length ? (
          <p className="py-6 text-center text-sm text-surface-400">Este cliente no tiene membresías registradas.</p>
        ) : (
          <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
            {historyData.map((m) => (
              <div key={m.id} className="rounded-2xl border border-surface-200/60 px-4 py-4 dark:border-surface-800/60">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-surface-900 dark:text-white">{m.plan_name}</p>
                    <p className="mt-0.5 text-xs text-surface-500">
                      {m.starts_at ? `Desde ${formatDate(m.starts_at)}` : 'Sin fecha inicio'}
                      {m.expires_at ? ` · Vence ${formatDate(m.expires_at)}` : ''}
                    </p>
                    {m.notes && (
                      <p className="mt-2 text-xs text-amber-600 dark:text-amber-400 italic">"{m.notes}"</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className={cn('badge',
                      m.status === 'active' ? 'badge-success' :
                      m.status === 'frozen' ? 'badge-info' :
                      m.status === 'expired' ? 'badge-warning' :
                      m.status === 'cancelled' ? 'badge-danger' : 'badge-neutral'
                    )}>
                      {m.status === 'active' ? 'Activa' : m.status === 'frozen' ? 'Pausada' : m.status === 'expired' ? 'Vencida' : m.status === 'cancelled' ? 'Cancelada' : m.status}
                    </span>
                    {m.frozen_until && (
                      <span className="text-xs text-surface-400">Hasta {formatDate(m.frozen_until)}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <button type="button" className="btn-secondary" onClick={() => setHistoryClient(null)}>Cerrar</button>
        </div>
      </Modal>

      {/* Modal estadísticas de asistencia */}
      <Modal
        open={!!statsClient}
        title={`Estadísticas — ${statsClient?.first_name ?? ''} ${statsClient?.last_name ?? ''}`}
        onClose={() => setStatsClient(null)}
      >
        {statsLoading ? (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="shimmer h-20 rounded-2xl" />
            ))}
          </div>
        ) : statsData ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-2xl bg-surface-50 px-4 py-4 dark:bg-surface-800/60">
                <p className="text-xs text-surface-500">Reservas confirmadas</p>
                <p className="mt-2 text-2xl font-bold font-display text-surface-900 dark:text-white">{statsData.confirmed_reservations}</p>
              </div>
              <div className="rounded-2xl bg-surface-50 px-4 py-4 dark:bg-surface-800/60">
                <p className="text-xs text-surface-500">Check-ins realizados</p>
                <p className="mt-2 text-2xl font-bold font-display text-surface-900 dark:text-white">{statsData.total_checkins}</p>
              </div>
              <div className="rounded-2xl bg-surface-50 px-4 py-4 dark:bg-surface-800/60">
                <p className="text-xs text-surface-500">Tasa de asistencia</p>
                <p className={cn('mt-2 text-2xl font-bold font-display', statsData.attendance_rate >= 70 ? 'text-emerald-600 dark:text-emerald-400' : statsData.attendance_rate >= 40 ? 'text-amber-500' : 'text-rose-500')}>
                  {statsData.attendance_rate}%
                </p>
              </div>
              <div className="rounded-2xl bg-surface-50 px-4 py-4 dark:bg-surface-800/60">
                <p className="text-xs text-surface-500">Total reservas</p>
                <p className="mt-2 text-2xl font-bold font-display text-surface-900 dark:text-white">{statsData.total_reservations}</p>
              </div>
              <div className="rounded-2xl bg-surface-50 px-4 py-4 dark:bg-surface-800/60">
                <p className="text-xs text-surface-500">Cancelaciones</p>
                <p className="mt-2 text-2xl font-bold font-display text-surface-900 dark:text-white">{statsData.cancelled_reservations}</p>
              </div>
              <div className="rounded-2xl bg-surface-50 px-4 py-4 dark:bg-surface-800/60">
                <p className="text-xs text-surface-500">Última visita</p>
                <p className="mt-2 text-sm font-semibold text-surface-900 dark:text-white">
                  {statsData.last_visit ? formatDate(statsData.last_visit) : 'Sin registros'}
                </p>
              </div>
            </div>
            {statsData.confirmed_reservations > 0 && (
              <div>
                <div className="mb-1 flex items-center justify-between text-xs text-surface-500">
                  <span>Asistencia</span>
                  <span>{statsData.total_checkins}/{statsData.confirmed_reservations}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-surface-200 dark:bg-surface-700">
                  <div
                    className={cn('h-full rounded-full transition-all', statsData.attendance_rate >= 70 ? 'bg-emerald-500' : statsData.attendance_rate >= 40 ? 'bg-amber-400' : 'bg-rose-500')}
                    style={{ width: `${Math.min(statsData.attendance_rate, 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        ) : null}
        <div className="mt-4 flex justify-end">
          <button type="button" className="btn-secondary" onClick={() => setStatsClient(null)}>Cerrar</button>
        </div>
      </Modal>

      {/* Modal notas de membresía */}
      <Modal
        open={!!notesClient}
        title={`Nota de membresía — ${notesClient?.first_name ?? ''} ${notesClient?.last_name ?? ''}`}
        onClose={() => !saveMembershipNotes.isPending && setNotesClient(null)}
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!notesClient?.membership_id) return;
            saveMembershipNotes.mutate({ membershipId: notesClient.membership_id });
          }}
        >
          <p className="text-sm text-surface-500 dark:text-surface-400">
            Estas notas son solo visibles para el equipo del gimnasio. El cliente no las verá.
          </p>
          <textarea
            className="input min-h-32 resize-y"
            value={notesText}
            onChange={(e) => setNotesText(e.target.value)}
            placeholder="Ej: Solicitó no hacer squats por lesión de rodilla. Renovar en junio..."
            maxLength={2000}
          />
          <p className="text-xs text-surface-400 text-right">{notesText.length}/2000</p>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setNotesClient(null)}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={saveMembershipNotes.isPending}>
              {saveMembershipNotes.isPending ? 'Guardando...' : 'Guardar nota'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal pausar / reactivar membresía */}
      <Modal
        open={!!freezeClient}
        title={
          freezeClient?.membership_status === 'frozen'
            ? `Reactivar membresía — ${freezeClient?.first_name ?? ''} ${freezeClient?.last_name ?? ''}`
            : `Pausar membresía — ${freezeClient?.first_name ?? ''} ${freezeClient?.last_name ?? ''}`
        }
        onClose={() => !freezeMembership.isPending && setFreezeClient(null)}
      >
        {freezeClient?.membership_status === 'frozen' ? (
          <div className="space-y-4">
            <p className="text-sm text-surface-500 dark:text-surface-400">
              La membresía de <strong className="text-surface-900 dark:text-white">{freezeClient.first_name} {freezeClient.last_name}</strong> está
              actualmente pausada. Al reactivarla quedará en estado <strong>activo</strong> de inmediato.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setFreezeClient(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={freezeMembership.isPending}
                onClick={() => freezeClient.membership_id && freezeMembership.mutate({ membershipId: freezeClient.membership_id, unfreeze: true })}
              >
                {freezeMembership.isPending ? 'Reactivando...' : 'Reactivar membresía'}
              </button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!freezeClient?.membership_id) return;
              freezeMembership.mutate({ membershipId: freezeClient.membership_id, unfreeze: false });
            }}
          >
            <p className="text-sm text-surface-500 dark:text-surface-400">
              Pausa la membresía de <strong className="text-surface-900 dark:text-white">{freezeClient?.first_name} {freezeClient?.last_name}</strong>.
              El cliente no podrá reservar clases mientras esté pausada.
            </p>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">
                Pausar hasta (opcional)
              </label>
              <input
                type="date"
                className="input"
                value={freezeUntilDate}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setFreezeUntilDate(e.target.value)}
              />
              <p className="mt-1 text-xs text-surface-500">
                Si no se indica fecha, la membresía quedará pausada indefinidamente.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setFreezeClient(null)}>
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={freezeMembership.isPending}>
                {freezeMembership.isPending ? 'Pausando...' : 'Pausar membresía'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </motion.div>
  );
}

type ClientActionTileProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  accentClass?: string;
  disabled?: boolean;
  href?: string;
  onClick?: () => void;
};

function ClientActionTile({
  icon: Icon,
  title,
  description,
  accentClass = 'text-surface-500',
  disabled = false,
  href,
  onClick,
}: ClientActionTileProps) {
  const className = cn(
    'rounded-2xl border border-surface-200 bg-white p-4 text-left transition-colors dark:border-surface-800 dark:bg-surface-950/20',
    disabled
      ? 'cursor-not-allowed opacity-50'
      : 'hover:border-surface-300 hover:bg-surface-50 dark:hover:bg-surface-900',
  );

  const content = (
    <>
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-surface-100 p-2 dark:bg-surface-900">
          <Icon size={18} className={accentClass} />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-surface-900 dark:text-white">{title}</p>
          <p className="mt-1 text-sm text-surface-500">{description}</p>
        </div>
      </div>
    </>
  );

  if (href && !disabled) {
    return (
      <a href={href} className={className} onClick={onClick}>
        {content}
      </a>
    );
  }

  return (
    <button type="button" className={className} onClick={onClick} disabled={disabled}>
      {content}
    </button>
  );
}
