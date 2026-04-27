import { motion } from 'framer-motion';
import { Check, Star, ArrowRight } from 'lucide-react';
import { formatCurrency, formatDurationLabel } from '@/utils';
import type { TenantPublicProfile } from '@/types';

type Plan = TenantPublicProfile['featured_plans'][number];

interface Props {
  plans: Plan[];
  currency: string;
  checkoutEnabled: boolean;
  onSelectPlan: (planId: string) => void;
}

function getDiscountedPrice(plan: Plan): number {
  if (!plan.discount_pct) return plan.price;
  return Math.round(plan.price * (1 - plan.discount_pct / 100));
}

function getDurationShort(plan: Plan): string {
  const label = formatDurationLabel(plan.duration_type, plan.duration_days);
  if (label === 'Mensual') return 'mes';
  if (label === 'Anual') return 'año';
  if (label === 'Trimestral') return 'trimestre';
  if (label === 'Semestral') return 'semestre';
  return label.toLowerCase();
}

function getBenefits(plan: Plan): string[] {
  try {
    if (plan.description) {
      const parsed = JSON.parse(plan.description);
      if (Array.isArray(parsed)) return parsed as string[];
    }
  } catch { /* not JSON */ }
  return plan.description ? [plan.description] : [];
}

interface PlanCardProps {
  plan: Plan;
  index: number;
  checkoutEnabled: boolean;
  onSelect: () => void;
}

function PlanCard({ plan, index, checkoutEnabled, onSelect }: PlanCardProps) {
  const discountedPrice = getDiscountedPrice(plan);
  const hasDiscount = !!plan.discount_pct && plan.discount_pct > 0;
  const benefits = getBenefits(plan);
  const durationShort = getDurationShort(plan);

  return (
    <motion.article
      className={`sf-plan-card relative flex flex-col rounded-3xl p-6 md:p-7 ${plan.is_featured ? 'sf-plan-featured' : 'sf-card'}`}
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: plan.is_featured ? -6 : 0 }}
      viewport={{ once: true, margin: '-30px' }}
      transition={{ duration: 0.5, delay: index * 0.07, ease: 'easeOut' }}
      whileHover={{ y: plan.is_featured ? -10 : -4, transition: { duration: 0.2 } }}
    >
      {/* Featured badge */}
      {plan.is_featured && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
          <span className="sf-badge-featured flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold">
            <Star className="w-3 h-3 fill-current" />
            Recomendado
          </span>
        </div>
      )}

      {/* Plan name + duration */}
      <div className="flex items-center justify-between gap-2 mb-4">
        <span className="sf-chip-brand text-sm font-bold px-3 py-1 rounded-full">{plan.name}</span>
        <span className="sf-text-muted text-xs">{formatDurationLabel(plan.duration_type, plan.duration_days)}</span>
      </div>

      {/* Price */}
      <div className="mb-1">
        {hasDiscount && (
          <div className="sf-text-muted text-sm line-through mb-0.5">
            {formatCurrency(plan.price, plan.currency)}
          </div>
        )}
        <div className="flex items-end gap-2">
          <span className="sf-price-num text-4xl md:text-5xl font-black tracking-tight leading-none">
            {formatCurrency(discountedPrice, plan.currency)}
          </span>
          <span className="sf-text-muted text-sm mb-1.5">/ {durationShort}</span>
        </div>
        {hasDiscount && (
          <span className="sf-badge-discount text-xs font-bold px-2 py-0.5 rounded-md mt-1 inline-block">
            {plan.discount_pct}% de descuento
          </span>
        )}
      </div>

      {/* Description */}
      {plan.description && !benefits.length && (
        <p className="sf-text-muted text-sm leading-relaxed mt-3">{plan.description}</p>
      )}

      {/* Benefits list */}
      {benefits.length > 0 && (
        <ul className="mt-4 space-y-2 flex-1">
          {benefits.map((b, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm">
              <span className="sf-check-icon flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center mt-0.5">
                <Check className="w-2.5 h-2.5" strokeWidth={3} />
              </span>
              <span className="sf-text-strong">{b}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex-1" />

      {/* CTA */}
      {checkoutEnabled && (
        <motion.button
          onClick={onSelect}
          className={`mt-6 w-full py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 ${
            plan.is_featured ? 'sf-btn-brand' : 'sf-btn-secondary'
          }`}
          whileTap={{ scale: 0.97 }}
        >
          Inscribirme
          <ArrowRight className="w-4 h-4" />
        </motion.button>
      )}
    </motion.article>
  );
}

export default function PlanGrid({ plans, checkoutEnabled, onSelectPlan }: Props) {
  if (!plans.length) return null;

  return (
    <section id="sf-plans" className="sf-section sf-section-alt">
      <div className="sf-container">
        <motion.div
          className="text-center mb-10"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        >
          <h2 className="sf-heading text-3xl md:text-4xl font-black tracking-tight mb-2">
            Planes y precios
          </h2>
          <p className="sf-text-muted text-sm md:text-base">
            Elige el plan que mejor se adapte a ti. Activación inmediata.
          </p>
        </motion.div>

        <div className={`grid gap-5 ${
          plans.length === 1
            ? 'max-w-sm mx-auto'
            : plans.length === 2
            ? 'grid-cols-1 sm:grid-cols-2 max-w-2xl mx-auto'
            : plans.length === 3
            ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
            : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
        }`}>
          {plans.map((plan, i) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              index={i}
              checkoutEnabled={checkoutEnabled}
              onSelect={() => onSelectPlan(plan.id)}
            />
          ))}
        </div>

        <motion.p
          className="text-center sf-text-subtle text-xs mt-6"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.4 }}
        >
          Precios en CLP · Los valores no incluyen IVA · Sin permanencia mínima
        </motion.p>
      </div>
    </section>
  );
}
