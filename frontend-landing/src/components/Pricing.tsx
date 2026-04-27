import { useEffect, useState } from 'react';
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

function formatPrice(price: string, currency: string) {
  const num = parseFloat(price);
  if (currency === 'CLP') return '$' + Math.round(num).toLocaleString('es-CL');
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency }).format(num);
}

const CheckIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

function PlanCard({ plan, index }: { plan: Plan; index: number }) {
  const period = PLAN_PERIOD[plan.license_type] ?? plan.license_type;
  const price = formatPrice(plan.price, plan.currency);

  return (
    <motion.article
      className={`card plan-card${plan.highlighted ? ' plan-card-featured' : ''}`}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: plan.highlighted ? -6 : 0 }}
      viewport={{ once: true, margin: '-30px' }}
      transition={{ duration: 0.5, delay: index * 0.08, ease: 'easeOut' }}
      whileHover={{ y: plan.highlighted ? -10 : -4 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem' }}>
        <span className="chip chip-brand">{plan.name}</span>
        {plan.highlighted && <span className="chip chip-accent">Recomendado</span>}
      </div>

      <div className="plan-price">
        <span className="plan-price-num">{price}</span>
        <div className="plan-price-meta">
          <span className="plan-price-suffix">/ {period}</span>
          <span className="plan-price-iva">+ IVA (19%)</span>
        </div>
      </div>

      <p className="plan-desc">{plan.description}</p>

      <div className="plan-meta">
        {plan.trial_days > 0 && (
          <span className="chip" style={{ background: 'var(--surface)', border: '1px solid var(--surface-border)', color: 'var(--muted)', fontSize: '.72rem', padding: '.25rem .6rem' }}>
            {plan.trial_days} días gratis
          </span>
        )}
        <span className="chip" style={{ background: 'var(--surface)', border: '1px solid var(--surface-border)', color: 'var(--muted)', fontSize: '.72rem', padding: '.25rem .6rem' }}>
          Hasta {plan.max_members.toLocaleString('es-CL')} miembros
        </span>
        <span className="chip" style={{ background: 'var(--surface)', border: '1px solid var(--surface-border)', color: 'var(--muted)', fontSize: '.72rem', padding: '.25rem .6rem' }}>
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

  return (
    <section className="section" id="precios">
      <div className="container">
        <ScrollReveal className="section-heading section-heading-centered">
          <span className="eyebrow"><span className="eyebrow-dot" />Precios públicos</span>
          <h2>Planes claros, prueba gratis y sin letra pequeña.</h2>
          <p>Precios directamente desde el sistema — siempre actualizados.</p>
        </ScrollReveal>

        <AnimatePresence>
          <div className="plan-grid">
            {displayPlans.map((plan, i) => (
              <PlanCard key={plan.key} plan={plan} index={i} />
            ))}
          </div>
        </AnimatePresence>
      </div>
    </section>
  );
}
