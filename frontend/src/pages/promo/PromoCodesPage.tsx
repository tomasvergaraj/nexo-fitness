import { useState, type ComponentType } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Layers,
  Pencil,
  Plus,
  Sparkles,
  Tag,
  ToggleLeft,
  ToggleRight,
  Trash2,
} from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { plansApi, promoCodesApi } from '@/services/api';
import type { Plan, PromoCode } from '@/types';
import { cn, formatCurrency, formatDate, getApiError } from '@/utils';
import { fadeInUp, staggerContainer } from '@/utils/animations';

interface FormState {
  code: string;
  name: string;
  description: string;
  discount_type: 'percent' | 'fixed';
  discount_value: string;
  max_uses: string;
  expires_at: string;
  plan_ids: string[]; // empty = aplica a todos los planes
}

const emptyForm: FormState = {
  code: '',
  name: '',
  description: '',
  discount_type: 'percent',
  discount_value: '',
  max_uses: '',
  expires_at: '',
  plan_ids: [],
};

function formatDiscount(promo: PromoCode) {
  return promo.discount_type === 'percent'
    ? `${promo.discount_value}% de descuento`
    : `${formatCurrency(Number(promo.discount_value))} de descuento`;
}

function getPromoExpiryMeta(expiresAt?: string) {
  if (!expiresAt) {
    return {
      badgeClass: 'badge-neutral',
      badgeLabel: 'Sin vencimiento',
      helperLabel: 'Disponible sin fecha de término',
      isExpired: false,
      isExpiringSoon: false,
    };
  }

  const expiryDate = new Date(expiresAt);
  const diffMs = expiryDate.getTime() - Date.now();
  const diffDays = Math.ceil(diffMs / 86_400_000);

  if (diffMs < 0) {
    return {
      badgeClass: 'badge-danger',
      badgeLabel: 'Expirado',
      helperLabel: `Venció el ${formatDate(expiryDate)}`,
      isExpired: true,
      isExpiringSoon: false,
    };
  }

  if (diffDays <= 14) {
    return {
      badgeClass: 'badge-warning',
      badgeLabel: 'Por vencer',
      helperLabel: `Vence el ${formatDate(expiryDate)}`,
      isExpired: false,
      isExpiringSoon: true,
    };
  }

  return {
    badgeClass: 'badge-info',
    badgeLabel: 'Programado',
    helperLabel: `Vence el ${formatDate(expiryDate)}`,
    isExpired: false,
    isExpiringSoon: false,
  };
}

function getUsageProgress(promo: PromoCode) {
  if (!promo.max_uses) {
    return null;
  }

  return Math.min(100, Math.round((promo.uses_count / promo.max_uses) * 100));
}

function comparePromos(left: PromoCode, right: PromoCode) {
  if (left.is_active !== right.is_active) {
    return Number(right.is_active) - Number(left.is_active);
  }

  const leftExpiry = left.expires_at ? new Date(left.expires_at).getTime() : Number.POSITIVE_INFINITY;
  const rightExpiry = right.expires_at ? new Date(right.expires_at).getTime() : Number.POSITIVE_INFINITY;

  if (leftExpiry !== rightExpiry) {
    return leftExpiry - rightExpiry;
  }

  return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
}

function promoToForm(promo: PromoCode): FormState {
  return {
    code: promo.code,
    name: promo.name,
    description: promo.description ?? '',
    discount_type: promo.discount_type,
    discount_value: String(promo.discount_value),
    max_uses: promo.max_uses != null ? String(promo.max_uses) : '',
    expires_at: promo.expires_at ? promo.expires_at.slice(0, 10) : '',
    plan_ids: promo.plan_ids ?? [],
  };
}

interface PromoFormProps {
  initial: FormState;
  plans: Plan[];
  plansLoading: boolean;
  onSave: (data: FormState) => void;
  onCancel: () => void;
  saving: boolean;
  isEdit?: boolean;
}

function PromoForm({ initial, plans, plansLoading, onSave, onCancel, saving, isEdit }: PromoFormProps) {
  const [form, setForm] = useState<FormState>(initial);
  const codePreview = form.code.trim() || 'PROMO2026';
  const appliesToAll = form.plan_ids.length === 0;

  function set(key: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function togglePlan(planId: string) {
    setForm((current) => ({
      ...current,
      plan_ids: current.plan_ids.includes(planId)
        ? current.plan_ids.filter((id) => id !== planId)
        : [...current.plan_ids, planId],
    }));
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    onSave(form);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="rounded-[1.25rem] border border-surface-200 bg-surface-50/80 p-4 dark:border-white/10 dark:bg-surface-950/35">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-surface-900 dark:text-white">Configura el beneficio</p>
            <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
              Define descuento, vigencia y límite de uso sin salir del lenguaje visual del panel.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-2xl border border-brand-200 bg-brand-50 px-3 py-2 text-brand-700 dark:border-brand-500/20 dark:bg-brand-500/10 dark:text-brand-100">
            <Tag size={15} />
            <span className="font-mono text-sm font-semibold uppercase tracking-[0.22em]">{codePreview}</span>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Código *</label>
          <input
            className={cn('input font-mono uppercase tracking-[0.2em]', isEdit && 'opacity-70')}
            value={form.code}
            onChange={(event) => set('code', event.target.value.toUpperCase())}
            placeholder="VERANO20"
            required
            maxLength={50}
            disabled={isEdit}
          />
          {isEdit ? (
            <p className="mt-2 text-xs text-surface-500 dark:text-surface-400">
              El código se mantiene fijo para no romper campañas o enlaces ya publicados.
            </p>
          ) : null}
        </div>

        <div className="sm:col-span-2">
          <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Nombre *</label>
          <input
            className="input"
            value={form.name}
            onChange={(event) => set('name', event.target.value)}
            placeholder="Descuento de reapertura"
            required
            maxLength={200}
          />
        </div>

        <div className="sm:col-span-2">
          <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Descripción</label>
          <textarea
            className="input min-h-24 resize-y"
            value={form.description}
            onChange={(event) => set('description', event.target.value)}
            placeholder="Opcional. Explica cuándo conviene usar este beneficio."
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Tipo de descuento *</label>
          <select
            className="input"
            value={form.discount_type}
            onChange={(event) => set('discount_type', event.target.value as 'percent' | 'fixed')}
          >
            <option value="percent">Porcentaje (%)</option>
            <option value="fixed">Monto fijo ($)</option>
          </select>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Valor *</label>
          <input
            className="input"
            type="number"
            min={0.01}
            step={0.01}
            value={form.discount_value}
            onChange={(event) => set('discount_value', event.target.value)}
            placeholder={form.discount_type === 'percent' ? '20' : '5000'}
            required
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Usos máximos</label>
          <input
            className="input"
            type="number"
            min={1}
            step={1}
            value={form.max_uses}
            onChange={(event) => set('max_uses', event.target.value)}
            placeholder="Ilimitado"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Expira</label>
          <input
            className="input"
            type="date"
            value={form.expires_at}
            onChange={(event) => set('expires_at', event.target.value)}
          />
        </div>
      </div>

      <div className="rounded-[1.25rem] border border-surface-200 bg-surface-50/80 p-4 dark:border-white/10 dark:bg-surface-950/35">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-surface-900 dark:text-white">Planes donde aplica</p>
          <p className="text-sm text-surface-500 dark:text-surface-400">
            Elige a qué planes se puede aplicar este descuento. Los clientes solo podrán usarlo en los planes que marques.
          </p>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-surface-200 bg-white px-4 py-3 text-sm dark:border-white/10 dark:bg-white/5">
            <input
              type="radio"
              name="promo-scope"
              className="mt-0.5"
              checked={appliesToAll}
              onChange={() => setForm((current) => ({ ...current, plan_ids: [] }))}
            />
            <span>
              <span className="block font-medium text-surface-900 dark:text-white">Todos los planes</span>
              <span className="text-surface-500 dark:text-surface-400">El código sirve para cualquier plan disponible en la tienda.</span>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-surface-200 bg-white px-4 py-3 text-sm dark:border-white/10 dark:bg-white/5">
            <input
              type="radio"
              name="promo-scope"
              className="mt-0.5"
              checked={!appliesToAll}
              onChange={() => {
                // Selecciona el primer plan disponible para no dejar la lista vacía (que equivaldría a "todos").
                setForm((current) => (
                  current.plan_ids.length > 0 || plans.length === 0
                    ? current
                    : { ...current, plan_ids: [plans[0].id] }
                ));
              }}
            />
            <span>
              <span className="block font-medium text-surface-900 dark:text-white">Solo planes específicos</span>
              <span className="text-surface-500 dark:text-surface-400">Marca abajo los planes que sí aceptan este descuento.</span>
            </span>
          </label>
        </div>

        {!appliesToAll ? (
          <div className="mt-3 space-y-2">
            {plansLoading ? (
              <p className="text-sm text-surface-500 dark:text-surface-400">Cargando planes...</p>
            ) : plans.length === 0 ? (
              <p className="text-sm text-surface-500 dark:text-surface-400">Todavía no tienes planes creados.</p>
            ) : (
              <>
                <div className="grid gap-2 sm:grid-cols-2">
                  {plans.map((plan) => {
                    const checked = form.plan_ids.includes(plan.id);
                    return (
                      <label
                        key={plan.id}
                        className={cn(
                          'flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition-colors',
                          checked
                            ? 'border-brand-300 bg-brand-50 text-brand-900 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-100'
                            : 'border-surface-200 bg-white text-surface-700 hover:border-surface-300 dark:border-white/10 dark:bg-white/5 dark:text-surface-200',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => togglePlan(plan.id)}
                        />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{plan.name}</span>
                          <span className="text-xs text-surface-500 dark:text-surface-400">
                            {formatCurrency(Number(plan.price), plan.currency)}
                            {plan.is_active ? '' : ' · inactivo'}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                {form.plan_ids.length === 0 ? (
                  <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                    Marca al menos un plan; de lo contrario el código aplicará a todos.
                  </p>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-surface-200/70 pt-4 dark:border-white/10">
        <button type="button" onClick={onCancel} className="btn-secondary" disabled={saving}>
          Cancelar
        </button>
        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear código'}
        </button>
      </div>
    </form>
  );
}

export default function PromoCodesPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editPromo, setEditPromo] = useState<PromoCode | null>(null);
  const [deletePromo, setDeletePromo] = useState<PromoCode | null>(null);

  const promoCodesQuery = useQuery<PromoCode[]>({
    queryKey: ['promo-codes'],
    queryFn: async () => (await promoCodesApi.list()).data,
  });

  const plansQuery = useQuery<Plan[]>({
    queryKey: ['plans', 'promo-scope'],
    queryFn: async () => (await plansApi.list({ active_only: false })).data.items,
  });
  const plans = plansQuery.data ?? [];
  const planNameById = new Map(plans.map((plan) => [plan.id, plan.name]));

  const createMutation = useMutation({
    mutationFn: (form: FormState) =>
      promoCodesApi.create({
        code: form.code.trim(),
        name: form.name.trim(),
        description: form.description.trim() || null,
        discount_type: form.discount_type,
        discount_value: parseFloat(form.discount_value),
        max_uses: form.max_uses ? parseInt(form.max_uses, 10) : null,
        expires_at: form.expires_at ? new Date(`${form.expires_at}T23:59:59`).toISOString() : null,
        plan_ids: form.plan_ids.length ? form.plan_ids : null,
      }),
    onSuccess: async () => {
      toast.success('Código promocional creado.');
      setShowCreate(false);
      await queryClient.invalidateQueries({ queryKey: ['promo-codes'] });
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No se pudo crear el código promocional.'));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, form }: { id: string; form: FormState }) =>
      promoCodesApi.update(id, {
        name: form.name.trim(),
        description: form.description.trim() || null,
        discount_type: form.discount_type,
        discount_value: parseFloat(form.discount_value),
        max_uses: form.max_uses ? parseInt(form.max_uses, 10) : null,
        expires_at: form.expires_at ? new Date(`${form.expires_at}T23:59:59`).toISOString() : null,
        plan_ids: form.plan_ids.length ? form.plan_ids : null,
      }),
    onSuccess: async () => {
      toast.success('Código promocional actualizado.');
      setEditPromo(null);
      await queryClient.invalidateQueries({ queryKey: ['promo-codes'] });
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No se pudo actualizar el código promocional.'));
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (promo: PromoCode) => promoCodesApi.update(promo.id, { is_active: !promo.is_active }),
    onSuccess: async (_response, promo) => {
      toast.success(promo.is_active ? 'Código desactivado.' : 'Código activado.');
      await queryClient.invalidateQueries({ queryKey: ['promo-codes'] });
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No se pudo cambiar el estado del código.'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => promoCodesApi.delete(id),
    onSuccess: async () => {
      toast.success('Código promocional eliminado.');
      setDeletePromo(null);
      await queryClient.invalidateQueries({ queryKey: ['promo-codes'] });
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No se pudo eliminar el código.'));
    },
  });

  const promos = promoCodesQuery.data ?? [];
  const sortedPromos = [...promos].sort(comparePromos);
  const activePromos = promos.filter((promo) => promo.is_active).length;
  const inactivePromos = promos.length - activePromos;
  const totalUses = promos.reduce((acc, promo) => acc + promo.uses_count, 0);
  const expiringSoonCount = promos.filter((promo) => promo.is_active && getPromoExpiryMeta(promo.expires_at).isExpiringSoon).length;

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-6">
      <motion.section
        variants={fadeInUp}
        className="rounded-[1.75rem] border border-surface-200/70 bg-white/90 p-6 shadow-sm dark:border-white/10 dark:bg-white/[0.04] dark:shadow-none"
      >
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-surface-200 bg-surface-50 px-3 py-1 text-xs font-semibold text-surface-600 dark:border-white/10 dark:bg-white/5 dark:text-surface-300">
              <Tag size={14} />
              Descuentos listos para vender mejor
            </div>
            <h1 className="mt-4 text-2xl font-bold font-display text-surface-900 dark:text-white">Códigos promocionales</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-surface-500 dark:text-surface-400">
              Gestiona beneficios, controla vencimientos y revisa el uso de cada código con el mismo lenguaje visual del resto del panel.
            </p>
          </div>

          <button type="button" onClick={() => setShowCreate(true)} className="btn-primary">
            <Plus size={16} />
            Nuevo código
          </button>
        </div>
      </motion.section>

      {promoCodesQuery.isError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-600 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
          {getApiError(promoCodesQuery.error, 'No pudimos cargar los códigos promocionales.')}
        </div>
      ) : null}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <PromoMetricCard icon={Tag} label="Total" value={promos.length} caption="Beneficios creados para tu venta online." accentClass="text-brand-500" />
        <PromoMetricCard icon={CheckCircle2} label="Activos" value={activePromos} caption="Códigos listos para usarse ahora mismo." accentClass="text-emerald-500" />
        <PromoMetricCard icon={Sparkles} label="Canjes" value={totalUses} caption="Usos registrados en todos tus descuentos." accentClass="text-violet-500" />
        <PromoMetricCard icon={Clock3} label="Por vencer" value={expiringSoonCount} caption="Códigos activos que vencen pronto." accentClass="text-amber-500" />
      </section>

      <motion.section
        variants={fadeInUp}
        className="overflow-hidden rounded-[1.65rem] border border-surface-200/70 bg-white/90 shadow-sm dark:border-white/10 dark:bg-white/[0.04] dark:shadow-none"
      >
        <div className="border-b border-surface-200/70 px-5 py-5 dark:border-white/10">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-surface-900 dark:text-white">Beneficios publicados</p>
              <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
                Revisa vigencia, consumo y estado operativo de cada código desde una sola bandeja.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-surface-500 dark:text-surface-400">
              <span className="badge badge-neutral">{promos.length} {promos.length === 1 ? 'código' : 'códigos'}</span>
              <span className="badge badge-success">{activePromos} activos</span>
              <span className="badge badge-warning">{inactivePromos} inactivos</span>
            </div>
          </div>
        </div>

        {promoCodesQuery.isLoading ? (
          <div className="p-5">
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="shimmer h-20 rounded-2xl" />
              ))}
            </div>
          </div>
        ) : !sortedPromos.length ? (
          <div className="px-5 py-14 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-surface-100 text-surface-400 dark:bg-white/5 dark:text-surface-500">
              <Tag size={28} />
            </div>
            <p className="mt-4 text-lg font-semibold text-surface-900 dark:text-white">Todavía no hay códigos promocionales</p>
            <p className="mt-2 text-sm leading-6 text-surface-600 dark:text-surface-300">
              Crea tu primer descuento para campañas de reapertura, cierres de mes o beneficios de fidelización.
            </p>
            <div className="mt-5">
              <button type="button" onClick={() => setShowCreate(true)} className="btn-primary">
                <Plus size={16} />
                Crear primer código
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-[1040px] w-full">
                <thead className="bg-surface-50/90 dark:bg-white/[0.03]">
                  <tr className="text-left text-xs uppercase tracking-[0.18em] text-surface-500 dark:text-surface-400">
                    <th className="px-5 py-4 font-semibold">Código</th>
                    <th className="px-4 py-4 font-semibold">Beneficio</th>
                    <th className="px-4 py-4 font-semibold">Vigencia</th>
                    <th className="px-4 py-4 font-semibold">Uso</th>
                    <th className="px-4 py-4 font-semibold">Estado</th>
                    <th className="px-5 py-4 font-semibold text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-200/70 dark:divide-white/10">
                  {sortedPromos.map((promo) => {
                    const expiryMeta = getPromoExpiryMeta(promo.expires_at);
                    const usageProgress = getUsageProgress(promo);
                    const remainingUses = promo.max_uses != null ? Math.max(promo.max_uses - promo.uses_count, 0) : null;

                    return (
                      <tr key={promo.id} className="transition-colors hover:bg-surface-50/80 dark:hover:bg-white/[0.03]">
                        <td className="px-5 py-4 align-top">
                          <div className="inline-flex items-center rounded-2xl border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-brand-700 dark:border-brand-500/20 dark:bg-brand-500/10 dark:text-brand-100">
                            {promo.code}
                          </div>
                          <p className="mt-2 text-xs text-surface-500 dark:text-surface-400">
                            Creado el {formatDate(promo.created_at)}
                          </p>
                        </td>

                        <td className="px-4 py-4 align-top">
                          <p className="text-sm font-semibold text-surface-900 dark:text-white">{promo.name}</p>
                          <p className="mt-1 text-sm leading-6 text-surface-600 dark:text-surface-300">
                            {promo.description?.trim() || 'Sin descripción interna para este beneficio.'}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <span className="badge badge-info">{formatDiscount(promo)}</span>
                            <span className="badge badge-neutral">
                              {promo.max_uses != null ? `${promo.max_uses} usos máximos` : 'Usos ilimitados'}
                            </span>
                          </div>
                          <div className="mt-2 flex items-start gap-1.5 text-xs text-surface-500 dark:text-surface-400">
                            <Layers size={13} className="mt-0.5 shrink-0" />
                            <span>
                              {!promo.plan_ids || promo.plan_ids.length === 0
                                ? 'Aplica a todos los planes'
                                : `Solo: ${promo.plan_ids
                                    .map((id) => planNameById.get(id) ?? 'Plan eliminado')
                                    .join(', ')}`}
                            </span>
                          </div>
                        </td>

                        <td className="px-4 py-4 align-top">
                          <div className="flex flex-wrap gap-2">
                            <span className={cn('badge', expiryMeta.badgeClass)}>{expiryMeta.badgeLabel}</span>
                          </div>
                          <p className="mt-2 text-sm text-surface-700 dark:text-surface-200">{expiryMeta.helperLabel}</p>
                        </td>

                        <td className="px-4 py-4 align-top">
                          <p className="text-sm font-semibold text-surface-900 dark:text-white">
                            {promo.uses_count}
                            {promo.max_uses != null ? ` / ${promo.max_uses}` : ''}
                          </p>
                          <p className="mt-1 text-xs text-surface-500 dark:text-surface-400">
                            {remainingUses != null ? `${remainingUses} usos disponibles` : 'Sin tope configurado'}
                          </p>
                          {usageProgress != null ? (
                            <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-100 dark:bg-white/10">
                              <div
                                className={cn(
                                  'h-full rounded-full',
                                  usageProgress >= 85 ? 'bg-rose-400' : usageProgress >= 60 ? 'bg-amber-400' : 'bg-emerald-500',
                                )}
                                style={{ width: `${usageProgress}%` }}
                              />
                            </div>
                          ) : null}
                        </td>

                        <td className="px-4 py-4 align-top">
                          <div className="flex flex-wrap gap-2">
                            <span className={cn('badge', promo.is_active ? 'badge-success' : 'badge-neutral')}>
                              {promo.is_active ? 'Activo' : 'Inactivo'}
                            </span>
                            {expiryMeta.isExpired ? <span className="badge badge-danger">Vencido</span> : null}
                            {!expiryMeta.isExpired && expiryMeta.isExpiringSoon ? <span className="badge badge-warning">Vence pronto</span> : null}
                          </div>
                        </td>

                        <td className="px-5 py-4 align-top">
                          <div className="flex justify-end gap-2">
                            <PromoActionButton
                              label={promo.is_active ? 'Desactivar código' : 'Activar código'}
                              disabled={toggleMutation.isPending}
                              onClick={() => toggleMutation.mutate(promo)}
                            >
                              {promo.is_active ? <ToggleRight size={16} className="text-emerald-500" /> : <ToggleLeft size={16} />}
                            </PromoActionButton>

                            <PromoActionButton
                              label="Editar código"
                              disabled={updateMutation.isPending}
                              onClick={() => setEditPromo(promo)}
                            >
                              <Pencil size={15} />
                            </PromoActionButton>

                            <PromoActionButton
                              label="Eliminar código"
                              danger
                              disabled={deleteMutation.isPending}
                              onClick={() => setDeletePromo(promo)}
                            >
                              <Trash2 size={15} />
                            </PromoActionButton>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="border-t border-surface-200/70 bg-surface-50/70 px-5 py-3 text-sm text-surface-500 dark:border-white/10 dark:bg-white/[0.02] dark:text-surface-400">
              Mantén activos solo los beneficios vigentes para que el checkout y las campañas reflejen exactamente lo que quieres vender.
            </div>
          </>
        )}
      </motion.section>

      <Modal
        open={showCreate}
        title="Nuevo código promocional"
        description="Crea un beneficio coherente con el resto del panel y deja claras sus reglas desde el inicio."
        onClose={() => {
          if (!createMutation.isPending) {
            setShowCreate(false);
          }
        }}
        size="lg"
      >
        <PromoForm
          initial={emptyForm}
          plans={plans}
          plansLoading={plansQuery.isLoading}
          onSave={(form) => createMutation.mutate(form)}
          onCancel={() => setShowCreate(false)}
          saving={createMutation.isPending}
        />
        {createMutation.isError ? (
          <div className="mt-4 flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50/80 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
            <AlertCircle size={14} />
            {getApiError(createMutation.error, 'No se pudo crear el código promocional.')}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(editPromo)}
        title="Editar código promocional"
        description="Ajusta nombre, vigencia o límites sin salir del estilo visual del sistema."
        onClose={() => {
          if (!updateMutation.isPending) {
            setEditPromo(null);
          }
        }}
        size="lg"
      >
        {editPromo ? (
          <>
            <PromoForm
              initial={promoToForm(editPromo)}
              plans={plans}
              plansLoading={plansQuery.isLoading}
              onSave={(form) => updateMutation.mutate({ id: editPromo.id, form })}
              onCancel={() => setEditPromo(null)}
              saving={updateMutation.isPending}
              isEdit
            />
            {updateMutation.isError ? (
              <div className="mt-4 flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50/80 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
                <AlertCircle size={14} />
                {getApiError(updateMutation.error, 'No se pudo actualizar el código promocional.')}
              </div>
            ) : null}
          </>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(deletePromo)}
        title="Eliminar código"
        description="Esta acción quita el descuento del panel y del flujo de compra."
        onClose={() => {
          if (!deleteMutation.isPending) {
            setDeletePromo(null);
          }
        }}
      >
        {deletePromo ? (
          <div className="space-y-5">
            <div className="rounded-[1.25rem] border border-rose-200 bg-rose-50/80 p-4 dark:border-rose-900/40 dark:bg-rose-950/20">
              <p className="text-sm font-semibold text-rose-700 dark:text-rose-200">Se eliminará este código promocional</p>
              <p className="mt-3 font-mono text-base font-bold uppercase tracking-[0.22em] text-surface-900 dark:text-white">
                {deletePromo.code}
              </p>
              <p className="mt-1 text-sm text-surface-600 dark:text-surface-300">{deletePromo.name}</p>
            </div>

            <p className="text-sm leading-6 text-surface-600 dark:text-surface-300">
              ¿Quieres continuar? Esta acción no se puede deshacer.
            </p>

            <div className="flex flex-wrap justify-end gap-2 border-t border-surface-200/70 pt-4 dark:border-white/10">
              <button type="button" onClick={() => setDeletePromo(null)} className="btn-secondary" disabled={deleteMutation.isPending}>
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => deleteMutation.mutate(deletePromo.id)}
                disabled={deleteMutation.isPending}
                className="inline-flex items-center justify-center rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deleteMutation.isPending ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </motion.div>
  );
}

function PromoMetricCard({
  icon: Icon,
  label,
  value,
  caption,
  accentClass,
}: {
  icon: ComponentType<{ size?: number | string; className?: string; title?: string }>;
  label: string;
  value: number;
  caption: string;
  accentClass: string;
}) {
  return (
    <div className="rounded-[1.5rem] border border-surface-200/70 bg-white/90 p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.04] dark:shadow-none">
      <div className="flex items-center gap-3">
        <div className={cn('flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-100 dark:bg-white/10', accentClass)}>
          <Icon size={18} />
        </div>
        <span className="text-sm font-medium text-surface-500 dark:text-surface-400">{label}</span>
      </div>
      <p className="mt-4 text-3xl font-bold font-display text-surface-900 dark:text-white">{value}</p>
      <p className="mt-2 text-sm leading-6 text-surface-600 dark:text-surface-300">{caption}</p>
    </div>
  );
}

function PromoActionButton({
  label,
  danger = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-10 w-10 items-center justify-center rounded-xl border bg-white text-surface-500 transition-colors disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white/5',
        danger
          ? 'border-rose-200 hover:border-rose-300 hover:text-rose-600 dark:border-rose-900/30 dark:hover:text-rose-300'
          : 'border-surface-200 hover:border-surface-300 hover:text-surface-900 dark:border-white/10 dark:hover:text-white',
      )}
    >
      {children}
    </button>
  );
}
