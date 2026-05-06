import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '@/components/ui/Modal';
import {
  DeviceStatusItem,
  EmptyState,
  Panel,
  ProfileDetailItem,
  SkeletonListItems,
} from '../components/MemberShared';
import {
  cn,
  classStatusColor,
  formatClassModalityLabel,
  formatClassStatusLabel,
  formatTime,
  formatRelative,
} from '@/utils';
import { mobileApi } from '@/services/api';
import {
  getAgendaDateKey,
  getAgendaDayMeta,
  formatAgendaTimeRange,
  formatAgendaAvailabilityLabel,
  getReservationStatusLabel,
} from '../memberUtils';
import { useMemberContext } from '../MemberContext';

export default function AgendaTab() {
  const {
    classes,
    classesQuery,
    reservations,
    wallet,
    enrolledPrograms,
    accentColor,
    brandGradient,
    setAgendaWeekOffset,
    agendaWeekDates,
    agendaProgramFilter,
    setAgendaProgramFilter,
    reserveMutation,
    cancelMutation,
  } = useMemberContext();

  const [agendaSelectedDay, setAgendaSelectedDay] = useState<string | null>(null);
  const [expandedClassId, setExpandedClassId] = useState<string | null>(null);
  const [agendaModalityFilter, setAgendaModalityFilter] = useState<string>('all');
  const [agendaBranchFilter, setAgendaBranchFilter] = useState<string>('all');
  const [pendingCancelReservationId, setPendingCancelReservationId] = useState<string | null>(null);
  const [cancelReasonText, setCancelReasonText] = useState('');

  const reservationByClassId = useMemo(
    () => new Map(reservations.map((r) => [r.gym_class_id, r])),
    [reservations],
  );

  const agendaModalities = useMemo(
    () => Array.from(new Set(classes.map((c) => c.modality).filter(Boolean))).sort(),
    [classes],
  );

  const agendaBranches = useMemo(
    () =>
      Array.from(
        new Map(
          classes
            .filter((c) => c.branch_id && c.branch_name)
            .map((c) => [c.branch_id!, { id: c.branch_id!, name: c.branch_name! }]),
        ).values(),
      ).sort((a, b) => a.name.localeCompare(b.name, 'es-CL')),
    [classes],
  );

  const filteredClasses = useMemo(() => {
    return classes.filter((c) => {
      if (agendaSelectedDay !== null && getAgendaDateKey(c.start_time) !== agendaSelectedDay)
        return false;
      if (agendaModalityFilter !== 'all' && c.modality !== agendaModalityFilter) return false;
      if (agendaBranchFilter !== 'all' && c.branch_id !== agendaBranchFilter) return false;
      if (agendaProgramFilter !== 'all' && c.program_id !== agendaProgramFilter) return false;
      return true;
    });
  }, [classes, agendaSelectedDay, agendaModalityFilter, agendaBranchFilter, agendaProgramFilter]);

  const reservedVisibleClasses = filteredClasses.filter((c) =>
    reservationByClassId.has(c.id),
  ).length;
  const classesWithAvailableSpots = filteredClasses.filter(
    (c) => c.current_bookings < c.max_capacity,
  ).length;

  const classesByDayKey = useMemo(() => {
    const map: Record<string, number> = {};
    filteredClasses.forEach((c) => {
      const key = getAgendaDateKey(c.start_time);
      map[key] = (map[key] ?? 0) + 1;
    });
    return map;
  }, [filteredClasses]);

  const agendaGroups = useMemo(() => {
    const grouped = new Map<string, { date: Date; key: string; items: typeof classes }>();
    filteredClasses.forEach((c) => {
      const key = getAgendaDateKey(c.start_time);
      if (!grouped.has(key)) {
        grouped.set(key, { date: new Date(c.start_time), key, items: [] });
      }
      grouped.get(key)!.items.push(c);
    });
    return Array.from(grouped.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [filteredClasses]);

  const todayKey = getAgendaDateKey(new Date());

  const showSecondaryFilters =
    agendaModalities.length > 1 || agendaBranches.length > 1 || enrolledPrograms.length > 0;

  const hasWeekQuota =
    Boolean(wallet?.max_reservations_per_week) || Boolean(wallet?.max_reservations_per_month);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
      className="space-y-4"
    >
      {classesQuery.isLoading && !classesQuery.data ? (
        <SkeletonListItems count={4} />
      ) : (
        <>
          {/* ── Panel principal ── */}
          <Panel title="Tu agenda">
            <p className="text-sm leading-6 text-surface-600 dark:text-surface-300">
              Clases disponibles para la semana seleccionada. Reserva tu lugar con anticipación.
            </p>

            {/* Stats */}
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <DeviceStatusItem
                label="Clases visibles"
                value={`${filteredClasses.length}`}
                tone="info"
              />
              <DeviceStatusItem
                label="Tus reservas"
                value={`${reservedVisibleClasses}`}
                tone="success"
              />
              <DeviceStatusItem
                label="Con cupos"
                value={`${classesWithAvailableSpots}`}
                tone="warning"
              />
            </div>

            {/* Download calendar */}
            <div className="mt-3">
              <button
                type="button"
                className="btn-secondary text-sm inline-flex items-center gap-2"
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

            {/* Quota bar */}
            {hasWeekQuota ? (
              <div className="mt-4 rounded-2xl border border-surface-200 bg-surface-50 p-4 dark:border-white/10 dark:bg-surface-950/40">
                <p className="mb-3 text-[11px] uppercase tracking-[0.18em] text-surface-500">
                  Cuota de reservas
                </p>
                <div className="space-y-3">
                  {wallet?.max_reservations_per_week ? (
                    <div>
                      <div className="mb-1 flex items-center justify-between text-xs text-surface-600 dark:text-surface-300">
                        <span>Semanal</span>
                        <span>
                          {wallet.weekly_reservations_used ?? 0} / {wallet.max_reservations_per_week}
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-200 dark:bg-white/10">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.min(
                              ((wallet.weekly_reservations_used ?? 0) /
                                wallet.max_reservations_per_week) *
                                100,
                              100,
                            )}%`,
                            background: brandGradient,
                          }}
                        />
                      </div>
                      {(wallet.weekly_reservations_used ?? 0) >=
                      wallet.max_reservations_per_week ? (
                        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                          Alcanzaste el límite semanal de reservas.
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {wallet?.max_reservations_per_month ? (
                    <div>
                      <div className="mb-1 flex items-center justify-between text-xs text-surface-600 dark:text-surface-300">
                        <span>Mensual</span>
                        <span>
                          {wallet.monthly_reservations_used ?? 0} /{' '}
                          {wallet.max_reservations_per_month}
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-200 dark:bg-white/10">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.min(
                              ((wallet.monthly_reservations_used ?? 0) /
                                wallet.max_reservations_per_month) *
                                100,
                              100,
                            )}%`,
                            background: brandGradient,
                          }}
                        />
                      </div>
                      {(wallet.monthly_reservations_used ?? 0) >=
                      wallet.max_reservations_per_month ? (
                        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                          Alcanzaste el límite mensual de reservas.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {/* Secondary filters */}
            {showSecondaryFilters ? (
              <div className="mt-4 space-y-3">
                {agendaModalities.length > 1 ? (
                  <div>
                    <p className="mb-2 text-[11px] uppercase tracking-[0.18em] text-surface-500">
                      Modalidad
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setAgendaModalityFilter('all')}
                        className={cn(
                          'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                          agendaModalityFilter === 'all'
                            ? 'text-white'
                            : 'bg-surface-100 text-surface-700 hover:bg-surface-200 dark:bg-white/10 dark:text-surface-300 dark:hover:bg-white/15',
                        )}
                        style={agendaModalityFilter === 'all' ? { background: brandGradient } : {}}
                      >
                        Todas las modalidades
                      </button>
                      {agendaModalities.map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setAgendaModalityFilter(m)}
                          className={cn(
                            'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                            agendaModalityFilter === m
                              ? 'text-white'
                              : 'bg-surface-100 text-surface-700 hover:bg-surface-200 dark:bg-white/10 dark:text-surface-300 dark:hover:bg-white/15',
                          )}
                          style={agendaModalityFilter === m ? { background: brandGradient } : {}}
                        >
                          {formatClassModalityLabel(m)}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {agendaBranches.length > 1 ? (
                  <div>
                    <p className="mb-2 text-[11px] uppercase tracking-[0.18em] text-surface-500">
                      Sede
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setAgendaBranchFilter('all')}
                        className={cn(
                          'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                          agendaBranchFilter === 'all'
                            ? 'text-white'
                            : 'bg-surface-100 text-surface-700 hover:bg-surface-200 dark:bg-white/10 dark:text-surface-300 dark:hover:bg-white/15',
                        )}
                        style={agendaBranchFilter === 'all' ? { background: brandGradient } : {}}
                      >
                        Todas las sedes
                      </button>
                      {agendaBranches.map((b) => (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => setAgendaBranchFilter(b.id)}
                          className={cn(
                            'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                            agendaBranchFilter === b.id
                              ? 'text-white'
                              : 'bg-surface-100 text-surface-700 hover:bg-surface-200 dark:bg-white/10 dark:text-surface-300 dark:hover:bg-white/15',
                          )}
                          style={agendaBranchFilter === b.id ? { background: brandGradient } : {}}
                        >
                          {b.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {enrolledPrograms.length > 0 ? (
                  <div>
                    <p className="mb-2 text-[11px] uppercase tracking-[0.18em] text-surface-500">
                      Programa
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setAgendaProgramFilter('all')}
                        className={cn(
                          'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                          agendaProgramFilter === 'all'
                            ? 'text-white'
                            : 'bg-surface-100 text-surface-700 hover:bg-surface-200 dark:bg-white/10 dark:text-surface-300 dark:hover:bg-white/15',
                        )}
                        style={agendaProgramFilter === 'all' ? { background: brandGradient } : {}}
                      >
                        Todos los programas
                      </button>
                      {enrolledPrograms.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setAgendaProgramFilter(p.id)}
                          className={cn(
                            'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                            agendaProgramFilter === p.id
                              ? 'text-white'
                              : 'bg-surface-100 text-surface-700 hover:bg-surface-200 dark:bg-white/10 dark:text-surface-300 dark:hover:bg-white/15',
                          )}
                          style={agendaProgramFilter === p.id ? { background: brandGradient } : {}}
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </Panel>

          {/* ── Week strip ── */}
          <div className="overflow-hidden rounded-2xl border border-surface-200/80 bg-white/85 dark:border-white/10 dark:bg-white/[0.04]">
            <div className="flex items-center gap-1 p-2">
              {/* Prev week */}
              <button
                type="button"
                onClick={() => setAgendaWeekOffset((n) => n - 1)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-surface-500 transition-colors hover:bg-surface-100 hover:text-surface-900 dark:text-surface-400 dark:hover:bg-white/10 dark:hover:text-white"
                aria-label="Semana anterior"
              >
                <ChevronLeft size={18} />
              </button>

              {/* Scrollable day chips */}
              <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
                {/* Ver todas chip */}
                <button
                  type="button"
                  onClick={() => setAgendaSelectedDay(null)}
                  className={cn(
                    'shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors',
                    agendaSelectedDay === null
                      ? 'text-white'
                      : 'text-surface-600 hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-white/10',
                  )}
                  style={agendaSelectedDay === null ? { background: brandGradient } : {}}
                >
                  Todas
                </button>

                {agendaWeekDates.map((date) => {
                  const key = getAgendaDateKey(date);
                  const isSelected = agendaSelectedDay === key;
                  const isToday = key === todayKey;
                  const count = classesByDayKey[key] ?? 0;
                  const dayNum = date.getDate();
                  const dayLabel = date.toLocaleDateString('es-CL', { weekday: 'short' });

                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setAgendaSelectedDay(isSelected ? null : key)}
                      className={cn(
                        'relative flex shrink-0 flex-col items-center rounded-xl px-2.5 py-1.5 transition-colors',
                        isSelected
                          ? 'text-white'
                          : 'hover:bg-surface-100 dark:hover:bg-white/10',
                      )}
                      style={isSelected ? { background: brandGradient } : {}}
                    >
                      <span
                        className={cn(
                          'text-[10px] font-medium uppercase',
                          isSelected
                            ? 'text-white/80'
                            : 'text-surface-500 dark:text-surface-400',
                        )}
                      >
                        {dayLabel}
                      </span>
                      <span
                        className={cn(
                          'mt-0.5 text-sm font-bold',
                          isSelected
                            ? 'text-white'
                            : isToday
                              ? 'text-brand-600 dark:text-brand-400'
                              : 'text-surface-900 dark:text-white',
                        )}
                      >
                        {dayNum}
                      </span>
                      {count > 0 ? (
                        <span
                          className={cn(
                            'mt-0.5 h-1.5 w-1.5 rounded-full',
                            isSelected ? 'bg-white/70' : 'bg-brand-400',
                          )}
                        />
                      ) : (
                        <span className="mt-0.5 h-1.5 w-1.5" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Next week */}
              <button
                type="button"
                onClick={() => setAgendaWeekOffset((n) => n + 1)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-surface-500 transition-colors hover:bg-surface-100 hover:text-surface-900 dark:text-surface-400 dark:hover:bg-white/10 dark:hover:text-white"
                aria-label="Semana siguiente"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>

          {/* ── Class groups ── */}
          {agendaGroups.length === 0 ? (
            <EmptyState
              title="No hay clases para mostrar"
              description="No encontramos clases para la semana y filtros seleccionados."
            />
          ) : (
            <div className="space-y-5">
              {agendaGroups.map((group) => {
                const meta = getAgendaDayMeta(group.date);
                return (
                  <div key={group.key}>
                    {/* Day header */}
                    <div className="mb-2 flex items-baseline gap-2">
                      <p className="text-base font-bold text-surface-900 dark:text-white">
                        {meta.title}
                      </p>
                      <p className="text-xs text-surface-500 dark:text-surface-400">
                        {meta.subtitle}
                      </p>
                    </div>

                    {/* Class cards */}
                    <div className="space-y-2">
                      {group.items.map((gymClass) => {
                        const isExpanded = expandedClassId === gymClass.id;
                        const reservation = reservationByClassId.get(gymClass.id);
                        const hasReservation = Boolean(reservation);
                        const now = Date.now();
                        const endMs = new Date(gymClass.end_time).getTime();
                        const startMs = new Date(gymClass.start_time).getTime();
                        const isPast = endMs < now;
                        const isInProgress = startMs <= now && now < endMs;
                        const attended = reservation?.status === 'attended';
                        const reservationActive = reservation?.status !== 'cancelled';
                        const deadlineMs = (gymClass.cancellation_deadline_hours ?? 1) * 60 * 60 * 1000;
                        const canCancel =
                          hasReservation &&
                          !isPast &&
                          !isInProgress &&
                          reservationActive &&
                          (startMs - now) > deadlineMs;
                        const isFull =
                          gymClass.current_bookings >= gymClass.max_capacity &&
                          !gymClass.waitlist_enabled;
                        const availabilityPct = Math.min(
                          (gymClass.current_bookings / gymClass.max_capacity) * 100,
                          100,
                        );
                        const barColor =
                          availabilityPct >= 100
                            ? '#ef4444'
                            : availabilityPct >= 80
                              ? '#f59e0b'
                              : accentColor;
                        const classColor = gymClass.color ?? accentColor;

                        return (
                          <div
                            key={gymClass.id}
                            className="overflow-hidden rounded-2xl border border-surface-200/80 bg-white/85 shadow-sm dark:border-white/10 dark:bg-white/[0.04]"
                          >
                            {/* Compact row */}
                            <button
                              type="button"
                              className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-surface-50/60 dark:hover:bg-white/[0.03]"
                              onClick={() =>
                                setExpandedClassId(isExpanded ? null : gymClass.id)
                              }
                            >
                              {/* Color bar */}
                              <div
                                className="h-12 w-1 shrink-0 rounded-full"
                                style={{ backgroundColor: classColor }}
                              />

                              {/* Time */}
                              <div className="w-14 shrink-0 text-center">
                                <p className="text-sm font-bold text-surface-900 dark:text-white">
                                  {formatTime(gymClass.start_time)}
                                </p>
                                <p className="text-[10px] text-surface-500 dark:text-surface-400">
                                  {formatTime(gymClass.end_time)}
                                </p>
                              </div>

                              {/* Name & meta */}
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold text-surface-900 dark:text-white">
                                  {gymClass.name}
                                </p>
                                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                  {gymClass.instructor_name ? (
                                    <span className="text-[11px] text-surface-500 dark:text-surface-400">
                                      {gymClass.instructor_name}
                                    </span>
                                  ) : null}
                                  {gymClass.branch_name ? (
                                    <span className="text-[11px] text-surface-400 dark:text-surface-500">
                                      · {gymClass.branch_name}
                                    </span>
                                  ) : null}
                                </div>
                                {/* Mini occupancy bar */}
                                <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-surface-200 dark:bg-white/10">
                                  <div
                                    className="h-full rounded-full transition-all"
                                    style={{ width: `${availabilityPct}%`, backgroundColor: barColor }}
                                  />
                                </div>
                              </div>

                              {/* Badge + chevron */}
                              <div className="flex shrink-0 flex-col items-end gap-1.5">
                                {hasReservation && attended ? (
                                  <span className="badge badge-success flex items-center gap-1 text-[10px]">
                                    <CheckCircle2 size={10} />
                                    Asististe
                                  </span>
                                ) : hasReservation && isPast && reservationActive ? (
                                  <span className="badge badge-danger text-[10px]">No asististe</span>
                                ) : hasReservation && isInProgress && reservationActive ? (
                                  <span className="badge badge-neutral text-[10px]">Sin registrar</span>
                                ) : hasReservation && reservationActive ? (
                                  <span className="badge badge-success text-[10px]">Reservada</span>
                                ) : isFull ? (
                                  <span className="badge badge-danger text-[10px]">Llena</span>
                                ) : (
                                  <span className="badge badge-info text-[10px]">Disponible</span>
                                )}
                                <ChevronDown
                                  size={14}
                                  className={cn(
                                    'text-surface-400 transition-transform duration-200',
                                    isExpanded ? 'rotate-180' : '',
                                  )}
                                />
                              </div>
                            </button>

                            {/* Expanded panel */}
                            {isExpanded ? (
                              <div className="border-t border-surface-200/60 px-4 pb-4 pt-3 dark:border-white/10">
                                {/* Badges */}
                                <div className="flex flex-wrap gap-2">
                                  <span className={cn('badge', classStatusColor(gymClass.status))}>
                                    {formatClassStatusLabel(gymClass.status)}
                                  </span>
                                  <span className="badge badge-neutral">
                                    {formatClassModalityLabel(gymClass.modality)}
                                  </span>
                                  {gymClass.restricted_plan_name ? (
                                    <span className="badge badge-warning">
                                      {gymClass.restricted_plan_name}
                                    </span>
                                  ) : null}
                                  {hasReservation && reservation ? (
                                    <span className={cn('badge', attended ? 'badge-success' : isPast && reservationActive ? 'badge-danger' : isInProgress && reservationActive ? 'badge-neutral' : 'badge-success')}>
                                      {getReservationStatusLabel(reservation)}
                                    </span>
                                  ) : null}
                                </div>

                                {/* Description */}
                                {gymClass.description ? (
                                  <p className="mt-3 text-sm leading-6 text-surface-600 dark:text-surface-300">
                                    {gymClass.description}
                                  </p>
                                ) : null}

                                {/* Detail grid */}
                                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                  <ProfileDetailItem
                                    label="Horario"
                                    value={formatAgendaTimeRange(
                                      gymClass.start_time,
                                      gymClass.end_time,
                                    )}
                                  />
                                  {gymClass.instructor_name ? (
                                    <ProfileDetailItem
                                      label="Instructor"
                                      value={gymClass.instructor_name}
                                    />
                                  ) : null}
                                  {gymClass.branch_name ? (
                                    <ProfileDetailItem label="Sede" value={gymClass.branch_name} />
                                  ) : null}
                                  <ProfileDetailItem
                                    label="Cupos"
                                    value={formatAgendaAvailabilityLabel(
                                      gymClass.current_bookings,
                                      gymClass.max_capacity,
                                    )}
                                  />
                                </div>

                                {/* Occupancy bar */}
                                <div className="mt-3">
                                  <div className="mb-1 flex justify-between text-xs text-surface-500 dark:text-surface-400">
                                    <span>Ocupación</span>
                                    <span>
                                      {gymClass.current_bookings}/{gymClass.max_capacity}
                                    </span>
                                  </div>
                                  <div className="h-2 w-full overflow-hidden rounded-full bg-surface-200 dark:bg-white/10">
                                    <div
                                      className="h-full rounded-full transition-all"
                                      style={{
                                        width: `${availabilityPct}%`,
                                        backgroundColor: barColor,
                                      }}
                                    />
                                  </div>
                                </div>

                                {/* CTAs */}
                                <div className="mt-4 flex flex-wrap gap-2">
                                  {canCancel && reservation ? (
                                    <button
                                      type="button"
                                      disabled={cancelMutation.isPending}
                                      onClick={() =>
                                        setPendingCancelReservationId(reservation.id)
                                      }
                                      className="btn-secondary inline-flex items-center gap-2 text-sm text-rose-600 dark:text-rose-400"
                                    >
                                      <XCircle size={14} />
                                      Cancelar reserva
                                    </button>
                                  ) : !hasReservation &&
                                    !isPast &&
                                    !isInProgress &&
                                    gymClass.status === 'scheduled' ? (
                                    <button
                                      type="button"
                                      disabled={
                                        reserveMutation.isPending ||
                                        (isFull && !gymClass.waitlist_enabled)
                                      }
                                      onClick={() => reserveMutation.mutate(gymClass.id)}
                                      className="btn-primary inline-flex items-center gap-2 text-sm"
                                      style={{ background: brandGradient }}
                                    >
                                      {reserveMutation.isPending &&
                                      reserveMutation.variables === gymClass.id
                                        ? 'Reservando…'
                                        : isFull && gymClass.waitlist_enabled
                                          ? 'Unirse a lista de espera'
                                          : 'Reservar clase'}
                                    </button>
                                  ) : !hasReservation && (isPast || isInProgress) ? (
                                    <span className="text-xs text-surface-500 dark:text-surface-400">
                                      {isPast ? 'Clase finalizada' : 'Clase en curso'}
                                    </span>
                                  ) : null}

                                  {gymClass.online_link ? (
                                    <a
                                      href={gymClass.online_link}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="btn-secondary inline-flex items-center gap-2 text-sm"
                                    >
                                      <ExternalLink size={14} />
                                      Unirse online
                                    </a>
                                  ) : null}
                                </div>

                                {hasReservation && reservation && !isPast ? (
                                  <p className="mt-2 text-[11px] text-surface-500 dark:text-surface-400">
                                    Reservada {formatRelative(reservation.created_at)}
                                    {!canCancel && reservation.status !== 'cancelled' ? (
                                      <span className="ml-1">· Solo se puede cancelar con más de {gymClass.cancellation_deadline_hours ?? 1}h de anticipación</span>
                                    ) : null}
                                  </p>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── Cancel reservation modal ── */}
      <Modal
        open={Boolean(pendingCancelReservationId)}
        title="Cancelar reserva"
        description="¿Estás seguro de que quieres cancelar esta reserva? Esta acción no se puede deshacer."
        onClose={() => {
          setPendingCancelReservationId(null);
          setCancelReasonText('');
        }}
      >
        <div className="space-y-4">
          <div>
            <label
              htmlFor="cancel-reason"
              className="mb-1.5 block text-sm font-medium text-surface-700 dark:text-surface-300"
            >
              Motivo de cancelación{' '}
              <span className="text-surface-400 dark:text-surface-500">(opcional)</span>
            </label>
            <textarea
              id="cancel-reason"
              value={cancelReasonText}
              onChange={(e) => setCancelReasonText(e.target.value)}
              placeholder="Escribe un motivo si lo deseas…"
              rows={3}
              className="input w-full resize-none text-sm"
            />
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setPendingCancelReservationId(null);
                setCancelReasonText('');
              }}
            >
              Volver
            </button>
            <button
              type="button"
              disabled={cancelMutation.isPending}
              className="btn-primary bg-rose-600 hover:bg-rose-700"
              onClick={() => {
                if (!pendingCancelReservationId) return;
                cancelMutation.mutate(
                  {
                    reservationId: pendingCancelReservationId,
                    reason: cancelReasonText || undefined,
                  },
                  {
                    onSuccess: () => {
                      setPendingCancelReservationId(null);
                      setCancelReasonText('');
                    },
                  },
                );
              }}
            >
              {cancelMutation.isPending ? 'Cancelando…' : 'Confirmar cancelación'}
            </button>
          </div>
        </div>
      </Modal>
    </motion.div>
  );
}
