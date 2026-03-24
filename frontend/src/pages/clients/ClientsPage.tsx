import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  Download,
  Mail,
  Phone,
  Plus,
  Power,
  RefreshCcw,
  Search,
  Upload,
  Users,
} from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { clientsApi, notificationsApi } from '@/services/api';
import { fadeInUp, staggerContainer } from '@/utils/animations';
import { cn, formatDate, formatDateTime, getInitials } from '@/utils';
import type { AppNotification, NotificationDispatchResponse, PaginatedResponse, User } from '@/types';

const filters = [
  { label: 'Todos', value: '' },
  { label: 'Activos', value: 'active' },
  { label: 'Inactivos', value: 'inactive' },
];

const notificationActionPresets = [
  { label: 'Perfil', value: 'nexofitness://account/profile' },
  { label: 'Pagos', value: 'nexofitness://payments' },
  { label: 'Agenda', value: 'nexofitness://agenda' },
  { label: 'Checkout', value: 'nexofitness://store' },
];

const emptyForm = {
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  password: 'Client123!',
};

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
    title: client ? `Actualizacion para ${client.first_name}` : 'Actualizacion de tu cuenta',
    message: '',
    type: 'info',
    action_url: 'nexofitness://account/profile',
    send_push: true,
  };
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
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showNotificationModal, setShowNotificationModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [notificationForm, setNotificationForm] = useState<NotificationForm>(createNotificationForm());
  const [lastDispatchResult, setLastDispatchResult] = useState<NotificationDispatchResponse | null>(null);
  const [lastDispatchUsedPush, setLastDispatchUsedPush] = useState<boolean | null>(null);
  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    setPage(1);
  }, [deferredSearch, statusFilter]);

  const { data, isLoading, isError } = useQuery<PaginatedResponse<User>>({
    queryKey: ['clients', page, deferredSearch, statusFilter],
    queryFn: async () => {
      const response = await clientsApi.list({
        page,
        per_page: 10,
        ...(deferredSearch ? { search: deferredSearch } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
      });
      return response.data;
    },
  });

  const createClient = useMutation({
    mutationFn: async () => {
      const response = await clientsApi.create(form);
      return response.data;
    },
    onSuccess: () => {
      toast.success('Cliente creado correctamente');
      setShowCreateModal(false);
      setForm(emptyForm);
      queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.detail || 'No se pudo crear el cliente');
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
      toast.error(error?.response?.data?.detail || 'No se pudo actualizar el cliente');
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
        toast.success('Notificacion creada en bandeja sin envio push');
        return;
      }

      if (!dispatch.push_deliveries.length) {
        toast.success('Notificacion creada. El cliente no tenia subscriptions push activas.');
        return;
      }

      if (accepted === dispatch.push_deliveries.length) {
        toast.success(`Notificacion enviada. Expo acepto ${accepted} delivery(s).`);
        return;
      }

      toast.success(`Notificacion creada con ${accepted}/${dispatch.push_deliveries.length} delivery(s) aceptadas.`);
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.detail || 'No se pudo crear la notificacion');
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
      toast.success('Tracking Expo actualizado');
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.detail || error?.message || 'No se pudo refrescar el tracking push');
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

  const exportClients = () => {
    if (!items.length) {
      toast('No hay clientes para exportar con los filtros actuales');
      return;
    }

    downloadCsv(
      `clientes-nexo-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        ['Nombre', 'Email', 'Telefono', 'Estado', 'Registrado'],
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
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => toast('La importacion masiva aun no esta conectada')}
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
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowCreateModal(true)}
            className="btn-primary text-sm"
          >
            <Plus size={16} /> Nuevo Cliente
          </motion.button>
        </div>
      </motion.div>

      <motion.div
        variants={fadeInUp}
        className="rounded-3xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Composer de notificaciones</h2>
            <p className="mt-1 text-sm text-surface-500">
              Desde cada cliente ya puedes crear una notificacion real en backend y, si existe subscription activa, disparar la push via Expo con feedback inmediato.
            </p>
          </div>
          <div className="rounded-2xl bg-surface-50 px-4 py-3 text-sm text-surface-500 dark:bg-surface-950/60">
            Endpoint activo: <span className="font-mono text-xs text-surface-700 dark:text-surface-300">POST /api/v1/notifications</span>
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
          {filters.map((filter) => (
            <button
              key={filter.label}
              onClick={() => setStatusFilter(filter.value)}
              className={cn(
                'px-3 py-2 rounded-xl text-sm font-medium transition-all duration-200',
                statusFilter === filter.value
                  ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/50 dark:text-brand-300'
                  : 'text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800',
              )}
            >
              {filter.label}
            </button>
          ))}
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

                  <div className="col-span-2">
                    <span className={cn('badge', client.is_active ? 'badge-success' : 'badge-warning')}>
                      {client.is_active ? 'Activo' : 'Inactivo'}
                    </span>
                  </div>

                  <div className="col-span-1">
                    <span className="text-sm text-surface-500">{formatDate(client.created_at)}</span>
                  </div>

                  <div className="col-span-2 flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setNotificationForm(createNotificationForm(client));
                        setLastDispatchResult(null);
                        setLastDispatchUsedPush(null);
                        setShowNotificationModal(true);
                      }}
                      className="rounded-lg p-2 transition-colors hover:bg-surface-100 dark:hover:bg-surface-800"
                      aria-label={`Enviar notificacion a ${client.first_name}`}
                    >
                      <Bell size={15} className="text-brand-500" />
                    </button>
                    <a
                      href={`mailto:${client.email}`}
                      className="rounded-lg p-2 transition-colors hover:bg-surface-100 dark:hover:bg-surface-800"
                      aria-label={`Enviar correo a ${client.first_name}`}
                    >
                      <Mail size={15} className="text-surface-400" />
                    </a>
                    <a
                      href={client.phone ? `tel:${client.phone}` : undefined}
                      className={cn(
                        'rounded-lg p-2 transition-colors hover:bg-surface-100 dark:hover:bg-surface-800',
                        !client.phone && 'pointer-events-none opacity-40',
                      )}
                      aria-label={`Llamar a ${client.first_name}`}
                    >
                      <Phone size={15} className="text-surface-400" />
                    </a>
                    <button
                      type="button"
                      onClick={() => updateClient.mutate({ clientId: client.id, isActive: !client.is_active })}
                      className="rounded-lg p-2 transition-colors hover:bg-surface-100 dark:hover:bg-surface-800"
                      aria-label={client.is_active ? 'Desactivar cliente' : 'Activar cliente'}
                    >
                      <Power size={15} className={client.is_active ? 'text-amber-500' : 'text-emerald-500'} />
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
        open={showCreateModal}
        title="Nuevo cliente"
        description="Crea un cliente real en el backend para que aparezca en la tabla y pueda reservar o hacer check-in."
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
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Telefono</label>
              <input
                className="input"
                value={form.phone}
                onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Contrasena inicial</label>
            <input
              type="text"
              className="input"
              value={form.password}
              onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
              required
            />
            <p className="mt-1 text-xs text-surface-500">Debe tener al menos 8 caracteres, una mayuscula y un numero.</p>
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

      <Modal
        open={showNotificationModal}
        size="lg"
        title="Nueva notificacion al cliente"
        description="Crea la notificacion en backend y, si el cliente tiene subscriptions activas, dispara la push via Expo con el mismo action_url que consume mobile."
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
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Titulo</label>
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
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Action URL</label>
            <input
              className="input"
              value={notificationForm.action_url}
              onChange={(event) =>
                setNotificationForm((current) => ({
                  ...current,
                  action_url: event.target.value,
                }))
              }
              placeholder="nexofitness://account/profile"
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
            <span className="text-sm text-surface-700 dark:text-surface-300">Intentar envio push remoto via Expo ademas de crear la notificacion en bandeja</span>
          </label>

          {lastDispatchResult ? (
            <div className="space-y-4 rounded-3xl border border-surface-200/60 bg-surface-50 p-5 dark:border-surface-800/60 dark:bg-surface-950/60">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-base font-semibold text-surface-900 dark:text-white">Resultado del ultimo envio</h3>
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
                      {refreshDispatchTracking.isPending ? 'Refrescando...' : 'Refrescar tracking'}
                    </button>
                  ) : null}
                  <span className={cn('badge', dispatchSummary?.receiptErrored ? 'badge-warning' : dispatchSummary?.receiptPending ? 'badge-info' : 'badge-success')}>
                    {dispatchSummary?.total
                      ? `${dispatchSummary.accepted}/${dispatchSummary.total} ticket(s) aceptados`
                      : lastDispatchUsedPush
                        ? 'Sin deliveries'
                        : 'Solo bandeja'}
                  </span>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-4">
                <div className="rounded-2xl bg-white px-4 py-4 dark:bg-surface-900">
                  <p className="text-sm text-surface-500">Tickets ok</p>
                  <p className="mt-2 text-2xl font-bold font-display text-surface-900 dark:text-white">{dispatchSummary?.accepted ?? 0}</p>
                </div>
                <div className="rounded-2xl bg-white px-4 py-4 dark:bg-surface-900">
                  <p className="text-sm text-surface-500">Receipts ok</p>
                  <p className="mt-2 text-2xl font-bold font-display text-surface-900 dark:text-white">{dispatchSummary?.receiptDelivered ?? 0}</p>
                </div>
                <div className="rounded-2xl bg-white px-4 py-4 dark:bg-surface-900">
                  <p className="text-sm text-surface-500">Receipts pendientes</p>
                  <p className="mt-2 text-2xl font-bold font-display text-surface-900 dark:text-white">{dispatchSummary?.receiptPending ?? 0}</p>
                </div>
                <div className="rounded-2xl bg-white px-4 py-4 dark:bg-surface-900">
                  <p className="text-sm text-surface-500">Destino</p>
                  <p className="mt-2 truncate text-sm font-semibold text-surface-900 dark:text-white">
                    {lastDispatchResult.notification.action_url || 'Sin deep link'}
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
                          <p className="text-sm font-semibold text-surface-900 dark:text-white">
                            {delivery.ticket_id || delivery.subscription_id}
                          </p>
                          <p className="mt-1 break-all text-xs text-surface-500">{delivery.expo_push_token}</p>
                          {delivery.receipt_checked_at ? (
                            <p className="mt-1 text-xs text-surface-500">Ultimo receipt: {formatDateTime(delivery.receipt_checked_at)}</p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <span className={cn('badge', delivery.status === 'ok' ? 'badge-success' : 'badge-danger')}>
                            ticket {delivery.status}
                          </span>
                          {delivery.receipt_status ? (
                            <span className={cn('badge', delivery.receipt_status === 'ok' ? 'badge-success' : delivery.receipt_status === 'pending' ? 'badge-info' : 'badge-warning')}>
                              receipt {delivery.receipt_status}
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
                            ? 'Ticket aceptado por Expo. Receipt aun pendiente.'
                            : delivery.is_active
                              ? 'Subscription sigue activa.'
                              : 'Subscription marcada como inactiva.')}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-surface-300 px-4 py-6 text-sm text-surface-500 dark:border-surface-700">
                  {lastDispatchUsedPush
                    ? 'No hubo deliveries push para este cliente. Esto suele indicar que todavia no registro un Expo push token activo en mobile.'
                    : 'El envio push se omitio intencionalmente y la notificacion quedo solo en bandeja.'}
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
              {notifyClient.isPending ? 'Enviando...' : notificationForm.send_push ? 'Crear y enviar push' : 'Crear notificacion'}
            </button>
          </div>
        </form>
      </Modal>
    </motion.div>
  );
}
