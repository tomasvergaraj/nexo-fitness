import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { CalendarDays, Dumbbell, Plus, Repeat2, Users } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { programsApi } from '@/services/api';
import { fadeInUp, staggerContainer } from '@/utils/animations';
import type { PaginatedResponse, TrainingProgram } from '@/types';

type ProgramForm = {
  id?: string;
  name: string;
  description: string;
  trainer_id: string;
  program_type: string;
  duration_weeks: string;
  schedule: string;
  is_active: boolean;
};

const emptyForm: ProgramForm = {
  name: '',
  description: '',
  trainer_id: '',
  program_type: 'fuerza',
  duration_weeks: '4',
  schedule: '[{"day":"Lunes","focus":"Piernas"},{"day":"Miercoles","focus":"Torso"}]',
  is_active: true,
};

function toForm(program?: TrainingProgram): ProgramForm {
  if (!program) return emptyForm;
  return {
    id: program.id,
    name: program.name,
    description: program.description ?? '',
    trainer_id: program.trainer_id ?? '',
    program_type: program.program_type ?? '',
    duration_weeks: program.duration_weeks ? String(program.duration_weeks) : '',
    schedule: JSON.stringify(program.schedule, null, 2),
    is_active: program.is_active,
  };
}

export default function ProgramsPage() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<ProgramForm>(emptyForm);

  const { data, isLoading, isError } = useQuery<PaginatedResponse<TrainingProgram>>({
    queryKey: ['programs'],
    queryFn: async () => {
      const response = await programsApi.list({ page: 1, per_page: 50 });
      return response.data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        description: form.description || null,
        trainer_id: form.trainer_id || null,
        program_type: form.program_type || null,
        duration_weeks: form.duration_weeks ? Number(form.duration_weeks) : null,
        schedule: form.schedule.trim() ? JSON.parse(form.schedule) : [],
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
      setForm(emptyForm);
      queryClient.invalidateQueries({ queryKey: ['programs'] });
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.detail || 'No se pudo guardar el programa');
    },
  });

  const programs = data?.items ?? [];
  const activePrograms = programs.filter((program) => program.is_active).length;
  const totalWeeks = programs.reduce((sum, program) => sum + (program.duration_weeks ?? 0), 0);

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-6">
      <motion.div variants={fadeInUp} className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Programas</h1>
          <p className="mt-1 text-sm text-surface-500">Planes de entrenamiento persistentes, conectados al backend</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setForm(emptyForm);
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
          <p className="text-sm text-surface-500">Programas activos</p>
          <p className="mt-2 text-3xl font-bold font-display text-surface-900 dark:text-white">{activePrograms}</p>
        </div>
        <div className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
          <p className="text-sm text-surface-500">Semanas planificadas</p>
          <p className="mt-2 text-3xl font-bold font-display text-surface-900 dark:text-white">{totalWeeks}</p>
        </div>
        <div className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
          <p className="text-sm text-surface-500">Total catalogo</p>
          <p className="mt-2 text-3xl font-bold font-display text-surface-900 dark:text-white">{programs.length}</p>
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
            <p className="mt-2 text-sm leading-6 text-surface-500">{program.description || 'Sin descripcion todavia.'}</p>

            <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-2xl bg-surface-50 px-4 py-3 dark:bg-surface-950/60">
                <div className="flex items-center gap-2 text-surface-500"><CalendarDays size={15} /> Duracion</div>
                <p className="mt-2 font-semibold text-surface-900 dark:text-white">{program.duration_weeks ?? 0} semanas</p>
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
              <p className="mt-2 text-sm font-medium text-surface-900 dark:text-white">{program.trainer_name || 'Pendiente'}</p>
            </div>
          </motion.button>
        ))}
      </div>

      <Modal
        open={showModal}
        title={form.id ? 'Editar programa' : 'Nuevo programa'}
        description="La grilla semanal se guarda como JSON para dejar lista la evolucion del modulo."
        onClose={() => {
          if (!saveMutation.isPending) {
            setShowModal(false);
          }
        }}
      >
        <form
          className="space-y-4"
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
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Tipo</label>
              <input className="input" value={form.program_type} onChange={(event) => setForm((current) => ({ ...current, program_type: event.target.value }))} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Trainer ID</label>
              <input className="input" value={form.trainer_id} onChange={(event) => setForm((current) => ({ ...current, trainer_id: event.target.value }))} placeholder="UUID del trainer" />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Duracion (semanas)</label>
              <input type="number" min="1" className="input" value={form.duration_weeks} onChange={(event) => setForm((current) => ({ ...current, duration_weeks: event.target.value }))} />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Descripcion</label>
            <textarea className="input min-h-24 resize-y" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Schedule JSON</label>
            <textarea className="input min-h-40 resize-y font-mono text-xs" value={form.schedule} onChange={(event) => setForm((current) => ({ ...current, schedule: event.target.value }))} />
          </div>

          <label className="flex items-center gap-3 rounded-2xl border border-surface-200 px-4 py-3 dark:border-surface-800">
            <input type="checkbox" checked={form.is_active} onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.checked }))} />
            <span className="text-sm text-surface-700 dark:text-surface-300">Programa activo</span>
          </label>

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
