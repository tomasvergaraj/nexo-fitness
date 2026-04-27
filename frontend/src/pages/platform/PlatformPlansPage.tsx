import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { Check, Eye, EyeOff, Plus, Settings2, Sparkles, Star, Tag, ToggleLeft, ToggleRight, WalletCards } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { billingApi } from '@/services/api';
import { fadeInUp, staggerContainer } from '@/utils/animations';
import { cn, formatCurrency, formatDateTime, parseApiNumber , getApiError } from '@/utils';
import type { AdminSaaSPlan, AdminSaaSPlanCreateRequest, AdminSaaSPlanUpdateRequest } from '@/types';

type PlatformPlanFormState = {
  id?: string;
  key: string;
  name: string;
  description: string;
  license_type: 'monthly' | 'quarterly' | 'semi_annual' | 'annual' | 'perpetual';
  currency: string;
  price: string;
  discount_pct: string;
  billing_interval: 'month' | 'quarter' | 'semi_annual' | 'year' | 'manual';
  trial_days: string;
  max_members: string;
  max_branches: string;
  checkout_provider: 'none' | 'stripe' | 'fintoc' | 'webpay';
  stripe_price_id: string;
  features: string;
  highlighted: boolean;
  is_active: boolean;
  is_public: boolean;
  sort_order: string;
};

function applyDiscount(price: number, discountPct: number | null | undefined): number {
  if (!discountPct) return price;
  return Math.round(price * (1 - discountPct / 100));
}

const emptyForm: PlatformPlanFormState = {
  key: '',
  name: '',
  description: '',
  license_type: 'monthly',
  currency: 'CLP',
  price: '29990',
  discount_pct: '',
  billing_interval: 'month',
  trial_days: '14',
  max_members: '500',
  max_branches: '3',
  checkout_provider: 'none',
  stripe_price_id: '',
  features: 'Panel operativo multicuenta\nClientes, clases y check-in',
  highlighted: false,
  is_active: true,
  is_public: true,
  sort_order: '10',
};

function toFormState(plan?: AdminSaaSPlan): PlatformPlanFormState {
  if (!plan) {
    return emptyForm;
  }

  return {
    id: plan.id,
    key: plan.key,
    name: plan.name,
    description: plan.description ?? '',
    license_type: plan.license_type,
    currency: plan.currency,
    price: String(parseApiNumber(plan.price)),
    discount_pct: plan.discount_pct ? String(plan.discount_pct) : '',
    billing_interval: plan.billing_interval,
    trial_days: String(plan.trial_days),
    max_members: String(plan.max_members),
    max_branches: String(plan.max_branches),
    checkout_provider: plan.webpay_enabled ? 'webpay' : plan.fintoc_enabled ? 'fintoc' : plan.stripe_price_id ? 'stripe' : 'none',
    stripe_price_id: plan.stripe_price_id ?? '',
    features: plan.features.join('\n'),
    highlighted: plan.highlighted,
    is_active: plan.is_active,
    is_public: plan.is_public,
    sort_order: String(plan.sort_order),
  };
}

function parseFeatures(rawValue: string): string[] {
  return rawValue
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean);
}

function providerLabel(provider?: AdminSaaSPlan['checkout_provider'] | PlatformPlanFormState['checkout_provider'] | null) {
  if (provider === 'webpay') return 'Webpay';
  if (provider === 'fintoc') return 'Fintoc';
  if (provider === 'stripe') return 'Stripe';
  return 'Sin checkout';
}

function toCreatePayload(form: PlatformPlanFormState): AdminSaaSPlanCreateRequest {
  return {
    key: form.key.trim().toLowerCase(),
    name: form.name.trim(),
    description: form.description.trim(),
    license_type: form.license_type,
    currency: form.currency.trim().toUpperCase(),
    price: Number(form.price),
    discount_pct: form.discount_pct ? Number(form.discount_pct) : null,
    billing_interval: form.billing_interval,
    trial_days: Number(form.trial_days),
    max_members: Number(form.max_members),
    max_branches: Number(form.max_branches),
    stripe_price_id: form.checkout_provider === 'stripe' ? form.stripe_price_id.trim() || null : null,
    fintoc_enabled: form.checkout_provider === 'fintoc',
    webpay_enabled: form.checkout_provider === 'webpay',
    features: parseFeatures(form.features),
    highlighted: form.highlighted,
    is_active: form.is_active,
    is_public: form.is_public,
    sort_order: Number(form.sort_order),
  };
}

function toUpdatePayload(form: PlatformPlanFormState): AdminSaaSPlanUpdateRequest {
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    license_type: form.license_type,
    currency: form.currency.trim().toUpperCase(),
    price: Number(form.price),
    discount_pct: form.discount_pct ? Number(form.discount_pct) : null,
    billing_interval: form.billing_interval,
    trial_days: Number(form.trial_days),
    max_members: Number(form.max_members),
    max_branches: Number(form.max_branches),
    stripe_price_id: form.checkout_provider === 'stripe' ? form.stripe_price_id.trim() || null : null,
    fintoc_enabled: form.checkout_provider === 'fintoc',
    webpay_enabled: form.checkout_provider === 'webpay',
    features: parseFeatures(form.features),
    highlighted: form.highlighted,
    is_active: form.is_active,
    is_public: form.is_public,
    sort_order: Number(form.sort_order),
  };
}

export default function PlatformPlansPage() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<PlatformPlanFormState>(emptyForm);

  const { data: plans = [], isLoading, isError } = useQuery<AdminSaaSPlan[]>({
    queryKey: ['platform-saas-plans'],
    queryFn: async () => {
      const response = await billingApi.listAdminPlans();
      return response.data;
    },
  });

  const createPlan = useMutation({
    mutationFn: async () => {
      const response = await billingApi.createAdminPlan(toCreatePayload(form));
      return response.data;
    },
    onSuccess: () => {
      toast.success('Plan SaaS creado');
      setShowModal(false);
      setForm(emptyForm);
      queryClient.invalidateQueries({ queryKey: ['platform-saas-plans'] });
      queryClient.invalidateQueries({ queryKey: ['platform-tenants'] });
      queryClient.invalidateQueries({ queryKey: ['platform-public-plans'] });
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No se pudo crear el plan SaaS'));
    },
  });

  const updatePlan = useMutation({
    mutationFn: async ({ planId, payload }: { planId: string; payload: AdminSaaSPlanUpdateRequest }) => {
      const response = await billingApi.updateAdminPlan(planId, payload);
      return response.data;
    },
    onSuccess: () => {
      toast.success('Plan SaaS actualizado');
      setShowModal(false);
      setForm(emptyForm);
      queryClient.invalidateQueries({ queryKey: ['platform-saas-plans'] });
      queryClient.invalidateQueries({ queryKey: ['platform-tenants'] });
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No se pudo actualizar el plan SaaS'));
    },
  });

  const quickToggle = useMutation({
    mutationFn: async ({ planId, payload }: { planId: string; payload: AdminSaaSPlanUpdateRequest }) => {
      const response = await billingApi.updateAdminPlan(planId, payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-saas-plans'] });
      queryClient.invalidateQueries({ queryKey: ['platform-tenants'] });
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No se pudo guardar el cambio'));
    },
  });

  const isEditing = Boolean(form.id);
  const summary = useMemo(() => ({
    total: plans.length,
    active: plans.filter((plan) => plan.is_active).length,
    public: plans.filter((plan) => plan.is_public).length,
    checkoutReady: plans.filter((plan) => plan.checkout_enabled).length,
  }), [plans]);

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-6">
      <motion.div variants={fadeInUp} className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-brand-200/50 bg-brand-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-brand-700 dark:border-brand-900/40 dark:bg-brand-950/20 dark:text-brand-300">
            <Settings2 size={14} />
            Catalogo SaaS
          </div>
          <h1 className="mt-3 text-2xl font-bold font-display text-surface-900 dark:text-white">Planes de la plataforma</h1>
          <p className="mt-1 text-sm text-surface-500">
            Crea y ajusta los planes que se publican en el registro del gimnasio.
          </p>
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
          Nuevo plan SaaS
        </button>
      </motion.div>

      {isError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-600 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
          No pudimos cargar el catálogo de planes SaaS.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
          <p className="text-sm text-surface-500">Planes totales</p>
          <p className="mt-2 text-3xl font-bold font-display text-surface-900 dark:text-white">{summary.total}</p>
        </div>
        <div className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
          <p className="text-sm text-surface-500">Planes activos</p>
          <p className="mt-2 text-3xl font-bold font-display text-surface-900 dark:text-white">{summary.active}</p>
        </div>
        <div className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
          <p className="text-sm text-surface-500">Visibles en registro</p>
          <p className="mt-2 text-3xl font-bold font-display text-surface-900 dark:text-white">{summary.public}</p>
        </div>
        <div className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
          <p className="text-sm text-surface-500">Cobro listo</p>
          <p className="mt-2 text-3xl font-bold font-display text-surface-900 dark:text-white">{summary.checkoutReady}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="shimmer h-[420px] rounded-3xl" />
          ))
        ) : plans.map((plan) => (
          <motion.div
            key={plan.id}
            variants={fadeInUp}
            className={cn(
              'overflow-hidden rounded-3xl border p-6 shadow-xl transition-all',
              plan.highlighted
                ? 'border-brand-300/40 bg-gradient-to-br from-brand-500 to-cyan-600 text-white shadow-brand-500/20'
                : 'border-surface-200/50 bg-white dark:border-surface-800/50 dark:bg-surface-900',
            )}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className={cn('text-xl font-bold font-display', !plan.highlighted && 'text-surface-900 dark:text-white')}>
                    {plan.name}
                  </h2>
                  {plan.highlighted ? (
                    <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white">
                      Destacado
                    </span>
                  ) : null}
                </div>
                <p className={cn('mt-1 font-mono text-xs', plan.highlighted ? 'text-white/70' : 'text-surface-500')}>
                  {plan.key}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setForm(toFormState(plan));
                  setShowModal(true);
                }}
                className={cn(
                  'rounded-2xl px-4 py-2 text-sm font-semibold transition-colors',
                  plan.highlighted ? 'bg-white text-brand-700 hover:bg-white/90' : 'btn-secondary',
                )}
              >
                Editar
              </button>
            </div>

            <p className={cn('mt-4 min-h-12 text-sm leading-6', plan.highlighted ? 'text-white/85' : 'text-surface-500')}>
              {plan.description}
            </p>

            <div className="mt-5 flex items-end justify-between gap-3">
              <div>
                <p className={cn('text-3xl font-bold font-display', !plan.highlighted && 'text-surface-900 dark:text-white')}>
                  {formatCurrency(parseApiNumber(plan.price), plan.currency)}
                </p>
                <p className={cn('mt-1 text-xs uppercase tracking-[0.18em]', plan.highlighted ? 'text-white/70' : 'text-surface-500')}>
                  Valor neto
                </p>
                <p className={cn('mt-1 text-xs uppercase tracking-[0.18em]', plan.highlighted ? 'text-white/70' : 'text-surface-500')}>
                  {plan.billing_interval === 'year' ? 'Cobro anual' : plan.billing_interval === 'quarter' ? 'Cobro trimestral' : plan.billing_interval === 'semi_annual' ? 'Cobro semestral' : plan.billing_interval === 'manual' ? 'Manual' : 'Cobro mensual'}
                </p>
                <p className={cn('mt-2 text-xs', plan.highlighted ? 'text-white/85' : 'text-surface-500')}>
                  IVA 19%: {formatCurrency(parseApiNumber(plan.tax_amount), plan.currency)}
                </p>
                <p className={cn('mt-1 text-xs font-semibold', plan.highlighted ? 'text-white' : 'text-brand-700 dark:text-brand-300')}>
                  Total cobrado: {formatCurrency(parseApiNumber(plan.total_price), plan.currency)}
                </p>
                {plan.discount_pct ? (
                  <div className="mt-2 flex items-center gap-1.5">
                    <Tag size={11} className={plan.highlighted ? 'text-white' : 'text-amber-500'} />
                    <span className={cn('text-[11px]', plan.highlighted ? 'text-white/85' : 'text-amber-700 dark:text-amber-300')}>
                      Legacy {plan.discount_pct}%: no entra en la nueva cotización SaaS por promo code.
                    </span>
                  </div>
                ) : null}
              </div>
              <div className={cn('text-right text-xs', plan.highlighted ? 'text-white/80' : 'text-surface-500')}>
                <p>{plan.trial_days} días de prueba</p>
                <p>{plan.max_members} miembros</p>
                <p>{plan.max_branches} sedes</p>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', plan.highlighted ? 'bg-white/15 text-white' : 'bg-surface-100 text-surface-700 dark:bg-surface-800 dark:text-surface-300')}>
                {plan.is_active ? 'Activo' : 'Inactivo'}
              </span>
              <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', plan.highlighted ? 'bg-white/15 text-white' : 'bg-surface-100 text-surface-700 dark:bg-surface-800 dark:text-surface-300')}>
                {plan.is_public ? 'Público' : 'Interno'}
              </span>
              <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', plan.highlighted ? 'bg-white/15 text-white' : 'bg-surface-100 text-surface-700 dark:bg-surface-800 dark:text-surface-300')}>
                {plan.checkout_enabled
                  ? `Cobro: ${providerLabel(plan.checkout_provider)}`
                  : 'Cobro pendiente'}
              </span>
            </div>

            <div className={cn('mt-5 space-y-2 rounded-2xl border p-4', plan.highlighted ? 'border-white/15 bg-white/8' : 'border-surface-200/60 bg-surface-50 dark:border-surface-800 dark:bg-surface-950/60')}>
              <div className="flex items-center justify-between text-sm">
                <span className={plan.highlighted ? 'text-white/80' : 'text-surface-500'}>Pasarela</span>
                <span className={cn('text-xs font-medium', !plan.highlighted && 'text-surface-700 dark:text-surface-300')}>
                  {providerLabel(plan.checkout_provider)}
                </span>
              </div>
              {plan.checkout_provider === 'stripe' && (
                <div className="flex items-center justify-between text-sm">
                  <span className={plan.highlighted ? 'text-white/80' : 'text-surface-500'}>Stripe price ID</span>
                  <span className={cn('max-w-[180px] truncate font-mono text-xs', !plan.highlighted && 'text-surface-700 dark:text-surface-300')}>
                    {plan.stripe_price_id || 'Sin configurar'}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between text-sm">
                <span className={plan.highlighted ? 'text-white/80' : 'text-surface-500'}>Orden</span>
                <span className={cn('font-semibold', !plan.highlighted && 'text-surface-900 dark:text-white')}>{plan.sort_order}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className={plan.highlighted ? 'text-white/80' : 'text-surface-500'}>Actualizado</span>
                <span className={cn('text-xs', !plan.highlighted && 'text-surface-700 dark:text-surface-300')}>{formatDateTime(plan.updated_at)}</span>
              </div>
            </div>

            <div className="mt-5 space-y-2">
              {plan.features.slice(0, 4).map((feature) => (
                <div key={`${plan.id}-${feature}`} className="flex items-center gap-2 text-sm">
                  <Check size={15} className={plan.highlighted ? 'text-white' : 'text-brand-500'} />
                  <span className={plan.highlighted ? 'text-white/90' : 'text-surface-600 dark:text-surface-300'}>{feature}</span>
                </div>
              ))}
            </div>

            <div className="mt-6 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => quickToggle.mutate({ planId: plan.id, payload: { is_active: !plan.is_active } })}
                className={cn('rounded-2xl px-3 py-3 text-xs font-semibold transition-colors', plan.highlighted ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-surface-100 text-surface-700 hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-200 dark:hover:bg-surface-700')}
              >
                <div className="flex items-center justify-center gap-2">
                  {plan.is_active ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                  {plan.is_active ? 'Activo' : 'Inactivo'}
                </div>
              </button>
              <button
                type="button"
                onClick={() => quickToggle.mutate({ planId: plan.id, payload: { is_public: !plan.is_public } })}
                className={cn('rounded-2xl px-3 py-3 text-xs font-semibold transition-colors', plan.highlighted ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-surface-100 text-surface-700 hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-200 dark:hover:bg-surface-700')}
              >
                <div className="flex items-center justify-center gap-2">
                  {plan.is_public ? <Eye size={15} /> : <EyeOff size={15} />}
                  {plan.is_public ? 'Público' : 'Oculto'}
                </div>
              </button>
              <button
                type="button"
                onClick={() => quickToggle.mutate({ planId: plan.id, payload: { highlighted: !plan.highlighted } })}
                className={cn('rounded-2xl px-3 py-3 text-xs font-semibold transition-colors', plan.highlighted ? 'bg-white text-brand-700 hover:bg-white/90' : 'bg-surface-100 text-surface-700 hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-200 dark:hover:bg-surface-700')}
              >
                <div className="flex items-center justify-center gap-2">
                  <Star size={15} />
                  Destacar
                </div>
              </button>
            </div>
          </motion.div>
        ))}
      </div>

      <Modal
        open={showModal}
        title={isEditing ? 'Editar plan SaaS' : 'Nuevo plan SaaS'}
        description="Este catálogo alimenta el registro público, la cotización del owner y el cobro SaaS. El price corresponde al valor neto; el IVA se agrega en runtime."
        onClose={() => {
          if (!createPlan.isPending && !updatePlan.isPending) {
            setShowModal(false);
          }
        }}
        size="lg"
      >
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (isEditing && form.id) {
              updatePlan.mutate({ planId: form.id, payload: toUpdatePayload(form) });
              return;
            }
            createPlan.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Key</label>
              <input
                className="input"
                value={form.key}
                onChange={(event) => setForm((current) => ({ ...current, key: event.target.value }))}
                disabled={isEditing}
                required
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Nombre</label>
              <input
                className="input"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                required
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Descripcion</label>
            <textarea
              className="input min-h-24 resize-y"
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-5">
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Valor neto</label>
              <input type="number" min="0" className="input" value={form.price} onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))} required />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">
                <Tag size={12} className="mr-1 inline-block text-emerald-500" />
                Descuento legacy %
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
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Moneda</label>
              <input className="input" value={form.currency} onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))} required />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Licencia</label>
              <select className="input" value={form.license_type} onChange={(event) => setForm((current) => ({ ...current, license_type: event.target.value as PlatformPlanFormState['license_type'] }))}>
                <option value="monthly">Mensual</option>
                <option value="quarterly">Trimestral</option>
                <option value="semi_annual">Semestral</option>
                <option value="annual">Anual</option>
                <option value="perpetual">Perpetua</option>
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Cobro</label>
              <select className="input" value={form.billing_interval} onChange={(event) => setForm((current) => ({ ...current, billing_interval: event.target.value as PlatformPlanFormState['billing_interval'] }))}>
                <option value="month">Mensual</option>
                <option value="quarter">Trimestral</option>
                <option value="semi_annual">Semestral</option>
                <option value="year">Anual</option>
                <option value="manual">Manual</option>
              </select>
            </div>
          </div>

          {form.discount_pct && Number(form.discount_pct) > 0 && Number(form.price) > 0 ? (
            <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm dark:border-emerald-900/40 dark:bg-emerald-950/20">
              <Tag size={15} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span className="text-emerald-800 dark:text-emerald-200">
                Referencia legacy:{' '}
                <strong>
                  {formatCurrency(applyDiscount(Number(form.price), Number(form.discount_pct)), form.currency || 'CLP')}
                </strong>
                {' '}— {form.discount_pct}% sobre{' '}
                {formatCurrency(Number(form.price), form.currency || 'CLP')}
                . La nueva cotización SaaS usa promo code + IVA, no este campo.
              </span>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Prueba</label>
              <input type="number" min="0" className="input" value={form.trial_days} onChange={(event) => setForm((current) => ({ ...current, trial_days: event.target.value }))} required />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Miembros</label>
              <input type="number" min="1" className="input" value={form.max_members} onChange={(event) => setForm((current) => ({ ...current, max_members: event.target.value }))} required />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Sedes</label>
              <input type="number" min="1" className="input" value={form.max_branches} onChange={(event) => setForm((current) => ({ ...current, max_branches: event.target.value }))} required />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Orden</label>
              <input type="number" min="0" className="input" value={form.sort_order} onChange={(event) => setForm((current) => ({ ...current, sort_order: event.target.value }))} required />
            </div>
          </div>

          {/* Pasarela de pago */}
          <div className="rounded-2xl border border-surface-200 dark:border-surface-800 p-4 space-y-4">
            <p className="text-sm font-semibold text-surface-700 dark:text-surface-300">Pasarela de pago</p>

            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Proveedor</label>
              <select
                className="input"
                value={form.checkout_provider}
                onChange={(event) => setForm((current) => ({ ...current, checkout_provider: event.target.value as PlatformPlanFormState['checkout_provider'] }))}
              >
                <option value="none">Solo trial / sin checkout</option>
                <option value="stripe">Stripe</option>
                <option value="fintoc">Fintoc</option>
                <option value="webpay">Webpay</option>
              </select>
            </div>

            {form.checkout_provider === 'stripe' && (
              <div>
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Stripe price ID</label>
                <input
                  className="input"
                  value={form.stripe_price_id}
                  onChange={(event) => setForm((current) => ({ ...current, stripe_price_id: event.target.value }))}
                  placeholder="price_123..."
                />
              </div>
            )}

            <div className="rounded-xl border border-surface-200/60 bg-surface-50 px-3 py-3 text-xs text-surface-500 dark:border-surface-800 dark:bg-surface-950/40 dark:text-surface-400">
              {form.checkout_provider === 'stripe'
                ? 'Stripe usa el price ID del plan y las credenciales globales del servidor.'
                : form.checkout_provider === 'fintoc'
                  ? 'Fintoc usa FINTOC_SECRET_KEY del backend y checkout hosted para transferencias bancarias.'
                  : form.checkout_provider === 'webpay'
                    ? 'Webpay usa WEBPAY_COMMERCE_CODE y WEBPAY_API_KEY del backend para cobrar el SaaS del super admin.'
                    : 'Sin pasarela: el plan puede publicarse, pero no iniciará un checkout automático.'}
            </div>

            {/* Indicador del proveedor activo */}
            <div className={`rounded-xl px-3 py-2.5 text-xs font-medium flex items-center gap-2 ${
              form.checkout_provider === 'fintoc'
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-300'
                : form.checkout_provider === 'webpay'
                  ? 'bg-sky-50 text-sky-700 dark:bg-sky-950/20 dark:text-sky-300'
                  : form.checkout_provider === 'stripe' && form.stripe_price_id.trim()
                  ? 'bg-violet-50 text-violet-700 dark:bg-violet-950/20 dark:text-violet-300'
                  : 'bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-400'
            }`}>
              <WalletCards size={14} />
              {form.checkout_provider === 'fintoc'
                ? 'Cobro activo vía Fintoc'
                : form.checkout_provider === 'webpay'
                  ? 'Cobro activo vía Webpay'
                  : form.checkout_provider === 'stripe' && form.stripe_price_id.trim()
                  ? 'Cobro activo vía Stripe'
                  : 'Sin cobro configurado, solo prueba'}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Features</label>
            <textarea
              className="input min-h-32 resize-y"
              value={form.features}
              onChange={(event) => setForm((current) => ({ ...current, features: event.target.value }))}
              placeholder="Una feature por linea"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <label className="flex items-center gap-3 rounded-2xl border border-surface-200 px-4 py-3 dark:border-surface-800">
              <input type="checkbox" checked={form.highlighted} onChange={(event) => setForm((current) => ({ ...current, highlighted: event.target.checked }))} />
              <span className="text-sm text-surface-700 dark:text-surface-300">Destacado</span>
            </label>
            <label className="flex items-center gap-3 rounded-2xl border border-surface-200 px-4 py-3 dark:border-surface-800">
              <input type="checkbox" checked={form.is_active} onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.checked }))} />
              <span className="text-sm text-surface-700 dark:text-surface-300">Activo</span>
            </label>
            <label className="flex items-center gap-3 rounded-2xl border border-surface-200 px-4 py-3 dark:border-surface-800">
              <input type="checkbox" checked={form.is_public} onChange={(event) => setForm((current) => ({ ...current, is_public: event.target.checked }))} />
              <span className="text-sm text-surface-700 dark:text-surface-300">Público</span>
            </label>
            <div className="rounded-2xl border border-surface-200 px-4 py-3 dark:border-surface-800">
              <div className="flex items-center gap-2 text-sm text-surface-500 dark:text-surface-400">
                <WalletCards size={16} />
                {form.checkout_provider === 'none'
                  ? 'Sin checkout'
                  : form.checkout_provider === 'stripe'
                    ? (form.stripe_price_id.trim() ? 'Cobro posible' : 'Falta Stripe price ID')
                    : 'Cobro posible'}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-surface-200/60 bg-surface-50 px-4 py-4 text-sm text-surface-500 dark:border-surface-800 dark:bg-surface-950/60 dark:text-surface-400">
            <div className="flex items-start gap-2">
              <Sparkles size={16} className="mt-0.5 text-brand-500" />
              <p>
                El `key` queda fijo después de crear el plan. Si este plan se publica, aparecerá en la página de registro del gimnasio y podrá ser usado por nuevas cuentas.
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={createPlan.isPending || updatePlan.isPending}>
              {createPlan.isPending || updatePlan.isPending ? 'Guardando...' : isEditing ? 'Guardar cambios' : 'Crear plan'}
            </button>
          </div>
        </form>
      </Modal>
    </motion.div>
  );
}
