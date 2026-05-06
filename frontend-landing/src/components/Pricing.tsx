import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ScrollReveal from '../animations/ScrollReveal';
import GlowButton from '../animations/GlowButton';

const APP_ORIGIN = 'https://app.nexofitness.cl';
const API_BASE = '/api/v1';

interface Plan {
  key: string;
  name: string;
  description: string;
  license_type: string;
  currency: string;
  price: string;
  trial_days: number;
  max_members: number;
  max_branches: number;
  features: string[];
  highlighted: boolean;
  checkout_enabled: boolean;
}

const PLAN_SORT: Record<string, number> = { monthly: 1, quarterly: 2, semi_annual: 3, annual: 4 };
const PLAN_PERIOD: Record<string, string> = { monthly: 'mes', quarterly: 'trimestre', semi_annual: 'semestre', annual: 'año' };
const PLAN_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, semi_annual: 6, annual: 12 };

const FALLBACK: Plan[] = [
  {
    key: 'monthly', name: 'Mensual', description: 'Ideal para empezar. Acceso completo con 14 días gratis.',
    license_type: 'monthly', currency: 'CLP', price: '34990', trial_days: 14,
    max_members: 500, max_branches: 3, highlighted: false, checkout_enabled: true,
    features: ['Clientes, clases y check-in', 'Tienda online y cobro público', 'Pagos y cobros internos', 'Reportes y estadísticas'],
  },
  {
    key: 'quarterly', name: 'Trimestral', description: 'Paga 3 meses y ahorra sin perder flexibilidad.',
    license_type: 'quarterly', currency: 'CLP', price: '94990', trial_days: 14,
    max_members: 500, max_branches: 3, highlighted: true, checkout_enabled: true,
    features: ['Todo lo del plan mensual', '~9% de ahorro vs mensual', 'Checkout online con pagos integrados', '14 días de prueba gratis'],
  },
  {
    key: 'semi_annual', name: 'Semestral', description: 'Paga 6 meses y ahorra ~12% sobre el plan mensual.',
    license_type: 'semi_annual', currency: 'CLP', price: '184990', trial_days: 14,
    max_members: 500, max_branches: 3, highlighted: false, checkout_enabled: true,
    features: ['Todo lo del plan mensual', '~12% de ahorro vs mensual', 'Checkout online con pagos integrados', '14 días de prueba gratis'],
  },
  {
    key: 'annual', name: 'Anual', description: '2 meses gratis. Más capacidad para gimnasios en crecimiento.',
    license_type: 'annual', currency: 'CLP', price: '349900', trial_days: 14,
    max_members: 1500, max_branches: 10, highlighted: false, checkout_enabled: true,
    features: ['Todo lo del plan mensual', '2 meses gratis vs mensual', 'Hasta 1500 miembros y 10 sedes', '14 días de prueba gratis'],
  },
];

function formatPrice(price: string | number, currency: string) {
  const num = typeof price === 'string' ? parseFloat(price) : price;
  if (currency === 'CLP') return '$' + Math.round(num).toLocaleString('es-CL');
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency }).format(num);
}

const CheckIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const ArrowDownIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" />
  </svg>
);

/* ─── Pricing anchor (cost of not having Nexo) ──────────── */

const HIDDEN_COSTS = [
  { label: 'Tiempo en planillas + WhatsApp', detail: '~2 hrs/día del staff', cost: 120000 },
  { label: 'Ventas perdidas sin checkout 24/7', detail: '3 leads/mes que no esperan al lunes', cost: 150000 },
  { label: 'Cobranza manual y recordatorios', detail: '~1 hr/día persiguiendo pagos', cost: 60000 },
  { label: 'Renovaciones que no se concretan', detail: '~5% de la base sin recordar', cost: 80000 },
];

function PricingAnchor({ cheapestMonthly }: { cheapestMonthly: number }) {
  const totalHidden = HIDDEN_COSTS.reduce((s, c) => s + c.cost, 0);
  const savings = totalHidden - cheapestMonthly;

  return (
    <ScrollReveal className="pricing-anchor">
      <div className="pricing-anchor-glow" aria-hidden />
      <div className="pricing-anchor-grid">
        <div className="pricing-anchor-side">
          <span className="eyebrow eyebrow-warn">
            <span className="eyebrow-dot" />
            Costo del desorden
          </span>
          <h3>Lo que probablemente ya estás pagando hoy.</h3>
          <p>Sin un sistema, el costo no aparece en una factura — pero está. Lo pagas en horas, ventas que no cierran y miembros que no renuevan.</p>
        </div>

        <div className="pricing-anchor-table">
          {HIDDEN_COSTS.map((c, i) => (
            <motion.div
              key={c.label}
              className="pricing-anchor-row"
              initial={{ opacity: 0, x: 16 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.07, ease: 'easeOut' }}
            >
              <div className="pricing-anchor-row-info">
                <strong>{c.label}</strong>
                <span>{c.detail}</span>
              </div>
              <span className="pricing-anchor-row-cost">~${c.cost.toLocaleString('es-CL')}</span>
            </motion.div>
          ))}

          <div className="pricing-anchor-total">
            <span>Costo mensual estimado</span>
            <strong>~${totalHidden.toLocaleString('es-CL')}</strong>
          </div>

          <div className="pricing-anchor-vs">
            <ArrowDownIcon />
            <div>
              <span>Nexo desde</span>
              <strong>${cheapestMonthly.toLocaleString('es-CL')} / mes</strong>
            </div>
            <div className="pricing-anchor-save">
              <span>Ahorro estimado</span>
              <strong>~${savings.toLocaleString('es-CL')}</strong>
            </div>
          </div>
        </div>
      </div>
    </ScrollReveal>
  );
}

/* ─── Plan card ──────────────────────────────────────────── */

function calcSavings(plan: Plan, monthlyPlan?: Plan) {
  if (!monthlyPlan || plan.license_type === 'monthly') return null;
  const months = PLAN_MONTHS[plan.license_type] ?? 1;
  const monthlyPrice = parseFloat(monthlyPlan.price);
  const planPrice = parseFloat(plan.price);
  const equivalent = planPrice / months;
  const savePerMonth = monthlyPrice - equivalent;
  if (savePerMonth <= 0) return null;
  const totalSave = savePerMonth * months;
  const pct = Math.round((savePerMonth / monthlyPrice) * 100);
  return { equivalent, savePerMonth, totalSave, pct };
}

function PlanCard({ plan, index, monthlyPlan }: { plan: Plan; index: number; monthlyPlan?: Plan }) {
  const period = PLAN_PERIOD[plan.license_type] ?? plan.license_type;
  const price = formatPrice(plan.price, plan.currency);
  const savings = calcSavings(plan, monthlyPlan);

  return (
    <motion.article
      className={`card plan-card${plan.highlighted ? ' plan-card-featured' : ''}`}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: plan.highlighted ? -6 : 0 }}
      viewport={{ once: true, margin: '-30px' }}
      transition={{ duration: 0.5, delay: index * 0.08, ease: 'easeOut' }}
      whileHover={{ y: plan.highlighted ? -10 : -4 }}
    >
      {plan.highlighted && <div className="plan-ribbon">Más elegido</div>}

      <div className="plan-head">
        <span className="chip chip-brand">{plan.name}</span>
        {savings && <span className="plan-save-pill">Ahorra {savings.pct}%</span>}
      </div>

      <div className="plan-price">
        <span className="plan-price-num">{price}</span>
        <div className="plan-price-meta">
          <span className="plan-price-suffix">/ {period}</span>
          <span className="plan-price-iva">+ IVA (19%)</span>
        </div>
      </div>

      {savings ? (
        <div className="plan-equiv">
          <span>Equivale a</span>
          <strong>{formatPrice(savings.equivalent, plan.currency)}</strong>
          <span>/ mes</span>
        </div>
      ) : (
        <div className="plan-equiv plan-equiv-base">
          <span>Sin compromisos · Cancela cuando quieras</span>
        </div>
      )}

      <p className="plan-desc">{plan.description}</p>

      <div className="plan-meta">
        {plan.trial_days > 0 && (
          <span className="chip plan-meta-chip">{plan.trial_days} días gratis</span>
        )}
        <span className="chip plan-meta-chip">
          Hasta {plan.max_members.toLocaleString('es-CL')} miembros
        </span>
        <span className="chip plan-meta-chip">
          {plan.max_branches} sede{plan.max_branches > 1 ? 's' : ''}
        </span>
      </div>

      <div className="plan-features">
        {plan.features.map(f => (
          <div key={f} className="plan-feature">
            <span className="plan-feature-check"><CheckIcon /></span>
            <span>{f}</span>
          </div>
        ))}
      </div>

      <div className="plan-ctas">
        <GlowButton
          href={`${APP_ORIGIN}/register`}
          variant={plan.highlighted ? 'primary' : 'secondary'}
          size="sm"
        >
          Comenzar prueba gratis
        </GlowButton>
      </div>
    </motion.article>
  );
}

export default function Pricing() {
  const [plans, setPlans] = useState<Plan[]>([]);

  useEffect(() => {
    fetch(`${API_BASE}/public/plans`)
      .then(r => { if (!r.ok) throw new Error('error'); return r.json(); })
      .then((data: unknown) => {
        const arr = Array.isArray(data) ? data : ((data as Record<string, unknown>).plans ?? (data as Record<string, unknown>).data ?? []) as Plan[];
        if ((arr as Plan[]).length) {
          const sorted = [...(arr as Plan[])].sort((a, b) => (PLAN_SORT[a.license_type] ?? 99) - (PLAN_SORT[b.license_type] ?? 99));
          setPlans(sorted);
        } else {
          setPlans(FALLBACK);
        }
      })
      .catch(() => setPlans(FALLBACK));
  }, []);

  const displayPlans = plans.length ? plans : FALLBACK;
  const monthlyPlan = useMemo(() => displayPlans.find(p => p.license_type === 'monthly'), [displayPlans]);
  const cheapestMonthly = monthlyPlan ? parseFloat(monthlyPlan.price) : 34990;

  return (
    <section className="section" id="precios">
      <div className="container">
        <ScrollReveal className="section-heading section-heading-centered">
          <span className="eyebrow"><span className="eyebrow-dot" />Precios públicos</span>
          <h2>Planes claros, prueba gratis y sin letra pequeña.</h2>
          <p>Precios directamente desde el sistema — siempre actualizados.</p>
        </ScrollReveal>

        <PricingAnchor cheapestMonthly={cheapestMonthly} />

        <AnimatePresence>
          <div className="plan-grid">
            {displayPlans.map((plan, i) => (
              <PlanCard key={plan.key} plan={plan} index={i} monthlyPlan={monthlyPlan} />
            ))}
          </div>
        </AnimatePresence>

        <ScrollReveal className="pricing-foot-note">
          <span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
            Sin contrato de permanencia · IVA aplica solo en CLP · Cambia o cancela cuando quieras
          </span>
        </ScrollReveal>
      </div>
    </section>
  );
}
