import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  Pencil,
  Plus,
  ShieldCheck,
  Tag,
  ToggleLeft,
  ToggleRight,
  Trash2,
} from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { billingApi } from '@/services/api';
import type { AdminSaaSPlan, PlatformPromoCode } from '@/types';
import { cn, formatCurrency, formatDate, getApiError } from '@/utils';
import { fadeInUp, staggerContainer } from '@/utils/animations';

type FormState = {
  code: string;
  name: string;
  description: string;
  discount_type: 'percent' | 'fixed';
  discount_value: string;
  max_uses: string;
  expires_at: string;
  is_active: boolean;
  plan_keys: string[];
};

const emptyForm: FormState = {
  code: '',
  name: '',
  description: '',
  discount_type: 'percent',
  discount_value: '',
  max_uses: '',
  expires_at: '',
  is_active: true,
  plan_keys: [],
};

function promoToForm(promo: PlatformPromoCode): FormState {
  return {
    code: promo.code,
    name: promo.name,
    description: promo.description ?? '',
    discount_type: promo.discount_type,
    discount_value: String(promo.discount_value),
    max_uses: promo.max_uses != null ? String(promo.max_uses) : '',
    expires_at: promo.expires_at ? promo.expires_at.slice(0, 10) : '',
    is_active: promo.is_active,
    plan_keys: promo.plan_keys ?? [],
  };
}

function formatDiscount(promo: PlatformPromoCode) {
  if (promo.discount_type === 'percent') {
    return `${promo.discount_value}%`;
  }
  return formatCurrency(Number(promo.discount_value), 'CLP');
}

function expiryLabel(expiresAt?: string | null) {
  if (!expiresAt) {
    return 'Sin vencimiento';
  }
  const expiry = new Date(expiresAt);
  return `Vence ${formatDate(expiry)}`;
}

export default function PlatformPromoCodesPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editingPromo, setEditingPromo] = useState<PlatformPromoCode | null>(null);
  const [deletingPromo, setDeletingPromo] = useState<PlatformPromoCode | null>(null);

  const promoCodesQuery = useQuery<PlatformPromoCode[]>({
    queryKey: ['platform-promo-codes'],
    queryFn: async () => (await billingApi.listAdminPromoCodes()).data,
  });

  const plansQuery = useQuery<AdminSaaSPlan[]>({
    queryKey: ['platform-saas-plans'],
    queryFn: async () => (await billingApi.listAdminPlans()).data,
  });

  const createMutation = useMutation({
    mutationFn: async (form: FormState) => billingApi.createAdminPromoCode({
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      description: form.description.trim() || null,
      discount_type: form.discount_type,
      discount_value: Number(form.discount_value),
      max_uses: form.max_uses ? Number(form.max_uses) : null,
      expires_at: form.expires_at ? new Date(`${form.expires_at}T23:59:59Z`).toISOString() : null,
      is_active: form.is_active,
      plan_keys: form.plan_keys.length > 0 ? form.plan_keys : null,
    }),
    onSuccess: async () => {
      toast.success('Código promocional SaaS creado.');
      setShowCreate(false);
      await queryClient.invalidateQueries({ queryKey: ['platform-promo-codes'] });
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No se pudo crear el código promocional SaaS.'));
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ promoId, form }: { promoId: string; form: FormState }) => billingApi.updateAdminPromoCode(promoId, {
      name: form.name.trim(),
      description: form.description.trim() || null,
      discount_type: form.discount_type,
      discount_value: Number(form.discount_value),
      max_uses: form.max_uses ? Number(form.max_uses) : null,
      expires_at: form.expires_at ? new Date(`${form.expires_at}T23:59:59Z`).toISOString() : null,
      is_active: form.is_active,
      plan_keys: form.plan_keys.length > 0 ? form.plan_keys : [],
    }),
    onSuccess: async () => {
      toast.success('Código promocional SaaS actualizado.');
      setEditingPromo(null);
      await queryClient.invalidateQueries({ queryKey: ['platform-promo-codes'] });
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No se pudo actualizar el código promocional SaaS.'));
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async (promo: PlatformPromoCode) => billingApi.updateAdminPromoCode(promo.id, { is_active: !promo.is_active }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['platform-promo-codes'] });
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No se pudo cambiar el estado del código.'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (promoId: string) => billingApi.deleteAdminPromoCode(promoId),
    onSuccess: async () => {
      toast.success('Código promocional SaaS eliminado.');
      setDeletingPromo(null);
      await queryClient.invalidateQueries({ queryKey: ['platform-promo-codes'] });
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No se pudo eliminar el código.'));
    },
  });

  const promos = promoCodesQuery.data ?? [];
  const availablePlans = plansQuery.data ?? [];
  const sortedPromos = useMemo(
    () => [...promos].sort((left, right) => Number(right.is_active) - Number(left.is_active) || new Date(right.created_at).getTime() - new Date(left.created_at).getTime()),
    [promos],
  );

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-6">
      <motion.div variants={fadeInUp} className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-brand-200/50 bg-brand-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-brand-700 dark:border-brand-900/40 dark:bg-brand-950/20 dark:text-brand-300">
            <ShieldCheck size={14} />
            Billing SaaS
          </div>
          <h1 className="mt-3 text-2xl font-bold font-display text-surface-900 dark:text-white">Promo codes SaaS</h1>
          <p className="mt-1 text-sm text-surface-500">
            Beneficios globales para renovación y activación de planes de la plataforma.
          </p>
        </div>

        <button type="button" onClick={() => setShowCreate(true)} className="btn-primary">
          <Plus size={16} />
          Nuevo código SaaS
        </button>
      </motion.div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
          <p className="text-sm text-surface-500">Total</p>
          <p className="mt-2 text-3xl font-bold font-display text-surface-900 dark:text-white">{promos.length}</p>
        </div>
        <div className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
          <p className="text-sm text-surface-500">Activos</p>
          <p className="mt-2 text-3xl font-bold font-display text-surface-900 dark:text-white">
            {promos.filter((promo) => promo.is_active).length}
          </p>
        </div>
        <div className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
          <p className="text-sm text-surface-500">Usos acumulados</p>
          <p className="mt-2 text-3xl font-bold font-display text-surface-900 dark:text-white">
            {promos.reduce((acc, promo) => acc + promo.uses_count, 0)}
          </p>
        </div>
      </div>

      {promoCodesQuery.isError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-600 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
          {getApiError(promoCodesQuery.error, 'No pudimos cargar los promo codes SaaS.')}
        </div>
      ) : null}

      <motion.div variants={fadeInUp} className="overflow-hidden rounded-2xl border border-surface-200/50 bg-white dark:border-surface-800/50 dark:bg-surface-900">
        <div className="flex items-center justify-between border-b border-surface-100 px-5 py-4 dark:border-surface-800">
          <div>
            <h2 className="text-base font-semibold text-surface-900 dark:text-white">Códigos promocionales</h2>
            <p className="text-sm text-surface-500">
              {promoCodesQuery.isLoading ? 'Cargando...' : `${sortedPromos.length} códigos configurados`}
            </p>
          </div>
        </div>

        {promoCodesQuery.isLoading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-20 animate-pulse rounded-2xl bg-surface-100 dark:bg-surface-800/60" />
            ))}
          </div>
        ) : sortedPromos.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <Tag size={28} className="mx-auto text-surface-400" />
            <p className="mt-4 text-lg font-semibold text-surface-900 dark:text-white">Todavía no hay promo codes SaaS</p>
            <p className="mt-2 text-sm text-surface-500">Crea beneficios globales para aplicar en renovación y activación del billing.</p>
          </div>
        ) : (
          <div className="divide-y divide-surface-100 dark:divide-surface-800">
            {sortedPromos.map((promo) => (
              <div key={promo.id} className="grid gap-4 px-5 py-5 xl:grid-cols-[1.2fr_0.8fr_0.8fr_0.9fr]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-2xl border border-brand-200 bg-brand-50 px-3 py-1 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-brand-700 dark:border-brand-500/20 dark:bg-brand-500/10 dark:text-brand-100">
                      {promo.code}
                    </span>
                    <span className={cn('badge', promo.is_active ? 'badge-success' : 'badge-neutral')}>
                      {promo.is_active ? 'Activo' : 'Inactivo'}
                    </span>
                  </div>
                  <p className="mt-3 text-sm font-semibold text-surface-900 dark:text-white">{promo.name}</p>
                  <p className="mt-1 text-sm text-surface-500">{promo.description?.trim() || 'Sin descripción interna.'}</p>
                </div>

                <div className="space-y-2 text-sm text-surface-500">
                  <p className="font-semibold text-surface-900 dark:text-white">Descuento</p>
                  <p>{formatDiscount(promo)}</p>
                  <p>{promo.max_uses != null ? `${promo.uses_count} / ${promo.max_uses} usos` : `${promo.uses_count} usos`}</p>
                </div>

                <div className="space-y-2 text-sm text-surface-500">
                  <p className="font-semibold text-surface-900 dark:text-white">Vigencia</p>
                  <p>{expiryLabel(promo.expires_at)}</p>
                  <div className="flex flex-wrap gap-2">
                    {(promo.plan_keys && promo.plan_keys.length > 0 ? promo.plan_keys : ['Todos los planes']).map((planKey) => (
                      <span key={`${promo.id}-${planKey}`} className="rounded-full bg-surface-100 px-2.5 py-1 text-xs text-surface-600 dark:bg-surface-800 dark:text-surface-300">
                        {planKey}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex items-start justify-end gap-2">
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={promo.is_active ? 'Desactivar código' : 'Activar código'}
                    onClick={() => toggleMutation.mutate(promo)}
                  >
                    {promo.is_active ? <ToggleRight size={16} className="text-emerald-500" /> : <ToggleLeft size={16} />}
                  </button>
                  <button type="button" className="icon-btn" aria-label="Editar código" onClick={() => setEditingPromo(promo)}>
                    <Pencil size={16} />
                  </button>
                  <button type="button" className="icon-btn text-rose-500" aria-label="Eliminar código" onClick={() => setDeletingPromo(promo)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </motion.div>

      <PlatformPromoFormModal
        open={showCreate}
        title="Nuevo promo code SaaS"
        plans={availablePlans}
        saving={createMutation.isPending}
        onClose={() => !createMutation.isPending && setShowCreate(false)}
        onSave={(form) => createMutation.mutate(form)}
      />

      <PlatformPromoFormModal
        open={Boolean(editingPromo)}
        title="Editar promo code SaaS"
        initial={editingPromo ? promoToForm(editingPromo) : emptyForm}
        plans={availablePlans}
        saving={updateMutation.isPending}
        onClose={() => !updateMutation.isPending && setEditingPromo(null)}
        onSave={(form) => editingPromo && updateMutation.mutate({ promoId: editingPromo.id, form })}
        isEdit
      />

      <Modal
        open={Boolean(deletingPromo)}
        title="Eliminar promo code SaaS"
        description="Esta acción elimina el código del catálogo global de billing."
        onClose={() => !deleteMutation.isPending && setDeletingPromo(null)}
        size="md"
      >
        <div className="space-y-4">
          <p className="text-sm text-surface-600 dark:text-surface-300">
            Se eliminará <strong>{deletingPromo?.code}</strong>.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setDeletingPromo(null)} disabled={deleteMutation.isPending}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => deletingPromo && deleteMutation.mutate(deletingPromo.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Eliminando...' : 'Eliminar'}
            </button>
          </div>
        </div>
      </Modal>
    </motion.div>
  );
}

function PlatformPromoFormModal({
  open,
  title,
  plans,
  saving,
  onClose,
  onSave,
  initial = emptyForm,
  isEdit = false,
}: {
  open: boolean;
  title: string;
  plans: AdminSaaSPlan[];
  saving: boolean;
  onClose: () => void;
  onSave: (form: FormState) => void;
  initial?: FormState;
  isEdit?: boolean;
}) {
  const [form, setForm] = useState<FormState>(initial);

  useEffect(() => {
    if (!open) {
      return;
    }
    setForm(initial);
  }, [initial, open]);

  const scopedPlans = plans.filter((plan) => plan.is_active);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function togglePlanKey(planKey: string) {
    setForm((current) => ({
      ...current,
      plan_keys: current.plan_keys.includes(planKey)
        ? current.plan_keys.filter((key) => key !== planKey)
        : [...current.plan_keys, planKey],
    }));
  }

  return (
    <Modal open={open} title={title} description="Los descuentos SaaS se aplican solo sobre el valor neto del plan y luego se calcula el IVA." onClose={onClose} size="lg">
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(form);
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Código</label>
            <input
              className={cn('input font-mono uppercase tracking-[0.2em]', isEdit && 'opacity-70')}
              value={form.code}
              onChange={(event) => set('code', event.target.value.toUpperCase())}
              disabled={isEdit}
              required
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Nombre</label>
            <input className="input" value={form.name} onChange={(event) => set('name', event.target.value)} required />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Descripción</label>
            <textarea className="input min-h-24 resize-y" value={form.description} onChange={(event) => set('description', event.target.value)} />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Tipo</label>
            <select className="input" value={form.discount_type} onChange={(event) => set('discount_type', event.target.value as FormState['discount_type'])}>
              <option value="percent">Porcentaje</option>
              <option value="fixed">Monto fijo</option>
            </select>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Valor</label>
            <input className="input" type="number" min="0.01" step="0.01" value={form.discount_value} onChange={(event) => set('discount_value', event.target.value)} required />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Usos máximos</label>
            <input className="input" type="number" min="1" step="1" value={form.max_uses} onChange={(event) => set('max_uses', event.target.value)} placeholder="Ilimitado" />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Expira</label>
            <input className="input" type="date" value={form.expires_at} onChange={(event) => set('expires_at', event.target.value)} />
          </div>
        </div>

        <div className="rounded-2xl border border-surface-200 p-4 dark:border-surface-800">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-surface-900 dark:text-white">Scope por plan</p>
              <p className="mt-1 text-sm text-surface-500">Si no seleccionas planes, el código aplica a todo el catálogo SaaS.</p>
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-surface-600 dark:text-surface-300">
              <input type="checkbox" checked={form.is_active} onChange={(event) => set('is_active', event.target.checked)} />
              Activo
            </label>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {scopedPlans.map((plan) => (
              <label key={plan.id} className="flex items-center gap-3 rounded-2xl border border-surface-200 px-3 py-3 text-sm dark:border-surface-800">
                <input
                  type="checkbox"
                  checked={form.plan_keys.includes(plan.key)}
                  onChange={() => togglePlanKey(plan.key)}
                />
                <div>
                  <p className="font-medium text-surface-900 dark:text-white">{plan.name}</p>
                  <p className="text-xs text-surface-500">{plan.key}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear código'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
