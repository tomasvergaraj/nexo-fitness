import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { CalendarDays, Dumbbell, Plus, XCircle } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import Modal from '@/components/ui/Modal';
import {
  DeviceStatusItem,
  EmptyState,
  Panel,
  SkeletonListItems,
} from '../components/MemberShared';
import { formatDateTime, getApiError } from '@/utils';
import { mobileApi, programBookingsApi, classesApi } from '@/services/api';
import type { GymClass, PaginatedResponse, TrainingProgram } from '@/types';
import { useMemberContext } from '../MemberContext';

export default function ProgramsTab() {
  const {
    programs,
    programsQuery,
    programBookings,
    enrolledPrograms,
    enrolledProgramIds,
    brandGradient,
    setAgendaProgramFilter,
    navigateTo,
    queryClient,
  } = useMemberContext();

  const [pendingBookingProgram, setPendingBookingProgram] = useState<TrainingProgram | null>(null);
  const [bookingPreviewClasses, setBookingPreviewClasses] = useState<GymClass[] | null>(null);
  const [bookingPreviewLoading, setBookingPreviewLoading] = useState(false);
  const [pendingCancelBookingId, setPendingCancelBookingId] = useState<string | null>(null);
  const [cancelBookingReason, setCancelBookingReason] = useState('');

  // ── Mutations ──────────────────────────────────────────────────────────────

  const enrollProgramMutation = useMutation({
    mutationFn: async (programId: string) => (await mobileApi.enrollProgram(programId)).data,
    onSuccess: async () => {
      toast.success('Te inscribiste al programa.');
      await queryClient.invalidateQueries({ queryKey: ['member-programs'] });
    },
    onError: (error: unknown) =>
      toast.error(getApiError(error, 'No se pudo completar la inscripción.')),
  });

  const leaveProgramMutation = useMutation({
    mutationFn: async (programId: string) => mobileApi.leaveProgram(programId),
    onSuccess: async () => {
      toast.success('Dejaste el programa.');
      await queryClient.invalidateQueries({ queryKey: ['member-programs'] });
    },
    onError: (error: unknown) =>
      toast.error(getApiError(error, 'No se pudo quitar la inscripción.')),
  });

  const createProgramBookingMutation = useMutation({
    mutationFn: async (data: { program_id: string; recurrence_group_id: string }) =>
      (await programBookingsApi.create(data)).data,
    onSuccess: async () => {
      toast.success('Programa reservado.');
      setPendingBookingProgram(null);
      setBookingPreviewClasses(null);
      await queryClient.invalidateQueries({ queryKey: ['member-program-bookings'] });
      await queryClient.invalidateQueries({ queryKey: ['member-reservations'] });
    },
    onError: (error: unknown) =>
      toast.error(getApiError(error, 'No se pudo reservar el programa.')),
  });

  const cancelProgramBookingMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) =>
      programBookingsApi.cancel(id, reason ? { cancel_reason: reason } : undefined),
    onSuccess: async () => {
      toast.success('Reserva de programa cancelada.');
      setPendingCancelBookingId(null);
      setCancelBookingReason('');
      await queryClient.invalidateQueries({ queryKey: ['member-program-bookings'] });
      await queryClient.invalidateQueries({ queryKey: ['member-reservations'] });
    },
    onError: (error: unknown) =>
      toast.error(getApiError(error, 'No se pudo cancelar la reserva.')),
  });

  // ── Local helpers ──────────────────────────────────────────────────────────

  async function openProgramBookingModal(program: TrainingProgram) {
    setPendingBookingProgram(program);
    setBookingPreviewClasses(null);
    setBookingPreviewLoading(true);
    try {
      const response = await classesApi.list({
        program_id: program.id,
        per_page: 100,
        sort_order: 'asc',
      });
      const allClasses = (response.data as PaginatedResponse<GymClass>).items ?? [];
      const now = new Date();
      setBookingPreviewClasses(
        allClasses.filter((c) => new Date(c.start_time) > now && c.status !== 'cancelled'),
      );
    } catch {
      toast.error('No se pudieron cargar las clases del programa.');
      setPendingBookingProgram(null);
    } finally {
      setBookingPreviewLoading(false);
    }
  }

  // ── Computed ───────────────────────────────────────────────────────────────

  const activeBookings = programBookings.filter((b) => b.status === 'active');
  const activeBookingByProgram = new Map(activeBookings.map((b) => [b.program_id ?? '', b]));

  // ── Booking recurrence_group_id helper ────────────────────────────────────
  // The API requires a recurrence_group_id; we pick it from the first preview class.
  const bookingRecurrenceGroupId = useMemo(() => {
    if (!bookingPreviewClasses?.length) return null;
    return bookingPreviewClasses.find((c) => c.recurrence_group_id)?.recurrence_group_id ?? null;
  }, [bookingPreviewClasses]);

  // ── Day label helper ───────────────────────────────────────────────────────

  function dayLabel(day: string): string {
    const map: Record<string, string> = {
      monday: 'Lunes',
      tuesday: 'Martes',
      wednesday: 'Miércoles',
      thursday: 'Jueves',
      friday: 'Viernes',
      saturday: 'Sábado',
      sunday: 'Domingo',
    };
    return map[day.toLowerCase()] ?? day;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
      className="space-y-4"
    >
      {programsQuery.isLoading && !programsQuery.data ? (
        <SkeletonListItems count={3} />
      ) : (
        <>
          {/* ── Panel overview ── */}
          <Panel title="Programas de entrenamiento">
            <p className="text-sm leading-6 text-surface-600 dark:text-surface-300">
              Inscríbete en un programa para llevar un seguimiento estructurado de tu entrenamiento.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <DeviceStatusItem
                label="Disponibles"
                value={`${programs.length}`}
                tone="info"
              />
              <DeviceStatusItem
                label="Inscrito"
                value={`${enrolledPrograms.length}`}
                tone="success"
              />
              <DeviceStatusItem
                label="Reservas activas"
                value={`${activeBookings.length}`}
                tone="success"
              />
            </div>
          </Panel>

          {/* ── Active program bookings ── */}
          {activeBookings.length > 0 ? (
            <Panel title="Mis reservas de programa">
              <div className="space-y-3">
                {activeBookings.map((booking) => {
                  const reserved = booking.reserved_classes;
                  const total = booking.total_classes;
                  const progressPct = total > 0 ? Math.min((reserved / total) * 100, 100) : 0;

                  return (
                    <div
                      key={booking.id}
                      className="rounded-2xl border border-surface-200 bg-surface-50 p-4 dark:border-white/10 dark:bg-surface-950/30"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-surface-900 dark:text-white">
                            {booking.program_name ?? 'Programa'}
                          </p>
                          <p className="mt-0.5 text-xs text-surface-500 dark:text-surface-400">
                            {reserved} reservadas · {booking.waitlisted_classes} en espera ·{' '}
                            {total} total
                          </p>
                        </div>
                        <button
                          type="button"
                          className="btn-secondary shrink-0 inline-flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-400"
                          onClick={() => setPendingCancelBookingId(booking.id)}
                        >
                          <XCircle size={13} />
                          Cancelar
                        </button>
                      </div>

                      {/* Progress bar */}
                      <div className="mt-3">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-200 dark:bg-white/10">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${progressPct}%`, background: brandGradient }}
                          />
                        </div>
                        <p className="mt-1 text-[10px] text-surface-500 dark:text-surface-400">
                          {Math.round(progressPct)}% de clases reservadas
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>
          ) : null}

          {/* ── Program cards grid ── */}
          {programs.length === 0 && !programsQuery.isLoading ? (
            <EmptyState
              title="Sin programas disponibles"
              description="El gimnasio aún no tiene programas publicados. Vuelve más tarde."
            />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {programs.map((program) => {
                const isEnrolled = enrolledProgramIds.has(program.id);
                const activeBooking = activeBookingByProgram.get(program.id);
                const hasLinkedClasses = program.linked_class_count > 0;

                return (
                  <Panel key={program.id} title={program.name}>
                    {/* Status badges */}
                    <div className="flex flex-wrap gap-2">
                      {isEnrolled ? (
                        <span className="badge badge-success">Inscrito</span>
                      ) : (
                        <span className="badge badge-info">Disponible</span>
                      )}
                      {program.duration_weeks > 0 ? (
                        <span className="badge badge-neutral">
                          {program.duration_weeks} sem.
                        </span>
                      ) : (
                        <span className="badge badge-neutral">Sin límite</span>
                      )}
                      {activeBooking ? (
                        <span className="badge badge-warning">Reservado</span>
                      ) : null}
                    </div>

                    {/* Description */}
                    {program.description ? (
                      <p className="mt-3 text-sm leading-6 text-surface-600 dark:text-surface-300">
                        {program.description}
                      </p>
                    ) : null}

                    {/* Details */}
                    <div className="mt-3 space-y-1">
                      {program.trainer_name ? (
                        <div className="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-300">
                          <Dumbbell size={13} className="shrink-0 text-surface-400" />
                          <span>{program.trainer_name}</span>
                        </div>
                      ) : null}
                      {program.program_type ? (
                        <div className="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-300">
                          <CalendarDays size={13} className="shrink-0 text-surface-400" />
                          <span>{program.program_type}</span>
                        </div>
                      ) : null}
                    </div>

                    {/* Weekly schedule */}
                    {program.schedule.length > 0 ? (
                      <div className="mt-4 space-y-2">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-surface-500">
                          Horario semanal
                        </p>
                        {program.schedule.map((schedDay, idx) => (
                          <div
                            key={idx}
                            className="rounded-xl border border-surface-200 bg-surface-50 px-3 py-2.5 dark:border-white/10 dark:bg-surface-950/30"
                          >
                            <div className="flex items-baseline gap-2">
                              <span className="text-sm font-bold text-surface-900 dark:text-white">
                                {dayLabel(schedDay.day)}
                              </span>
                              {schedDay.focus ? (
                                <span className="text-xs text-surface-500 dark:text-surface-400">
                                  {schedDay.focus}
                                </span>
                              ) : null}
                            </div>
                            {schedDay.exercises.length > 0 ? (
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {schedDay.exercises.map((ex, exIdx) => (
                                  <span
                                    key={exIdx}
                                    className="rounded-full bg-surface-200/70 px-2 py-0.5 text-[11px] text-surface-700 dark:bg-white/10 dark:text-surface-300"
                                  >
                                    {ex.name}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {/* CTAs */}
                    <div className="mt-4 flex flex-wrap gap-2">
                      {isEnrolled ? (
                        <>
                          <button
                            type="button"
                            className="btn-primary inline-flex items-center gap-2 text-sm"
                            style={{ background: brandGradient }}
                            onClick={() => {
                              navigateTo('agenda');
                              setAgendaProgramFilter(program.id);
                            }}
                          >
                            <CalendarDays size={14} />
                            Ver en agenda
                          </button>

                          {hasLinkedClasses && !activeBooking ? (
                            <button
                              type="button"
                              disabled={createProgramBookingMutation.isPending}
                              className="btn-secondary inline-flex items-center gap-2 text-sm"
                              onClick={() => void openProgramBookingModal(program)}
                            >
                              <Plus size={14} />
                              Reservar programa
                            </button>
                          ) : null}

                          {activeBooking ? (
                            <button
                              type="button"
                              disabled={cancelProgramBookingMutation.isPending}
                              className="btn-secondary inline-flex items-center gap-2 text-sm text-rose-600 dark:text-rose-400"
                              onClick={() => setPendingCancelBookingId(activeBooking.id)}
                            >
                              <XCircle size={14} />
                              Cancelar reserva
                            </button>
                          ) : null}

                          <button
                            type="button"
                            disabled={leaveProgramMutation.isPending}
                            className="btn-secondary text-sm"
                            onClick={() => leaveProgramMutation.mutate(program.id)}
                          >
                            {leaveProgramMutation.isPending &&
                            leaveProgramMutation.variables === program.id
                              ? 'Saliendo…'
                              : 'Salir del programa'}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={enrollProgramMutation.isPending}
                          className="btn-primary inline-flex items-center gap-2 text-sm"
                          style={{ background: brandGradient }}
                          onClick={() => enrollProgramMutation.mutate(program.id)}
                        >
                          <Plus size={14} />
                          {enrollProgramMutation.isPending &&
                          enrollProgramMutation.variables === program.id
                            ? 'Inscribiéndote…'
                            : 'Inscribirme'}
                        </button>
                      )}
                    </div>
                  </Panel>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── Book program modal ── */}
      <Modal
        open={Boolean(pendingBookingProgram)}
        title={pendingBookingProgram ? `Reservar: ${pendingBookingProgram.name}` : 'Reservar programa'}
        description="Revisa las clases incluidas y confirma tu reserva."
        onClose={() => {
          setPendingBookingProgram(null);
          setBookingPreviewClasses(null);
        }}
      >
        {bookingPreviewLoading ? (
          <SkeletonListItems count={3} />
        ) : bookingPreviewClasses !== null ? (
          <div className="space-y-4">
            {bookingPreviewClasses.length === 0 ? (
              <EmptyState
                title="Sin clases próximas"
                description="No hay clases futuras disponibles en este programa para reservar."
              />
            ) : (
              <>
                <div className="space-y-2">
                  {bookingPreviewClasses.map((gymClass) => {
                    const isFull = gymClass.current_bookings >= gymClass.max_capacity;
                    return (
                      <div
                        key={gymClass.id}
                        className="flex items-center justify-between gap-3 rounded-2xl border border-surface-200 bg-surface-50 px-4 py-3 dark:border-white/10 dark:bg-surface-950/30"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-surface-900 dark:text-white">
                            {gymClass.name}
                          </p>
                          <p className="mt-0.5 text-xs text-surface-500 dark:text-surface-400">
                            {formatDateTime(gymClass.start_time)}
                          </p>
                        </div>
                        <div className="shrink-0">
                          {isFull && !gymClass.waitlist_enabled ? (
                            <span className="badge badge-danger">Llena</span>
                          ) : isFull && gymClass.waitlist_enabled ? (
                            <span className="badge badge-warning">Lista espera</span>
                          ) : (
                            <span className="badge badge-success">
                              {gymClass.max_capacity - gymClass.current_bookings} cupos
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      setPendingBookingProgram(null);
                      setBookingPreviewClasses(null);
                    }}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={
                      createProgramBookingMutation.isPending || !bookingRecurrenceGroupId
                    }
                    className="btn-primary"
                    style={{ background: brandGradient }}
                    onClick={() => {
                      if (!pendingBookingProgram || !bookingRecurrenceGroupId) return;
                      createProgramBookingMutation.mutate({
                        program_id: pendingBookingProgram.id,
                        recurrence_group_id: bookingRecurrenceGroupId,
                      });
                    }}
                  >
                    {createProgramBookingMutation.isPending ? 'Reservando…' : 'Confirmar reserva'}
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}
      </Modal>

      {/* ── Cancel program booking modal ── */}
      <Modal
        open={Boolean(pendingCancelBookingId)}
        title="Cancelar reserva de programa"
        description="¿Confirmas que deseas cancelar esta reserva? Se cancelarán todas las clases reservadas del programa."
        onClose={() => {
          setPendingCancelBookingId(null);
          setCancelBookingReason('');
        }}
      >
        <div className="space-y-4">
          <div>
            <label
              htmlFor="cancel-booking-reason"
              className="mb-1.5 block text-sm font-medium text-surface-700 dark:text-surface-300"
            >
              Motivo{' '}
              <span className="text-surface-400 dark:text-surface-500">(opcional)</span>
            </label>
            <textarea
              id="cancel-booking-reason"
              value={cancelBookingReason}
              onChange={(e) => setCancelBookingReason(e.target.value)}
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
                setPendingCancelBookingId(null);
                setCancelBookingReason('');
              }}
            >
              Volver
            </button>
            <button
              type="button"
              disabled={cancelProgramBookingMutation.isPending}
              className="btn-primary bg-rose-600 hover:bg-rose-700"
              onClick={() => {
                if (!pendingCancelBookingId) return;
                cancelProgramBookingMutation.mutate({
                  id: pendingCancelBookingId,
                  reason: cancelBookingReason || undefined,
                });
              }}
            >
              {cancelProgramBookingMutation.isPending ? 'Cancelando…' : 'Cancelar programa'}
            </button>
          </div>
        </div>
      </Modal>
    </motion.div>
  );
}
