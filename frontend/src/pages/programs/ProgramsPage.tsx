import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { CalendarDays, Dumbbell, Plus, Repeat2, Users, X } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { programsApi, staffApi } from '@/services/api';
import { cn, getApiError } from '@/utils';
import { fadeInUp, staggerContainer } from '@/utils/animations';
import type { PaginatedResponse, TrainingProgram } from '@/types';

const WEEK_DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

type ScheduleDay = { day: string; focus: string };

type ProgramForm = {
  id?: string;
  name: string;
  description: string;
  trainer_id: string;
  program_type: string;
  duration_weeks: string;
  schedule: ScheduleDay[];
  is_active: boolean;
};

function createEmptyForm(trainerId = ''): ProgramForm {
  return {
    name: '',
    description: '',
    trainer_id: trainerId,
    program_type: 'fuerza',
    duration_weeks: '0',
    schedule: [
      { day: 'Lunes', focus: '' },
      { day: 'Miércoles', focus: '' },
      { day: 'Viernes', focus: '' },
    ],
    is_active: true,
  };
}

function toForm(program?: TrainingProgram): ProgramForm {
  if (!program) return createEmptyForm();
  const rawSchedule = Array.isArray(program.schedule) ? program.schedule as ScheduleDay[] : [];
  return {
    id: program.id,
    name: program.name,
    description: program.description ?? '',
    trainer_id: program.trainer_id ?? '',
    program_type: program.program_type ?? '',
    duration_weeks: String(program.duration_weeks ?? 0),
    schedule: rawSchedule.length ? rawSchedule : createEmptyForm().schedule,
    is_active: program.is_active,
  };
}

function ScheduleBuilder({
  value,
  onChange,
}: {
  value: ScheduleDay[];
  onChange: (schedule: ScheduleDay[]) => void;
}) {
  const activeDays = new Set(value.map((item) => item.day));

  function toggleDay(day: string) {
    if (activeDays.has(day)) {
      onChange(value.filter((item) => item.day !== day));
    } else {
      const newItem = { day, focus: '' };
      // Insert in week order
      const ordered = WEEK_DAYS.filter(
        (d) => d === day || activeDays.has(d)
      ).map((d) => value.find((item) => item.day === d) ?? newItem);
      onChange(ordered);
    }
  }

  function updateFocus(day: string, focus: string) {
    onChange(value.map((item) => (item.day === day ? { ...item, focus } : item)));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {WEEK_DAYS.map((day) => (
          <button
            key={day}
            type="button"
            onClick={() => toggleDay(day)}
            className={`rounded-xl border px-3 py-1.5 text-sm font-medium transition-colors ${
              activeDays.has(day)
                ? 'border-brand-400 bg-brand-50 text-brand-700 dark:border-brand-600 dark:bg-brand-950/40 dark:text-brand-300'
                : 'border-surface-200 bg-white text-surface-500 hover:border-surface-300 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-400'
            }`}
          >
            {day.slice(0, 3)}
          </button>
        ))}
      </div>

      {value.length > 0 && (
        <div className="space-y-2">
          {value.map((item) => (
            <div key={item.day} className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-sm font-medium text-surface-600 dark:text-surface-400">
                {item.day}
              </span>
              <input
                className="input flex-1"
                placeholder="Ej: Piernas, Cardio, Descanso activo..."
                value={item.focus}
                onChange={(e) => updateFocus(item.day, e.target.value)}
              />
              <button
                type="button"
                onClick={() => toggleDay(item.day)}
                className="shrink-0 rounded-lg p-1.5 text-surface-400 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-950/30"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {value.length === 0 && (
        <p className="text-sm text-surface-400">Selecciona los días de entrenamiento arriba.</p>
      )}
    </div>
  );
}

function ProgramToggleCard({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (nextValue: boolean) => void;
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border px-4 py-4 transition-colors',
        checked
          ? 'border-emerald-300 bg-emerald-50/80 dark:border-emerald-800/50 dark:bg-emerald-950/20'
          : 'border-surface-200 bg-white dark:border-surface-800 dark:bg-surface-950/20',
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-surface-900 dark:text-white">Programa activo</p>
          <p className="mt-1 text-xs leading-5 text-surface-500 dark:text-surface-400">
            Si lo pausas, dejará de estar disponible hasta que vuelvas a activarlo.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={() => onChange(!checked)}
          className={cn(
            'relative inline-flex h-7 w-12 shrink-0 rounded-full border p-0.5 transition-all duration-200 focus:outline-none',
            checked
              ? 'border-emerald-400/60 bg-emerald-500'
              : 'border-surface-300 bg-surface-200 dark:border-white/10 dark:bg-white/10',
          )}
        >
          <span
            className={cn(
              'absolute left-0.5 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white shadow-sm transition-transform duration-200',
              checked ? 'translate-x-5' : 'translate-x-0',
            )}
          />
        </button>
      </div>
    </div>
  );
}

export default function ProgramsPage() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<ProgramForm>(createEmptyForm());

  const { data, isLoading, isError } = useQuery<PaginatedResponse<TrainingProgram>>({
    queryKey: ['programs'],
    queryFn: async () => {
      const response = await programsApi.list({ page: 1, per_page: 50 });
      return response.data;
    },
  });

  const { data: staffList = [] } = useQuery({
    queryKey: ['staff'],
    queryFn: async () => {
      const response = await staffApi.list();
      return response.data;
    },
    enabled: showModal,
  });

  const trainers = staffList.filter((s) => s.role === 'trainer' || s.role === 'admin' || s.role === 'owner');
  const defaultOwnerTrainerId = useMemo(
    () => trainers.find((trainer) => trainer.role === 'owner')?.id ?? '',
    [trainers],
  );

  useEffect(() => {
    if (!showModal || form.id || form.trainer_id || !defaultOwnerTrainerId) {
      return;
    }

    setForm((current) => ({ ...current, trainer_id: defaultOwnerTrainerId }));
  }, [defaultOwnerTrainerId, form.id, form.trainer_id, showModal]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        description: form.description || null,
        trainer_id: form.trainer_id || null,
        program_type: form.program_type || null,
        duration_weeks: Number(form.duration_weeks) || 0,
        schedule: form.schedule,
        is_active: form.is_active,
      };

      if (form.id) {
        const response = await programsApi.update(form.id, payload);
        return response.data;
      }

      const response = await programsApi.create(payload);
      return response.data;
    },
    onSuccess: () => {
      toast.success(form.id ? 'Programa actualizado' : 'Programa creado');
      setShowModal(false);
      setForm(createEmptyForm(defaultOwnerTrainerId));
      queryClient.invalidateQueries({ queryKey: ['programs'] });
    },
    onError: (error: unknown) => {
      toast.error(getApiError(error, 'No se pudo guardar el programa'));
    },
  });

  const programs = data?.items ?? [];
  const activePrograms = programs.filter((program) => program.is_active).length;
  const totalWeeks = programs.reduce((sum, program) => sum + (program.duration_weeks || 0), 0);
  const indefinitePrograms = programs.filter((p) => !p.duration_weeks).length;
  const totalEnrollments = programs.reduce((sum, program) => sum + (program.enrolled_count ?? 0), 0);

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-6">
      <motion.div variants={fadeInUp} className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Programas</h1>
          <p className="mt-1 text-sm text-surface-500">Planes de entrenamiento persistentes que tus clientes ya pueden tomar desde la app member</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setForm(createEmptyForm(defaultOwnerTrainerId));
            setShowModal(true);
          }}
          className="btn-primary"
        >
          <Plus size={16} />
          Nuevo programa
        </button>
      </motion.div>

      {isError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-600 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
          No pudimos cargar los programas.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
          <p className="text-sm text-surface-500">Programas activos</p>
          <p className="mt-2 text-3xl font-bold font-display text-surface-900 dark:text-white">{activePrograms}</p>
        </div>
        <div className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
          <p className="text-sm text-surface-500">Semanas planificadas</p>
          <p className="mt-2 text-3xl font-bold font-display text-surface-900 dark:text-white">
            {totalWeeks || <span className="text-surface-400">—</span>}
          </p>
          {indefinitePrograms > 0 ? (
            <p className="mt-1 text-xs text-surface-400">{indefinitePrograms} indefinido{indefinitePrograms !== 1 ? 's' : ''}</p>
          ) : null}
        </div>
        <div className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
          <p className="text-sm text-surface-500">Total catálogo</p>
          <p className="mt-2 text-3xl font-bold font-display text-surface-900 dark:text-white">{programs.length}</p>
        </div>
        <div className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
          <p className="text-sm text-surface-500">Inscripciones</p>
          <p className="mt-2 text-3xl font-bold font-display text-surface-900 dark:text-white">{totalEnrollments}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, index) => <div key={index} className="shimmer h-56 rounded-3xl" />)
        ) : programs.map((program) => (
          <motion.button
            type="button"
            key={program.id}
            variants={fadeInUp}
            onClick={() => {
              setForm(toForm(program));
              setShowModal(true);
            }}
            className="rounded-3xl border border-surface-200/50 bg-white p-6 text-left transition-all hover:-translate-y-1 hover:shadow-xl dark:border-surface-800/50 dark:bg-surface-900"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-500 dark:bg-brand-950/40">
                <Dumbbell size={22} />
              </div>
              <span className={`badge ${program.is_active ? 'badge-success' : 'badge-warning'}`}>
                {program.is_active ? 'Activo' : 'Pausado'}
              </span>
            </div>

            <h2 className="mt-5 text-xl font-semibold font-display text-surface-900 dark:text-white">{program.name}</h2>
            <p className="mt-2 text-sm leading-6 text-surface-500">{program.description || 'Sin descripción todavía.'}</p>

            <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-2xl bg-surface-50 px-4 py-3 dark:bg-surface-950/60">
                <div className="flex items-center gap-2 text-surface-500"><CalendarDays size={15} /> Duración</div>
                <p className="mt-2 font-semibold text-surface-900 dark:text-white">
                  {program.duration_weeks ? `${program.duration_weeks} semanas` : 'Sin límite'}
                </p>
              </div>
              <div className="rounded-2xl bg-surface-50 px-4 py-3 dark:bg-surface-950/60">
                <div className="flex items-center gap-2 text-surface-500"><Repeat2 size={15} /> Tipo</div>
                <p className="mt-2 font-semibold capitalize text-surface-900 dark:text-white">{program.program_type || 'General'}</p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-dashed border-surface-300 px-4 py-4 dark:border-surface-700">
              <div className="flex items-center gap-2 text-sm text-surface-500">
                <Users size={15} />
                Trainer asignado
              </div>
              <p className="mt-2 text-sm font-medium text-surface-900 dark:text-white">{program.trainer_name || 'Sin asignar'}</p>
            </div>

            <div className="mt-4 rounded-2xl border border-surface-200/70 bg-surface-50 px-4 py-4 dark:border-surface-800 dark:bg-surface-950/40">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-surface-900 dark:text-white">Clientes inscritos</p>
                  <p className="mt-1 text-xs text-surface-500 dark:text-surface-400">
                    Disponible para autoinscripción desde la app member.
                  </p>
                </div>
                <span className="text-2xl font-bold font-display text-surface-900 dark:text-white">{program.enrolled_count}</span>
              </div>
            </div>
          </motion.button>
        ))}
      </div>

      <Modal
        open={showModal}
        title={form.id ? 'Editar programa' : 'Nuevo programa'}
        description="Configura los datos del programa y su horario semanal de entrenamiento."
        onClose={() => {
          if (!saveMutation.isPending) {
            setShowModal(false);
          }
        }}
      >
        <form
          className="space-y-5"
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
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Tipo de programa</label>
              <select className="input" value={form.program_type} onChange={(event) => setForm((current) => ({ ...current, program_type: event.target.value }))}>
                <option value="fuerza">Fuerza</option>
                <option value="cardio">Cardio</option>
                <option value="funcional">Funcional</option>
                <option value="hiit">HIIT</option>
                <option value="yoga">Yoga / Flexibilidad</option>
                <option value="perdida_peso">Pérdida de peso</option>
                <option value="ganancia_muscular">Ganancia muscular</option>
                <option value="general">General</option>
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Trainer responsable</label>
              <select
                className="input"
                value={form.trainer_id}
                onChange={(event) => setForm((current) => ({ ...current, trainer_id: event.target.value }))}
              >
                <option value="">Sin asignar</option>
                {trainers.map((trainer) => (
                  <option key={trainer.id} value={trainer.id}>
                    {trainer.full_name} ({trainer.role})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Duración (semanas)</label>
              <input type="number" min="0" className="input" value={form.duration_weeks} onChange={(event) => setForm((current) => ({ ...current, duration_weeks: event.target.value }))} />
              <p className="mt-1 text-xs text-surface-400">
                {form.duration_weeks === '0' || form.duration_weeks === ''
                  ? '0 = Sin límite de duración (programa indefinido)'
                  : `El programa dura ${form.duration_weeks} semanas`}
              </p>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Descripción</label>
            <textarea className="input min-h-20 resize-y" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="Describe el objetivo y características del programa..." />
          </div>

          <div>
            <label className="mb-3 block text-sm font-medium text-surface-700 dark:text-surface-300">
              Horario semanal
              <span className="ml-2 text-xs font-normal text-surface-400">Selecciona los días y especifica el enfoque de cada sesión</span>
            </label>
            <ScheduleBuilder
              value={form.schedule}
              onChange={(schedule) => setForm((current) => ({ ...current, schedule }))}
            />
          </div>

          <ProgramToggleCard
            checked={form.is_active}
            onChange={(nextValue) => setForm((current) => ({ ...current, is_active: nextValue }))}
          />

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Guardando...' : form.id ? 'Guardar cambios' : 'Crear programa'}
            </button>
          </div>
        </form>
      </Modal>
    </motion.div>
  );
}
