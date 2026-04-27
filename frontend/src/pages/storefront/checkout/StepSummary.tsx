import { useState } from 'react';
import { motion } from 'framer-motion';
import { Tag, X, Loader2, ShieldCheck, ChevronDown } from 'lucide-react';
import { formatCurrency, formatDurationLabel } from '@/utils';
import type { TenantPublicProfile } from '@/types';
import type { useCheckout } from '../hooks/useCheckout';

type Plan = TenantPublicProfile['featured_plans'][number];
type CheckoutHook = ReturnType<typeof useCheckout>;

interface Props {
  checkout: CheckoutHook;
  plan: Plan | undefined;
  slug: string;
}

export default function StepSummary({ checkout, plan, slug }: Props) {
  const { state, set, validatePromo, clearPromo, pay } = checkout;
  const [promoOpen, setPromoOpen] = useState(false);

  if (!plan) return null;

  const basePrice = plan.price;
  const planDiscount = plan.discount_pct
    ? Math.round(basePrice * (plan.discount_pct / 100))
    : 0;
  const afterPlanDiscount = basePrice - planDiscount;

  const promoDiscount = state.promoResult?.discount_amount ?? 0;
  const finalPrice = state.promoResult?.final_price ?? afterPlanDiscount;

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const successUrl = `${origin}/store/${slug}?checkout=success`;
  const cancelUrl = `${origin}/store/${slug}?checkout=cancel`;

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.25 }}
    >
      {/* Order summary card */}
      <div className="sf-summary-card rounded-2xl p-4 space-y-3">
        <div className="flex justify-between items-start">
          <div>
            <p className="sf-text-strong font-bold">{plan.name}</p>
            <p className="sf-text-muted text-xs mt-0.5">
              {formatDurationLabel(plan.duration_type, plan.duration_days)}
            </p>
          </div>
          <span className="sf-text-strong font-bold">{formatCurrency(basePrice, plan.currency)}</span>
        </div>

        {planDiscount > 0 && (
          <div className="flex justify-between items-center text-sm">
            <span className="sf-text-muted">Descuento del plan ({plan.discount_pct}%)</span>
            <span className="text-emerald-400 font-semibold">−{formatCurrency(planDiscount, plan.currency)}</span>
          </div>
        )}

        {promoDiscount > 0 && (
          <div className="flex justify-between items-center text-sm">
            <span className="sf-text-muted flex items-center gap-1">
              <Tag className="w-3 h-3" /> Código promo
            </span>
            <span className="text-emerald-400 font-semibold">−{formatCurrency(promoDiscount, plan.currency)}</span>
          </div>
        )}

        <div className="sf-divider-h my-1" />

        <div className="flex justify-between items-center">
          <span className="sf-text-strong font-bold">Total</span>
          <span className="sf-price-num text-2xl font-black">
            {formatCurrency(finalPrice, plan.currency)}
          </span>
        </div>
        <p className="sf-text-subtle text-xs">+ IVA (19%) · Pago seguro vía Webpay</p>
      </div>

      {/* Promo code */}
      <div>
        <button
          onClick={() => setPromoOpen(o => !o)}
          className="flex items-center gap-2 sf-text-muted text-xs hover:sf-text-strong transition-colors"
        >
          <Tag className="w-3.5 h-3.5" />
          {state.promoResult ? `Código aplicado: ${state.promoInput}` : '¿Tienes un código de descuento?'}
          <motion.span animate={{ rotate: promoOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronDown className="w-3.5 h-3.5" />
          </motion.span>
        </button>

        {promoOpen && (
          <motion.div
            className="mt-2 flex gap-2"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            {state.promoResult ? (
              <button
                onClick={() => { clearPromo(); }}
                className="flex items-center gap-1.5 sf-error text-xs"
              >
                <X className="w-3.5 h-3.5" /> Quitar código
              </button>
            ) : (
              <>
                <input
                  type="text"
                  value={state.promoInput}
                  onChange={e => set({ promoInput: e.target.value.toUpperCase(), error: '' })}
                  placeholder="CÓDIGO"
                  className="sf-input flex-1 text-sm uppercase"
                />
                <button
                  onClick={validatePromo}
                  disabled={!state.promoInput.trim() || state.loading}
                  className="sf-btn-brand px-4 py-2 rounded-xl text-sm font-bold disabled:opacity-50"
                >
                  {state.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Aplicar'}
                </button>
              </>
            )}
          </motion.div>
        )}
        {state.error && !state.promoResult && (
          <p className="sf-error text-xs mt-1">{state.error}</p>
        )}
      </div>

      {/* Pay button */}
      <motion.button
        onClick={() => pay(successUrl, cancelUrl)}
        disabled={state.loading}
        className="sf-btn-brand w-full py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2 disabled:opacity-50"
        whileTap={{ scale: 0.98 }}
      >
        {state.loading
          ? <Loader2 className="w-5 h-5 animate-spin" />
          : <>Pagar {formatCurrency(finalPrice, plan.currency)}</>
        }
      </motion.button>

      <div className="flex items-center justify-center gap-2 sf-text-subtle text-xs">
        <ShieldCheck className="w-3.5 h-3.5" />
        Pago seguro · Sin permanencia mínima
      </div>
    </motion.div>
  );
}
