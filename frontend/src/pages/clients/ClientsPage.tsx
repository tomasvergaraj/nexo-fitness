import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  Users, Plus, Search, Download, Upload, Mail, Phone, ChevronLeft, ChevronRight, Power,
} from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { clientsApi } from '@/services/api';
import { staggerContainer, fadeInUp } from '@/utils/animations';
import { cn, formatDate, getInitials } from '@/utils';
import type { PaginatedResponse, User } from '@/types';

const filters = [
  { label: 'Todos', value: '' },
  { label: 'Activos', value: 'active' },
  { label: 'Inactivos', value: 'inactive' },
];

const emptyForm = {
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  password: 'Client123!',
};

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows
        .map((row) =>
          row
            .map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`)
            .join(','))
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
  const [form, setForm] = useState(emptyForm);
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

  const items = data?.items ?? [];

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

      <motion.div variants={fadeInUp} className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-surface-400" />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nombre, email o teléfono..."
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
          <div className="col-span-2">Registrado</div>
          <div className="col-span-1 text-right">Acciones</div>
        </div>

        <div className="divide-y divide-surface-100 dark:divide-surface-800">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="grid grid-cols-1 gap-4 px-5 py-4 md:grid-cols-12">
                <div className="shimmer h-14 rounded-xl md:col-span-4" />
                <div className="shimmer h-14 rounded-xl md:col-span-3" />
                <div className="shimmer h-14 rounded-xl md:col-span-2" />
                <div className="shimmer h-14 rounded-xl md:col-span-2" />
                <div className="shimmer h-14 rounded-xl md:col-span-1" />
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

          {!isLoading && !isError ? items.map((client, index) => (
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
                <p className="text-sm font-medium text-surface-700 dark:text-surface-300">{client.phone || 'Sin teléfono'}</p>
                <p className="text-xs text-surface-500">{client.role}</p>
              </div>

              <div className="col-span-2">
                <span className={cn('badge', client.is_active ? 'badge-success' : 'badge-warning')}>
                  {client.is_active ? 'Activo' : 'Inactivo'}
                </span>
              </div>

              <div className="col-span-2">
                <span className="text-sm text-surface-500">{formatDate(client.created_at)}</span>
              </div>

              <div className="col-span-1 flex items-center justify-end gap-1">
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
          )) : null}
        </div>

        <div className="flex items-center justify-between border-t border-surface-100 bg-surface-50 px-5 py-3 dark:border-surface-800 dark:bg-surface-800/50">
          <span className="text-sm text-surface-500">
            Página {data?.page ?? 1} de {Math.max(data?.pages ?? 1, 1)}
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
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Teléfono</label>
              <input
                className="input"
                value={form.phone}
                onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
              />
            </div>
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
    </motion.div>
  );
}
