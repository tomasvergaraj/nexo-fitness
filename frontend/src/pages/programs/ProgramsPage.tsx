import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  CalendarDays,
  CheckCircle2,
  Dumbbell,
  LibraryBig,
  Link2Off,
  PencilLine,
  Plus,
  Repeat2,
  Search,
  Trash2,
  Users,
  Wand2,
  X,
} from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { branchesApi, classesApi, programsApi, staffApi } from '@/services/api';
import { cn, getApiError } from '@/utils';
import { fadeInUp, staggerContainer } from '@/utils/animations';
import type {
  GymClass,
  PaginatedResponse,
  ProgramExerciseLibraryItem,
  ProgramScheduleDay,
  ProgramScheduleExercise,
  TrainingProgram,
} from '@/types';

const WEEK_DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const EXERCISE_GROUP_SUGGESTIONS = [
  'Pecho',
  'Espalda',
  'Piernas',
  'Gluteos',
  'Hombros',
  'Brazos',
  'Core',
  'Cardio',
  'Movilidad',
];

type ProgramForm = {
  id?: string;
  name: string;
  description: string;
  trainer_id: string;
  program_type: string;
  duration_weeks: string;
  schedule: ProgramScheduleDay[];
  is_active: boolean;
};

type ExerciseLibraryForm = {
  name: string;
  group: string;
};

type GenerateForm = {
  start_date: string;
  weeks: string;
  class_time: string;
  duration_minutes: string;
  branch_id: string;
  instructor_id: string;
  max_capacity: string;
  color: string;
  class_type: string;
};

function createEmptyGenerateForm(): GenerateForm {
  const today = new Date().toISOString().split('T')[0];
  return {
    start_date: today,
    weeks: '4',
    class_time: '09:00',
    duration_minutes: '60',
    branch_id: '',
    instructor_id: '',
    max_capacity: '20',
    color: '#06b6d4',
    class_type: '',
  };
}

function createEmptyScheduleDay(day: string): ProgramScheduleDay {
  return {
    day,
    focus: '',
    exercises: [],
  };
}

function createEmptyForm(trainerId = ''): ProgramForm {
  return {
    name: '',
    description: '',
    trainer_id: trainerId,
    program_type: 'fuerza',
    duration_weeks: '0',
    schedule: [
      createEmptyScheduleDay('Lunes'),
      createEmptyScheduleDay('Miércoles'),
      createEmptyScheduleDay('Viernes'),
    ],
    is_active: true,
  };
}

function normalizeExerciseEntry(rawValue: unknown, index: number): ProgramScheduleExercise | null {
  if (typeof rawValue === 'string' && rawValue.trim()) {
    const name = rawValue.trim();
    return {
      exercise_id: `legacy-${index}-${name.toLowerCase()}`,
      name,
      group: 'General',
    };
  }

  if (!rawValue || typeof rawValue !== 'object') {
    return null;
  }

  const value = rawValue as Record<string, unknown>;
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (!name) {
    return null;
  }

  const exerciseId = typeof value.exercise_id === 'string' && value.exercise_id.trim()
    ? value.exercise_id.trim()
    : typeof value.id === 'string' && value.id.trim()
      ? value.id.trim()
      : `legacy-${index}-${name.toLowerCase()}`;

  return {
    exercise_id: exerciseId,
    name,
    group: typeof value.group === 'string' && value.group.trim() ? value.group.trim() : 'General',
  };
}

function normalizeScheduleDay(rawValue: unknown, index: number): ProgramScheduleDay {
  if (!rawValue || typeof rawValue !== 'object') {
    return createEmptyScheduleDay(WEEK_DAYS[index] ?? `Día ${index + 1}`);
  }

  const value = rawValue as Record<string, unknown>;
  const day = typeof value.day === 'string' && value.day.trim()
    ? value.day.trim()
    : WEEK_DAYS[index] ?? `Día ${index + 1}`;
  const exercises = Array.isArray(value.exercises)
    ? value.exercises
        .map((exercise, exerciseIndex) => normalizeExerciseEntry(exercise, exerciseIndex))
        .filter((exercise): exercise is ProgramScheduleExercise => Boolean(exercise))
    : [];

  return {
    day,
    focus: typeof value.focus === 'string' ? value.focus : '',
    exercises,
  };
}

function toForm(program?: TrainingProgram): ProgramForm {
  if (!program) return createEmptyForm();
  const rawSchedule = Array.isArray(program.schedule) ? program.schedule : [];

  return {
    id: program.id,
    name: program.name,
    description: program.description ?? '',
    trainer_id: program.trainer_id ?? '',
    program_type: program.program_type ?? '',
    duration_weeks: String(program.duration_weeks ?? 0),
    schedule: rawSchedule.length ? rawSchedule.map((entry, index) => normalizeScheduleDay(entry, index)) : createEmptyForm().schedule,
    is_active: program.is_active,
  };
}

function countProgramExercises(program: TrainingProgram): number {
  if (!Array.isArray(program.schedule)) {
    return 0;
  }

  return program.schedule.reduce((sum, entry, index) => {
    const scheduleDay = normalizeScheduleDay(entry, index);
    return sum + scheduleDay.exercises.length;
  }, 0);
}

function groupScheduledExercises(exercises: ProgramScheduleExercise[]) {
  const groups = new Map<string, ProgramScheduleExercise[]>();

  exercises.forEach((exercise) => {
    const group = exercise.group || 'General';
    const current = groups.get(group) ?? [];
    current.push(exercise);
    groups.set(group, current);
  });

  return Array.from(groups.entries())
    .map(([group, groupedExercises]) => [
      group,
      [...groupedExercises].sort((left, right) => left.name.localeCompare(right.name, 'es')),
    ] as const)
    .sort((left, right) => left[0].localeCompare(right[0], 'es'));
}

function groupExerciseLibrary(items: ProgramExerciseLibraryItem[]) {
  const groups = new Map<string, ProgramExerciseLibraryItem[]>();

  items.forEach((item) => {
    const current = groups.get(item.group) ?? [];
    current.push(item);
    groups.set(item.group, current);
  });

  return Array.from(groups.entries())
    .map(([group, exercises]) => [
      group,
      [...exercises].sort((left, right) => left.name.localeCompare(right.name, 'es')),
    ] as const)
    .sort((left, right) => {
      const leftIndex = EXERCISE_GROUP_SUGGESTIONS.indexOf(left[0]);
      const rightIndex = EXERCISE_GROUP_SUGGESTIONS.indexOf(right[0]);

      if (leftIndex === -1 && rightIndex === -1) {
        return left[0].localeCompare(right[0], 'es');
      }

      if (leftIndex === -1) return 1;
      if (rightIndex === -1) return -1;
      return leftIndex - rightIndex;
    });
}

function ExerciseLibraryManager({
  exercises,
  search,
  onSearchChange,
  form,
  onFormChange,
  onCreate,
  onDelete,
  isLoading,
  isError,
  isCreating,
  deletingId,
  groupOptions,
}: {
  exercises: ProgramExerciseLibraryItem[];
  search: string;
  onSearchChange: (nextValue: string) => void;
  form: ExerciseLibraryForm;
  onFormChange: (nextValue: ExerciseLibraryForm) => void;
  onCreate: () => void;
  onDelete: (exerciseId: string) => void;
  isLoading: boolean;
  isError: boolean;
  isCreating: boolean;
  deletingId?: string;
  groupOptions: string[];
}) {
  const groupedExercises = useMemo(() => groupExerciseLibrary(exercises), [exercises]);

  return (
    <motion.section variants={fadeInUp} className="rounded-3xl border border-surface-200/70 bg-white p-6 dark:border-surface-800 dark:bg-surface-900">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-brand-700 dark:border-brand-900/50 dark:bg-brand-950/30 dark:text-brand-300">
            <LibraryBig size={14} />
            Biblioteca de ejercicios
          </div>
          <h2 className="mt-3 text-xl font-semibold font-display text-surface-900 dark:text-white">
            Catálogo reutilizable para planificar cada programa
          </h2>
          <p className="mt-2 text-sm leading-6 text-surface-500 dark:text-surface-400">
            Tienes una base predefinida de ejercicios agrupados por zona. Puedes sumar ejercicios propios y eliminar los que no usas para que el planificador quede limpio.
          </p>
        </div>

        <div className="grid w-full gap-3 sm:grid-cols-[minmax(0,1fr)_220px_auto] xl:max-w-3xl">
          <input
            className="input"
            placeholder="Nuevo ejercicio, por ejemplo Press con barra T"
            value={form.name}
            onChange={(event) => onFormChange({ ...form, name: event.target.value })}
          />
          <select
            className="input"
            value={form.group}
            onChange={(event) => onFormChange({ ...form, group: event.target.value })}
          >
            {groupOptions.map((group) => (
              <option key={group} value={group}>
                {group}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-primary"
            onClick={onCreate}
            disabled={isCreating || !form.name.trim()}
          >
            <Plus size={16} />
            {isCreating ? 'Guardando...' : 'Agregar'}
          </button>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" size={16} />
          <input
            className="input pl-10"
            placeholder="Buscar por nombre o grupo"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>
        <p className="text-sm text-surface-500 dark:text-surface-400">
          {exercises.length} ejercicio{exercises.length !== 1 ? 's' : ''} disponible{exercises.length !== 1 ? 's' : ''} en {groupedExercises.length} grupo{groupedExercises.length !== 1 ? 's' : ''}
        </p>
      </div>

      {isError ? (
        <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
          No pudimos cargar la biblioteca de ejercicios.
        </div>
      ) : null}

      {isLoading ? (
        <div className="mt-5 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="shimmer h-44 rounded-3xl" />
          ))}
        </div>
      ) : groupedExercises.length ? (
        <div className="mt-5 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {groupedExercises.map(([group, groupExercises]) => (
            <div key={group} className="rounded-3xl border border-surface-200 bg-surface-50 p-4 dark:border-surface-800 dark:bg-surface-950/40">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-surface-900 dark:text-white">{group}</h3>
                  <p className="text-xs text-surface-400">{groupExercises.length} ejercicio{groupExercises.length !== 1 ? 's' : ''}</p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-brand-500 shadow-sm dark:bg-surface-900">
                  <Dumbbell size={18} />
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {groupExercises.map((exercise) => (
                  <span
                    key={exercise.id}
                    className="inline-flex items-center gap-2 rounded-full border border-surface-200 bg-white px-3 py-1.5 text-xs font-medium text-surface-600 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-300"
                  >
                    {exercise.name}
                    <button
                      type="button"
                      onClick={() => onDelete(exercise.id)}
                      disabled={deletingId === exercise.id}
                      className="rounded-full p-0.5 text-surface-400 transition-colors hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-950/30"
                      aria-label={`Eliminar ${exercise.name}`}
                    >
                      <Trash2 size={12} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-5 rounded-3xl border border-dashed border-surface-300 px-5 py-8 text-center text-sm text-surface-500 dark:border-surface-700 dark:text-surface-400">
          No encontramos ejercicios con ese filtro.
        </div>
      )}
    </motion.section>
  );
}

function ScheduleBuilder({
  value,
  onChange,
  selectedDay,
  onSelectDay,
}: {
  value: ProgramScheduleDay[];
  onChange: (schedule: ProgramScheduleDay[]) => void;
  selectedDay: string | null;
  onSelectDay: (day: string | null) => void;
}) {
  const activeDays = new Set(value.map((item) => item.day));

  function toggleDay(day: string) {
    if (activeDays.has(day)) {
      const nextValue = value.filter((item) => item.day !== day);
      onChange(nextValue);
      if (selectedDay === day) {
        onSelectDay(nextValue[0]?.day ?? null);
      }
      return;
    }

    const newItem = createEmptyScheduleDay(day);
    const ordered = WEEK_DAYS.filter((weekDay) => weekDay === day || activeDays.has(weekDay))
      .map((weekDay) => value.find((item) => item.day === weekDay) ?? newItem);

    onChange(ordered);
    onSelectDay(day);
  }

  function updateFocus(day: string, focus: string) {
    onChange(value.map((item) => (item.day === day ? { ...item, focus } : item)));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {WEEK_DAYS.map((day) => (
          <button
            key={day}
            type="button"
            onClick={() => toggleDay(day)}
            className={cn(
              'rounded-xl border px-3 py-1.5 text-sm font-medium transition-colors',
              activeDays.has(day)
                ? 'border-brand-400 bg-brand-50 text-brand-700 dark:border-brand-600 dark:bg-brand-950/40 dark:text-brand-300'
                : 'border-surface-200 bg-white text-surface-500 hover:border-surface-300 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-400',
            )}
          >
            {day.slice(0, 3)}
          </button>
        ))}
      </div>

      {value.length > 0 ? (
        <div className="space-y-3">
          {value.map((item) => (
            <div
              key={item.day}
              className={cn(
                'rounded-3xl border px-4 py-4 transition-colors',
                selectedDay === item.day
                  ? 'border-brand-300 bg-brand-50/60 dark:border-brand-800 dark:bg-brand-950/20'
                  : 'border-surface-200 bg-white dark:border-surface-800 dark:bg-surface-950/20',
              )}
            >
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
                <button
                  type="button"
                  onClick={() => onSelectDay(item.day)}
                  className={cn(
                    'inline-flex w-full items-center justify-center rounded-2xl px-4 py-2 text-sm font-semibold transition-colors xl:w-28',
                    selectedDay === item.day
                      ? 'bg-brand-500 text-white'
                      : 'bg-surface-100 text-surface-700 hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-200 dark:hover:bg-surface-700',
                  )}
                >
                  {item.day}
                </button>

                <input
                  className="input flex-1"
                  placeholder="Ej: Piernas, Empuje, Cardio, Descanso activo..."
                  value={item.focus}
                  onChange={(event) => updateFocus(item.day, event.target.value)}
                />

                <button
                  type="button"
                  onClick={() => onSelectDay(item.day)}
                  className={cn(
                    'rounded-2xl border px-4 py-2 text-sm font-medium transition-colors',
                    selectedDay === item.day
                      ? 'border-brand-400 bg-white text-brand-700 dark:border-brand-700 dark:bg-surface-900 dark:text-brand-300'
                      : 'border-surface-200 bg-white text-surface-500 hover:border-surface-300 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-300',
                  )}
                >
                  {item.exercises.length ? `${item.exercises.length} ejercicios` : 'Planificar ejercicios'}
                </button>

                <button
                  type="button"
                  onClick={() => toggleDay(item.day)}
                  className="self-start rounded-xl p-2 text-surface-400 transition-colors hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-950/30"
                  aria-label={`Quitar ${item.day}`}
                >
                  <X size={16} />
                </button>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {item.exercises.length ? item.exercises.slice(0, 4).map((exercise) => (
                  <span
                    key={`${item.day}-${exercise.exercise_id}`}
                    className="rounded-full border border-surface-200 bg-white px-3 py-1 text-xs font-medium text-surface-600 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-300"
                  >
                    {exercise.name}
                  </span>
                )) : (
                  <p className="text-xs text-surface-400">Selecciona este día para asignar ejercicios desde la biblioteca.</p>
                )}
                {item.exercises.length > 4 ? (
                  <span className="rounded-full border border-dashed border-surface-300 px-3 py-1 text-xs font-medium text-surface-400 dark:border-surface-700">
                    +{item.exercises.length - 4} más
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
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
  const [modalStep, setModalStep] = useState<1 | 2 | 3>(1);
  const [programSearch, setProgramSearch] = useState('');
  const [selectedPlanningDay, setSelectedPlanningDay] = useState<string | null>('Lunes');
  const [exerciseLibrarySearch, setExerciseLibrarySearch] = useState('');
  const [plannerSearch, setPlannerSearch] = useState('');
  const [programToDelete, setProgramToDelete] = useState<TrainingProgram | null>(null);
  const [exerciseLibraryForm, setExerciseLibraryForm] = useState<ExerciseLibraryForm>({
    name: '',
    group: EXERCISE_GROUP_SUGGESTIONS[0],
  });
  const [form, setForm] = useState<ProgramForm>(createEmptyForm());

  // Program detail modals
  const [selectedProgramForModal, setSelectedProgramForModal] = useState<TrainingProgram | null>(null);
  const [showClassesModal, setShowClassesModal] = useState(false);
  const [showEnrollmentsModal, setShowEnrollmentsModal] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [generateForm, setGenerateForm] = useState<GenerateForm>(createEmptyGenerateForm());

  const { data, isLoading, isError } = useQuery<PaginatedResponse<TrainingProgram>>({
    queryKey: ['programs'],
    queryFn: async () => {
      const response = await programsApi.list({ page: 1, per_page: 50 });
      return response.data;
    },
  });

  const {
    data: exerciseLibrary = [],
    isLoading: isExerciseLibraryLoading,
    isError: isExerciseLibraryError,
  } = useQuery<ProgramExerciseLibraryItem[]>({
    queryKey: ['program-exercise-library'],
    queryFn: async () => {
      const response = await programsApi.listExerciseLibrary();
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

  const trainers = staffList.filter((staffMember) => (
    staffMember.role === 'trainer' || staffMember.role === 'admin' || staffMember.role === 'owner'
  ));
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

  useEffect(() => {
    if (!showModal) {
      return;
    }

    if (!form.schedule.length) {
      setSelectedPlanningDay(null);
      return;
    }

    if (!selectedPlanningDay || !form.schedule.some((item) => item.day === selectedPlanningDay)) {
      setSelectedPlanningDay(form.schedule[0].day);
    }
  }, [form.schedule, selectedPlanningDay, showModal]);

  function resetEditorState(nextTrainerId = defaultOwnerTrainerId) {
    setPlannerSearch('');
    setSelectedPlanningDay('Lunes');
    setForm(createEmptyForm(nextTrainerId));
  }

  function openCreateProgramModal() {
    resetEditorState(defaultOwnerTrainerId);
    setModalStep(1);
    setShowModal(true);
  }

  function openEditProgramModal(program: TrainingProgram) {
    const nextForm = toForm(program);
    setForm(nextForm);
    setPlannerSearch('');
    setSelectedPlanningDay(nextForm.schedule[0]?.day ?? null);
    setModalStep(1);
    setShowModal(true);
  }

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
      resetEditorState(defaultOwnerTrainerId);
      queryClient.invalidateQueries({ queryKey: ['programs'] });
    },
    onError: (error: unknown) => {
      toast.error(getApiError(error, 'No se pudo guardar el programa'));
    },
  });

  const createExerciseMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: exerciseLibraryForm.name.trim(),
        group: exerciseLibraryForm.group.trim(),
      };
      const response = await programsApi.createExerciseLibraryItem(payload);
      return response.data;
    },
    onSuccess: () => {
      toast.success('Ejercicio agregado a la biblioteca');
      setExerciseLibraryForm((current) => ({ ...current, name: '' }));
      queryClient.invalidateQueries({ queryKey: ['program-exercise-library'] });
    },
    onError: (error: unknown) => {
      toast.error(getApiError(error, 'No se pudo agregar el ejercicio'));
    },
  });

  const deleteExerciseMutation = useMutation({
    mutationFn: async (exerciseId: string) => {
      await programsApi.deleteExerciseLibraryItem(exerciseId);
      return exerciseId;
    },
    onSuccess: () => {
      toast.success('Ejercicio eliminado de la biblioteca');
      queryClient.invalidateQueries({ queryKey: ['program-exercise-library'] });
    },
    onError: (error: unknown) => {
      toast.error(getApiError(error, 'No se pudo eliminar el ejercicio'));
    },
  });

  const deleteProgramMutation = useMutation({
    mutationFn: async (programId: string) => {
      await programsApi.delete(programId);
      return programId;
    },
    onSuccess: (_, programId) => {
      toast.success('Programa eliminado');
      queryClient.invalidateQueries({ queryKey: ['programs'] });
      setProgramToDelete(null);
      if (form.id === programId) {
        setShowModal(false);
        resetEditorState(defaultOwnerTrainerId);
      }
    },
    onError: (error: unknown) => {
      toast.error(getApiError(error, 'No se pudo eliminar el programa'));
    },
  });

  const { data: programClasses = [], isLoading: isProgramClassesLoading } = useQuery<GymClass[]>({
    queryKey: ['program-classes', selectedProgramForModal?.id],
    queryFn: async () => {
      const response = await programsApi.listClasses(selectedProgramForModal!.id);
      return response.data;
    },
    enabled: showClassesModal && Boolean(selectedProgramForModal),
  });

  const { data: programEnrollments = [], isLoading: isProgramEnrollmentsLoading } = useQuery<{
    id: string; user_id: string; user_name?: string; user_email?: string; user_phone?: string; created_at: string;
  }[]>({
    queryKey: ['program-enrollments', selectedProgramForModal?.id],
    queryFn: async () => {
      const response = await programsApi.listEnrollments(selectedProgramForModal!.id);
      return response.data;
    },
    enabled: showEnrollmentsModal && Boolean(selectedProgramForModal),
  });

  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => {
      const response = await branchesApi.list();
      return response.data;
    },
    enabled: showGenerateModal,
  });

  const generateClassesMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        start_date: generateForm.start_date,
        weeks: Number(generateForm.weeks) || 4,
        class_time: generateForm.class_time,
        duration_minutes: Number(generateForm.duration_minutes) || 60,
        branch_id: generateForm.branch_id || null,
        instructor_id: generateForm.instructor_id || null,
        max_capacity: Number(generateForm.max_capacity) || 20,
        // Pass browser's UTC offset so backend converts local time → UTC correctly
        utc_offset_minutes: new Date().getTimezoneOffset(),
        color: generateForm.color || null,
        class_type: generateForm.class_type || null,
      };
      const response = await programsApi.generateClasses(selectedProgramForModal!.id, payload);
      return response.data as GymClass[];
    },
    onSuccess: (created) => {
      toast.success(`${created.length} clase${created.length !== 1 ? 's' : ''} generada${created.length !== 1 ? 's' : ''} en la agenda`);
      setShowGenerateModal(false);
      queryClient.invalidateQueries({ queryKey: ['programs'] });
      queryClient.invalidateQueries({ queryKey: ['program-classes', selectedProgramForModal?.id] });
    },
    onError: (error: unknown) => {
      toast.error(getApiError(error, 'No se pudo generar las clases'));
    },
  });

  const unlinkClassMutation = useMutation({
    mutationFn: async (classId: string) => {
      await classesApi.update(classId, { program_id: null });
      return classId;
    },
    onSuccess: () => {
      toast.success('Clase desvinculada del programa');
      queryClient.invalidateQueries({ queryKey: ['program-classes', selectedProgramForModal?.id] });
      queryClient.invalidateQueries({ queryKey: ['programs'] });
    },
    onError: (error: unknown) => {
      toast.error(getApiError(error, 'No se pudo desvincular la clase'));
    },
  });

  const groupedLibraryOptions = useMemo(
    () => Array.from(new Set([...EXERCISE_GROUP_SUGGESTIONS, ...exerciseLibrary.map((item) => item.group)])).filter(Boolean),
    [exerciseLibrary],
  );

  const filteredExerciseLibrary = useMemo(() => {
    const search = exerciseLibrarySearch.trim().toLowerCase();
    if (!search) {
      return exerciseLibrary;
    }

    return exerciseLibrary.filter((exercise) => (
      exercise.name.toLowerCase().includes(search) || exercise.group.toLowerCase().includes(search)
    ));
  }, [exerciseLibrary, exerciseLibrarySearch]);

  const filteredPlannerLibrary = useMemo(() => {
    const search = plannerSearch.trim().toLowerCase();
    if (!search) {
      return exerciseLibrary;
    }

    return exerciseLibrary.filter((exercise) => (
      exercise.name.toLowerCase().includes(search) || exercise.group.toLowerCase().includes(search)
    ));
  }, [exerciseLibrary, plannerSearch]);

  const groupedPlannerLibrary = useMemo(
    () => groupExerciseLibrary(filteredPlannerLibrary),
    [filteredPlannerLibrary],
  );

  const selectedScheduleDay = useMemo(
    () => form.schedule.find((item) => item.day === selectedPlanningDay) ?? null,
    [form.schedule, selectedPlanningDay],
  );

  const selectedScheduleExerciseGroups = useMemo(
    () => groupScheduledExercises(selectedScheduleDay?.exercises ?? []),
    [selectedScheduleDay],
  );

  const selectedExerciseIds = useMemo(
    () => new Set((selectedScheduleDay?.exercises ?? []).map((exercise) => exercise.exercise_id)),
    [selectedScheduleDay],
  );

  const programs = data?.items ?? [];
  const filteredPrograms = useMemo(() => {
    const search = programSearch.trim().toLowerCase();
    if (!search) {
      return programs;
    }

    return programs.filter((program) => (
      program.name.toLowerCase().includes(search)
      || (program.description ?? '').toLowerCase().includes(search)
      || (program.program_type ?? '').toLowerCase().includes(search)
      || (program.trainer_name ?? '').toLowerCase().includes(search)
    ));
  }, [programSearch, programs]);
  const activePrograms = programs.filter((program) => program.is_active).length;
  const totalWeeks = programs.reduce((sum, program) => sum + (program.duration_weeks || 0), 0);
  const indefinitePrograms = programs.filter((program) => !program.duration_weeks).length;
  const totalEnrollments = programs.reduce((sum, program) => sum + (program.enrolled_count ?? 0), 0);
  function updateSchedule(schedule: ProgramScheduleDay[]) {
    setForm((current) => ({ ...current, schedule }));
  }

  function addExercisesToSelectedDay(exercises: ProgramExerciseLibraryItem[]) {
    if (!selectedPlanningDay) {
      return;
    }

    setForm((current) => ({
      ...current,
      schedule: current.schedule.map((scheduleDay) => {
        if (scheduleDay.day !== selectedPlanningDay) {
          return scheduleDay;
        }

        const existingIds = new Set(scheduleDay.exercises.map((item) => item.exercise_id));
        return {
          ...scheduleDay,
          exercises: [
            ...scheduleDay.exercises,
            ...exercises
              .filter((exercise) => !existingIds.has(exercise.id))
              .map((exercise) => ({
                exercise_id: exercise.id,
                name: exercise.name,
                group: exercise.group,
              })),
          ],
        };
      }),
    }));
  }

  function toggleExerciseForSelectedDay(exercise: ProgramExerciseLibraryItem) {
    if (!selectedPlanningDay) {
      return;
    }

    if (selectedExerciseIds.has(exercise.id)) {
      removeExerciseFromSelectedDay(exercise.id);
      return;
    }

    addExercisesToSelectedDay([exercise]);
  }

  function removeExerciseFromSelectedDay(exerciseId: string) {
    if (!selectedPlanningDay) {
      return;
    }

    setForm((current) => ({
      ...current,
      schedule: current.schedule.map((scheduleDay) => (
        scheduleDay.day === selectedPlanningDay
          ? {
              ...scheduleDay,
              exercises: scheduleDay.exercises.filter((exercise) => exercise.exercise_id !== exerciseId),
            }
          : scheduleDay
      )),
    }));
  }

  function removeExerciseGroupFromSelectedDay(group: string) {
    if (!selectedPlanningDay) {
      return;
    }

    setForm((current) => ({
      ...current,
      schedule: current.schedule.map((scheduleDay) => (
        scheduleDay.day === selectedPlanningDay
          ? {
              ...scheduleDay,
              exercises: scheduleDay.exercises.filter((exercise) => (exercise.group || 'General') !== group),
            }
          : scheduleDay
      )),
    }));
  }

  function clearSelectedDayExercises() {
    if (!selectedPlanningDay) {
      return;
    }

    setForm((current) => ({
      ...current,
      schedule: current.schedule.map((scheduleDay) => (
        scheduleDay.day === selectedPlanningDay
          ? { ...scheduleDay, exercises: [] }
          : scheduleDay
      )),
    }));
  }

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-6">
      <motion.div variants={fadeInUp} className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Programas</h1>
          <p className="mt-1 text-sm text-surface-500">
            Diseña programas persistentes con días, foco semanal y una biblioteca propia de ejercicios para la planificación.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateProgramModal}
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

      <motion.div
        variants={fadeInUp}
        className="flex flex-col gap-3 rounded-3xl border border-surface-200/70 bg-white p-5 dark:border-surface-800 dark:bg-surface-900 lg:flex-row lg:items-center lg:justify-between"
      >
        <div>
          <p className="text-sm font-semibold text-surface-900 dark:text-white">Gestiona tu catálogo de programas</p>
          <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
            Busca por nombre, trainer, tipo o descripción para encontrar un programa más rápido.
          </p>
        </div>
        <div className="relative w-full lg:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" size={16} />
          <input
            className="input pl-10"
            placeholder="Buscar programas"
            value={programSearch}
            onChange={(event) => setProgramSearch(event.target.value)}
          />
        </div>
      </motion.div>

      <ExerciseLibraryManager
        exercises={filteredExerciseLibrary}
        search={exerciseLibrarySearch}
        onSearchChange={setExerciseLibrarySearch}
        form={exerciseLibraryForm}
        onFormChange={setExerciseLibraryForm}
        onCreate={() => createExerciseMutation.mutate()}
        onDelete={(exerciseId) => deleteExerciseMutation.mutate(exerciseId)}
        isLoading={isExerciseLibraryLoading}
        isError={isExerciseLibraryError}
        isCreating={createExerciseMutation.isPending}
        deletingId={deleteExerciseMutation.isPending ? deleteExerciseMutation.variables : undefined}
        groupOptions={groupedLibraryOptions}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, index) => <div key={index} className="shimmer h-56 rounded-3xl" />)
        ) : filteredPrograms.map((program) => {
          const plannedExerciseCount = countProgramExercises(program);
          const normalizedSchedule = program.schedule.map((entry, index) => normalizeScheduleDay(entry, index));

          return (
            <motion.div
              key={program.id}
              variants={fadeInUp}
              className="rounded-3xl border border-surface-200/50 bg-white p-6 transition-all hover:-translate-y-1 hover:shadow-xl dark:border-surface-800/50 dark:bg-surface-900"
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

              <div className="mt-4 flex flex-wrap gap-2">
                {normalizedSchedule.length ? normalizedSchedule.map((scheduleDay) => (
                  <span
                    key={`${program.id}-${scheduleDay.day}`}
                    className="rounded-full border border-surface-200 bg-surface-50 px-3 py-1 text-xs font-medium text-surface-600 dark:border-surface-700 dark:bg-surface-950/50 dark:text-surface-300"
                  >
                    {scheduleDay.day}
                    {scheduleDay.focus ? ` · ${scheduleDay.focus}` : ''}
                  </span>
                )) : (
                  <span className="text-xs text-surface-400">Sin días definidos</span>
                )}
              </div>

              <div className="mt-4 flex items-center gap-2 text-sm text-surface-500 dark:text-surface-400">
                <LibraryBig size={15} />
                {plannedExerciseCount
                  ? `${plannedExerciseCount} ejercicio${plannedExerciseCount !== 1 ? 's' : ''} planificado${plannedExerciseCount !== 1 ? 's' : ''}`
                  : 'Sin ejercicios definidos todavía'}
              </div>

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

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-surface-200/70 bg-surface-50 px-4 py-3 dark:border-surface-800 dark:bg-surface-950/40">
                  <div className="flex items-center gap-2 text-sm text-surface-500 dark:text-surface-400">
                    <Users size={14} />
                    Inscritos
                  </div>
                  <p className="mt-1 text-2xl font-bold font-display text-surface-900 dark:text-white">{program.enrolled_count}</p>
                </div>
                <div className="rounded-2xl border border-surface-200/70 bg-surface-50 px-4 py-3 dark:border-surface-800 dark:bg-surface-950/40">
                  <div className="flex items-center gap-2 text-sm text-surface-500 dark:text-surface-400">
                    <CalendarDays size={14} />
                    Clases
                  </div>
                  <p className="mt-1 text-2xl font-bold font-display text-surface-900 dark:text-white">{program.linked_class_count ?? 0}</p>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => { setSelectedProgramForModal(program); setShowEnrollmentsModal(true); }}
                  className="btn-secondary flex-1 justify-center"
                >
                  <Users size={15} />
                  Inscritos
                </button>
                <button
                  type="button"
                  onClick={() => { setSelectedProgramForModal(program); setShowClassesModal(true); }}
                  className="btn-secondary flex-1 justify-center"
                >
                  <CalendarDays size={15} />
                  Clases
                </button>
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => { setSelectedProgramForModal(program); setGenerateForm(createEmptyGenerateForm()); setShowGenerateModal(true); }}
                  className="btn-secondary flex-1 justify-center"
                >
                  <Wand2 size={15} />
                  Generar clases
                </button>
                <button
                  type="button"
                  onClick={() => openEditProgramModal(program)}
                  className="btn-secondary flex-1 justify-center"
                >
                  <PencilLine size={15} />
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => setProgramToDelete(program)}
                  className="btn-danger justify-center"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </motion.div>
          );
        })}

        {!isLoading && !filteredPrograms.length ? (
          <div className="col-span-full rounded-3xl border border-dashed border-surface-300 bg-surface-50 px-6 py-12 text-center dark:border-surface-700 dark:bg-surface-900/30">
            <Dumbbell size={28} className="mx-auto mb-3 text-surface-300 dark:text-surface-700" />
            <p className="font-medium text-surface-700 dark:text-surface-200">
              {programSearch ? 'No encontramos programas con ese filtro' : 'Todavía no tienes programas creados'}
            </p>
            <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
              {programSearch
                ? 'Prueba con otro nombre, tipo o trainer.'
                : 'Crea el primero y luego planifica sus ejercicios por día.'}
            </p>
          </div>
        ) : null}
      </div>

      <Modal
        open={showModal}
        title={form.id ? 'Editar programa' : 'Nuevo programa'}
        description={modalStep === 1 ? 'Información básica del programa' : modalStep === 2 ? 'Días de entrenamiento y enfoque de cada sesión' : 'Ejercicios por sesión (opcional — podés completar después)'}
        onClose={() => {
          if (!saveMutation.isPending) {
            setShowModal(false);
          }
        }}
      >
        {/* Step indicator */}
        <div className="mb-6 flex items-center gap-0">
          {(['Información', 'Horario', 'Ejercicios'] as const).map((label, idx) => {
            const step = (idx + 1) as 1 | 2 | 3;
            const done = modalStep > step;
            const active = modalStep === step;
            return (
              <div key={label} className="flex flex-1 items-center">
                <button
                  type="button"
                  onClick={() => setModalStep(step)}
                  className="flex flex-1 flex-col items-center gap-1.5"
                >
                  <div className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold transition-colors',
                    done ? 'bg-emerald-500 text-white' : active ? 'bg-brand-500 text-white' : 'bg-surface-100 text-surface-400 dark:bg-surface-800',
                  )}>
                    {done ? <CheckCircle2 size={16} /> : step}
                  </div>
                  <span className={cn('text-xs font-medium', active ? 'text-surface-900 dark:text-white' : 'text-surface-400 dark:text-surface-500')}>
                    {label}
                  </span>
                </button>
                {idx < 2 && <div className={cn('mb-5 h-px flex-1 transition-colors', done ? 'bg-emerald-300 dark:bg-emerald-700' : 'bg-surface-200 dark:bg-surface-700')} />}
              </div>
            );
          })}
        </div>

        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (modalStep < 3) { setModalStep((s) => (s + 1) as 1 | 2 | 3); return; }
            saveMutation.mutate();
          }}
        >
          {/* ── Paso 1: Información ─────────────────────────────── */}
          {modalStep === 1 && (
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">
                  Nombre del programa <span className="text-rose-500">*</span>
                </label>
                <input
                  className="input"
                  placeholder="Ej: Fuerza 12 semanas, Cardio intensivo..."
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  required
                  autoFocus
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Tipo</label>
                  <select
                    className="input"
                    value={form.program_type}
                    onChange={(event) => setForm((current) => ({ ...current, program_type: event.target.value }))}
                  >
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
                <div>
                  <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Trainer</label>
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
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">
                  Duración
                  <span className="ml-2 text-xs font-normal text-surface-400">
                    {form.duration_weeks === '0' || form.duration_weeks === '' ? 'Sin límite — programa indefinido' : `${form.duration_weeks} semanas`}
                  </span>
                </label>
                <input
                  type="number"
                  min="0"
                  className="input"
                  placeholder="0 = sin límite"
                  value={form.duration_weeks}
                  onChange={(event) => setForm((current) => ({ ...current, duration_weeks: event.target.value }))}
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Descripción</label>
                <textarea
                  className="input min-h-20 resize-y"
                  value={form.description}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                  placeholder="Objetivo, nivel requerido, características del programa..."
                />
              </div>

              <ProgramToggleCard checked={form.is_active} onChange={(val) => setForm((c) => ({ ...c, is_active: val }))} />
            </div>
          )}

          {/* ── Paso 2: Horario ──────────────────────────────────── */}
          {modalStep === 2 && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-surface-200 bg-surface-50 px-4 py-3 text-sm text-surface-600 dark:border-surface-800 dark:bg-surface-950/30 dark:text-surface-400">
                Seleccioná los días de entrenamiento y escribí el foco de cada sesión (ej: Piernas, Empuje, Cardio).
              </div>
              <ScheduleBuilder
                value={form.schedule}
                onChange={updateSchedule}
                selectedDay={selectedPlanningDay}
                onSelectDay={setSelectedPlanningDay}
              />
              {form.schedule.length > 0 && (
                <div className="flex flex-wrap gap-3 rounded-2xl border border-surface-200 bg-surface-50 px-4 py-3 dark:border-surface-800 dark:bg-surface-950/30">
                  <span className="text-sm text-surface-500 dark:text-surface-400">{form.schedule.length} día{form.schedule.length !== 1 ? 's' : ''} seleccionado{form.schedule.length !== 1 ? 's' : ''}</span>
                  {form.schedule.map((d) => (
                    <span key={d.day} className="rounded-full border border-brand-200 bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700 dark:border-brand-800 dark:bg-brand-950/30 dark:text-brand-300">
                      {d.day}{d.focus ? ` · ${d.focus}` : ''}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Paso 3: Ejercicios ───────────────────────────────── */}
          {modalStep === 3 && (
            <div className="space-y-4">
              {form.schedule.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-surface-300 px-4 py-8 text-center text-sm text-surface-500 dark:border-surface-700 dark:text-surface-400">
                  No hay días en el horario. Volvé al paso anterior para agregar días.
                </div>
              ) : (
                <>
                  {/* Day tabs */}
                  <div className="flex flex-wrap gap-2">
                    {form.schedule.map((scheduleDay) => (
                      <button
                        key={scheduleDay.day}
                        type="button"
                        onClick={() => setSelectedPlanningDay(scheduleDay.day)}
                        className={cn(
                          'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                          selectedPlanningDay === scheduleDay.day
                            ? 'border-brand-500 bg-brand-500 text-white'
                            : 'border-surface-200 bg-white text-surface-600 hover:border-surface-300 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-300',
                        )}
                      >
                        {scheduleDay.day}
                        {scheduleDay.exercises.length ? (
                          <span className={cn('ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold', selectedPlanningDay === scheduleDay.day ? 'bg-white/30 text-white' : 'bg-brand-100 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300')}>
                            {scheduleDay.exercises.length}
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>

                  {selectedScheduleDay && (
                    <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
                      {/* Left: assigned exercises */}
                      <div className="rounded-3xl border border-surface-200 bg-white p-4 dark:border-surface-800 dark:bg-surface-900">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-surface-900 dark:text-white">
                              {selectedScheduleDay.day}
                              {selectedScheduleDay.focus ? ` — ${selectedScheduleDay.focus}` : ''}
                            </p>
                            <p className="mt-0.5 text-xs text-surface-400">{selectedScheduleDay.exercises.length} ejercicio{selectedScheduleDay.exercises.length !== 1 ? 's' : ''} asignado{selectedScheduleDay.exercises.length !== 1 ? 's' : ''}</p>
                          </div>
                          {selectedScheduleDay.exercises.length > 0 && (
                            <button type="button" onClick={clearSelectedDayExercises} className="rounded-full border border-rose-200 px-2.5 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:border-rose-900/50 dark:text-rose-300">
                              Vaciar
                            </button>
                          )}
                        </div>

                        <div className="mt-4 space-y-3">
                          {selectedScheduleExerciseGroups.length ? selectedScheduleExerciseGroups.map(([group, groupExercises]) => (
                            <div key={`${selectedScheduleDay.day}-${group}`} className="rounded-2xl border border-surface-200 bg-surface-50 px-4 py-3 dark:border-surface-800 dark:bg-surface-950/40">
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-surface-500">{group} · {groupExercises.length}</p>
                                <button type="button" onClick={() => removeExerciseGroupFromSelectedDay(group)} className="text-xs font-semibold text-rose-500 hover:underline">Quitar</button>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {groupExercises.map((exercise) => (
                                  <button key={`${selectedScheduleDay.day}-${exercise.exercise_id}`} type="button" onClick={() => removeExerciseFromSelectedDay(exercise.exercise_id)} className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100 dark:border-brand-900/60 dark:bg-brand-950/30 dark:text-brand-300">
                                    {exercise.name} <X size={10} />
                                  </button>
                                ))}
                              </div>
                            </div>
                          )) : (
                            <div className="rounded-2xl border border-dashed border-surface-300 px-4 py-6 text-center text-xs text-surface-400 dark:border-surface-700">
                              Seleccioná ejercicios desde la biblioteca →
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Right: library */}
                      <div className="space-y-3">
                        <div className="relative">
                          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" size={15} />
                          <input className="input pl-10" placeholder="Buscar en biblioteca..." value={plannerSearch} onChange={(event) => setPlannerSearch(event.target.value)} />
                        </div>

                        {isExerciseLibraryError ? (
                          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
                            No se pudo cargar la biblioteca.
                          </div>
                        ) : isExerciseLibraryLoading ? (
                          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="shimmer h-24 rounded-2xl" />)}</div>
                        ) : groupedPlannerLibrary.length ? (
                          <div className="max-h-[400px] space-y-3 overflow-y-auto pr-1">
                            {groupedPlannerLibrary.map(([group, groupExercises]) => {
                              const selectedFromGroup = groupExercises.filter((exercise) => selectedExerciseIds.has(exercise.id)).length;
                              const allGroupSelected = selectedFromGroup === groupExercises.length;
                              return (
                                <div key={group} className="rounded-2xl border border-surface-200 bg-white p-4 dark:border-surface-800 dark:bg-surface-900">
                                  <div className="flex items-center justify-between gap-3">
                                    <div>
                                      <p className="text-sm font-semibold text-surface-900 dark:text-white">{group}</p>
                                      <p className="text-xs text-surface-400">{selectedFromGroup}/{groupExercises.length} seleccionados</p>
                                    </div>
                                    <button type="button" onClick={() => allGroupSelected ? removeExerciseGroupFromSelectedDay(group) : addExercisesToSelectedDay(groupExercises)} className={cn('rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors', allGroupSelected ? 'border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300' : 'border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-900/50 dark:bg-brand-950/20 dark:text-brand-300')}>
                                      {allGroupSelected ? 'Quitar todo' : 'Agregar todo'}
                                    </button>
                                  </div>
                                  <div className="mt-3 flex flex-wrap gap-1.5">
                                    {groupExercises.map((exercise) => {
                                      const isSelected = selectedExerciseIds.has(exercise.id);
                                      return (
                                        <button key={exercise.id} type="button" onClick={() => toggleExerciseForSelectedDay(exercise)} className={cn('rounded-full border px-2.5 py-1 text-xs font-medium transition-colors', isSelected ? 'border-brand-500 bg-brand-500 text-white' : 'border-surface-200 bg-surface-50 text-surface-600 hover:border-surface-300 hover:bg-surface-100 dark:border-surface-700 dark:bg-surface-950 dark:text-surface-300 dark:hover:bg-surface-800')}>
                                          {exercise.name}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                          })}
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-dashed border-surface-300 px-4 py-6 text-sm text-surface-500 dark:border-surface-700 dark:text-surface-400">
                          No hay ejercicios que coincidan con la búsqueda. Puedes crear uno nuevo desde la biblioteca principal de la página.
                        </div>
                      )}
                    </div>
                  </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Navegación por pasos ─────────────────────────────── */}
          <div className="flex items-center justify-between gap-3 border-t border-surface-200 pt-4 dark:border-surface-800">
            <div>
              {form.id && modalStep === 1 ? (
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => {
                    const currentProgram = programs.find((program) => program.id === form.id);
                    if (currentProgram) setProgramToDelete(currentProgram);
                  }}
                >
                  <Trash2 size={15} />
                  Eliminar
                </button>
              ) : <span />}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => modalStep > 1 ? setModalStep((s) => (s - 1) as 1 | 2 | 3) : setShowModal(false)}
                disabled={saveMutation.isPending}
              >
                {modalStep > 1 ? '← Anterior' : 'Cancelar'}
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={saveMutation.isPending || (modalStep === 1 && !form.name.trim())}
              >
                {modalStep < 3
                  ? 'Siguiente →'
                  : saveMutation.isPending
                    ? 'Guardando...'
                    : form.id ? 'Guardar cambios' : 'Crear programa'}
              </button>
            </div>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(programToDelete)}
        title="Eliminar programa"
        description="Esta acción eliminará el programa del catálogo y desvinculará sus inscripciones."
        onClose={() => {
          if (!deleteProgramMutation.isPending) {
            setProgramToDelete(null);
          }
        }}
      >
        <div className="space-y-5">
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
            <p className="font-semibold">{programToDelete?.name}</p>
            <p className="mt-1">
              {programToDelete?.enrolled_count
                ? `${programToDelete.enrolled_count} cliente${programToDelete.enrolled_count !== 1 ? 's' : ''} inscrito${programToDelete.enrolled_count !== 1 ? 's' : ''} perderán la asociación con este programa.`
                : 'No se podrá recuperar una vez eliminado.'}
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setProgramToDelete(null)}
              disabled={deleteProgramMutation.isPending}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => {
                if (programToDelete) {
                  deleteProgramMutation.mutate(programToDelete.id);
                }
              }}
              disabled={deleteProgramMutation.isPending}
            >
              <Trash2 size={15} />
              {deleteProgramMutation.isPending ? 'Eliminando...' : 'Eliminar'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ─── Clases del programa ─────────────────────────────────── */}
      <Modal
        open={showClassesModal}
        title={`Clases vinculadas — ${selectedProgramForModal?.name ?? ''}`}
        description="Clases de la agenda que pertenecen a este programa."
        onClose={() => setShowClassesModal(false)}
      >
        <div className="space-y-4">
          {isProgramClassesLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <div key={i} className="shimmer h-14 rounded-2xl" />)}
            </div>
          ) : programClasses.length ? (
            <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
              {programClasses.map((gymClass) => (
                <div key={gymClass.id} className="flex items-center justify-between gap-3 rounded-2xl border border-surface-200 bg-surface-50 px-4 py-3 dark:border-surface-800 dark:bg-surface-950/40">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-surface-900 dark:text-white truncate">{gymClass.name}</p>
                    <p className="text-xs text-surface-500 dark:text-surface-400">
                      {new Date(gymClass.start_time).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}
                      {gymClass.branch_name ? ` · ${gymClass.branch_name}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`badge ${gymClass.status === 'cancelled' ? 'badge-danger' : gymClass.status === 'completed' ? 'badge-neutral' : 'badge-success'}`}>
                      {gymClass.status === 'scheduled' ? 'Programada' : gymClass.status === 'completed' ? 'Completada' : gymClass.status === 'cancelled' ? 'Cancelada' : gymClass.status}
                    </span>
                    <button
                      type="button"
                      title="Desvincular del programa"
                      className="rounded-full p-1.5 text-surface-400 transition-colors hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-950/30"
                      onClick={() => unlinkClassMutation.mutate(gymClass.id)}
                      disabled={unlinkClassMutation.isPending}
                    >
                      <Link2Off size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-3xl border border-dashed border-surface-300 px-5 py-8 text-center text-sm text-surface-500 dark:border-surface-700 dark:text-surface-400">
              No hay clases vinculadas a este programa todavía.
            </div>
          )}
          <div className="flex justify-end">
            <button type="button" className="btn-secondary" onClick={() => setShowClassesModal(false)}>Cerrar</button>
          </div>
        </div>
      </Modal>

      {/* ─── Inscritos al programa ───────────────────────────────── */}
      <Modal
        open={showEnrollmentsModal}
        title={`Inscritos — ${selectedProgramForModal?.name ?? ''}`}
        description="Clientes inscriptos a este programa desde la app."
        onClose={() => setShowEnrollmentsModal(false)}
      >
        <div className="space-y-4">
          {isProgramEnrollmentsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <div key={i} className="shimmer h-14 rounded-2xl" />)}
            </div>
          ) : programEnrollments.length ? (
            <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
              {programEnrollments.map((enrollment) => (
                <div key={enrollment.id} className="rounded-2xl border border-surface-200 bg-surface-50 px-4 py-3 dark:border-surface-800 dark:bg-surface-950/40">
                  <p className="text-sm font-semibold text-surface-900 dark:text-white">{enrollment.user_name || 'Cliente'}</p>
                  <p className="text-xs text-surface-500 dark:text-surface-400">
                    {enrollment.user_email}
                    {enrollment.user_phone ? ` · ${enrollment.user_phone}` : ''}
                    {' · Inscrito el '}{new Date(enrollment.created_at).toLocaleDateString('es-CL')}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-3xl border border-dashed border-surface-300 px-5 py-8 text-center text-sm text-surface-500 dark:border-surface-700 dark:text-surface-400">
              Ningún cliente inscripto todavía.
            </div>
          )}
          <div className="flex justify-end">
            <button type="button" className="btn-secondary" onClick={() => setShowEnrollmentsModal(false)}>Cerrar</button>
          </div>
        </div>
      </Modal>

      {/* ─── Generar clases desde schedule ──────────────────────── */}
      <Modal
        open={showGenerateModal}
        title={`Generar clases — ${selectedProgramForModal?.name ?? ''}`}
        description="Crea clases en la agenda a partir del horario semanal del programa."
        onClose={() => {
          if (!generateClassesMutation.isPending) setShowGenerateModal(false);
        }}
      >
        <form
          className="space-y-4"
          onSubmit={(e) => { e.preventDefault(); generateClassesMutation.mutate(); }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Fecha de inicio</label>
              <input
                type="date"
                className="input"
                value={generateForm.start_date}
                onChange={(e) => setGenerateForm((f) => ({ ...f, start_date: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Semanas a generar</label>
              <input
                type="number"
                min="1"
                max="52"
                className="input"
                value={generateForm.weeks}
                onChange={(e) => setGenerateForm((f) => ({ ...f, weeks: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Hora de inicio</label>
              <input
                type="time"
                className="input"
                value={generateForm.class_time}
                onChange={(e) => setGenerateForm((f) => ({ ...f, class_time: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Duración (minutos)</label>
              <input
                type="number"
                min="15"
                max="480"
                className="input"
                value={generateForm.duration_minutes}
                onChange={(e) => setGenerateForm((f) => ({ ...f, duration_minutes: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Capacidad máx.</label>
              <input
                type="number"
                min="1"
                className="input"
                value={generateForm.max_capacity}
                onChange={(e) => setGenerateForm((f) => ({ ...f, max_capacity: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Sede (opcional)</label>
              <select
                className="input"
                value={generateForm.branch_id}
                onChange={(e) => setGenerateForm((f) => ({ ...f, branch_id: e.target.value }))}
              >
                <option value="">Sin sede</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Instructor (opcional)</label>
              <select
                className="input"
                value={generateForm.instructor_id}
                onChange={(e) => setGenerateForm((f) => ({ ...f, instructor_id: e.target.value }))}
              >
                <option value="">Sin instructor</option>
                {trainers.map((trainer) => (
                  <option key={trainer.id} value={trainer.id}>{trainer.full_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">
                Tipo / categoría
                <span className="ml-2 text-xs font-normal text-surface-400">Opcional</span>
              </label>
              <input
                className="input"
                value={generateForm.class_type}
                onChange={(e) => setGenerateForm((f) => ({ ...f, class_type: e.target.value }))}
                placeholder="Ej: funcional, yoga, fuerza..."
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Color en agenda</label>
              <input
                type="color"
                className="input h-11 w-full p-2"
                value={generateForm.color}
                onChange={(e) => setGenerateForm((f) => ({ ...f, color: e.target.value }))}
              />
            </div>
          </div>

          {selectedProgramForModal && (
            <div className="rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-700 dark:border-brand-900/40 dark:bg-brand-950/20 dark:text-brand-300">
              Se generará 1 clase por cada día del horario semanal del programa × {generateForm.weeks || '?'} semanas
              = <strong>{(selectedProgramForModal.schedule?.length || 0) * (Number(generateForm.weeks) || 0)} clases</strong>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setShowGenerateModal(false)} disabled={generateClassesMutation.isPending}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={generateClassesMutation.isPending}>
              <Wand2 size={15} />
              {generateClassesMutation.isPending ? 'Generando...' : 'Generar clases'}
            </button>
          </div>
        </form>
      </Modal>
    </motion.div>
  );
}
