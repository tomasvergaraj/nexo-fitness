import { useState } from 'react';
import { motion } from 'framer-motion';
import { CreditCard, ExternalLink } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { EmptyState, Panel } from '../components/MemberShared';
import { cn, formatCurrency, formatDurationLabel, getApiError, getPublicAppOrigin } from '@/utils';
import { publicApi } from '@/services/api';
import type { PromoCodeValidateResponse, PublicCheckoutSession } from '@/types';
import { useMemberContext } from '../MemberContext';

export default function PlansTab() {
  const { plans, plansQuery, wallet, brandGradient, user } = useMemberContext();

  const [promoInputByPlan, setPromoInputByPlan] = useState<Record<string, string>>({});
  const [promoResultByPlan, setPromoResultByPlan] = useState<
    Record<string, PromoCodeValidateResponse | null>
  >({});
  const [promoValidatingPlan, setPromoValidatingPlan] = useState<string | null>(null);
  const [checkoutSession, setCheckoutSession] = useState<PublicCheckoutSession | null>(null);

  const tenantSlug = wallet?.tenant_slug;

  const checkoutMutation = useMutation({
    mutationFn: async (planId: string) => {
      if (!tenantSlug) throw new Error('No se encontró el gimnasio asociado.');
      const promoResult = promoResultByPlan[planId];
      const promoCodeId = promoResult?.valid ? promoResult.promo_code_id : undefined;
      const returnBase = `${getPublicAppOrigin()}/member`;
      const payload: Record<string, unknown> = {
        plan_id: planId,
        member_user_id: user.id,
        success_url: `${returnBase}?tab=payments&checkout=success`,
        cancel_url: `${returnBase}?tab=plans&checkout=cancelled`,
      };
      if (promoCodeId) {
        payload.promo_code_id = promoCodeId;
      }
      const response = await publicApi.createCheckoutSession(tenantSlug, payload);
      const session = response.data as PublicCheckoutSession;
      setCheckoutSession(session);
      window.location.href = session.checkout_url;
      return session;
    },
    onError: (error: unknown) => {
      toast.error(getApiError(error, 'No se pudo iniciar el pago. Intenta nuevamente.'));
    },
  });

  async function validatePromoCode(planId: string) {
    const code = (promoInputByPlan[planId] ?? '').trim();
    if (!code) {
      toast.error('Ingresa un código de promoción antes de aplicarlo.');
      return;
    }
    if (!tenantSlug) {
      toast.error('No se pudo identificar el gimnasio.');
      return;
    }
    setPromoValidatingPlan(planId);
    try {
      const response = await publicApi.validateTenantPromoCode(tenantSlug, code, planId);
      const result = response.data as PromoCodeValidateResponse;
      setPromoResultByPlan((prev) => ({ ...prev, [planId]: result }));
      if (result.valid) {
        toast.success('Código de descuento aplicado.');
      } else {
        toast.error(result.reason || 'El código no es válido para este plan.');
      }
    } catch (error: unknown) {
      toast.error(getApiError(error, 'No se pudo validar el código.'));
      setPromoResultByPlan((prev) => ({ ...prev, [planId]: null }));
    } finally {
      setPromoValidatingPlan(null);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
      className="space-y-4"
    >
      {checkoutSession ? (
        <div className="rounded-[1.4rem] border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-500/30 dark:bg-emerald-500/10">
          <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
            Tu pago está listo para continuar.
          </p>
          <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300">
            Serás redirigido automáticamente. Si no ocurre, usa el enlace a continuación.
          </p>
          <a
            href={checkoutSession.checkout_url}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-2 btn-secondary"
          >
            <ExternalLink size={16} />
            Ir al pago
          </a>
        </div>
      ) : null}

      {plansQuery.isLoading && !plansQuery.data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="animate-pulse rounded-[1.4rem] border border-surface-200/80 bg-white/85 p-4 dark:border-white/10 dark:bg-white/[0.04]"
            >
              <div className="h-5 w-32 rounded-xl bg-surface-200/80 dark:bg-white/8" />
              <div className="mt-3 h-8 w-28 rounded-xl bg-surface-200/80 dark:bg-white/8" />
              <div className="mt-2 h-4 w-full rounded-xl bg-surface-200/80 dark:bg-white/8" />
              <div className="mt-4 h-10 w-full rounded-xl bg-surface-200/80 dark:bg-white/8" />
            </div>
          ))}
        </div>
      ) : plans.length === 0 ? (
        <EmptyState
          title="Sin planes publicados"
          description="Los planes aparecerán aquí cuando el gimnasio los publique."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {plans.map((plan) => {
            const promoResult = promoResultByPlan[plan.id] ?? null;
            const isValidPromo = promoResult?.valid === true;
            const isValidatingThis = promoValidatingPlan === plan.id;
            const isCurrentPlan = wallet?.plan_id === plan.id;
            const buyLabel = isCurrentPlan ? 'Renovar este plan' : 'Comprar este plan';

            return (
              <Panel key={plan.id} title={plan.name}>
                <p className="mt-1 text-3xl font-bold font-display text-surface-900 dark:text-white">
                  {formatCurrency(plan.price, plan.currency)}
                </p>

                {plan.description ? (
                  <p className="mt-2 text-sm leading-6 text-surface-600 dark:text-surface-300">
                    {plan.description}
                  </p>
                ) : null}

                <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-surface-500 dark:text-surface-400">
                  {formatDurationLabel(plan.duration_type, plan.duration_days)}
                </p>

                {/* Promo code */}
                <div className="mt-4 flex gap-2">
                  <input
                    type="text"
                    value={promoInputByPlan[plan.id] ?? ''}
                    onChange={(e) =>
                      setPromoInputByPlan((prev) => ({ ...prev, [plan.id]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void validatePromoCode(plan.id);
                    }}
                    placeholder="Código de descuento"
                    className="input flex-1 text-sm"
                    disabled={isValidatingThis}
                  />
                  <button
                    type="button"
                    onClick={() => void validatePromoCode(plan.id)}
                    disabled={isValidatingThis || !(promoInputByPlan[plan.id] ?? '').trim()}
                    className="btn-secondary shrink-0 text-sm"
                  >
                    {isValidatingThis ? 'Validando…' : 'Aplicar'}
                  </button>
                </div>

                {isValidPromo && promoResult ? (
                  <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                    <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
                      {promoResult.discount_type === 'percent'
                        ? `Descuento del ${promoResult.discount_value}%`
                        : `Descuento de ${formatCurrency(promoResult.discount_value ?? 0, plan.currency)}`}
                    </p>
                    {promoResult.final_price !== undefined ? (
                      <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300">
                        Precio final:{' '}
                        <span className="font-bold">
                          {formatCurrency(promoResult.final_price, plan.currency)}
                        </span>
                      </p>
                    ) : null}
                  </div>
                ) : promoResult && !promoResult.valid ? (
                  <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 dark:border-rose-500/30 dark:bg-rose-500/10">
                    <p className="text-sm text-rose-700 dark:text-rose-300">
                      {promoResult.reason || 'El código no es válido para este plan.'}
                    </p>
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={() => checkoutMutation.mutate(plan.id)}
                  disabled={checkoutMutation.isPending}
                  className={cn(
                    'btn-primary mt-3 w-full flex items-center justify-center gap-2',
                  )}
                  style={{ background: brandGradient }}
                >
                  <CreditCard size={16} />
                  {checkoutMutation.isPending && checkoutMutation.variables === plan.id
                    ? 'Procesando…'
                    : buyLabel}
                </button>
              </Panel>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
