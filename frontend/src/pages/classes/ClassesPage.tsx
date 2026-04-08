import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  CalendarDays, Plus, Filter, Clock, Users, Video, ChevronLeft, ChevronRight,
  Ban, ExternalLink, MapPin,
} from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { classesApi } from '@/services/api';
import { staggerContainer, fadeInUp } from '@/utils/animations';
import {
  classStatusColor, cn, formatDateTime, formatTime, getApiError, occupancyColor, toDateInputValue,
} from '@/utils';
import type { GymClass, PaginatedResponse } from '@/types';

type ViewMode = 'cards' | 'list' | 'calendar';
type StatusFilter = 'all' | 'scheduled' | 'cancelled';

type ClassFormState = {
  name: string;
  class_type: string;
  modality: 'in_person' | 'online' | 'hybrid';
  start_time: string;
  end_time: string;
  max_capacity: string;
  online_link: string;
  color: string;
};

function createInitialForm(date: Date): ClassFormState {
  const start = new Date(date);
  start.setHours(9, 0, 0, 0);
  const end = new Date(date);
  end.setHours(10, 0, 0, 0);

  return {
    name: '',
    class_type: '',
    modality: 'in_person',
    start_time: toDateInputValue(start),
    end_time: toDateInputValue(end),
    max_capacity: '20',
    online_link: '',
    color: '#06b6d4',
  };
}

function getOccupancyRate(gymClass: GymClass) {
  if (!gymClass.max_capacity) return 0;
  return (gymClass.current_bookings / gymClass.max_capacity) * 100;
}

export default function ClassesPage() {
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<ViewMode>('cards');
  const [selectedDay, setSelectedDay] = useState(0);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const weekDates = useMemo(() => {
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(base);
      date.setDate(base.getDate() + index);
      return date;
    });
  }, []);

  const selectedDate = weekDates[selectedDay];
  const [form, setForm] = useState<ClassFormState>(() => createInitialForm(selectedDate));

  const dateFrom = new Date(selectedDate);
  dateFrom.setHours(0, 0, 0, 0);
  const dateTo = new Date(selectedDate);
  dateTo.setHours(23, 59, 59, 999);

  const { data, isLoading, isError } = useQuery<PaginatedResponse<GymClass>>({
    queryKey: ['classes', selectedDate.toISOString(), statusFilter],
    queryFn: async () => {
      const response = await classesApi.list({
        page: 1,
        per_page: 50,
        date_from: dateFrom.toISOString(),
        date_to: dateTo.toISOString(),
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
      });
      return response.data;
    },
  });

  const createClass = useMutation({
    mutationFn: async () => {
      if (new Date(form.end_time) <= new Date(form.start_time)) {
        throw new Error('La hora de término debe ser posterior al inicio');
      }

      const response = await classesApi.create({
        name: form.name,
        class_type: form.class_type || null,
        modality: form.modality,
        start_time: new Date(form.start_time).toISOString(),
        end_time: new Date(form.end_time).toISOString(),
        max_capacity: Number(form.max_capacity),
        online_link: form.modality === 'in_person' ? null : form.online_link || null,
        color: form.color,
      });
      return response.data;
    },
    onSuccess: () => {
      toast.success('Clase creada');
      setShowCreateModal(false);
      setForm(createInitialForm(selectedDate));
      queryClient.invalidateQueries({ queryKey: ['classes'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] });
    },
    onError: (error: any) => {
      toast.error(error?.message || getApiError(error, 'No se pudo crear la clase'));
    },
  });

  const cancelClass = useMutation({
    mutationFn: async (classId: string) => {
      await classesApi.cancel(classId);
    },
    onSuccess: () => {
      toast.success('Clase cancelada');
      queryClient.invalidateQueries({ queryKey: ['classes'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] });
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No se pudo cancelar la clase'));
    },
  });

  const classes = data?.items ?? [];
  const dayLabel = selectedDate.toLocaleDateString('es-CL', { weekday: 'short', day: '2-digit', month: 'short' });

  const cycleFilter = () => {
    setStatusFilter((current) => {
      if (current === 'all') return 'scheduled';
      if (current === 'scheduled') return 'cancelled';
      return 'all';
    });
  };

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-6">
      <motion.div variants={fadeInUp} className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Clases</h1>
          <p className="mt-1 text-sm text-surface-500">Agenda real para {dayLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={cycleFilter}
            className="btn-secondary text-sm"
          >
            <Filter size={16} /> {statusFilter === 'all' ? 'Todas' : statusFilter === 'scheduled' ? 'Programadas' : 'Canceladas'}
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              setForm(createInitialForm(selectedDate));
              setShowCreateModal(true);
            }}
            className="btn-primary text-sm"
          >
            <Plus size={16} /> Nueva Clase
          </motion.button>
        </div>
      </motion.div>

      <motion.div
        variants={fadeInUp}
        className="flex items-center gap-2 overflow-x-auto rounded-2xl border border-surface-200/50 bg-white p-1 dark:border-surface-800/50 dark:bg-surface-900"
      >
        <button
          type="button"
          className="rounded-xl p-2 transition-colors hover:bg-surface-100 dark:hover:bg-surface-800"
          onClick={() => setSelectedDay((current) => Math.max(0, current - 1))}
          disabled={selectedDay === 0}
        >
          <ChevronLeft size={16} className="text-surface-500" />
        </button>
        {weekDates.map((date, index) => (
          <motion.button
            key={date.toISOString()}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => setSelectedDay(index)}
            className={cn(
              'min-w-[72px] flex-1 rounded-xl px-3 py-2.5 text-center transition-all duration-200',
              selectedDay === index
                ? 'bg-gradient-to-r from-brand-500 to-brand-600 text-white shadow-md shadow-brand-500/20'
                : 'text-surface-600 hover:bg-surface-50 dark:text-surface-400 dark:hover:bg-surface-800',
            )}
          >
            <p className="text-xs font-medium">
              {date.toLocaleDateString('es-CL', { weekday: 'short' })}
            </p>
            <p className="text-lg font-bold font-display">{date.getDate()}</p>
          </motion.button>
        ))}
        <button
          type="button"
          className="rounded-xl p-2 transition-colors hover:bg-surface-100 dark:hover:bg-surface-800"
          onClick={() => setSelectedDay((current) => Math.min(weekDates.length - 1, current + 1))}
          disabled={selectedDay === weekDates.length - 1}
        >
          <ChevronRight size={16} className="text-surface-500" />
        </button>
      </motion.div>

      <motion.div variants={fadeInUp} className="flex w-fit items-center gap-1 rounded-xl bg-surface-100 p-1 dark:bg-surface-800">
        {(['cards', 'list', 'calendar'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition-all duration-200',
              viewMode === mode
                ? 'bg-white text-surface-900 shadow-sm dark:bg-surface-700 dark:text-white'
                : 'text-surface-500 hover:text-surface-700',
            )}
          >
            {mode === 'cards' ? 'Tarjetas' : mode === 'list' ? 'Lista' : 'Timeline'}
          </button>
        ))}
      </motion.div>

      {isError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-600 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
          No pudimos cargar las clases.
        </div>
      ) : null}

      <AnimatePresence mode="wait">
        <motion.div
          key={viewMode}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className={cn(
            viewMode === 'cards' && 'grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3',
            viewMode === 'list' && 'space-y-2',
            viewMode === 'calendar' && 'space-y-3',
          )}
        >
          {isLoading ? (
            Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="shimmer h-44 rounded-2xl" />
            ))
          ) : null}

          {!isLoading && !classes.length ? (
            <div className="col-span-full rounded-2xl border border-dashed border-surface-300 bg-surface-50 px-6 py-10 text-center dark:border-surface-700 dark:bg-surface-900/30">
              <CalendarDays size={28} className="mx-auto mb-3 text-surface-300 dark:text-surface-700" />
              <p className="font-medium text-surface-700 dark:text-surface-200">No hay clases para este día</p>
              <p className="mt-1 text-sm text-surface-500">Prueba otro día o crea una nueva clase.</p>
            </div>
          ) : null}

          {!isLoading && viewMode === 'cards' ? classes.map((gymClass, index) => {
            const occupancyRate = getOccupancyRate(gymClass);
            const isCancelled = gymClass.status === 'cancelled';

            return (
              <motion.div
                key={gymClass.id}
                initial={{ opacity: 0, y: 20, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ delay: index * 0.04 }}
                className="group relative overflow-hidden rounded-2xl border border-surface-200/50 bg-white p-4 transition-all duration-300 hover:shadow-lg dark:border-surface-800/50 dark:bg-surface-900"
              >
                <div className="absolute left-0 right-0 top-0 h-1 rounded-t-2xl" style={{ backgroundColor: gymClass.color || '#06b6d4' }} />
                <div className="mb-3 flex items-start justify-between pt-1">
                  <div>
                    <h3 className="font-semibold text-surface-900 dark:text-white">{gymClass.name}</h3>
                    <p className="text-xs text-surface-500">{gymClass.class_type || 'Clase general'}</p>
                  </div>
                  <span className={cn('badge', classStatusColor(gymClass.status))}>
                    {gymClass.status}
                  </span>
                </div>

                <div className="space-y-2 text-sm text-surface-500">
                  <div className="flex items-center gap-2">
                    <Clock size={14} />
                    <span>{formatDateTime(gymClass.start_time)} - {formatTime(gymClass.end_time)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {gymClass.modality === 'online' ? <Video size={14} /> : <MapPin size={14} />}
                    <span>{gymClass.modality === 'in_person' ? 'Presencial' : gymClass.modality === 'online' ? 'Online' : 'Híbrida'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Users size={14} />
                    <span>{gymClass.current_bookings}/{gymClass.max_capacity} reservas</span>
                  </div>
                </div>

                <div className="mt-4 border-t border-surface-100 pt-3 dark:border-surface-800">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-xs font-medium text-surface-500">Ocupación</span>
                    <span className={cn('text-xs font-bold', occupancyColor(occupancyRate))}>
                      {occupancyRate.toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-100 dark:bg-surface-800">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${occupancyRate}%` }}
                      transition={{ delay: 0.3 + index * 0.05, duration: 0.7 }}
                      className="h-full rounded-full"
                      style={{ backgroundColor: gymClass.color || '#06b6d4' }}
                    />
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-2">
                  {gymClass.online_link ? (
                    <a
                      href={gymClass.online_link}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-secondary flex-1 text-sm"
                    >
                      <ExternalLink size={14} /> Link
                    </a>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => cancelClass.mutate(gymClass.id)}
                    disabled={isCancelled || cancelClass.isPending}
                    className="btn-danger flex-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Ban size={14} /> {isCancelled ? 'Cancelada' : 'Cancelar'}
                  </button>
                </div>
              </motion.div>
            );
          }) : null}

          {!isLoading && viewMode === 'list' ? classes.map((gymClass, index) => (
            <motion.div
              key={gymClass.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.03 }}
              className="flex flex-col gap-3 rounded-xl border border-surface-200/50 bg-white p-4 dark:border-surface-800/50 dark:bg-surface-900 sm:flex-row sm:items-center"
            >
              <div className="h-12 w-1 rounded-full" style={{ backgroundColor: gymClass.color || '#06b6d4' }} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-surface-900 dark:text-white">{gymClass.name}</h3>
                  <span className={cn('badge', classStatusColor(gymClass.status))}>{gymClass.status}</span>
                </div>
                <p className="text-sm text-surface-500">
                  {formatDateTime(gymClass.start_time)} · {gymClass.class_type || 'Clase general'} · {gymClass.current_bookings}/{gymClass.max_capacity}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {gymClass.online_link ? (
                  <a href={gymClass.online_link} target="_blank" rel="noreferrer" className="btn-secondary text-sm">
                    <ExternalLink size={14} /> Abrir
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={() => cancelClass.mutate(gymClass.id)}
                  disabled={gymClass.status === 'cancelled'}
                  className="btn-danger text-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Ban size={14} /> Cancelar
                </button>
              </div>
            </motion.div>
          )) : null}

          {!isLoading && viewMode === 'calendar' ? classes.map((gymClass, index) => (
            <motion.div
              key={gymClass.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.04 }}
              className="flex gap-4 rounded-2xl border border-surface-200/50 bg-white p-4 dark:border-surface-800/50 dark:bg-surface-900"
            >
              <div className="w-24 flex-shrink-0 text-right">
                <p className="text-sm font-semibold text-surface-900 dark:text-white">{formatTime(gymClass.start_time)}</p>
                <p className="text-xs text-surface-400">{formatTime(gymClass.end_time)}</p>
              </div>
              <div className="relative flex-1 rounded-xl border border-surface-100 bg-surface-50 p-4 dark:border-surface-800 dark:bg-surface-800/30">
                <div className="absolute bottom-3 left-0 top-3 w-1 rounded-full" style={{ backgroundColor: gymClass.color || '#06b6d4' }} />
                <div className="pl-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-surface-900 dark:text-white">{gymClass.name}</h3>
                    <span className={cn('badge', classStatusColor(gymClass.status))}>{gymClass.status}</span>
                  </div>
                  <p className="mt-1 text-sm text-surface-500">
                    {gymClass.class_type || 'Clase general'} · {gymClass.current_bookings}/{gymClass.max_capacity} reservas
                  </p>
                </div>
              </div>
            </motion.div>
          )) : null}
        </motion.div>
      </AnimatePresence>

      <Modal
        open={showCreateModal}
        title="Nueva clase"
        description="Esta acción crea la clase real en el backend para el día seleccionado."
        onClose={() => {
          if (!createClass.isPending) {
            setShowCreateModal(false);
          }
        }}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            createClass.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Nombre</label>
              <input
                className="input"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                required
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Tipo</label>
              <input
                className="input"
                value={form.class_type}
                onChange={(event) => setForm((current) => ({ ...current, class_type: event.target.value }))}
                placeholder="yoga, crossfit, spinning..."
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Inicio</label>
              <input
                type="datetime-local"
                className="input"
                value={form.start_time}
                onChange={(event) => setForm((current) => ({ ...current, start_time: event.target.value }))}
                required
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Término</label>
              <input
                type="datetime-local"
                className="input"
                value={form.end_time}
                onChange={(event) => setForm((current) => ({ ...current, end_time: event.target.value }))}
                required
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Modalidad</label>
              <select
                className="input"
                value={form.modality}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  modality: event.target.value as ClassFormState['modality'],
                }))}
              >
                <option value="in_person">Presencial</option>
                <option value="online">Online</option>
                <option value="hybrid">Híbrida</option>
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Capacidad</label>
              <input
                type="number"
                min="1"
                className="input"
                value={form.max_capacity}
                onChange={(event) => setForm((current) => ({ ...current, max_capacity: event.target.value }))}
                required
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Color</label>
              <input
                type="color"
                className="input h-11 p-2"
                value={form.color}
                onChange={(event) => setForm((current) => ({ ...current, color: event.target.value }))}
              />
            </div>
          </div>

          {(form.modality === 'online' || form.modality === 'hybrid') ? (
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Link online</label>
              <input
                type="url"
                className="input"
                value={form.online_link}
                onChange={(event) => setForm((current) => ({ ...current, online_link: event.target.value }))}
                placeholder="https://..."
              />
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setShowCreateModal(false)}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={createClass.isPending}>
              {createClass.isPending ? 'Creando...' : 'Crear clase'}
            </button>
          </div>
        </form>
      </Modal>
    </motion.div>
  );
}
