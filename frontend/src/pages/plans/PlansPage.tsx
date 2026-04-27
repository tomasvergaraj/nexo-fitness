import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { Plus, Check, Star, Edit2, ToggleLeft, ToggleRight, Tag } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import Tooltip from '@/components/ui/Tooltip';
import { plansApi } from '@/services/api';
import { staggerContainer, fadeInUp } from '@/utils/animations';
import { cn, formatCurrency, formatDurationLabel, parseApiNumber, getApiError } from '@/utils';
import type { PaginatedResponse, Plan } from '@/types';

type DurationPreset = 'monthly' | 'quarterly' | 'semiannual' | 'annual' | 'perpetual' | 'custom';

type PlanFormState = {
  id?: string;
  name: string;
  description: string;
  price: string;
  discount_pct: string;
  duration_preset: DurationPreset;
  duration_days: string;
  max_reservations_per_week: string;
  max_reservations_per_month: string;
  is_featured: boolean;
  auto_renew: boolean;
  is_active: boolean;
};

function applyDiscount(price: number, discountPct: number | null | undefined): number {
  if (!discountPct) return price;
  return Math.round(price * (1 - discountPct / 100));
}

const durationPresetOptions: Array<{
  value: Exclude<DurationPreset, 'custom'>;
  label: string;
  description: string;
}> = [
  { value: 'monthly', label: 'Mensual', description: 'Cobro y renovación cada 30 días.' },
  { value: 'quarterly', label: 'Trimestral', description: 'Compromiso de 3 meses.' },
  { value: 'semiannual', label: 'Semestral', description: 'Plan de 6 meses.' },
  { value: 'annual', label: 'Anual', description: 'Ideal para fidelización de largo plazo.' },
  { value: 'perpetual', label: 'Perpetuo', description: 'Sin vencimiento ni renovación.' },
];

const resolveDurationPreset = (durationType: Plan['duration_type'], durationDays?: number | null): DurationPreset => {
  if (durationType === 'monthly') return 'monthly';
  if (durationType === 'annual') return 'annual';
  if (durationType === 'perpetual') return 'perpetual';
  if (durationDays === 90) return 'quarterly';
  if (durationDays === 180) return 'semiannual';
  return 'custom';
};

const resolveDurationPayload = (form: PlanFormState) => {
  switch (form.duration_preset) {
    case 'monthly':
      return { duration_type: 'monthly' as const, duration_days: 30, auto_renew: form.auto_renew };
    case 'quarterly':
      return { duration_type: 'custom' as const, duration_days: 90, auto_renew: form.auto_renew };
    case 'semiannual':
      return { duration_type: 'custom' as const, duration_days: 180, auto_renew: form.auto_renew };
    case 'annual':
      return { duration_type: 'annual' as const, duration_days: 365, auto_renew: form.auto_renew };
    case 'perpetual':
      return { duration_type: 'perpetual' as const, duration_days: null, auto_renew: false };
    case 'custom':
      return {
        duration_type: 'custom' as const,
        duration_days: form.duration_days ? Number(form.duration_days) : null,
        auto_renew: form.auto_renew,
      };
  }
};

function SettingToggleCard({
  title,
  description,
  checked,
  disabled = false,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (nextValue: boolean) => void;
}) {
  return (
    <label
      className={cn(
        'block h-full rounded-2xl border px-4 py-4 transition-all',
        disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer',
        checked
          ? 'border-brand-300 bg-brand-50/80 shadow-sm dark:border-brand-700 dark:bg-brand-950/20'
          : 'border-surface-200 bg-white dark:border-surface-800 dark:bg-surface-950/30',
      )}
    >
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          if (disabled) {
            return;
          }
          onChange(event.target.checked);
        }}
      />
      <div className="flex min-h-[5.25rem] items-center justify-between gap-4">
        <div className="min-w-0 pr-2">
          <p className="text-sm font-semibold text-surface-900 dark:text-white">{title}</p>
          <p className="mt-1 text-xs leading-5 text-surface-500 dark:text-surface-400">{description}</p>
        </div>
        <span
          className={cn(
            'relative inline-flex h-6 w-11 shrink-0 self-center rounded-full transition-colors duration-200',
            checked ? 'bg-brand-500' : 'bg-surface-300 dark:bg-surface-700',
          )}
        >
          <span
            className={cn(
              'absolute left-0.5 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white shadow-sm transition-transform duration-200',
              checked ? 'translate-x-5' : 'translate-x-0',
            )}
          />
        </span>
      </div>
    </label>
  );
}

const emptyForm: PlanFormState = {
  name: '',
  description: '',
  price: '29990',
  discount_pct: '',
  duration_preset: 'monthly',
  duration_days: '',
  max_reservations_per_week: '',
  max_reservations_per_month: '',
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
    discount_pct: plan.discount_pct ? String(plan.discount_pct) : '',
    duration_preset: resolveDurationPreset(plan.duration_type, plan.duration_days),
    duration_days: plan.duration_days ? String(plan.duration_days) : '',
    max_reservations_per_week: plan.max_reservations_per_week ? String(plan.max_reservations_per_week) : '',
    max_reservations_per_month: plan.max_reservations_per_month ? String(plan.max_reservations_per_month) : '',
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
      const duration = resolveDurationPayload(form);
      const response = await plansApi.create({
        name: form.name,
        description: form.description || null,
        price: Number(form.price),
        discount_pct: form.discount_pct ? Number(form.discount_pct) : null,
        duration_type: duration.duration_type,
        duration_days: duration.duration_days,
        max_reservations_per_week: form.max_reservations_per_week ? Number(form.max_reservations_per_week) : null,
        max_reservations_per_month: form.max_reservations_per_month ? Number(form.max_reservations_per_month) : null,
        is_featured: form.is_featured,
        auto_renew: duration.auto_renew,
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
      toast.error(getApiError(error, 'No se pudo crear el plan'));
    },
  });

  const updatePlan = useMutation({
    mutationFn: async () => {
      if (!form.id) throw new Error('Plan sin identificador');
      const duration = resolveDurationPayload(form);

      const response = await plansApi.update(form.id, {
        name: form.name,
        description: form.description || null,
        price: Number(form.price),
        discount_pct: form.discount_pct ? Number(form.discount_pct) : null,
        duration_type: duration.duration_type,
        duration_days: duration.duration_days,
        max_reservations_per_week: form.max_reservations_per_week ? Number(form.max_reservations_per_week) : null,
        max_reservations_per_month: form.max_reservations_per_month ? Number(form.max_reservations_per_month) : null,
        is_featured: form.is_featured,
        auto_renew: duration.auto_renew,
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
      toast.error(getApiError(error, 'No se pudo actualizar el plan'));
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
      toast.error(getApiError(error, 'No se pudo cambiar el estado del plan'));
    },
  });

  const isEditing = Boolean(form.id);
  const plans = data?.items ?? [];
  const featuredPlanId = useMemo(() => plans.find((plan) => plan.is_featured)?.id, [plans]);
  const durationPreview = resolveDurationPayload(form);

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
          No pudimos cargar los planes.
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
              {plan.discount_pct ? (
                <>
                  <div className="mb-1 flex items-center gap-2">
                    <span className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold',
                      plan.id === featuredPlanId
                        ? 'bg-white/20 text-white'
                        : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
                    )}>
                      <Tag size={10} />
                      {plan.discount_pct}% descuento
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className={cn('text-3xl font-extrabold font-display', plan.id !== featuredPlanId && 'text-surface-900 dark:text-white')}>
                      {formatCurrency(applyDiscount(parseApiNumber(plan.price), plan.discount_pct), plan.currency)}
                    </span>
                    <span className={cn('text-sm line-through', plan.id === featuredPlanId ? 'text-white/50' : 'text-surface-400')}>
                      {formatCurrency(parseApiNumber(plan.price), plan.currency)}
                    </span>
                  </div>
                </>
              ) : (
                <div className="flex items-baseline gap-2">
                  <span className={cn('text-3xl font-extrabold font-display', plan.id !== featuredPlanId && 'text-surface-900 dark:text-white')}>
                    {formatCurrency(parseApiNumber(plan.price), plan.currency)}
                  </span>
                </div>
              )}
              <p className={cn('mt-1 text-sm', plan.id === featuredPlanId ? 'text-white/65' : 'text-surface-400')}>
                {formatDurationLabel(plan.duration_type, plan.duration_days)}
              </p>
            </div>

            <ul className="mb-6 space-y-2.5">
              {[
                plan.max_reservations_per_week
                  ? `Hasta ${plan.max_reservations_per_week} reservas por semana`
                  : 'Sin límite semanal de reservas',
                plan.max_reservations_per_month
                  ? `Hasta ${plan.max_reservations_per_month} reservas por mes`
                  : 'Sin límite mensual de reservas',
                plan.auto_renew ? 'Renovación automática' : 'Renovación manual',
                plan.is_featured ? 'Destacado en la venta online' : 'Visible como plan estándar',
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

            <div className="flex items-center gap-2">
              <Tooltip content="Editar este plan" className="flex-1">
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
              </Tooltip>
              <Tooltip content={plan.is_active ? 'Desactivar este plan' : 'Activar este plan'}>
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
              </Tooltip>
            </div>
          </motion.div>
        )) : null}
      </div>

      <Modal
        open={showModal}
        title={isEditing ? 'Editar plan' : 'Nuevo plan'}
        description="Configura la duración y el comportamiento del plan sin tener que tocar campos técnicos."
        onClose={() => {
          if (!createPlan.isPending && !updatePlan.isPending) {
            setShowModal(false);
          }
        }}
        size="lg"
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
            <div className="grid grid-cols-[1fr_120px] gap-3">
              <div>
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Precio base</label>
                <input
                  type="number"
                  min="0"
                  className="input"
                  value={form.price}
                  onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">
                  <Tag size={13} className="mr-1 inline-block text-emerald-500" />
                  Descuento %
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  className="input"
                  value={form.discount_pct}
                  onChange={(event) => setForm((current) => ({ ...current, discount_pct: event.target.value }))}
                  placeholder="0"
                />
              </div>
            </div>
          </div>

          {form.discount_pct && Number(form.discount_pct) > 0 && Number(form.price) > 0 ? (
            <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm dark:border-emerald-900/40 dark:bg-emerald-950/20">
              <Tag size={15} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span className="text-emerald-800 dark:text-emerald-200">
                Precio con descuento:{' '}
                <strong>{formatCurrency(applyDiscount(Number(form.price), Number(form.discount_pct)), 'CLP')}</strong>
                {' '}— {form.discount_pct}% de descuento sobre{' '}
                {formatCurrency(Number(form.price), 'CLP')}
              </span>
            </div>
          ) : null}

          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Descripción</label>
            <textarea
              className="input min-h-24 resize-y"
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            />
          </div>

          <div className="space-y-3 rounded-2xl border border-surface-200 bg-surface-50/70 p-4 dark:border-surface-800 dark:bg-surface-950/30">
            <div>
              <p className="text-sm font-semibold text-surface-900 dark:text-white">Duración del plan</p>
              <p className="mt-1 text-xs leading-5 text-surface-500 dark:text-surface-400">
                Elige la duración que quieres ofrecer. Si necesitas otro plazo, puedes ingresarlo más abajo.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {durationPresetOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setForm((current) => ({
                    ...current,
                    duration_preset: option.value,
                    duration_days: option.value === 'perpetual' ? '' : current.duration_days,
                    auto_renew: option.value === 'perpetual' ? false : current.auto_renew,
                  }))}
                  className={cn(
                    'rounded-2xl border px-4 py-4 text-left transition-all',
                    form.duration_preset === option.value
                      ? 'border-brand-300 bg-brand-50 shadow-sm dark:border-brand-700 dark:bg-brand-950/20'
                      : 'border-surface-200 bg-white hover:border-surface-300 dark:border-surface-800 dark:bg-surface-900/70',
                  )}
                >
                  <p className="text-sm font-semibold text-surface-900 dark:text-white">{option.label}</p>
                  <p className="mt-1 text-xs leading-5 text-surface-500 dark:text-surface-400">{option.description}</p>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-[0.18em] text-surface-400">
                Opciones avanzadas
              </span>
              <button
                type="button"
                onClick={() => setForm((current) => ({
                  ...current,
                  duration_preset: 'custom',
                  duration_days: current.duration_days || '30',
                }))}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                  form.duration_preset === 'custom'
                    ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-brand-950/20 dark:text-brand-300'
                    : 'border-surface-200 text-surface-600 hover:border-surface-300 hover:text-surface-900 dark:border-surface-800 dark:text-surface-300 dark:hover:border-surface-700 dark:hover:text-white',
                )}
              >
                Usar otro plazo
              </button>
            </div>
            {form.duration_preset === 'custom' ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-900/40 dark:bg-amber-950/10">
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Duración personalizada en días</label>
                <input
                  type="number"
                  min="1"
                  className="input"
                  value={form.duration_days}
                  onChange={(event) => setForm((current) => ({ ...current, duration_days: event.target.value }))}
                  required
                />
                <p className="mt-2 text-xs leading-5 text-surface-500 dark:text-surface-400">
                  Solo úsalo si necesitas un plazo distinto a mensual, trimestral, semestral o anual.
                </p>
              </div>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-surface-200 bg-white px-4 py-4 dark:border-surface-800 dark:bg-surface-950/30">
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">
                Límite por semana (opcional)
              </label>
              <input
                type="number"
                min="0"
                className="input"
                value={form.max_reservations_per_week}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  max_reservations_per_week: event.target.value,
                }))}
                placeholder="Sin límite"
              />
              <p className="mt-2 text-xs leading-5 text-surface-500 dark:text-surface-400">
                Máximo de reservas por semana. Déjalo vacío para ilimitadas.
              </p>
            </div>

            <div className="rounded-2xl border border-surface-200 bg-white px-4 py-4 dark:border-surface-800 dark:bg-surface-950/30">
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">
                Límite por mes (opcional)
              </label>
              <input
                type="number"
                min="0"
                className="input"
                value={form.max_reservations_per_month}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  max_reservations_per_month: event.target.value,
                }))}
                placeholder="Sin límite"
              />
              <p className="mt-2 text-xs leading-5 text-surface-500 dark:text-surface-400">
                Máximo de reservas por mes. Déjalo vacío para ilimitadas.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-surface-200 bg-white px-4 py-4 dark:border-surface-800 dark:bg-surface-950/30">
            <p className="text-sm font-semibold text-surface-900 dark:text-white">Resumen rápido</p>
            <div className="mt-3 space-y-2 text-sm text-surface-600 dark:text-surface-300">
              <p>Duración: {formatDurationLabel(durationPreview.duration_type, durationPreview.duration_days)}</p>
              <p>
                Reservas semanales:{' '}
                {form.max_reservations_per_week ? `hasta ${form.max_reservations_per_week} por semana` : 'sin límite'}
              </p>
              <p>
                Reservas mensuales:{' '}
                {form.max_reservations_per_month ? `hasta ${form.max_reservations_per_month} por mes` : 'sin límite'}
              </p>
              <p>Renovación: {durationPreview.auto_renew ? 'automática' : 'manual'}</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <SettingToggleCard
              title="Destacar plan"
              description="Se mostrará como recomendado frente a los demás planes."
              checked={form.is_featured}
              onChange={(nextValue) => setForm((current) => ({ ...current, is_featured: nextValue }))}
            />
            <SettingToggleCard
              title="Renovación automática"
              description={form.duration_preset === 'perpetual' ? 'No aplica a planes perpetuos.' : 'El plan se renueva automáticamente al vencer.'}
              checked={durationPreview.auto_renew}
              disabled={form.duration_preset === 'perpetual'}
              onChange={(nextValue) => setForm((current) => ({ ...current, auto_renew: nextValue }))}
            />
            <SettingToggleCard
              title="Plan activo"
              description="Si lo desactivas, deja de ofrecerse para nuevas ventas."
              checked={form.is_active}
              onChange={(nextValue) => setForm((current) => ({ ...current, is_active: nextValue }))}
            />
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
