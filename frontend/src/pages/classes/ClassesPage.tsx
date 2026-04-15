import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  CalendarDays, Plus, Filter, Clock, Users, Video, ChevronLeft, ChevronRight,
  Ban, ExternalLink, MapPin, Repeat2, UserCircle,
} from 'lucide-react';
import Modal from '@/components/ui/Modal';
import Tooltip from '@/components/ui/Tooltip';
import { branchesApi, checkinsApi, classesApi, clientsApi, reservationsApi, staffApi } from '@/services/api';
import { staggerContainer, fadeInUp } from '@/utils/animations';
import {
  classStatusColor, cn, formatDateTime, formatTime, getApiError, occupancyColor,
} from '@/utils';
import type { Branch, ClassReservationDetail, GymClass, PaginatedResponse, User } from '@/types';

type ViewMode = 'cards' | 'list' | 'calendar';
type StatusFilter = 'all' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

type ClassFormState = {
  name: string;
  description: string;
  class_type: string;
  modality: 'in_person' | 'online' | 'hybrid';
  branch_id: string;
  instructor_id: string;
  start_date: string;
  start_time: string;
  duration_minutes: string;
  max_capacity: string;
  waitlist_enabled: boolean;
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
const CALENDAR_SLOT_HEIGHT = 72;
const CALENDAR_HOUR_OPTIONS = Array.from({ length: 20 }, (_, index) => index + 5);
const CALENDAR_PAGE_SIZE = 100;

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

function formatTimeInputValue(date: Date) {
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${hours}:${minutes}`;
}

function createInitialForm(date: Date, defaultBranchId = ''): ClassFormState {
  const hasExplicitTime = date.getHours() !== 0 || date.getMinutes() !== 0;

  return {
    name: '',
    description: '',
    class_type: '',
    modality: 'in_person',
    branch_id: defaultBranchId,
    instructor_id: '',
    start_date: formatDateKey(date),
    start_time: hasExplicitTime ? formatTimeInputValue(date) : '09:00',
    duration_minutes: '60',
    max_capacity: '20',
    waitlist_enabled: true,
    online_link: '',
    color: '#06b6d4',
    repeat_type: 'none',
    repeat_until: '',
  };
}

function gymClassToFormState(gymClass: GymClass): ClassFormState {
  const start = new Date(gymClass.start_time);
  const end = new Date(gymClass.end_time);
  const durationMins = Math.round((end.getTime() - start.getTime()) / 60000);
  return {
    name: gymClass.name,
    description: gymClass.description || '',
    class_type: gymClass.class_type || '',
    modality: gymClass.modality,
    branch_id: gymClass.branch_id || '',
    instructor_id: gymClass.instructor_id || '',
    start_date: formatDateKey(start),
    start_time: formatTimeInputValue(start),
    duration_minutes: String(durationMins),
    max_capacity: String(gymClass.max_capacity),
    waitlist_enabled: gymClass.waitlist_enabled,
    online_link: gymClass.online_link || '',
    color: gymClass.color || '#06b6d4',
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

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addWeeks(date: Date, weeks: number) {
  return addDays(date, weeks * 7);
}

function startOfWeek(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  const weekdayOffset = (next.getDay() + 6) % 7;
  next.setDate(next.getDate() - weekdayOffset);
  return next;
}

function getWeekdayIndex(date: Date) {
  return (date.getDay() + 6) % 7;
}

function buildWeekDays(date: Date) {
  const weekStart = startOfWeek(date);
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateKeyFromIso(value: string) {
  return formatDateKey(new Date(value));
}

function isSameDay(left: Date, right: Date) {
  return formatDateKey(left) === formatDateKey(right);
}

function getMinutesOfDay(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

function formatHourLabel(hour: number) {
  return `${`${hour}`.padStart(2, '0')}:00`;
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

type ClassLayout = { gymClass: GymClass; col: number; totalCols: number };

function computeDayLayout(classes: GymClass[]): ClassLayout[] {
  if (!classes.length) return [];
  const sorted = [...classes].sort(
    (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
  );
  // Greedy lane assignment
  const laneEnds: number[] = [];
  const assigned: Array<{ gymClass: GymClass; col: number }> = [];
  for (const gymClass of sorted) {
    const startMins = getMinutesOfDay(new Date(gymClass.start_time));
    const endMins = getMinutesOfDay(new Date(gymClass.end_time));
    let col = laneEnds.findIndex((end) => end <= startMins);
    if (col === -1) col = laneEnds.length;
    laneEnds[col] = endMins;
    assigned.push({ gymClass, col });
  }
  // Compute totalCols = max concurrent lanes for each class
  return assigned.map((item) => {
    const startMins = getMinutesOfDay(new Date(item.gymClass.start_time));
    const endMins = getMinutesOfDay(new Date(item.gymClass.end_time));
    const maxCol = Math.max(
      ...assigned
        .filter(({ gymClass: other }) => {
          const oStart = getMinutesOfDay(new Date(other.start_time));
          const oEnd = getMinutesOfDay(new Date(other.end_time));
          return oStart < endMins && oEnd > startMins;
        })
        .map((o) => o.col),
    );
    return { gymClass: item.gymClass, col: item.col, totalCols: maxCol + 1 };
  });
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
  const today = useMemo(() => {
    const next = new Date();
    next.setHours(0, 0, 0, 0);
    return next;
  }, []);
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<ViewMode>('calendar');
  const [weekStartDate, setWeekStartDate] = useState(() => startOfWeek(new Date()));
  const [selectedDay, setSelectedDay] = useState(() => getWeekdayIndex(new Date()));
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [selectedInstructorId, setSelectedInstructorId] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createModalDate, setCreateModalDate] = useState<Date | null>(null);
  const [calendarHourStart, setCalendarHourStart] = useState(6);
  const [calendarHourEnd, setCalendarHourEnd] = useState(23);
  const [selectedClass, setSelectedClass] = useState<GymClass | null>(null);
  const [classToCancel, setClassToCancel] = useState<GymClass | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelSeries, setCancelSeries] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingClass, setEditingClass] = useState<GymClass | null>(null);
  const [editForm, setEditForm] = useState<ClassFormState>(() => createInitialForm(new Date()));
  const [clientSearch, setClientSearch] = useState('');
  const [enrollClientId, setEnrollClientId] = useState('');
  const [cancelingReservationId, setCancelingReservationId] = useState<string | null>(null);

  const weekDates = useMemo(() => buildWeekDays(weekStartDate), [weekStartDate]);

  const selectedDate = weekDates[selectedDay];
  const effectiveCreateDate = createModalDate ?? selectedDate;
  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: async () => (await branchesApi.list()).data,
  });

  const { data: staffList = [] } = useQuery<Array<{ id: string; full_name: string; role: string }>>({
    queryKey: ['staff'],
    queryFn: async () => (await staffApi.list()).data,
  });

  const { data: clientsData } = useQuery<PaginatedResponse<User>>({
    queryKey: ['clients-search', clientSearch],
    queryFn: async () => (await clientsApi.list({ search: clientSearch, per_page: 30 })).data,
    enabled: Boolean(selectedClass) && clientSearch.length >= 2,
  });
  const activeBranches = useMemo(
    () => branches.filter((branch) => branch.is_active),
    [branches],
  );
  const defaultBranchId = activeBranches.length === 1 ? activeBranches[0].id : '';
  const [form, setForm] = useState<ClassFormState>(() => createInitialForm(effectiveCreateDate, defaultBranchId));

  const dateFrom = new Date(selectedDate);
  dateFrom.setHours(0, 0, 0, 0);
  const dateTo = new Date(selectedDate);
  dateTo.setHours(23, 59, 59, 999);

  const computedStartDate = useMemo(
    () => combineDateAndTime(effectiveCreateDate, form.start_time),
    [effectiveCreateDate, form.start_time],
  );
  const durationMinutes = Number(form.duration_minutes) || 0;
  const computedEndDate = useMemo(() => (
    new Date(computedStartDate.getTime() + Math.max(durationMinutes, 0) * 60000)
  ), [computedStartDate, durationMinutes]);
  const createDateLongLabel = effectiveCreateDate.toLocaleDateString('es-CL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const weekRangeLabel = `${weekDates[0].toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })} - ${weekDates[6].toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  useEffect(() => {
    if (form.modality === 'in_person' && form.online_link) {
      setForm((current) => ({ ...current, online_link: '' }));
    }
  }, [form.modality, form.online_link]);

  useEffect(() => {
    if (calendarHourEnd <= calendarHourStart) {
      setCalendarHourEnd(Math.min(calendarHourStart + 1, 24));
    }
  }, [calendarHourEnd, calendarHourStart]);

  useEffect(() => {
    if (!showCreateModal || form.branch_id || !defaultBranchId) {
      return;
    }
    setForm((current) => ({ ...current, branch_id: defaultBranchId }));
  }, [defaultBranchId, form.branch_id, showCreateModal]);

  const calendarRange = useMemo(() => {
    const firstDay = weekDates[0];
    const lastDay = weekDates[weekDates.length - 1];
    const rangeStart = new Date(firstDay);
    rangeStart.setHours(0, 0, 0, 0);
    const rangeEnd = new Date(lastDay);
    rangeEnd.setHours(23, 59, 59, 999);
    return { rangeStart, rangeEnd };
  }, [weekDates]);

  const { data, isLoading, isError } = useQuery<PaginatedResponse<GymClass>>({
    queryKey: ['classes', selectedDate.toISOString(), statusFilter, selectedBranchId, selectedInstructorId],
    queryFn: async () => {
      const response = await classesApi.list({
        page: 1,
        per_page: 50,
        date_from: dateFrom.toISOString(),
        date_to: dateTo.toISOString(),
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
        ...(selectedBranchId ? { branch_id: selectedBranchId } : {}),
        ...(selectedInstructorId ? { instructor_id: selectedInstructorId } : {}),
      });
      return response.data;
    },
  });

  const {
    data: calendarData,
    isLoading: isCalendarLoading,
    isError: isCalendarError,
  } = useQuery<PaginatedResponse<GymClass>>({
    queryKey: ['classes-calendar', weekStartDate.toISOString(), statusFilter, selectedBranchId, selectedInstructorId],
    queryFn: async () => {
      const aggregatedItems: GymClass[] = [];
      let page = 1;
      let pages = 1;

      do {
        const response = await classesApi.list({
          page,
          per_page: CALENDAR_PAGE_SIZE,
          date_from: calendarRange.rangeStart.toISOString(),
          date_to: calendarRange.rangeEnd.toISOString(),
          ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
          ...(selectedBranchId ? { branch_id: selectedBranchId } : {}),
          ...(selectedInstructorId ? { instructor_id: selectedInstructorId } : {}),
        });
        const payload = response.data as PaginatedResponse<GymClass>;

        aggregatedItems.push(...(payload.items ?? []));
        pages = Math.max(payload.pages || 1, 1);
        page += 1;
      } while (page <= pages);

      return {
        items: aggregatedItems,
        total: aggregatedItems.length,
        page: 1,
        per_page: aggregatedItems.length || CALENDAR_PAGE_SIZE,
        pages: 1,
      };
    },
    enabled: viewMode === 'calendar',
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
      if (form.modality !== 'online' && !form.branch_id) {
        throw new Error(activeBranches.length ? 'Selecciona una sede para esta clase.' : 'Necesitas al menos una sede activa para agendar clases presenciales o híbridas.');
      }

      const response = await classesApi.create({
        name: form.name,
        description: form.description || null,
        class_type: form.class_type || null,
        modality: form.modality,
        branch_id: form.branch_id || null,
        instructor_id: form.instructor_id || null,
        start_time: computedStartDate.toISOString(),
        end_time: computedEndDate.toISOString(),
        max_capacity: Number(form.max_capacity),
        waitlist_enabled: form.waitlist_enabled,
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
      setCreateModalDate(null);
      setForm(createInitialForm(selectedDate, defaultBranchId));
      queryClient.invalidateQueries({ queryKey: ['classes'] });
      queryClient.invalidateQueries({ queryKey: ['classes-calendar'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] });
    },
    onError: (error: any) => {
      toast.error(error?.message || getApiError(error, 'No se pudo crear la clase'));
    },
  });

  const cancelClass = useMutation({
    mutationFn: async ({ classId, reason, series }: { classId: string; reason?: string; series?: boolean }) => {
      await classesApi.cancel(classId, { cancelReason: reason, series });
    },
    onSuccess: () => {
      toast.success('Clase cancelada');
      setClassToCancel(null);
      setCancelReason('');
      setCancelSeries(false);
      queryClient.invalidateQueries({ queryKey: ['classes'] });
      queryClient.invalidateQueries({ queryKey: ['classes-calendar'] });
      queryClient.invalidateQueries({ queryKey: ['class-reservations'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] });
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No se pudo cancelar la clase'));
    },
  });

  const updateClass = useMutation({
    mutationFn: async () => {
      if (!editingClass) throw new Error('No hay clase para editar');
      if (!editForm.start_time) throw new Error('Selecciona una hora de inicio');
      const durationMins = Number(editForm.duration_minutes) || 0;
      if (!Number.isFinite(durationMins) || durationMins < 15) throw new Error('La duración debe ser de al menos 15 minutos');
      if (!Number.isFinite(Number(editForm.max_capacity)) || Number(editForm.max_capacity) < 1) throw new Error('La capacidad debe ser mayor a cero');
      if (editForm.modality !== 'online' && !editForm.branch_id) throw new Error('Selecciona una sede para esta clase.');

      // Use editForm.start_date if set (supports date change); fallback to original
      const baseDate = editForm.start_date
        ? new Date(`${editForm.start_date}T00:00:00`)
        : new Date(editingClass.start_time);
      const computedStart = combineDateAndTime(baseDate, editForm.start_time);
      const computedEnd = new Date(computedStart.getTime() + durationMins * 60000);

      const response = await classesApi.update(editingClass.id, {
        name: editForm.name,
        description: editForm.description || null,
        class_type: editForm.class_type || null,
        modality: editForm.modality,
        branch_id: editForm.branch_id || null,
        instructor_id: editForm.instructor_id || null,
        start_time: computedStart.toISOString(),
        end_time: computedEnd.toISOString(),
        max_capacity: Number(editForm.max_capacity),
        waitlist_enabled: editForm.waitlist_enabled,
        online_link: editForm.modality === 'in_person' ? null : editForm.online_link || null,
        color: editForm.color,
      });
      return response.data;
    },
    onSuccess: () => {
      toast.success('Clase actualizada');
      setShowEditModal(false);
      setEditingClass(null);
      queryClient.invalidateQueries({ queryKey: ['classes'] });
      queryClient.invalidateQueries({ queryKey: ['classes-calendar'] });
    },
    onError: (error: any) => {
      toast.error(error?.message || getApiError(error, 'No se pudo actualizar la clase'));
    },
  });

  const enrollClient = useMutation({
    mutationFn: async (userId: string) => {
      if (!selectedClass) throw new Error('No hay clase seleccionada');
      const response = await reservationsApi.create({ gym_class_id: selectedClass.id, user_id: userId });
      return response.data;
    },
    onSuccess: () => {
      toast.success('Cliente inscrito');
      setEnrollClientId('');
      setClientSearch('');
      queryClient.invalidateQueries({ queryKey: ['class-reservations', selectedClass?.id] });
      queryClient.invalidateQueries({ queryKey: ['classes-calendar'] });
      queryClient.invalidateQueries({ queryKey: ['classes'] });
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No se pudo inscribir al cliente'));
    },
  });

  const cancelReservation = useMutation({
    mutationFn: async (reservationId: string) => {
      await reservationsApi.cancel(reservationId);
    },
    onSuccess: () => {
      toast.success('Reserva cancelada');
      setCancelingReservationId(null);
      queryClient.invalidateQueries({ queryKey: ['class-reservations', selectedClass?.id] });
      queryClient.invalidateQueries({ queryKey: ['classes-calendar'] });
      queryClient.invalidateQueries({ queryKey: ['classes'] });
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No se pudo cancelar la reserva'));
      setCancelingReservationId(null);
    },
  });

  const markNoShow = useMutation({
    mutationFn: async (reservationId: string) => {
      await reservationsApi.updateStatus(reservationId, 'no_show');
    },
    onSuccess: () => {
      toast.success('Marcado como no asistió');
      queryClient.invalidateQueries({ queryKey: ['class-reservations', selectedClass?.id] });
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No se pudo actualizar la reserva'));
    },
  });

  const markCheckin = useMutation({
    mutationFn: async ({ userId, gymClassId }: { userId: string; gymClassId: string }) => {
      await checkinsApi.create({ user_id: userId, gym_class_id: gymClassId, check_type: 'manual' });
    },
    onSuccess: () => {
      toast.success('Check-in registrado');
      queryClient.invalidateQueries({ queryKey: ['class-reservations', selectedClass?.id] });
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No se pudo registrar el check-in'));
    },
  });

  const classes = data?.items ?? [];
  const calendarClasses = calendarData?.items ?? [];
  const calendarClassesByDay = useMemo(() => (
    calendarClasses.reduce<Record<string, GymClass[]>>((accumulator, gymClass) => {
      const key = formatDateKeyFromIso(gymClass.start_time);
      accumulator[key] = accumulator[key] ? [...accumulator[key], gymClass] : [gymClass];
      return accumulator;
    }, {})
  ), [calendarClasses]);
  const classReservations = classReservationsQuery.data ?? [];
  const confirmedReservations = classReservations.filter((item) => item.status === 'confirmed' || item.status === 'attended').length;
  const waitlistedReservations = classReservations.filter((item) => item.status === 'waitlisted').length;
  const cancelledReservations = classReservations.filter((item) => item.status === 'cancelled').length;
  const dayLabel = selectedDate.toLocaleDateString('es-CL', { weekday: 'short', day: '2-digit', month: 'short' });
  const selectedDayLongLabel = selectedDate.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });
  const calendarStartMinutes = calendarHourStart * 60;
  const calendarEndMinutes = calendarHourEnd * 60;
  const calendarHourSlots = useMemo(
    () => Array.from({ length: Math.max(calendarHourEnd - calendarHourStart, 1) }, (_, index) => calendarHourStart + index),
    [calendarHourEnd, calendarHourStart],
  );

  const handleViewModeChange = (nextMode: ViewMode) => {
    setViewMode(nextMode);
  };

  const openCreateModalForDate = (date: Date, hour = 9, minutes = 0) => {
    const nextDate = new Date(date);
    nextDate.setHours(hour, minutes, 0, 0);
    const dayIndex = weekDates.findIndex((item) => isSameDay(item, date));
    if (dayIndex >= 0) {
      setSelectedDay(dayIndex);
    }
    setCreateModalDate(nextDate);
    setForm(createInitialForm(nextDate, defaultBranchId));
    setShowCreateModal(true);
  };

  const openEditModal = (gymClass: GymClass) => {
    setEditingClass(gymClass);
    setEditForm(gymClassToFormState(gymClass));
    setShowEditModal(true);
  };

  const goToToday = () => {
    setWeekStartDate(startOfWeek(today));
    setSelectedDay(getWeekdayIndex(today));
  };

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-6">
      <motion.div variants={fadeInUp} className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Clases</h1>
          <p className="mt-1 text-sm text-surface-500">
            {viewMode === 'calendar'
              ? `Agenda semanal ${weekRangeLabel}`
              : viewMode === 'cards'
                ? `Vista en tarjetas para ${dayLabel}`
                : `Vista en lista para ${dayLabel}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => openCreateModalForDate(selectedDate, viewMode === 'calendar' ? calendarHourStart : 9)}
            className="btn-primary text-sm"
          >
            <Plus size={16} /> Nueva Clase
          </motion.button>
        </div>
      </motion.div>

      <motion.div variants={fadeInUp} className="flex w-fit items-center gap-1 rounded-xl bg-surface-100 p-1 dark:bg-surface-800">
        {(['cards', 'list', 'calendar'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => handleViewModeChange(mode)}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition-all duration-200',
              viewMode === mode
                ? 'bg-white text-surface-900 shadow-sm dark:bg-surface-700 dark:text-white'
                : 'text-surface-500 hover:text-surface-700',
            )}
          >
            {mode === 'cards' ? 'Tarjetas' : mode === 'list' ? 'Lista' : 'Calendario'}
          </button>
        ))}
      </motion.div>

      <motion.div
        variants={fadeInUp}
        className="rounded-2xl border border-surface-200/50 bg-white p-4 dark:border-surface-800/50 dark:bg-surface-900"
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-surface-400">
              {viewMode === 'calendar' ? 'Filtros del calendario' : 'Filtros de la vista diaria'}
            </p>
            <p className="mt-1 text-sm text-surface-500">
              {viewMode === 'calendar'
                ? 'Configura sede, estado y el rango horario que quieres ver en la agenda.'
                : 'Tarjetas y lista comparten el mismo día, sede y estado.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2 rounded-xl border border-surface-200 px-3 py-2 text-sm text-surface-500 dark:border-surface-700 dark:text-surface-300">
              <Filter size={15} />
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                className="bg-transparent outline-none"
              >
                <option value="all">Todas</option>
                <option value="scheduled">Programadas</option>
                <option value="in_progress">En curso</option>
                <option value="completed">Finalizadas</option>
                <option value="cancelled">Canceladas</option>
              </select>
            </div>

            {activeBranches.length > 1 ? (
              <select
                value={selectedBranchId}
                onChange={(event) => setSelectedBranchId(event.target.value)}
                className="input min-w-[210px] text-sm"
              >
                <option value="">Todas las sedes</option>
                {activeBranches.map((branch) => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
              </select>
            ) : null}

            {staffList.length > 0 ? (
              <select
                value={selectedInstructorId}
                onChange={(event) => setSelectedInstructorId(event.target.value)}
                className="input min-w-[210px] text-sm"
              >
                <option value="">Todos los instructores</option>
                {staffList.map((staff) => (
                  <option key={staff.id} value={staff.id}>{staff.full_name}</option>
                ))}
              </select>
            ) : null}

            {viewMode === 'calendar' ? (
              <>
                <select
                  value={calendarHourStart}
                  onChange={(event) => setCalendarHourStart(Number(event.target.value))}
                  className="input min-w-[132px] text-sm"
                >
                  {CALENDAR_HOUR_OPTIONS.filter((hour) => hour < calendarHourEnd).map((hour) => (
                    <option key={`start-${hour}`} value={hour}>
                      Desde {formatHourLabel(hour)}
                    </option>
                  ))}
                </select>
                <select
                  value={calendarHourEnd}
                  onChange={(event) => setCalendarHourEnd(Number(event.target.value))}
                  className="input min-w-[132px] text-sm"
                >
                  {CALENDAR_HOUR_OPTIONS.filter((hour) => hour > calendarHourStart).map((hour) => (
                    <option key={`end-${hour}`} value={hour}>
                      Hasta {formatHourLabel(hour)}
                    </option>
                  ))}
                </select>
              </>
            ) : null}
          </div>
        </div>
      </motion.div>

      {viewMode === 'calendar' ? (
        <motion.div
          variants={fadeInUp}
          className="flex flex-col gap-4 rounded-2xl border border-surface-200/50 bg-white px-4 py-4 dark:border-surface-800/50 dark:bg-surface-900 md:flex-row md:items-center md:justify-between"
        >
          <div>
            <p className="text-sm font-semibold text-surface-900 dark:text-white">{weekRangeLabel}</p>
            <p className="text-xs text-surface-500">
              Día activo: <span className="capitalize">{selectedDayLongLabel}</span>. Haz clic sobre un bloque horario para dejar una clase marcada en el calendario.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-xl p-2 transition-colors hover:bg-surface-100 dark:hover:bg-surface-800"
                onClick={() => setWeekStartDate((current) => addWeeks(current, -1))}
              >
                <ChevronLeft size={16} className="text-surface-500" />
              </button>
              <button
                type="button"
                className="btn-secondary text-sm"
                onClick={goToToday}
              >
                Hoy
              </button>
              <button
                type="button"
                className="rounded-xl p-2 transition-colors hover:bg-surface-100 dark:hover:bg-surface-800"
                onClick={() => setWeekStartDate((current) => addWeeks(current, 1))}
              >
                <ChevronRight size={16} className="text-surface-500" />
              </button>
            </div>

            <div className="rounded-xl border border-surface-200 px-3 py-2 dark:border-surface-700">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-surface-400">Horario visible</p>
              <p className="text-sm font-medium text-surface-700 dark:text-surface-200">
                {formatHourLabel(calendarHourStart)} - {formatHourLabel(calendarHourEnd)}
              </p>
            </div>
          </div>
        </motion.div>
      ) : (
        <div className="space-y-3">
          <motion.div
            variants={fadeInUp}
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-surface-200/50 bg-white px-4 py-3 dark:border-surface-800/50 dark:bg-surface-900"
          >
            <div>
              <p className="text-sm font-semibold text-surface-900 dark:text-white">{weekRangeLabel}</p>
              <p className="text-xs text-surface-500">Cambia de semana y luego elige el día que quieres revisar.</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-xl p-2 transition-colors hover:bg-surface-100 dark:hover:bg-surface-800"
                onClick={() => setWeekStartDate((current) => addWeeks(current, -1))}
              >
                <ChevronLeft size={16} className="text-surface-500" />
              </button>
              <button type="button" className="btn-secondary text-sm" onClick={goToToday}>
                Hoy
              </button>
              <button
                type="button"
                className="rounded-xl p-2 transition-colors hover:bg-surface-100 dark:hover:bg-surface-800"
                onClick={() => setWeekStartDate((current) => addWeeks(current, 1))}
              >
                <ChevronRight size={16} className="text-surface-500" />
              </button>
            </div>
          </motion.div>

          <motion.div
            variants={fadeInUp}
            className="flex items-center gap-2 overflow-x-auto rounded-2xl border border-surface-200/50 bg-white p-1 dark:border-surface-800/50 dark:bg-surface-900"
          >
            {weekDates.map((date, index) => (
              <motion.button
                key={date.toISOString()}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => setSelectedDay(index)}
                className={cn(
                  'min-w-[84px] flex-1 rounded-xl px-3 py-2.5 text-center transition-all duration-200',
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
          </motion.div>
        </div>
      )}

      {(isError || (viewMode === 'calendar' && isCalendarError)) ? (
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
            viewMode === 'calendar' && 'space-y-4',
          )}
        >
          {(viewMode === 'calendar' ? isCalendarLoading : isLoading) ? (
            Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="shimmer h-44 rounded-2xl" />
            ))
          ) : null}

          {!isLoading && viewMode !== 'calendar' && !classes.length ? (
            <div className="col-span-full rounded-2xl border border-dashed border-surface-300 bg-surface-50 px-6 py-10 text-center dark:border-surface-700 dark:bg-surface-900/30">
              <CalendarDays size={28} className="mx-auto mb-3 text-surface-300 dark:text-surface-700" />
              <p className="font-medium text-surface-700 dark:text-surface-200">No hay clases para este día</p>
              <p className="mt-1 text-sm text-surface-500">
                {selectedBranchId ? 'Prueba otra sede o crea una nueva clase.' : 'Prueba otro día o crea una nueva clase.'}
              </p>
            </div>
          ) : null}

          {!isCalendarLoading && viewMode === 'calendar' ? (
            <div className="overflow-x-auto">
              <div className="min-w-[1120px] overflow-hidden rounded-[28px] border border-surface-200/70 bg-white dark:border-surface-800/70 dark:bg-surface-900">
                <div className="grid grid-cols-[88px_repeat(7,minmax(148px,1fr))] border-b border-surface-200/70 dark:border-surface-800/70">
                  <div className="border-r border-surface-200/70 bg-surface-50/80 px-3 py-4 dark:border-surface-800/70 dark:bg-surface-950/20">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-surface-400">Hora</p>
                  </div>
                  {weekDates.map((date, index) => {
                    const isToday = isSameDay(date, today);
                    const totalDayClasses = (calendarClassesByDay[formatDateKey(date)] ?? []).length;

                    return (
                      <button
                        key={date.toISOString()}
                        type="button"
                        onClick={() => setSelectedDay(index)}
                        className={cn(
                          'border-r border-surface-200/70 px-4 py-4 text-left transition-colors last:border-r-0 dark:border-surface-800/70',
                          selectedDay === index
                            ? 'bg-brand-50/80 dark:bg-brand-950/20'
                            : 'bg-white hover:bg-surface-50 dark:bg-surface-900 dark:hover:bg-surface-800/70',
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-surface-400">
                              {date.toLocaleDateString('es-CL', { weekday: 'short' })}
                            </p>
                            <p className="mt-1 text-lg font-bold font-display text-surface-900 dark:text-white">
                              {date.toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })}
                            </p>
                          </div>
                          <span
                            className={cn(
                              'inline-flex rounded-full px-2 py-1 text-[11px] font-semibold',
                              isToday
                                ? 'bg-brand-500 text-white'
                                : 'bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-300',
                            )}
                          >
                            {`${totalDayClasses} ${totalDayClasses === 1 ? 'clase' : 'clases'}`}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="grid grid-cols-[88px_repeat(7,minmax(148px,1fr))]">
                  <div className="border-r border-surface-200/70 bg-surface-50/70 dark:border-surface-800/70 dark:bg-surface-950/20">
                    {calendarHourSlots.map((hour) => (
                      <div
                        key={`hour-${hour}`}
                        className="flex h-[72px] items-start border-b border-surface-200/70 px-3 pt-2 text-xs font-medium text-surface-500 last:border-b-0 dark:border-surface-800/70 dark:text-surface-400"
                      >
                        {formatHourLabel(hour)}
                      </div>
                    ))}
                  </div>

                  {weekDates.map((date, index) => {
                    const dateKey = formatDateKey(date);
                    const isColToday = isSameDay(date, today);
                    const dayClasses = (calendarClassesByDay[dateKey] ?? []).sort(
                      (left, right) => new Date(left.start_time).getTime() - new Date(right.start_time).getTime(),
                    );
                    const visibleDayClasses = dayClasses.filter((gymClass) => {
                      const startMinutes = getMinutesOfDay(new Date(gymClass.start_time));
                      const endMinutes = getMinutesOfDay(new Date(gymClass.end_time));
                      return endMinutes > calendarStartMinutes && startMinutes < calendarEndMinutes;
                    });
                    const dayLayout = computeDayLayout(visibleDayClasses);

                    return (
                      <div
                        key={dateKey}
                        className={cn(
                          'relative border-r border-surface-200/70 last:border-r-0 dark:border-surface-800/70',
                          selectedDay === index ? 'bg-brand-50/30 dark:bg-brand-950/10'
                            : isColToday ? 'bg-amber-50/40 dark:bg-amber-950/10'
                              : '',
                        )}
                      >
                        {/* Today indicator strip */}
                        {isColToday ? (
                          <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-amber-400/60" />
                        ) : null}

                        {calendarHourSlots.map((hour) => (
                          <button
                            key={`${dateKey}-${hour}`}
                            type="button"
                            onClick={() => openCreateModalForDate(date, hour)}
                            className="group flex h-[72px] w-full items-start border-b border-surface-200/70 px-3 pt-2 text-left transition-colors hover:bg-brand-50/70 last:border-b-0 dark:border-surface-800/70 dark:hover:bg-brand-950/20"
                          >
                            <span className="rounded-full bg-white/90 px-2 py-1 text-[10px] font-medium text-brand-600 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 dark:bg-surface-900/90 dark:text-brand-300">
                              + Clase
                            </span>
                          </button>
                        ))}

                        {dayLayout.map(({ gymClass, col, totalCols }) => {
                          const start = new Date(gymClass.start_time);
                          const end = new Date(gymClass.end_time);
                          const visibleStartMinutes = Math.max(getMinutesOfDay(start), calendarStartMinutes);
                          const visibleEndMinutes = Math.min(getMinutesOfDay(end), calendarEndMinutes);

                          if (visibleEndMinutes <= calendarStartMinutes || visibleStartMinutes >= calendarEndMinutes) {
                            return null;
                          }

                          const top = ((visibleStartMinutes - calendarStartMinutes) / 60) * CALENDAR_SLOT_HEIGHT;
                          const rawHeight = ((visibleEndMinutes - visibleStartMinutes) / 60) * CALENDAR_SLOT_HEIGHT;
                          const height = Math.max(rawHeight - 8, 30);
                          const leftPct = (col / totalCols) * 100;
                          const rightPct = ((totalCols - col - 1) / totalCols) * 100;
                          const isTiny = height < 50;

                          return (
                            <button
                              key={gymClass.id}
                              type="button"
                              onClick={() => setSelectedClass(gymClass)}
                              className="absolute z-10 overflow-hidden rounded-2xl px-2.5 py-2 text-left shadow-lg shadow-surface-950/5 ring-1 ring-black/5 transition-transform hover:scale-[1.01]"
                              style={{
                                top: `${top + 4}px`,
                                height: `${height}px`,
                                left: `calc(${leftPct}% + 5px)`,
                                right: `calc(${rightPct}% + 5px)`,
                                backgroundColor: gymClass.color || '#06b6d4',
                                opacity: gymClass.status === 'cancelled' ? 0.5 : 1,
                              }}
                            >
                              <div className="flex h-full flex-col justify-between text-white">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold leading-tight">{gymClass.name}</p>
                                  {!isTiny ? (
                                    <p className="mt-0.5 text-[10px] font-medium text-white/85">
                                      {formatTime(gymClass.start_time)} – {formatTime(gymClass.end_time)}
                                    </p>
                                  ) : null}
                                </div>
                                {!isTiny ? (
                                  <div className="mt-1 space-y-0.5 text-[10px] text-white/85">
                                    <div className="flex items-center gap-1">
                                      <span className="truncate">{gymClass.branch_name || formatClassModalityLabel(gymClass.modality)}</span>
                                      <span className="shrink-0">{gymClass.current_bookings}/{gymClass.max_capacity}</span>
                                    </div>
                                    {gymClass.instructor_name ? (
                                      <p className="truncate">{gymClass.instructor_name}</p>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            </button>
                          );
                        })}

                        {!visibleDayClasses.length ? (
                          <div
                            className="pointer-events-none absolute inset-x-3 rounded-2xl border border-dashed border-surface-200/80 bg-white/50 px-3 py-2 text-[11px] text-surface-400 dark:border-surface-700/70 dark:bg-surface-950/10 dark:text-surface-500"
                            style={{ top: '8px' }}
                          >
                            {dayClasses.length ? 'Fuera del rango visible' : 'Sin clases'}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
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
                  {gymClass.branch_name ? (
                    <div className="flex items-center gap-2">
                      <MapPin size={14} />
                      <span>{gymClass.branch_name}</span>
                    </div>
                  ) : null}
                  {gymClass.instructor_name ? (
                    <div className="flex items-center gap-2">
                      <UserCircle size={14} />
                      <span>{gymClass.instructor_name}</span>
                    </div>
                  ) : null}
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
                  {!isCancelled ? (
                    <button
                      type="button"
                      onClick={() => openEditModal(gymClass)}
                      className="btn-secondary flex-1 text-sm"
                    >
                      Editar
                    </button>
                  ) : null}
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
                        setCancelSeries(false);
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
                  {formatDateTime(gymClass.start_time)}
                  {' · '}
                  {gymClass.class_type === 'personal_training' ? '⚡ Sesión 1:1' : (gymClass.class_type || 'Clase general')}
                  {gymClass.branch_name ? ` · ${gymClass.branch_name}` : ''}
                  {gymClass.instructor_name ? ` · ${gymClass.instructor_name}` : ''}
                  {' · '}
                  {gymClass.current_bookings}/{gymClass.max_capacity}
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
                {gymClass.status !== 'cancelled' ? (
                  <button
                    type="button"
                    onClick={() => openEditModal(gymClass)}
                    className="btn-secondary text-sm"
                  >
                    Editar
                  </button>
                ) : null}
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
                      setCancelSeries(false);
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

        </motion.div>
      </AnimatePresence>

      <Modal
        open={showCreateModal}
        title="Nueva clase"
        description="Usa los atajos para definir la clase más rápido y agendarla en el día seleccionado."
        onClose={() => {
          if (!createClass.isPending) {
            setShowCreateModal(false);
            setCreateModalDate(null);
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
              <p className="capitalize">{createDateLongLabel}</p>
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

          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">
              Descripción
              <span className="ml-2 text-xs font-normal text-surface-400">Opcional — visible para los clientes</span>
            </label>
            <textarea
              className="input min-h-[72px] resize-y"
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="Ej: Clase de alta intensidad con música. Trae agua y toalla."
              maxLength={500}
            />
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
                <p>Sede: {activeBranches.find((branch) => branch.id === form.branch_id)?.name || (form.modality === 'online' ? 'Sin sede física' : 'Por definir')}</p>
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

          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">
              Sede
              <span className="ml-2 text-xs font-normal text-surface-400">
                {form.modality === 'online' ? 'Opcional para clases online' : 'Obligatoria para clases presenciales e híbridas'}
              </span>
            </label>
            <select
              className="input"
              value={form.branch_id}
              onChange={(event) => setForm((current) => ({ ...current, branch_id: event.target.value }))}
              required={form.modality !== 'online'}
              disabled={!activeBranches.length}
            >
              <option value="">{form.modality === 'online' ? 'Sin sede física' : 'Selecciona una sede'}</option>
              {activeBranches.map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.name}</option>
              ))}
            </select>
            {!activeBranches.length ? (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-300">
                Necesitas al menos una sede activa para programar clases presenciales o híbridas.
              </p>
            ) : null}
          </div>

          {staffList.length > 0 ? (
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Instructor</label>
              <select
                className="input"
                value={form.instructor_id}
                onChange={(event) => setForm((current) => ({ ...current, instructor_id: event.target.value }))}
              >
                <option value="">Sin instructor asignado</option>
                {staffList.map((staff) => (
                  <option key={staff.id} value={staff.id}>{staff.full_name}</option>
                ))}
              </select>
            </div>
          ) : null}

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

          <label className="flex cursor-pointer items-center gap-3">
            <div
              role="checkbox"
              aria-checked={form.waitlist_enabled}
              onClick={() => setForm((current) => ({ ...current, waitlist_enabled: !current.waitlist_enabled }))}
              className={cn(
                'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none',
                form.waitlist_enabled ? 'bg-brand-500' : 'bg-surface-300 dark:bg-surface-600',
              )}
            >
              <span
                className={cn(
                  'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-md ring-0 transition-transform',
                  form.waitlist_enabled ? 'translate-x-5' : 'translate-x-0',
                )}
              />
            </div>
            <div>
              <p className="text-sm font-medium text-surface-700 dark:text-surface-300">Lista de espera</p>
              <p className="text-xs text-surface-400">Cuando la clase esté llena, los clientes pueden anotarse en espera</p>
            </div>
          </label>

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
                  min={effectiveCreateDate.toISOString().slice(0, 10)}
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
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setShowCreateModal(false);
                setCreateModalDate(null);
              }}
            >
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={createClass.isPending}>
              {createClass.isPending ? 'Creando...' : form.repeat_type !== 'none' ? 'Crear serie' : 'Crear clase'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={showEditModal}
        title={editingClass ? `Editar ${editingClass.name}` : 'Editar clase'}
        description="Modifica los datos de esta clase. Los cambios se aplican solo a esta instancia."
        onClose={() => {
          if (!updateClass.isPending) {
            setShowEditModal(false);
            setEditingClass(null);
          }
        }}
        size="lg"
      >
        {editingClass ? (
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              updateClass.mutate();
            }}
          >
            {/* Día y hora actuales */}
            <div className="rounded-2xl border border-brand-200 bg-brand-50/70 p-4 dark:border-brand-900/40 dark:bg-brand-950/20">
              <p className="text-sm font-semibold text-surface-900 dark:text-white">Fecha y hora</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-surface-500">Día de la clase</label>
                  <input
                    type="date"
                    className="input text-sm"
                    value={editForm.start_date}
                    onChange={(event) => setEditForm((current) => ({ ...current, start_date: event.target.value }))}
                    required
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-surface-500">Hora de inicio</label>
                  <input
                    type="time"
                    className="input text-sm"
                    value={editForm.start_time}
                    onChange={(event) => setEditForm((current) => ({ ...current, start_time: event.target.value }))}
                    required
                  />
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {START_TIME_PRESETS.map((timeValue) => (
                      <button
                        key={timeValue}
                        type="button"
                        onClick={() => setEditForm((current) => ({ ...current, start_time: timeValue }))}
                        className={cn(
                          'rounded-full border px-2.5 py-1 text-xs transition-colors',
                          editForm.start_time === timeValue
                            ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-brand-950/20 dark:text-brand-300'
                            : 'border-surface-200 text-surface-600 hover:border-surface-300 dark:border-surface-800 dark:text-surface-300',
                        )}
                      >
                        {timeValue}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Tipo de clase */}
            <div>
              <label className="mb-3 block text-sm font-medium text-surface-700 dark:text-surface-300">
                Tipo de clase
                <span className="ml-2 text-xs font-normal text-surface-400">Elige un preset o escribe uno personalizado</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {CLASS_TYPE_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => setEditForm((current) => applyClassTypeChange(current, preset.value, preset))}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                      editForm.class_type === preset.value
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
                  value={editForm.name}
                  onChange={(event) => setEditForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Ej: Yoga AM, Spinning Intermedio..."
                  required
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Categoría</label>
                <input
                  className="input"
                  value={editForm.class_type}
                  onChange={(event) => setEditForm((current) => applyClassTypeChange(current, event.target.value))}
                  placeholder="Ej: yoga, crossfit, spinning..."
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">
                Descripción
                <span className="ml-2 text-xs font-normal text-surface-400">Opcional</span>
              </label>
              <textarea
                className="input min-h-[72px] resize-y"
                value={editForm.description}
                onChange={(event) => setEditForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="Ej: Clase de alta intensidad con música."
                maxLength={500}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="space-y-4 rounded-2xl border border-surface-200 bg-white p-4 dark:border-surface-800 dark:bg-surface-950/20">
                <div>
                  <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Duración</label>
                  <div className="flex flex-wrap gap-2">
                    {DURATION_PRESETS.map((minutes) => (
                      <button
                        key={minutes}
                        type="button"
                        onClick={() => setEditForm((current) => ({ ...current, duration_minutes: String(minutes) }))}
                        className={cn(
                          'rounded-full border px-3 py-1.5 text-sm transition-colors',
                          Number(editForm.duration_minutes) === minutes
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
                    value={editForm.duration_minutes}
                    onChange={(event) => setEditForm((current) => ({ ...current, duration_minutes: event.target.value }))}
                    placeholder="Duración personalizada en minutos"
                  />
                </div>
              </div>

              <div className="space-y-4 rounded-2xl border border-surface-200 bg-white p-4 dark:border-surface-800 dark:bg-surface-950/20">
                <div>
                  <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Capacidad</label>
                  <div className="flex flex-wrap gap-2">
                    {CAPACITY_PRESETS.map((cap) => (
                      <button
                        key={cap}
                        type="button"
                        onClick={() => setEditForm((current) => ({ ...current, max_capacity: String(cap) }))}
                        className={cn(
                          'rounded-full border px-3 py-1.5 text-sm transition-colors',
                          Number(editForm.max_capacity) === cap
                            ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-brand-950/20 dark:text-brand-300'
                            : 'border-surface-200 text-surface-600 hover:border-surface-300 dark:border-surface-800 dark:text-surface-300',
                        )}
                      >
                        {cap}
                      </button>
                    ))}
                  </div>
                  <input
                    type="number"
                    min="1"
                    className="input mt-3"
                    value={editForm.max_capacity}
                    onChange={(event) => setEditForm((current) => ({ ...current, max_capacity: event.target.value }))}
                    placeholder="Capacidad personalizada"
                    required
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="mb-3 block text-sm font-medium text-surface-700 dark:text-surface-300">Modalidad</label>
              <div className="grid gap-3 sm:grid-cols-3">
                {([
                  { value: 'in_person', label: 'Presencial' },
                  { value: 'online', label: 'Online' },
                  { value: 'hybrid', label: 'Híbrida' },
                ] as const).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setEditForm((current) => ({ ...current, modality: option.value }))}
                    className={cn(
                      'rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition-colors',
                      editForm.modality === option.value
                        ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-brand-950/20 dark:text-brand-300'
                        : 'border-surface-200 bg-white text-surface-700 hover:border-surface-300 dark:border-surface-800 dark:bg-surface-950/20 dark:text-surface-200',
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
              <div>
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">
                  Sede
                  {editForm.modality !== 'online' ? <span className="ml-2 text-xs font-normal text-surface-400">Obligatoria</span> : null}
                </label>
                <select
                  className="input"
                  value={editForm.branch_id}
                  onChange={(event) => setEditForm((current) => ({ ...current, branch_id: event.target.value }))}
                  required={editForm.modality !== 'online'}
                >
                  <option value="">{editForm.modality === 'online' ? 'Sin sede física' : 'Selecciona una sede'}</option>
                  {activeBranches.map((branch) => (
                    <option key={branch.id} value={branch.id}>{branch.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Color</label>
                <input
                  type="color"
                  className="input h-11 w-full min-w-[88px] p-2"
                  value={editForm.color}
                  onChange={(event) => setEditForm((current) => ({ ...current, color: event.target.value }))}
                />
              </div>
            </div>

            {staffList.length > 0 ? (
              <div>
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Instructor</label>
                <select
                  className="input"
                  value={editForm.instructor_id}
                  onChange={(event) => setEditForm((current) => ({ ...current, instructor_id: event.target.value }))}
                >
                  <option value="">Sin instructor asignado</option>
                  {staffList.map((staff) => (
                    <option key={staff.id} value={staff.id}>{staff.full_name}</option>
                  ))}
                </select>
              </div>
            ) : null}

            {(editForm.modality === 'online' || editForm.modality === 'hybrid') ? (
              <div>
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Enlace para la clase</label>
                <input
                  type="url"
                  className="input"
                  value={editForm.online_link}
                  onChange={(event) => setEditForm((current) => ({ ...current, online_link: event.target.value }))}
                  placeholder="https://zoom.us/..."
                />
              </div>
            ) : null}

            <label className="flex cursor-pointer items-center gap-3">
              <div
                role="checkbox"
                aria-checked={editForm.waitlist_enabled}
                onClick={() => setEditForm((current) => ({ ...current, waitlist_enabled: !current.waitlist_enabled }))}
                className={cn(
                  'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
                  editForm.waitlist_enabled ? 'bg-brand-500' : 'bg-surface-300 dark:bg-surface-600',
                )}
              >
                <span
                  className={cn(
                    'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-md ring-0 transition-transform',
                    editForm.waitlist_enabled ? 'translate-x-5' : 'translate-x-0',
                  )}
                />
              </div>
              <div>
                <p className="text-sm font-medium text-surface-700 dark:text-surface-300">Lista de espera</p>
                <p className="text-xs text-surface-400">Cuando la clase esté llena, los clientes pueden anotarse en espera</p>
              </div>
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => { setShowEditModal(false); setEditingClass(null); }}
                disabled={updateClass.isPending}
              >
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={updateClass.isPending}>
                {updateClass.isPending ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(selectedClass)}
        title={selectedClass ? `Inscritos en ${selectedClass.name}` : 'Inscritos'}
        description={selectedClass ? `${formatDateTime(selectedClass.start_time)}${selectedClass.branch_name ? ` · ${selectedClass.branch_name}` : ''} · ${selectedClass.current_bookings}/${selectedClass.max_capacity} reservas activas` : ''}
        onClose={() => {
          setSelectedClass(null);
          setClientSearch('');
          setEnrollClientId('');
          setCancelingReservationId(null);
        }}
        size="lg"
      >
        <div className="space-y-5">
          {selectedClass?.description ? (
            <p className="rounded-2xl bg-surface-50 px-4 py-3 text-sm text-surface-600 dark:bg-surface-800/40 dark:text-surface-300">
              {selectedClass.description}
            </p>
          ) : null}

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
              {classReservations.map((reservation) => {
                const isActive = reservation.status === 'confirmed' || reservation.status === 'waitlisted';
                const isCancelingThis = cancelingReservationId === reservation.id;
                return (
                  <div
                    key={reservation.id}
                    className="rounded-2xl border border-surface-200/60 bg-white px-4 py-4 dark:border-surface-800 dark:bg-surface-950/20"
                  >
                    {isCancelingThis ? (
                      <div className="space-y-3">
                        <p className="text-sm font-medium text-surface-700 dark:text-surface-200">
                          ¿Cancelar la reserva de <span className="font-semibold">{reservation.user_name}</span>?
                        </p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="btn-danger text-sm"
                            disabled={cancelReservation.isPending}
                            onClick={() => cancelReservation.mutate(reservation.id)}
                          >
                            {cancelReservation.isPending ? 'Cancelando...' : 'Confirmar'}
                          </button>
                          <button
                            type="button"
                            className="btn-secondary text-sm"
                            onClick={() => setCancelingReservationId(null)}
                          >
                            Volver
                          </button>
                        </div>
                      </div>
                    ) : (
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
                        {isActive || reservation.status === 'attended' ? (
                          <div className="flex shrink-0 flex-wrap gap-1.5">
                            {reservation.status === 'confirmed' ? (
                              <button
                                type="button"
                                className="btn-secondary text-xs"
                                disabled={markCheckin.isPending || markNoShow.isPending}
                                onClick={() => selectedClass && markCheckin.mutate({ userId: reservation.user_id, gymClassId: selectedClass.id })}
                              >
                                Check-in
                              </button>
                            ) : null}
                            {(reservation.status === 'confirmed' || reservation.status === 'attended') ? (
                              <button
                                type="button"
                                className="btn-secondary text-xs"
                                disabled={markNoShow.isPending}
                                onClick={() => markNoShow.mutate(reservation.id)}
                              >
                                No asistió
                              </button>
                            ) : null}
                            {isActive ? (
                              <button
                                type="button"
                                className="btn-danger text-xs"
                                onClick={() => setCancelingReservationId(reservation.id)}
                              >
                                <Ban size={12} /> Cancelar
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}

          {selectedClass && selectedClass.status !== 'cancelled' ? (
            <div className="rounded-2xl border border-surface-200 bg-surface-50 p-4 dark:border-surface-800 dark:bg-surface-950/20">
              <p className="mb-3 text-sm font-semibold text-surface-900 dark:text-white">Inscribir cliente manualmente</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="input flex-1 text-sm"
                  placeholder="Buscar por nombre o email (mín. 2 caracteres)..."
                  value={clientSearch}
                  onChange={(event) => {
                    setClientSearch(event.target.value);
                    setEnrollClientId('');
                  }}
                />
              </div>
              {clientSearch.length >= 2 && clientsData?.items?.length ? (
                <div className="mt-2 space-y-1">
                  {clientsData.items.map((client) => (
                    <button
                      key={client.id}
                      type="button"
                      onClick={() => {
                        setEnrollClientId(client.id);
                        setClientSearch(`${client.first_name} ${client.last_name}`);
                      }}
                      className={cn(
                        'flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-colors',
                        enrollClientId === client.id
                          ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/20 dark:text-brand-300'
                          : 'hover:bg-white dark:hover:bg-surface-800',
                      )}
                    >
                      <span className="font-medium">{client.first_name} {client.last_name}</span>
                      <span className="text-surface-400">{client.email}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              {clientSearch.length >= 2 && !clientsData?.items?.length ? (
                <p className="mt-2 text-xs text-surface-400">Sin resultados para "{clientSearch}"</p>
              ) : null}
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  className="btn-primary text-sm"
                  disabled={!enrollClientId || enrollClient.isPending}
                  onClick={() => enrollClient.mutate(enrollClientId)}
                >
                  {enrollClient.isPending ? 'Inscribiendo...' : 'Inscribir'}
                </button>
              </div>
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
            setCancelSeries(false);
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
              series: cancelSeries,
            });
          }}
        >
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
            Esta acción cancelará la clase y también las reservas confirmadas o en lista de espera asociadas.
          </div>

          {classToCancel?.recurrence_group_id ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-surface-700 dark:text-surface-300">¿Qué clases cancelar?</p>
              {([
                { value: false, label: 'Solo esta clase', description: 'Cancela únicamente esta instancia de la serie.' },
                { value: true, label: 'Esta y todas las futuras', description: 'Cancela esta clase y todas las siguientes de la misma serie.' },
              ] as const).map((option) => (
                <button
                  key={String(option.value)}
                  type="button"
                  onClick={() => setCancelSeries(option.value)}
                  className={cn(
                    'w-full rounded-xl border px-4 py-3 text-left transition-colors',
                    cancelSeries === option.value
                      ? 'border-rose-300 bg-rose-50 dark:border-rose-700 dark:bg-rose-950/20'
                      : 'border-surface-200 bg-white hover:border-surface-300 dark:border-surface-800 dark:bg-surface-950/20',
                  )}
                >
                  <p className="text-sm font-semibold text-surface-900 dark:text-white">{option.label}</p>
                  <p className="mt-0.5 text-xs text-surface-500">{option.description}</p>
                </button>
              ))}
            </div>
          ) : null}

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
                setCancelSeries(false);
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
