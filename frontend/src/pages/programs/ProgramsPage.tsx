import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Dumbbell,
  LibraryBig,
  Link2Off,
  PencilLine,
  Plus,
  Repeat2,
  Search,
  Settings2,
  Trash2,
  Users,
  Wand2,
  X,
} from 'lucide-react';
import ClassColorPicker from '@/components/ui/ClassColorPicker';
import Modal from '@/components/ui/Modal';
import { branchesApi, classesApi, plansApi, programBookingsApi, programsApi, staffApi } from '@/services/api';
import { cn, formatDateTime, getApiError } from '@/utils';
import { fadeInUp, staggerContainer } from '@/utils/animations';
import type {
  GymClass,
  PaginatedResponse,
  Plan,
  ProgramClassModality,
  ProgramBooking,
  ProgramExerciseLibraryItem,
  ProgramScheduleConfigMode,
  ProgramScheduleDay,
  ProgramScheduleDayConfig,
  ProgramScheduleDayConfigField,
  ProgramScheduleDayConfigValueMap,
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
const PROGRAM_CLASS_MODALITY_OPTIONS = [
  { value: 'in_person', label: 'Presencial', description: 'Solo en el gimnasio.' },
  { value: 'online', label: 'Online', description: 'Con enlace para conectarse.' },
  { value: 'hybrid', label: 'Híbrida', description: 'Asistencia presencial y online.' },
] as const;
const PROGRAM_CLASS_CONFIG_FIELDS = [
  'branch_id',
  'instructor_id',
  'modality',
  'max_capacity',
  'online_link',
  'cancellation_deadline_hours',
  'restricted_plan_id',
  'color',
  'class_type',
] as const satisfies ReadonlyArray<keyof ProgramScheduleDayConfig>;
const PROGRAM_CLASS_CONFIG_DEFAULTS: ProgramScheduleDayConfigValueMap = {
  branch_id: null,
  instructor_id: null,
  modality: 'in_person',
  max_capacity: 20,
  online_link: '',
  cancellation_deadline_hours: 2,
  restricted_plan_id: null,
  color: '#06b6d4',
  class_type: '',
};
const PROGRAM_CLASS_CONFIG_INHERITANCE_COPY = 'Usará el valor definido en Generar clases.';

type ProgramScheduleConfigFieldKey = typeof PROGRAM_CLASS_CONFIG_FIELDS[number];
type ProgramScheduleFieldOverride<Key extends ProgramScheduleConfigFieldKey> = ProgramScheduleDayConfigField<Key>;

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
  modality: ProgramClassModality;
  branch_id: string;
  instructor_id: string;
  max_capacity: string;
  online_link: string;
  cancellation_deadline_hours: string;
  restricted_plan_id: string;
  color: string;
  class_type: string;
};

type ProgramBookingGroup = {
  recurrenceGroupId: string;
  bookings: ProgramBooking[];
  classes: GymClass[];
  activeCount: number;
  cancelledCount: number;
};

function createEmptyGenerateForm(): GenerateForm {
  const today = new Date().toISOString().split('T')[0];
  return {
    start_date: today,
    weeks: '4',
    class_time: '09:00',
    duration_minutes: '60',
    modality: 'in_person',
    branch_id: '',
    instructor_id: '',
    max_capacity: '20',
    online_link: '',
    cancellation_deadline_hours: '2',
    restricted_plan_id: '',
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isProgramClassModality(value: unknown): value is ProgramClassModality {
  return value === 'in_person' || value === 'online' || value === 'hybrid';
}

function normalizeNullableStringOverride<Key extends ProgramScheduleConfigFieldKey>(
  rawValue: unknown,
): ProgramScheduleFieldOverride<Key> | null {
  if (isRecord(rawValue) && (rawValue.mode === 'inherit' || rawValue.mode === 'custom')) {
    if (rawValue.mode === 'inherit') {
      return { mode: 'inherit' } as ProgramScheduleFieldOverride<Key>;
    }

    if (typeof rawValue.value === 'string' || rawValue.value === null || rawValue.value === undefined) {
      return { mode: 'custom', value: (rawValue.value ?? null) as ProgramScheduleDayConfigValueMap[Key] };
    }

    return null;
  }

  if (typeof rawValue === 'string' || rawValue === null) {
    return { mode: 'custom', value: rawValue as ProgramScheduleDayConfigValueMap[Key] };
  }

  return null;
}

function normalizeNumberOverride<Key extends ProgramScheduleConfigFieldKey>(
  rawValue: unknown,
): ProgramScheduleFieldOverride<Key> | null {
  if (isRecord(rawValue) && (rawValue.mode === 'inherit' || rawValue.mode === 'custom')) {
    if (rawValue.mode === 'inherit') {
      return { mode: 'inherit' } as ProgramScheduleFieldOverride<Key>;
    }

    if (typeof rawValue.value === 'number' && Number.isFinite(rawValue.value)) {
      return { mode: 'custom', value: rawValue.value as ProgramScheduleDayConfigValueMap[Key] };
    }

    return null;
  }

  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    return { mode: 'custom', value: rawValue as ProgramScheduleDayConfigValueMap[Key] };
  }

  return null;
}

function normalizeModalityOverride(
  rawValue: unknown,
): ProgramScheduleFieldOverride<'modality'> | null {
  if (isRecord(rawValue) && (rawValue.mode === 'inherit' || rawValue.mode === 'custom')) {
    if (rawValue.mode === 'inherit') {
      return { mode: 'inherit' };
    }

    if (isProgramClassModality(rawValue.value)) {
      return { mode: 'custom', value: rawValue.value };
    }

    return null;
  }

  if (isProgramClassModality(rawValue)) {
    return { mode: 'custom', value: rawValue };
  }

  return null;
}

function hasCustomClassConfig(config?: ProgramScheduleDayConfig | null): boolean {
  if (!config) return false;
  return PROGRAM_CLASS_CONFIG_FIELDS.some((field) => config[field]?.mode === 'custom');
}

function getClassConfigFieldMode(
  config: ProgramScheduleDayConfig | null | undefined,
  field: ProgramScheduleConfigFieldKey,
): ProgramScheduleConfigMode {
  return config?.[field]?.mode ?? 'inherit';
}

function getClassConfigFieldValue<Key extends ProgramScheduleConfigFieldKey>(
  config: ProgramScheduleDayConfig | null | undefined,
  field: Key,
): ProgramScheduleDayConfigValueMap[Key] | undefined {
  const override = config?.[field];
  if (override?.mode !== 'custom') {
    return undefined;
  }

  return override.value as ProgramScheduleDayConfigValueMap[Key] | undefined;
}

function getDayConfigEffectiveCustomModality(
  config: ProgramScheduleDayConfig | null | undefined,
): ProgramClassModality | 'inherit' {
  const modalityOverride = config?.modality;
  if (modalityOverride?.mode === 'custom' && isProgramClassModality(modalityOverride.value)) {
    return modalityOverride.value;
  }

  return 'inherit';
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

function normalizeScheduleDayConfig(rawValue: unknown): ProgramScheduleDayConfig | null {
  if (!isRecord(rawValue)) {
    return null;
  }

  const value = rawValue;
  const config: ProgramScheduleDayConfig = {};

  const branch = normalizeNullableStringOverride<'branch_id'>(value.branch_id);
  const instructor = normalizeNullableStringOverride<'instructor_id'>(value.instructor_id);
  const modality = normalizeModalityOverride(value.modality);
  const maxCapacity = normalizeNumberOverride<'max_capacity'>(value.max_capacity);
  const onlineLink = normalizeNullableStringOverride<'online_link'>(value.online_link);
  const cancellationDeadline = normalizeNumberOverride<'cancellation_deadline_hours'>(value.cancellation_deadline_hours);
  const restrictedPlan = normalizeNullableStringOverride<'restricted_plan_id'>(value.restricted_plan_id);
  const color = normalizeNullableStringOverride<'color'>(value.color);
  const classType = normalizeNullableStringOverride<'class_type'>(value.class_type);

  if (branch) config.branch_id = branch;
  if (instructor) config.instructor_id = instructor;
  if (modality) config.modality = modality;
  if (maxCapacity) config.max_capacity = maxCapacity;
  if (onlineLink) config.online_link = onlineLink;
  if (cancellationDeadline) config.cancellation_deadline_hours = cancellationDeadline;
  if (restrictedPlan) config.restricted_plan_id = restrictedPlan;
  if (color) config.color = color;
  if (classType) config.class_type = classType;

  return Object.keys(config).length ? config : null;
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
    class_config: normalizeScheduleDayConfig(value.class_config),
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

function ClassConfigModeToggle({
  mode,
  onChange,
}: {
  mode: ProgramScheduleConfigMode;
  onChange: (nextMode: ProgramScheduleConfigMode) => void;
}) {
  return (
    <div className="inline-flex rounded-full border border-surface-200 bg-surface-50 p-1 dark:border-surface-700 dark:bg-surface-900">
      {([
        { value: 'inherit', label: 'Heredar' },
        { value: 'custom', label: 'Definir' },
      ] as const).map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
            mode === option.value
              ? 'bg-white text-brand-700 shadow-sm dark:bg-surface-800 dark:text-brand-300'
              : 'text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ProgramClassModalitySelector({
  value,
  onChange,
}: {
  value: ProgramClassModality;
  onChange: (nextValue: ProgramClassModality) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {PROGRAM_CLASS_MODALITY_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-2xl border px-4 py-4 text-left transition-colors',
            value === option.value
              ? 'border-brand-300 bg-brand-50 dark:border-brand-700 dark:bg-brand-950/20'
              : 'border-surface-200 bg-white hover:border-surface-300 dark:border-surface-800 dark:bg-surface-950/20',
          )}
        >
          <p className="text-sm font-semibold text-surface-900 dark:text-white">{option.label}</p>
          <p className="mt-1 text-xs leading-5 text-surface-500 dark:text-surface-400">{option.description}</p>
        </button>
      ))}
    </div>
  );
}

function ProgramDayClassConfigField({
  label,
  helper,
  mode,
  onModeChange,
  children,
  className,
}: {
  label: string;
  helper?: string;
  mode: ProgramScheduleConfigMode;
  onModeChange: (nextMode: ProgramScheduleConfigMode) => void;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-2xl border border-surface-200 bg-surface-50/70 p-4 dark:border-surface-800 dark:bg-surface-950/30', className)}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-xl">
          <label className="block text-sm font-medium text-surface-700 dark:text-surface-300">{label}</label>
          {helper ? (
            <p className="mt-1.5 text-xs leading-5 text-surface-500 dark:text-surface-400">{helper}</p>
          ) : null}
        </div>
        <ClassConfigModeToggle mode={mode} onChange={onModeChange} />
      </div>

      {mode === 'custom' ? (
        <div className="mt-4">{children}</div>
      ) : (
        <p className="mt-4 text-xs leading-5 text-surface-500 dark:text-surface-400">
          {PROGRAM_CLASS_CONFIG_INHERITANCE_COPY}
        </p>
      )}
    </div>
  );
}

function ScheduleBuilder({
  value,
  onChange,
  selectedDay,
  onSelectDay,
  branches = [],
  instructors = [],
  plans = [],
}: {
  value: ProgramScheduleDay[];
  onChange: (schedule: ProgramScheduleDay[]) => void;
  selectedDay: string | null;
  onSelectDay: (day: string | null) => void;
  branches?: { id: string; name: string }[];
  instructors?: { id: string; full_name?: string; name?: string }[];
  plans?: Plan[];
}) {
  const [expandedConfigDay, setExpandedConfigDay] = useState<string | null>(null);
  const activeDays = new Set(value.map((item) => item.day));

  function toggleDay(day: string) {
    if (activeDays.has(day)) {
      const nextValue = value.filter((item) => item.day !== day);
      onChange(nextValue);
      if (selectedDay === day) {
        onSelectDay(nextValue[0]?.day ?? null);
      }
      if (expandedConfigDay === day) {
        setExpandedConfigDay(null);
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

  function updateClassConfig(day: string, updater: (current: ProgramScheduleDayConfig) => ProgramScheduleDayConfig) {
    onChange(value.map((item) => {
      if (item.day !== day) return item;
      const nextConfig = updater(item.class_config ?? {});
      return { ...item, class_config: Object.keys(nextConfig).length ? nextConfig : null };
    }));
  }

  function setClassConfigMode<Key extends ProgramScheduleConfigFieldKey>(
    day: string,
    field: Key,
    mode: ProgramScheduleConfigMode,
  ) {
    updateClassConfig(day, (current) => {
      if (mode === 'inherit') {
        return {
          ...current,
          [field]: { mode: 'inherit' },
        };
      }

      const currentValue = current[field]?.mode === 'custom'
        ? current[field]?.value
        : undefined;

      return {
        ...current,
        [field]: {
          mode: 'custom',
          value: (currentValue ?? PROGRAM_CLASS_CONFIG_DEFAULTS[field]) as ProgramScheduleDayConfigValueMap[Key],
        },
      };
    });
  }

  function setClassConfigValue<Key extends ProgramScheduleConfigFieldKey>(
    day: string,
    field: Key,
    nextValue: ProgramScheduleDayConfigValueMap[Key],
  ) {
    updateClassConfig(day, (current) => ({
      ...current,
      [field]: {
        mode: 'custom',
        value: nextValue,
      },
    }));
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

              {/* Class config expander */}
              <div className="mt-3 border-t border-surface-100 pt-3 dark:border-surface-800">
                <button
                  type="button"
                  onClick={() => setExpandedConfigDay(expandedConfigDay === item.day ? null : item.day)}
                  className="flex w-full items-center gap-2 text-xs font-medium text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200"
                >
                  <Settings2 size={13} />
                  Configuración de clase
                  {hasCustomClassConfig(item.class_config) && (
                    <span className="rounded-full bg-brand-100 px-1.5 py-0.5 text-[10px] font-bold text-brand-700 dark:bg-brand-950/60 dark:text-brand-300">
                      personalizada
                    </span>
                  )}
                  <ChevronDown
                    size={14}
                    className={cn('ml-auto transition-transform', expandedConfigDay === item.day && 'rotate-180')}
                  />
                </button>

                {expandedConfigDay === item.day ? (() => {
                  const classConfig = item.class_config;
                  const effectiveModality = getDayConfigEffectiveCustomModality(classConfig);
                  const shouldShowOnlineLinkField = effectiveModality !== 'in_person';

                  return (
                    <div className="mt-4 space-y-4">
                      <div className="rounded-2xl border border-brand-200 bg-brand-50/70 px-4 py-3 text-sm leading-6 text-brand-700 dark:border-brand-900/50 dark:bg-brand-950/20 dark:text-brand-300">
                        Si dejas un ajuste en modo heredar, este día usará los valores que definas después en Generar clases.
                      </div>

                      <div className="grid gap-4 xl:grid-cols-2">
                        <ProgramDayClassConfigField
                          label="Modalidad"
                          helper="Elige cómo se impartirá esta clase."
                          mode={getClassConfigFieldMode(classConfig, 'modality')}
                          onModeChange={(nextMode) => setClassConfigMode(item.day, 'modality', nextMode)}
                          className="xl:col-span-2"
                        >
                          <ProgramClassModalitySelector
                            value={getClassConfigFieldValue(classConfig, 'modality') ?? PROGRAM_CLASS_CONFIG_DEFAULTS.modality}
                            onChange={(nextValue) => setClassConfigValue(item.day, 'modality', nextValue)}
                          />
                        </ProgramDayClassConfigField>

                        <ProgramDayClassConfigField
                          label="Sede"
                          helper={effectiveModality === 'online' ? 'Opcional para clases online' : 'Obligatoria para clases presenciales e híbridas'}
                          mode={getClassConfigFieldMode(classConfig, 'branch_id')}
                          onModeChange={(nextMode) => setClassConfigMode(item.day, 'branch_id', nextMode)}
                        >
                          <select
                            className="input"
                            value={getClassConfigFieldValue(classConfig, 'branch_id') ?? ''}
                            onChange={(event) => setClassConfigValue(item.day, 'branch_id', event.target.value || null)}
                          >
                            <option value="">Sin sede física</option>
                            {branches.map((branch) => (
                              <option key={branch.id} value={branch.id}>{branch.name}</option>
                            ))}
                          </select>
                        </ProgramDayClassConfigField>

                        <ProgramDayClassConfigField
                          label="Instructor"
                          mode={getClassConfigFieldMode(classConfig, 'instructor_id')}
                          onModeChange={(nextMode) => setClassConfigMode(item.day, 'instructor_id', nextMode)}
                        >
                          <select
                            className="input"
                            value={getClassConfigFieldValue(classConfig, 'instructor_id') ?? ''}
                            onChange={(event) => setClassConfigValue(item.day, 'instructor_id', event.target.value || null)}
                          >
                            <option value="">Sin instructor asignado</option>
                            {instructors.map((instructor) => (
                              <option key={instructor.id} value={instructor.id}>
                                {instructor.full_name ?? instructor.name ?? instructor.id}
                              </option>
                            ))}
                          </select>
                        </ProgramDayClassConfigField>

                        <ProgramDayClassConfigField
                          label="Capacidad"
                          mode={getClassConfigFieldMode(classConfig, 'max_capacity')}
                          onModeChange={(nextMode) => setClassConfigMode(item.day, 'max_capacity', nextMode)}
                        >
                          <input
                            type="number"
                            min={1}
                            className="input"
                            value={String(getClassConfigFieldValue(classConfig, 'max_capacity') ?? PROGRAM_CLASS_CONFIG_DEFAULTS.max_capacity)}
                            onChange={(event) => setClassConfigValue(item.day, 'max_capacity', Math.max(1, Number(event.target.value) || 1))}
                          />
                        </ProgramDayClassConfigField>

                        <ProgramDayClassConfigField
                          label="Color"
                          mode={getClassConfigFieldMode(classConfig, 'color')}
                          onModeChange={(nextMode) => setClassConfigMode(item.day, 'color', nextMode)}
                          className="xl:col-span-2"
                        >
                          <ClassColorPicker
                            hideLabel
                            inputId={`program-day-${item.day}-color`}
                            value={getClassConfigFieldValue(classConfig, 'color') ?? '#06b6d4'}
                            onChange={(nextColor) => setClassConfigValue(item.day, 'color', nextColor)}
                          />
                        </ProgramDayClassConfigField>

                        {shouldShowOnlineLinkField ? (
                          <ProgramDayClassConfigField
                            label="Enlace para la clase"
                            helper={effectiveModality === 'inherit'
                              ? 'Disponible cuando la modalidad heredada en Generar clases sea online o híbrida.'
                              : 'Comparte el enlace que usarán los clientes para conectarse.'}
                            mode={getClassConfigFieldMode(classConfig, 'online_link')}
                            onModeChange={(nextMode) => setClassConfigMode(item.day, 'online_link', nextMode)}
                            className="xl:col-span-2"
                          >
                            <input
                              type="url"
                              className="input"
                              value={getClassConfigFieldValue(classConfig, 'online_link') ?? ''}
                              onChange={(event) => setClassConfigValue(item.day, 'online_link', event.target.value)}
                              placeholder="https://zoom.us/... o enlace de Meet"
                            />
                          </ProgramDayClassConfigField>
                        ) : null}

                        <ProgramDayClassConfigField
                          label="Plan restringido"
                          helper="Solo los clientes con este plan podrán ver y reservar esta clase."
                          mode={getClassConfigFieldMode(classConfig, 'restricted_plan_id')}
                          onModeChange={(nextMode) => setClassConfigMode(item.day, 'restricted_plan_id', nextMode)}
                        >
                          <select
                            className="input"
                            value={getClassConfigFieldValue(classConfig, 'restricted_plan_id') ?? ''}
                            onChange={(event) => setClassConfigValue(item.day, 'restricted_plan_id', event.target.value || null)}
                          >
                            <option value="">Visible para todos</option>
                            {plans.map((plan) => (
                              <option key={plan.id} value={plan.id}>{plan.name}</option>
                            ))}
                          </select>
                          {!plans.length ? (
                            <p className="mt-2 text-xs text-surface-400">Aún no hay planes disponibles para restringir esta clase.</p>
                          ) : null}
                        </ProgramDayClassConfigField>

                        <ProgramDayClassConfigField
                          label="Categoría"
                          mode={getClassConfigFieldMode(classConfig, 'class_type')}
                          onModeChange={(nextMode) => setClassConfigMode(item.day, 'class_type', nextMode)}
                        >
                          <input
                            type="text"
                            className="input"
                            value={getClassConfigFieldValue(classConfig, 'class_type') ?? ''}
                            onChange={(event) => setClassConfigValue(item.day, 'class_type', event.target.value)}
                            placeholder="Ej: funcional, yoga, fuerza..."
                          />
                        </ProgramDayClassConfigField>

                        <ProgramDayClassConfigField
                          label="Anticipación mínima para cancelar"
                          helper="Horas antes del inicio en las que el cliente aún puede cancelar. 0 = se puede cancelar hasta el inicio."
                          mode={getClassConfigFieldMode(classConfig, 'cancellation_deadline_hours')}
                          onModeChange={(nextMode) => setClassConfigMode(item.day, 'cancellation_deadline_hours', nextMode)}
                          className="xl:col-span-2"
                        >
                          <input
                            type="number"
                            min={0}
                            className="input"
                            value={String(
                              getClassConfigFieldValue(classConfig, 'cancellation_deadline_hours')
                              ?? PROGRAM_CLASS_CONFIG_DEFAULTS.cancellation_deadline_hours,
                            )}
                            onChange={(event) => setClassConfigValue(item.day, 'cancellation_deadline_hours', Math.max(0, Number(event.target.value) || 0))}
                          />
                        </ProgramDayClassConfigField>
                      </div>
                    </div>
                  );
                })() : null}
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
  const [showBookingsModal, setShowBookingsModal] = useState(false);
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
    enabled: showModal || showGenerateModal,
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
      queryClient.invalidateQueries({ queryKey: ['classes'] });
      queryClient.invalidateQueries({ queryKey: ['classes-calendar'] });
      queryClient.invalidateQueries({ queryKey: ['program-classes', programId] });
      setProgramToDelete(null);
      if (form.id === programId) {
        setShowModal(false);
        resetEditorState(defaultOwnerTrainerId);
      }
      if (selectedProgramForModal?.id === programId) {
        setShowClassesModal(false);
        setShowEnrollmentsModal(false);
        setShowBookingsModal(false);
        setShowGenerateModal(false);
        setSelectedProgramForModal(null);
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
    enabled: (showClassesModal || showBookingsModal) && Boolean(selectedProgramForModal),
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

  const { data: programBookings = [], isLoading: isProgramBookingsLoading } = useQuery<ProgramBooking[]>({
    queryKey: ['program-bookings', selectedProgramForModal?.id],
    queryFn: async () => {
      const response = await programBookingsApi.list({
        status: 'all',
        program_id: selectedProgramForModal!.id,
      });
      return response.data;
    },
    enabled: showBookingsModal && Boolean(selectedProgramForModal),
  });

  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => {
      const response = await branchesApi.list();
      return response.data;
    },
    enabled: showModal || showGenerateModal,
  });

  const { data: plans = [] } = useQuery<Plan[]>({
    queryKey: ['plans'],
    queryFn: async () => {
      const response = await plansApi.list();
      return response.data?.items ?? response.data ?? [];
    },
    enabled: showModal || showGenerateModal,
  });

  const generateClassesMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        start_date: generateForm.start_date,
        weeks: Number(generateForm.weeks) || 4,
        class_time: generateForm.class_time,
        duration_minutes: Number(generateForm.duration_minutes) || 60,
        modality: generateForm.modality,
        branch_id: generateForm.branch_id || null,
        instructor_id: generateForm.instructor_id || null,
        max_capacity: Number(generateForm.max_capacity) || 20,
        online_link: generateForm.online_link || null,
        cancellation_deadline_hours: Math.max(0, Number(generateForm.cancellation_deadline_hours) || 0),
        restricted_plan_id: generateForm.restricted_plan_id || null,
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
  const groupedProgramBookings = useMemo<ProgramBookingGroup[]>(() => {
    const classesByGroup = new Map<string, GymClass[]>();
    programClasses.forEach((gymClass) => {
      if (!gymClass.recurrence_group_id) return;
      const current = classesByGroup.get(gymClass.recurrence_group_id) ?? [];
      current.push(gymClass);
      classesByGroup.set(gymClass.recurrence_group_id, current);
    });

    const groups = new Map<string, ProgramBookingGroup>();
    programBookings.forEach((booking) => {
      const current = groups.get(booking.recurrence_group_id);
      if (current) {
        current.bookings.push(booking);
        return;
      }
      groups.set(booking.recurrence_group_id, {
        recurrenceGroupId: booking.recurrence_group_id,
        bookings: [booking],
        classes: [...(classesByGroup.get(booking.recurrence_group_id) ?? [])],
        activeCount: 0,
        cancelledCount: 0,
      });
    });

    return Array.from(groups.values())
      .map((group) => {
        const bookings = [...group.bookings].sort((left, right) => {
          if (left.status !== right.status) {
            return left.status === 'active' ? -1 : 1;
          }
          return (left.user_name ?? '').localeCompare(right.user_name ?? '', 'es');
        });
        const classes = [...group.classes].sort(
          (left, right) => new Date(left.start_time).getTime() - new Date(right.start_time).getTime(),
        );
        const activeCount = bookings.filter((booking) => booking.status === 'active').length;
        return {
          ...group,
          bookings,
          classes,
          activeCount,
          cancelledCount: bookings.length - activeCount,
        };
      })
      .sort((left, right) => {
        const leftDate = new Date(left.classes[0]?.start_time ?? left.bookings[0]?.created_at ?? 0).getTime();
        const rightDate = new Date(right.classes[0]?.start_time ?? right.bookings[0]?.created_at ?? 0).getTime();
        return rightDate - leftDate;
      });
  }, [programBookings, programClasses]);
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

              <div className="mt-5 grid gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => { setSelectedProgramForModal(program); setShowEnrollmentsModal(true); }}
                  className="btn-secondary justify-center"
                >
                  <Users size={15} />
                  Inscritos
                </button>
                <button
                  type="button"
                  onClick={() => { setSelectedProgramForModal(program); setShowClassesModal(true); }}
                  className="btn-secondary justify-center"
                >
                  <CalendarDays size={15} />
                  Clases
                </button>
                <button
                  type="button"
                  onClick={() => { setSelectedProgramForModal(program); setShowBookingsModal(true); }}
                  className="btn-secondary justify-center"
                >
                  <Repeat2 size={15} />
                  Reservas
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
                branches={branches}
                instructors={trainers}
                plans={plans}
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
        description="Esta acción eliminará el programa del catálogo, sus inscripciones y todas las clases generadas desde ese programa."
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
            <p className="mt-1">
              {programToDelete?.linked_class_count
                ? `${programToDelete.linked_class_count} clase${programToDelete.linked_class_count !== 1 ? 's' : ''} generada${programToDelete.linked_class_count !== 1 ? 's' : ''} se eliminarán del calendario del administrador y de la agenda de clientes.`
                : 'Si el programa tenía clases generadas, también desaparecerán del calendario del administrador y de la agenda de clientes.'}
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

      {/* ─── Reservas del programa ─────────────────────────────── */}
      <Modal
        open={showBookingsModal}
        title={`Reservas — ${selectedProgramForModal?.name ?? ''}`}
        description="Reservas del programa agrupadas por tanda generada."
        onClose={() => setShowBookingsModal(false)}
        size="lg"
      >
        <div className="space-y-4">
          {isProgramBookingsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => <div key={i} className="shimmer h-28 rounded-3xl" />)}
            </div>
          ) : groupedProgramBookings.length ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-surface-200 bg-surface-50 px-4 py-4 dark:border-surface-800 dark:bg-surface-950/30">
                  <p className="text-xs uppercase tracking-[0.18em] text-surface-500">Reservas</p>
                  <p className="mt-2 text-2xl font-bold font-display text-surface-900 dark:text-white">{programBookings.length}</p>
                </div>
                <div className="rounded-2xl border border-surface-200 bg-surface-50 px-4 py-4 dark:border-surface-800 dark:bg-surface-950/30">
                  <p className="text-xs uppercase tracking-[0.18em] text-surface-500">Activas</p>
                  <p className="mt-2 text-2xl font-bold font-display text-surface-900 dark:text-white">
                    {programBookings.filter((booking) => booking.status === 'active').length}
                  </p>
                </div>
                <div className="rounded-2xl border border-surface-200 bg-surface-50 px-4 py-4 dark:border-surface-800 dark:bg-surface-950/30">
                  <p className="text-xs uppercase tracking-[0.18em] text-surface-500">Tandas</p>
                  <p className="mt-2 text-2xl font-bold font-display text-surface-900 dark:text-white">{groupedProgramBookings.length}</p>
                </div>
              </div>

              <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
                {groupedProgramBookings.map((group, index) => {
                  const firstClass = group.classes[0];
                  const lastClass = group.classes[group.classes.length - 1];
                  const classCount = group.classes.length || group.bookings[0]?.total_classes || 0;

                  return (
                    <div
                      key={group.recurrenceGroupId}
                      className="rounded-3xl border border-surface-200 bg-white p-5 dark:border-surface-800 dark:bg-surface-950/20"
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-surface-900 dark:text-white">Tanda {index + 1}</p>
                          <p className="mt-1 text-xs text-surface-500 dark:text-surface-400">
                            {firstClass && lastClass
                              ? `${formatDateTime(firstClass.start_time)} → ${formatDateTime(lastClass.start_time)}`
                              : `Grupo ${group.recurrenceGroupId.slice(0, 8)}`}
                          </p>
                          <p className="mt-1 text-xs text-surface-400 dark:text-surface-500">
                            {classCount} clase{classCount !== 1 ? 's' : ''} en esta tanda
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <span className="badge badge-success">{group.activeCount} activas</span>
                          {group.cancelledCount ? <span className="badge badge-neutral">{group.cancelledCount} canceladas</span> : null}
                        </div>
                      </div>

                      <div className="mt-4 space-y-3">
                        {group.bookings.map((booking) => {
                          const progressPct = booking.total_classes > 0
                            ? Math.round((booking.reserved_classes / booking.total_classes) * 100)
                            : 0;

                          return (
                            <div
                              key={booking.id}
                              className="rounded-2xl border border-surface-200 bg-surface-50 px-4 py-4 dark:border-surface-800 dark:bg-surface-950/40"
                            >
                              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-sm font-semibold text-surface-900 dark:text-white">
                                      {booking.user_name || 'Cliente'}
                                    </p>
                                    <span className={cn('badge', booking.status === 'active' ? 'badge-success' : 'badge-neutral')}>
                                      {booking.status === 'active' ? 'Activa' : 'Cancelada'}
                                    </span>
                                    {booking.waitlisted_classes ? (
                                      <span className="badge badge-warning">
                                        {booking.waitlisted_classes} en espera
                                      </span>
                                    ) : null}
                                  </div>

                                  <p className="mt-2 text-xs text-surface-500 dark:text-surface-400">
                                    {booking.user_email || 'Sin correo'}
                                    {booking.user_phone ? ` · ${booking.user_phone}` : ''}
                                  </p>
                                  <p className="mt-1 text-xs text-surface-400 dark:text-surface-500">
                                    Reservó el {formatDateTime(booking.created_at)}
                                    {booking.cancelled_at ? ` · Canceló el ${formatDateTime(booking.cancelled_at)}` : ''}
                                  </p>
                                </div>

                                <div className="min-w-[180px] rounded-2xl bg-white px-4 py-3 dark:bg-surface-900">
                                  <div className="flex items-center justify-between text-xs text-surface-500 dark:text-surface-400">
                                    <span>Confirmadas</span>
                                    <span>{booking.reserved_classes}/{booking.total_classes}</span>
                                  </div>
                                  <div className="mt-2 h-2 rounded-full bg-surface-200 dark:bg-surface-700">
                                    <div
                                      className="h-full rounded-full bg-emerald-500"
                                      style={{ width: `${Math.min(progressPct, 100)}%` }}
                                    />
                                  </div>
                                  <p className="mt-2 text-xs text-surface-400 dark:text-surface-500">
                                    {booking.failed_classes} sin reservar
                                  </p>
                                </div>
                              </div>

                              {booking.cancel_reason ? (
                                <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
                                  <span className="font-semibold">Motivo:</span> {booking.cancel_reason}
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
            </>
          ) : (
            <div className="rounded-3xl border border-dashed border-surface-300 px-5 py-8 text-center text-sm text-surface-500 dark:border-surface-700 dark:text-surface-400">
              Este programa todavía no tiene reservas completas registradas.
            </div>
          )}

          <div className="flex justify-end">
            <button type="button" className="btn-secondary" onClick={() => setShowBookingsModal(false)}>Cerrar</button>
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
          </div>

          <div>
            <label className="mb-3 block text-sm font-medium text-surface-700 dark:text-surface-300">Modalidad</label>
            <ProgramClassModalitySelector
              value={generateForm.modality}
              onChange={(nextValue) => setGenerateForm((f) => ({ ...f, modality: nextValue }))}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">
                Sede
                <span className="ml-2 text-xs font-normal text-surface-400">
                  {generateForm.modality === 'online' ? 'Opcional para clases online' : 'Obligatoria para clases presenciales e híbridas'}
                </span>
              </label>
              <select
                className="input"
                value={generateForm.branch_id}
                onChange={(e) => setGenerateForm((f) => ({ ...f, branch_id: e.target.value }))}
              >
                <option value="">{generateForm.modality === 'online' ? 'Sin sede física' : 'Selecciona una sede'}</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Instructor</label>
              <select
                className="input"
                value={generateForm.instructor_id}
                onChange={(e) => setGenerateForm((f) => ({ ...f, instructor_id: e.target.value }))}
              >
                <option value="">Sin instructor asignado</option>
                {trainers.map((trainer) => (
                  <option key={trainer.id} value={trainer.id}>{trainer.full_name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Capacidad</label>
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
          </div>

          <ClassColorPicker
            inputId="generate-program-classes-color"
            value={generateForm.color}
            onChange={(nextColor) => setGenerateForm((f) => ({ ...f, color: nextColor }))}
          />

          {(generateForm.modality === 'online' || generateForm.modality === 'hybrid') ? (
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Enlace para la clase</label>
              <input
                type="url"
                className="input"
                value={generateForm.online_link}
                onChange={(e) => setGenerateForm((f) => ({ ...f, online_link: e.target.value }))}
                placeholder="https://zoom.us/... o enlace de Meet"
              />
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">
                Plan restringido <span className="text-xs font-normal text-surface-400">(opcional)</span>
              </label>
              <select
                className="input"
                value={generateForm.restricted_plan_id}
                onChange={(e) => setGenerateForm((f) => ({ ...f, restricted_plan_id: e.target.value }))}
              >
                <option value="">Visible para todos</option>
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>{plan.name}</option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-surface-400">Solo los clientes con este plan podrán ver y reservar esta clase.</p>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Anticipación mínima para cancelar</label>
              <input
                type="number"
                min="0"
                className="input"
                value={generateForm.cancellation_deadline_hours}
                onChange={(e) => setGenerateForm((f) => ({ ...f, cancellation_deadline_hours: e.target.value }))}
              />
              <p className="mt-1.5 text-xs text-surface-400">
                Horas antes del inicio en las que el cliente aún puede cancelar. 0 = se puede cancelar hasta el inicio.
              </p>
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
