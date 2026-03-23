import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { Plus, Check, Star, Edit2, ToggleLeft, ToggleRight } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { plansApi } from '@/services/api';
import { staggerContainer, fadeInUp } from '@/utils/animations';
import { cn, formatCurrency, formatDurationLabel, parseApiNumber } from '@/utils';
import type { PaginatedResponse, Plan } from '@/types';

type PlanFormState = {
  id?: string;
  name: string;
  description: string;
  price: string;
  duration_type: 'monthly' | 'annual' | 'perpetual' | 'custom';
  duration_days: string;
  max_reservations_per_week: string;
  is_featured: boolean;
  auto_renew: boolean;
  is_active: boolean;
};

const emptyForm: PlanFormState = {
  name: '',
  description: '',
  price: '29990',
  duration_type: 'monthly',
  duration_days: '30',
  max_reservations_per_week: '',
  is_featured: false,
  auto_renew: true,
  is_active: true,
};

function toFormState(plan?: Plan): PlanFormState {
  if (!plan) {
    return emptyForm;
  }

  return {
    id: plan.id,
    name: plan.name,
    description: plan.description ?? '',
    price: String(parseApiNumber(plan.price)),
    duration_type: plan.duration_type,
    duration_days: plan.duration_days ? String(plan.duration_days) : '',
    max_reservations_per_week: plan.max_reservations_per_week ? String(plan.max_reservations_per_week) : '',
    is_featured: plan.is_featured,
    auto_renew: plan.auto_renew,
    is_active: plan.is_active,
  };
}

export default function PlansPage() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<PlanFormState>(emptyForm);

  const { data, isLoading, isError } = useQuery<PaginatedResponse<Plan>>({
    queryKey: ['plans'],
    queryFn: async () => {
      const response = await plansApi.list({ active_only: false });
      return response.data;
    },
  });

  const createPlan = useMutation({
    mutationFn: async () => {
      const response = await plansApi.create({
        name: form.name,
        description: form.description || null,
        price: Number(form.price),
        duration_type: form.duration_type,
        duration_days: form.duration_days ? Number(form.duration_days) : null,
        max_reservations_per_week: form.max_reservations_per_week ? Number(form.max_reservations_per_week) : null,
        is_featured: form.is_featured,
        auto_renew: form.auto_renew,
      });
      return response.data;
    },
    onSuccess: () => {
      toast.success('Plan creado correctamente');
      setShowModal(false);
      setForm(emptyForm);
      queryClient.invalidateQueries({ queryKey: ['plans'] });
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.detail || 'No se pudo crear el plan');
    },
  });

  const updatePlan = useMutation({
    mutationFn: async () => {
      if (!form.id) throw new Error('Plan sin identificador');

      const response = await plansApi.update(form.id, {
        name: form.name,
        description: form.description || null,
        price: Number(form.price),
        duration_type: form.duration_type,
        duration_days: form.duration_days ? Number(form.duration_days) : null,
        max_reservations_per_week: form.max_reservations_per_week ? Number(form.max_reservations_per_week) : null,
        is_featured: form.is_featured,
        auto_renew: form.auto_renew,
        is_active: form.is_active,
      });
      return response.data;
    },
    onSuccess: () => {
      toast.success('Plan actualizado');
      setShowModal(false);
      setForm(emptyForm);
      queryClient.invalidateQueries({ queryKey: ['plans'] });
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.detail || 'No se pudo actualizar el plan');
    },
  });

  const togglePlan = useMutation({
    mutationFn: async ({ planId, isActive }: { planId: string; isActive: boolean }) => {
      const response = await plansApi.update(planId, { is_active: isActive });
      return response.data;
    },
    onSuccess: (_, variables) => {
      toast.success(variables.isActive ? 'Plan activado' : 'Plan desactivado');
      queryClient.invalidateQueries({ queryKey: ['plans'] });
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.detail || 'No se pudo cambiar el estado del plan');
    },
  });

  const isEditing = Boolean(form.id);
  const plans = data?.items ?? [];
  const featuredPlanId = useMemo(() => plans.find((plan) => plan.is_featured)?.id, [plans]);

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-6">
      <motion.div variants={fadeInUp} className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Planes</h1>
          <p className="mt-1 text-sm text-surface-500">
            {isLoading ? 'Cargando planes...' : `${plans.length} planes disponibles`}
          </p>
        </div>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => {
            setForm(emptyForm);
            setShowModal(true);
          }}
          className="btn-primary text-sm"
        >
          <Plus size={16} /> Nuevo Plan
        </motion.button>
      </motion.div>

      {isError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-600 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
          No pudimos cargar los planes del backend.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="shimmer h-[420px] rounded-2xl" />
          ))
        ) : null}

        {!isLoading ? plans.map((plan, index) => (
          <motion.div
            key={plan.id}
            initial={{ opacity: 0, y: 30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: index * 0.08, duration: 0.45 }}
            whileHover={{ y: -6, transition: { duration: 0.2 } }}
            className={cn(
              'relative overflow-hidden rounded-2xl p-6 transition-all duration-300',
              plan.id === featuredPlanId
                ? 'bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-xl shadow-brand-500/25'
                : 'border border-surface-200/50 bg-white hover:shadow-xl dark:border-surface-800/50 dark:bg-surface-900',
            )}
          >
            {plan.id === featuredPlanId ? (
              <div className="absolute right-4 top-4 flex items-center gap-1 rounded-full bg-white/20 px-2.5 py-1 text-xs font-bold backdrop-blur-sm">
                <Star size={12} fill="currentColor" /> Destacado
              </div>
            ) : null}

            <div className="mb-5">
              <div className="mb-2 flex items-center gap-2">
                <h3 className={cn('text-lg font-bold font-display', plan.id !== featuredPlanId && 'text-surface-900 dark:text-white')}>
                  {plan.name}
                </h3>
                <span className={cn('badge', plan.is_active ? 'badge-success' : 'badge-warning')}>
                  {plan.is_active ? 'Activo' : 'Inactivo'}
                </span>
              </div>
              <p className={cn('text-sm', plan.id === featuredPlanId ? 'text-white/75' : 'text-surface-500')}>
                {plan.description || 'Sin descripción todavía.'}
              </p>
            </div>

            <div className="mb-5">
              <div className="flex items-baseline gap-2">
                <span className={cn('text-3xl font-extrabold font-display', plan.id !== featuredPlanId && 'text-surface-900 dark:text-white')}>
                  {formatCurrency(parseApiNumber(plan.price), plan.currency)}
                </span>
              </div>
              <p className={cn('mt-1 text-sm', plan.id === featuredPlanId ? 'text-white/65' : 'text-surface-400')}>
                {formatDurationLabel(plan.duration_type, plan.duration_days)}
              </p>
            </div>

            <ul className="mb-6 space-y-2.5">
              {[
                plan.max_reservations_per_week
                  ? `${plan.max_reservations_per_week} reservas por semana`
                  : 'Reservas ilimitadas',
                plan.auto_renew ? 'Renovación automática' : 'Renovación manual',
                plan.is_featured ? 'Visible como recomendado' : 'Plan estándar',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <div className={cn(
                    'mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full',
                    plan.id === featuredPlanId ? 'bg-white/20' : 'bg-brand-100 dark:bg-brand-950',
                  )}>
                    <Check size={10} className={plan.id === featuredPlanId ? 'text-white' : 'text-brand-500'} />
                  </div>
                  <span className={cn('text-sm', plan.id === featuredPlanId ? 'text-white/90' : 'text-surface-600 dark:text-surface-400')}>
                    {item}
                  </span>
                </li>
              ))}
            </ul>

            <div className={cn(
              'mb-4 flex items-center justify-between border-t px-0 py-3',
              plan.id === featuredPlanId ? 'border-white/20' : 'border-surface-100 dark:border-surface-800',
            )}>
              <span className={cn('text-sm', plan.id === featuredPlanId ? 'text-white/70' : 'text-surface-500')}>
                Duración en días
              </span>
              <span className={cn('text-sm font-bold', plan.id !== featuredPlanId && 'text-surface-900 dark:text-white')}>
                {plan.duration_days ?? 'N/A'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => {
                  setForm(toFormState(plan));
                  setShowModal(true);
                }}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-all duration-200',
                  plan.id === featuredPlanId ? 'bg-white text-brand-700 hover:bg-white/90' : 'btn-secondary',
                )}
              >
                <Edit2 size={14} /> Editar
              </motion.button>
              <button
                type="button"
                onClick={() => togglePlan.mutate({ planId: plan.id, isActive: !plan.is_active })}
                className={cn(
                  'rounded-xl p-2.5 transition-colors',
                  plan.id === featuredPlanId ? 'bg-white/15 hover:bg-white/25' : 'bg-surface-100 hover:bg-surface-200 dark:bg-surface-800 dark:hover:bg-surface-700',
                )}
                aria-label={plan.is_active ? 'Desactivar plan' : 'Activar plan'}
              >
                {plan.is_active ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
              </button>
            </div>
          </motion.div>
        )) : null}
      </div>

      <Modal
        open={showModal}
        title={isEditing ? 'Editar plan' : 'Nuevo plan'}
        description="Estos cambios se guardan contra el backend y actualizan las tarjetas en cuanto termina la solicitud."
        onClose={() => {
          if (!createPlan.isPending && !updatePlan.isPending) {
            setShowModal(false);
          }
        }}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (isEditing) {
              updatePlan.mutate();
            } else {
              createPlan.mutate();
            }
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
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Precio</label>
              <input
                type="number"
                min="0"
                className="input"
                value={form.price}
                onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))}
                required
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Descripción</label>
            <textarea
              className="input min-h-24 resize-y"
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Duración</label>
              <select
                className="input"
                value={form.duration_type}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  duration_type: event.target.value as PlanFormState['duration_type'],
                }))}
              >
                <option value="monthly">Mensual</option>
                <option value="annual">Anual</option>
                <option value="perpetual">Perpetuo</option>
                <option value="custom">Personalizado</option>
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Días</label>
              <input
                type="number"
                min="0"
                className="input"
                value={form.duration_days}
                onChange={(event) => setForm((current) => ({ ...current, duration_days: event.target.value }))}
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Reservas / semana</label>
              <input
                type="number"
                min="0"
                className="input"
                value={form.max_reservations_per_week}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  max_reservations_per_week: event.target.value,
                }))}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex items-center gap-3 rounded-2xl border border-surface-200 px-4 py-3 dark:border-surface-800">
              <input
                type="checkbox"
                checked={form.is_featured}
                onChange={(event) => setForm((current) => ({ ...current, is_featured: event.target.checked }))}
              />
              <span className="text-sm text-surface-700 dark:text-surface-300">Destacado</span>
            </label>
            <label className="flex items-center gap-3 rounded-2xl border border-surface-200 px-4 py-3 dark:border-surface-800">
              <input
                type="checkbox"
                checked={form.auto_renew}
                onChange={(event) => setForm((current) => ({ ...current, auto_renew: event.target.checked }))}
              />
              <span className="text-sm text-surface-700 dark:text-surface-300">Auto renovación</span>
            </label>
            <label className="flex items-center gap-3 rounded-2xl border border-surface-200 px-4 py-3 dark:border-surface-800">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.checked }))}
              />
              <span className="text-sm text-surface-700 dark:text-surface-300">Activo</span>
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={createPlan.isPending || updatePlan.isPending}>
              {createPlan.isPending || updatePlan.isPending
                ? 'Guardando...'
                : isEditing ? 'Guardar cambios' : 'Crear plan'}
            </button>
          </div>
        </form>
      </Modal>
    </motion.div>
  );
}
