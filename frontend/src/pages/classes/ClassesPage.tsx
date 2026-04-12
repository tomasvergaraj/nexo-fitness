import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  CalendarDays, Plus, Filter, Clock, Users, Video, ChevronLeft, ChevronRight,
  Ban, ExternalLink, MapPin, Repeat2,
} from 'lucide-react';
import Modal from '@/components/ui/Modal';
import Tooltip from '@/components/ui/Tooltip';
import { classesApi } from '@/services/api';
import { staggerContainer, fadeInUp } from '@/utils/animations';
import {
  classStatusColor, cn, formatDateTime, formatTime, getApiError, occupancyColor,
} from '@/utils';
import type { ClassReservationDetail, GymClass, PaginatedResponse } from '@/types';

type ViewMode = 'cards' | 'list' | 'calendar';
type StatusFilter = 'all' | 'scheduled' | 'cancelled';

type ClassFormState = {
  name: string;
  class_type: string;
  modality: 'in_person' | 'online' | 'hybrid';
  start_time: string;
  duration_minutes: string;
  max_capacity: string;
  online_link: string;
  color: string;
  repeat_type: 'none' | 'daily' | 'weekly' | 'monthly';
  repeat_until: string;
};

const CLASS_TYPE_PRESETS = [
  { label: 'Yoga', value: 'yoga', color: '#14b8a6', duration: 60, capacity: 20 },
  { label: 'Spinning', value: 'spinning', color: '#f97316', duration: 45, capacity: 18 },
  { label: 'Funcional', value: 'funcional', color: '#06b6d4', duration: 60, capacity: 20 },
  { label: 'HIIT', value: 'hiit', color: '#ef4444', duration: 45, capacity: 16 },
  { label: 'Pilates', value: 'pilates', color: '#8b5cf6', duration: 60, capacity: 18 },
  { label: 'CrossFit', value: 'crossfit', color: '#eab308', duration: 60, capacity: 14 },
  { label: 'Sesión Personal (1:1)', value: 'personal_training', color: '#a855f7', duration: 60, capacity: 1 },
] as const;

const START_TIME_PRESETS = ['06:00', '07:00', '08:00', '09:00', '18:00', '19:00', '20:00'];
const DURATION_PRESETS = [30, 45, 60, 75, 90];
const CAPACITY_PRESETS = [10, 15, 20, 25, 30];

function getSuggestedClassName(classType: string) {
  const normalizedType = classType.trim();
  if (!normalizedType) {
    return '';
  }

  const preset = CLASS_TYPE_PRESETS.find((item) => item.value === normalizedType);
  if (preset) {
    return preset.label;
  }

  return normalizedType
    .split(/[_-]+/)
    .filter(Boolean)
    .map((segment) => {
      const upperSegment = segment.toUpperCase();
      if (upperSegment === 'HIIT') {
        return 'HIIT';
      }
      return segment.charAt(0).toUpperCase() + segment.slice(1);
    })
    .join(' ');
}

function shouldSyncClassName(currentName: string, previousClassType: string) {
  const normalizedName = currentName.trim();
  if (!normalizedName) {
    return true;
  }

  const normalizedPreviousType = previousClassType.trim();
  if (!normalizedPreviousType) {
    return false;
  }

  return (
    normalizedName === normalizedPreviousType
    || normalizedName === getSuggestedClassName(normalizedPreviousType)
  );
}

function applyClassTypeChange(
  current: ClassFormState,
  nextClassType: string,
  preset?: (typeof CLASS_TYPE_PRESETS)[number],
): ClassFormState {
  const nextState: ClassFormState = { ...current, class_type: nextClassType };

  if (shouldSyncClassName(current.name, current.class_type)) {
    nextState.name = getSuggestedClassName(nextClassType);
  }

  if (preset) {
    nextState.duration_minutes = String(preset.duration);
    nextState.max_capacity = String(preset.capacity);
    nextState.color = preset.color;
  }

  return nextState;
}

function createInitialForm(_date: Date): ClassFormState {
  return {
    name: '',
    class_type: '',
    modality: 'in_person',
    start_time: '09:00',
    duration_minutes: '60',
    max_capacity: '20',
    online_link: '',
    color: '#06b6d4',
    repeat_type: 'none',
    repeat_until: '',
  };
}

function getOccupancyRate(gymClass: GymClass) {
  if (!gymClass.max_capacity) return 0;
  return (gymClass.current_bookings / gymClass.max_capacity) * 100;
}

function combineDateAndTime(baseDate: Date, timeValue: string) {
  const [hours, minutes] = timeValue.split(':').map(Number);
  const next = new Date(baseDate);
  next.setHours(hours || 0, minutes || 0, 0, 0);
  return next;
}

function formatClassStatusLabel(status: GymClass['status']) {
  if (status === 'scheduled') return 'Programada';
  if (status === 'in_progress') return 'En curso';
  if (status === 'completed') return 'Finalizada';
  if (status === 'cancelled') return 'Cancelada';
  return status;
}

function formatClassModalityLabel(modality: ClassFormState['modality'] | GymClass['modality']) {
  if (modality === 'in_person') return 'Presencial';
  if (modality === 'online') return 'Online';
  return 'Híbrida';
}

function formatReservationStatusLabel(status: ClassReservationDetail['status']) {
  if (status === 'confirmed') return 'Confirmada';
  if (status === 'waitlisted') return 'Lista de espera';
  if (status === 'cancelled') return 'Cancelada';
  if (status === 'attended') return 'Asistió';
  if (status === 'no_show') return 'No asistió';
  return status;
}

function reservationStatusBadgeClass(status: ClassReservationDetail['status']) {
  if (status === 'confirmed') return 'badge-success';
  if (status === 'waitlisted') return 'badge-warning';
  if (status === 'cancelled') return 'badge-danger';
  if (status === 'attended') return 'badge-info';
  return 'badge-neutral';
}

export default function ClassesPage() {
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<ViewMode>('cards');
  const [selectedDay, setSelectedDay] = useState(0);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedClass, setSelectedClass] = useState<GymClass | null>(null);
  const [classToCancel, setClassToCancel] = useState<GymClass | null>(null);
  const [cancelReason, setCancelReason] = useState('');

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

  const computedStartDate = useMemo(
    () => combineDateAndTime(selectedDate, form.start_time),
    [form.start_time, selectedDate],
  );
  const durationMinutes = Number(form.duration_minutes) || 0;
  const computedEndDate = useMemo(() => (
    new Date(computedStartDate.getTime() + Math.max(durationMinutes, 0) * 60000)
  ), [computedStartDate, durationMinutes]);
  const selectedDateLongLabel = selectedDate.toLocaleDateString('es-CL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  useEffect(() => {
    if (form.modality === 'in_person' && form.online_link) {
      setForm((current) => ({ ...current, online_link: '' }));
    }
  }, [form.modality, form.online_link]);

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

  const classReservationsQuery = useQuery<ClassReservationDetail[]>({
    queryKey: ['class-reservations', selectedClass?.id],
    queryFn: async () => {
      const response = await classesApi.listReservations(selectedClass!.id);
      return response.data;
    },
    enabled: Boolean(selectedClass),
  });

  const createClass = useMutation({
    mutationFn: async () => {
      if (!form.start_time) {
        throw new Error('Selecciona una hora de inicio');
      }
      if (!Number.isFinite(durationMinutes) || durationMinutes < 15) {
        throw new Error('La duración debe ser de al menos 15 minutos');
      }
      if (!Number.isFinite(Number(form.max_capacity)) || Number(form.max_capacity) < 1) {
        throw new Error('La capacidad debe ser mayor a cero');
      }

      const response = await classesApi.create({
        name: form.name,
        class_type: form.class_type || null,
        modality: form.modality,
        start_time: computedStartDate.toISOString(),
        end_time: computedEndDate.toISOString(),
        max_capacity: Number(form.max_capacity),
        online_link: form.modality === 'in_person' ? null : form.online_link || null,
        color: form.color,
        repeat_type: form.repeat_type,
        repeat_until: form.repeat_type !== 'none' && form.repeat_until ? form.repeat_until : null,
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
    mutationFn: async ({ classId, reason }: { classId: string; reason?: string }) => {
      await classesApi.cancel(classId, reason);
    },
    onSuccess: () => {
      toast.success('Clase cancelada');
      setClassToCancel(null);
      setCancelReason('');
      queryClient.invalidateQueries({ queryKey: ['classes'] });
      queryClient.invalidateQueries({ queryKey: ['class-reservations'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] });
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No se pudo cancelar la clase'));
    },
  });

  const classes = data?.items ?? [];
  const classReservations = classReservationsQuery.data ?? [];
  const confirmedReservations = classReservations.filter((item) => item.status === 'confirmed' || item.status === 'attended').length;
  const waitlistedReservations = classReservations.filter((item) => item.status === 'waitlisted').length;
  const cancelledReservations = classReservations.filter((item) => item.status === 'cancelled').length;
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
                    <p className="text-xs text-surface-500">
                      {gymClass.class_type === 'personal_training' ? '⚡ Sesión 1:1' : (gymClass.class_type || 'Clase general')}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={cn('badge', classStatusColor(gymClass.status))}>
                      {formatClassStatusLabel(gymClass.status)}
                    </span>
                    {gymClass.recurrence_group_id ? (
                      <span className="badge badge-info flex items-center gap-1"><Repeat2 size={10} /> Serie</span>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-2 text-sm text-surface-500">
                  <div className="flex items-center gap-2">
                    <Clock size={14} />
                    <span>{formatDateTime(gymClass.start_time)} - {formatTime(gymClass.end_time)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {gymClass.modality === 'online' ? <Video size={14} /> : <MapPin size={14} />}
                    <span>{formatClassModalityLabel(gymClass.modality)}</span>
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

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedClass(gymClass)}
                    className="btn-secondary flex-1 text-sm"
                  >
                    <Users size={14} /> Inscritos
                  </button>
                  {gymClass.online_link ? (
                    <Tooltip content="Abrir clase online" className="flex-1">
                      <a
                        href={gymClass.online_link}
                        target="_blank"
                        rel="noreferrer"
                        className="btn-secondary flex-1 text-sm"
                      >
                        <ExternalLink size={14} /> Link
                      </a>
                    </Tooltip>
                  ) : null}
                  <Tooltip content={isCancelled ? 'La clase ya está cancelada' : 'Cancelar esta clase'} className="flex-1">
                    <button
                      type="button"
                      onClick={() => {
                        setClassToCancel(gymClass);
                        setCancelReason('');
                      }}
                      disabled={isCancelled || cancelClass.isPending}
                      className="btn-danger flex-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Ban size={14} /> {isCancelled ? 'Cancelada' : 'Cancelar'}
                    </button>
                  </Tooltip>
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
                  <span className={cn('badge', classStatusColor(gymClass.status))}>{formatClassStatusLabel(gymClass.status)}</span>
                </div>
                <p className="text-sm text-surface-500">
                  {formatDateTime(gymClass.start_time)} · {gymClass.class_type === 'personal_training' ? '⚡ Sesión 1:1' : (gymClass.class_type || 'Clase general')} · {gymClass.current_bookings}/{gymClass.max_capacity}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedClass(gymClass)}
                  className="btn-secondary text-sm"
                >
                  <Users size={14} /> Inscritos
                </button>
                {gymClass.online_link ? (
                  <Tooltip content="Abrir clase online">
                    <a href={gymClass.online_link} target="_blank" rel="noreferrer" className="btn-secondary text-sm">
                      <ExternalLink size={14} /> Abrir
                    </a>
                  </Tooltip>
                ) : null}
                <Tooltip content={gymClass.status === 'cancelled' ? 'La clase ya está cancelada' : 'Cancelar esta clase'}>
                  <button
                    type="button"
                    onClick={() => {
                      setClassToCancel(gymClass);
                      setCancelReason('');
                    }}
                    disabled={gymClass.status === 'cancelled'}
                    className="btn-danger text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Ban size={14} /> Cancelar
                  </button>
                </Tooltip>
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
                    <span className={cn('badge', classStatusColor(gymClass.status))}>{formatClassStatusLabel(gymClass.status)}</span>
                  </div>
                  <p className="mt-1 text-sm text-surface-500">
                    {gymClass.class_type === 'personal_training' ? '⚡ Sesión 1:1' : (gymClass.class_type || 'Clase general')} · {gymClass.current_bookings}/{gymClass.max_capacity} reservas
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedClass(gymClass)}
                      className="btn-secondary text-sm"
                    >
                      <Users size={14} /> Ver inscritos
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setClassToCancel(gymClass);
                        setCancelReason('');
                      }}
                      disabled={gymClass.status === 'cancelled'}
                      className="btn-danger text-sm disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Ban size={14} /> Cancelar clase
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )) : null}
        </motion.div>
      </AnimatePresence>

      <Modal
        open={showCreateModal}
        title="Nueva clase"
        description="Usa los atajos para definir la clase más rápido y agendarla en el día seleccionado."
        onClose={() => {
          if (!createClass.isPending) {
            setShowCreateModal(false);
          }
        }}
        size="lg"
      >
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            createClass.mutate();
          }}
        >
          <div className="rounded-2xl border border-brand-200 bg-brand-50/70 p-4 dark:border-brand-900/40 dark:bg-brand-950/20">
            <p className="text-sm font-semibold text-surface-900 dark:text-white">Día seleccionado</p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-surface-600 dark:text-surface-300">
              <p className="capitalize">{selectedDateLongLabel}</p>
              <p>
                {form.start_time} a {formatTime(computedEndDate)}
              </p>
            </div>
          </div>

          <div>
            <label className="mb-3 block text-sm font-medium text-surface-700 dark:text-surface-300">
              Tipo de clase
              <span className="ml-2 text-xs font-normal text-surface-400">Elige una opción frecuente o escribe una personalizada</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {CLASS_TYPE_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => setForm((current) => applyClassTypeChange(current, preset.value, preset))}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                    form.class_type === preset.value
                      ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-brand-950/20 dark:text-brand-300'
                      : 'border-surface-200 bg-white text-surface-600 hover:border-surface-300 dark:border-surface-800 dark:bg-surface-950/20 dark:text-surface-300',
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Nombre visible</label>
              <input
                className="input"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Ej: Yoga AM, Spinning Intermedio..."
                required
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Categoría</label>
              <input
                className="input"
                value={form.class_type}
                onChange={(event) => setForm((current) => applyClassTypeChange(current, event.target.value))}
                placeholder="Ej: yoga, crossfit, spinning..."
              />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-4 rounded-2xl border border-surface-200 bg-white p-4 dark:border-surface-800 dark:bg-surface-950/20">
              <div>
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Hora de inicio</label>
                <input
                  type="time"
                  className="input"
                  value={form.start_time}
                  onChange={(event) => setForm((current) => ({ ...current, start_time: event.target.value }))}
                  required
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  {START_TIME_PRESETS.map((timeValue) => (
                    <button
                      key={timeValue}
                      type="button"
                      onClick={() => setForm((current) => ({ ...current, start_time: timeValue }))}
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-sm transition-colors',
                        form.start_time === timeValue
                          ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-brand-950/20 dark:text-brand-300'
                          : 'border-surface-200 text-surface-600 hover:border-surface-300 dark:border-surface-800 dark:text-surface-300',
                      )}
                    >
                      {timeValue}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Duración</label>
                <div className="flex flex-wrap gap-2">
                  {DURATION_PRESETS.map((minutes) => (
                    <button
                      key={minutes}
                      type="button"
                      onClick={() => setForm((current) => ({ ...current, duration_minutes: String(minutes) }))}
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-sm transition-colors',
                        Number(form.duration_minutes) === minutes
                          ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-brand-950/20 dark:text-brand-300'
                          : 'border-surface-200 text-surface-600 hover:border-surface-300 dark:border-surface-800 dark:text-surface-300',
                      )}
                    >
                      {minutes} min
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  min="15"
                  step="5"
                  className="input mt-3"
                  value={form.duration_minutes}
                  onChange={(event) => setForm((current) => ({ ...current, duration_minutes: event.target.value }))}
                  placeholder="Duración personalizada en minutos"
                />
              </div>
            </div>

            <div className="rounded-2xl border border-surface-200 bg-white p-4 dark:border-surface-800 dark:bg-surface-950/20">
              <p className="text-sm font-semibold text-surface-900 dark:text-white">Resumen rápido</p>
              <div className="mt-4 space-y-3 text-sm text-surface-600 dark:text-surface-300">
                <p>Inicio: {formatTime(computedStartDate)}</p>
                <p>Término estimado: {formatTime(computedEndDate)}</p>
                <p>Duración: {durationMinutes || 0} minutos</p>
                <p>Modalidad: {formatClassModalityLabel(form.modality)}</p>
                <p>Cupos: {form.max_capacity || 0}</p>
              </div>
            </div>
          </div>

          <div>
            <label className="mb-3 block text-sm font-medium text-surface-700 dark:text-surface-300">Modalidad</label>
            <div className="grid gap-3 sm:grid-cols-3">
              {([
                { value: 'in_person', label: 'Presencial', description: 'Solo en el gimnasio.' },
                { value: 'online', label: 'Online', description: 'Con enlace para conectarse.' },
                { value: 'hybrid', label: 'Híbrida', description: 'Asistencia presencial y online.' },
              ] as const).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setForm((current) => ({
                    ...current,
                    modality: option.value,
                  }))}
                  className={cn(
                    'rounded-2xl border px-4 py-4 text-left transition-colors',
                    form.modality === option.value
                      ? 'border-brand-300 bg-brand-50 dark:border-brand-700 dark:bg-brand-950/20'
                      : 'border-surface-200 bg-white hover:border-surface-300 dark:border-surface-800 dark:bg-surface-950/20',
                  )}
                >
                  <p className="text-sm font-semibold text-surface-900 dark:text-white">{option.label}</p>
                  <p className="mt-1 text-xs leading-5 text-surface-500 dark:text-surface-400">{option.description}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Capacidad</label>
              <div className="flex flex-wrap gap-2">
                {CAPACITY_PRESETS.map((capacity) => (
                  <button
                    key={capacity}
                    type="button"
                    onClick={() => setForm((current) => ({ ...current, max_capacity: String(capacity) }))}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-sm transition-colors',
                      Number(form.max_capacity) === capacity
                        ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-brand-950/20 dark:text-brand-300'
                        : 'border-surface-200 text-surface-600 hover:border-surface-300 dark:border-surface-800 dark:text-surface-300',
                    )}
                  >
                    {capacity} cupos
                  </button>
                ))}
              </div>
              <input
                type="number"
                min="1"
                className="input mt-3"
                value={form.max_capacity}
                onChange={(event) => setForm((current) => ({ ...current, max_capacity: event.target.value }))}
                required
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Color</label>
              <input
                type="color"
                className="input h-11 w-full min-w-[88px] p-2"
                value={form.color}
                onChange={(event) => setForm((current) => ({ ...current, color: event.target.value }))}
              />
            </div>
          </div>

          {(form.modality === 'online' || form.modality === 'hybrid') ? (
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Enlace para la clase</label>
              <input
                type="url"
                className="input"
                value={form.online_link}
                onChange={(event) => setForm((current) => ({ ...current, online_link: event.target.value }))}
                placeholder="https://zoom.us/... o enlace de Meet"
              />
            </div>
          ) : null}

          {/* ─── Recurrencia ─── */}
          <div className="rounded-2xl border border-surface-200 bg-white p-4 dark:border-surface-800 dark:bg-surface-950/20">
            <label className="mb-3 flex items-center gap-2 text-sm font-medium text-surface-700 dark:text-surface-300">
              <Repeat2 size={15} />
              Repetición
            </label>
            <div className="flex flex-wrap gap-2">
              {([
                { value: 'none', label: 'Sin repetición' },
                { value: 'daily', label: 'Diaria' },
                { value: 'weekly', label: 'Semanal' },
                { value: 'monthly', label: 'Mensual' },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setForm((current) => ({ ...current, repeat_type: opt.value }))}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-sm transition-colors',
                    form.repeat_type === opt.value
                      ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-brand-950/20 dark:text-brand-300'
                      : 'border-surface-200 text-surface-600 hover:border-surface-300 dark:border-surface-800 dark:text-surface-300',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {form.repeat_type !== 'none' ? (
              <div className="mt-4">
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">
                  Repetir hasta
                </label>
                <input
                  type="date"
                  className="input"
                  value={form.repeat_until}
                  min={selectedDate.toISOString().slice(0, 10)}
                  onChange={(event) => setForm((current) => ({ ...current, repeat_until: event.target.value }))}
                  required
                />
                <p className="mt-1.5 text-xs text-surface-400">
                  Se crearán instancias desde hoy hasta esta fecha con frecuencia {form.repeat_type === 'daily' ? 'diaria' : form.repeat_type === 'weekly' ? 'semanal' : 'mensual'}.
                </p>
              </div>
            ) : null}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setShowCreateModal(false)}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={createClass.isPending}>
              {createClass.isPending ? 'Creando...' : form.repeat_type !== 'none' ? 'Crear serie' : 'Crear clase'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(selectedClass)}
        title={selectedClass ? `Inscritos en ${selectedClass.name}` : 'Inscritos'}
        description={selectedClass ? `${formatDateTime(selectedClass.start_time)} · ${selectedClass.current_bookings}/${selectedClass.max_capacity} reservas activas` : ''}
        onClose={() => setSelectedClass(null)}
        size="lg"
      >
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-surface-200/60 bg-surface-50 px-4 py-4 dark:border-surface-800 dark:bg-surface-950/20">
              <p className="text-xs uppercase tracking-[0.18em] text-surface-500">Confirmadas</p>
              <p className="mt-2 text-2xl font-bold font-display text-surface-900 dark:text-white">{confirmedReservations}</p>
            </div>
            <div className="rounded-2xl border border-surface-200/60 bg-surface-50 px-4 py-4 dark:border-surface-800 dark:bg-surface-950/20">
              <p className="text-xs uppercase tracking-[0.18em] text-surface-500">Espera</p>
              <p className="mt-2 text-2xl font-bold font-display text-surface-900 dark:text-white">{waitlistedReservations}</p>
            </div>
            <div className="rounded-2xl border border-surface-200/60 bg-surface-50 px-4 py-4 dark:border-surface-800 dark:bg-surface-950/20">
              <p className="text-xs uppercase tracking-[0.18em] text-surface-500">Canceladas</p>
              <p className="mt-2 text-2xl font-bold font-display text-surface-900 dark:text-white">{cancelledReservations}</p>
            </div>
          </div>

          {classReservationsQuery.isLoading ? (
            Array.from({ length: 4 }).map((_, index) => <div key={index} className="shimmer h-24 rounded-2xl" />)
          ) : null}

          {!classReservationsQuery.isLoading && classReservations.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-surface-300 bg-surface-50 px-6 py-10 text-center dark:border-surface-700 dark:bg-surface-900/30">
              <Users size={28} className="mx-auto mb-3 text-surface-300 dark:text-surface-700" />
              <p className="font-medium text-surface-700 dark:text-surface-200">Todavía no hay clientes inscritos</p>
              <p className="mt-1 text-sm text-surface-500">Cuando alguien reserve esta clase aparecerá aquí con su estado y, si canceló, con el motivo.</p>
            </div>
          ) : null}

          {!classReservationsQuery.isLoading ? (
            <div className="space-y-3">
              {classReservations.map((reservation) => (
                <div
                  key={reservation.id}
                  className="rounded-2xl border border-surface-200/60 bg-white px-4 py-4 dark:border-surface-800 dark:bg-surface-950/20"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-surface-900 dark:text-white">{reservation.user_name || 'Cliente'}</p>
                        <span className={cn('badge', reservationStatusBadgeClass(reservation.status))}>
                          {formatReservationStatusLabel(reservation.status)}
                        </span>
                        {reservation.status === 'waitlisted' && reservation.waitlist_position ? (
                          <span className="badge badge-neutral">#{reservation.waitlist_position}</span>
                        ) : null}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-surface-500">
                        <span>{reservation.user_email || 'Sin correo'}</span>
                        <span>{reservation.user_phone || 'Sin teléfono'}</span>
                        <span>Reservó {formatDateTime(reservation.created_at)}</span>
                        {reservation.cancelled_at ? <span>Canceló {formatDateTime(reservation.cancelled_at)}</span> : null}
                      </div>
                      {reservation.cancel_reason ? (
                        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
                          <span className="font-semibold">Motivo de cancelación:</span> {reservation.cancel_reason}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={Boolean(classToCancel)}
        title={classToCancel ? `Cancelar ${classToCancel.name}` : 'Cancelar clase'}
        description="Puedes dejar un motivo opcional. Se guardará en las reservas canceladas para que el equipo pueda revisarlo después."
        onClose={() => {
          if (!cancelClass.isPending) {
            setClassToCancel(null);
            setCancelReason('');
          }
        }}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!classToCancel) return;
            cancelClass.mutate({
              classId: classToCancel.id,
              reason: cancelReason.trim() || undefined,
            });
          }}
        >
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
            Esta acción cancelará la clase y también las reservas confirmadas o en lista de espera asociadas.
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Motivo de cancelación</label>
            <textarea
              className="input min-h-24 resize-y"
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              placeholder="Ej: cambio de instructor, mantención del salón, feriado, etc."
              maxLength={500}
            />
            <p className="mt-2 text-xs text-surface-500">{cancelReason.length}/500 caracteres</p>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setClassToCancel(null);
                setCancelReason('');
              }}
              disabled={cancelClass.isPending}
            >
              Volver
            </button>
            <button type="submit" className="btn-danger" disabled={cancelClass.isPending}>
              {cancelClass.isPending ? 'Cancelando...' : 'Confirmar cancelación'}
            </button>
          </div>
        </form>
      </Modal>
    </motion.div>
  );
}
