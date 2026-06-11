import { useEffect, useMemo, useState } from 'react';
import ScrollReveal from '../animations/ScrollReveal';
import Button from './Button';

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

// Base prerenderizada: si el fetch falla o aún no responde, esto es lo que
// queda en el HTML estático. Mantener alineado con SaaSPlanDefinition.
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
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

function calcSavings(plan: Plan, monthlyPlan?: Plan) {
  if (!monthlyPlan || plan.license_type === 'monthly') return null;
  const months = PLAN_MONTHS[plan.license_type] ?? 1;
  const monthlyPrice = parseFloat(monthlyPlan.price);
  const planPrice = parseFloat(plan.price);
  const equivalent = planPrice / months;
  const savePerMonth = monthlyPrice - equivalent;
  if (savePerMonth <= 0) return null;
  const pct = Math.round((savePerMonth / monthlyPrice) * 100);
  return { equivalent, pct };
}

function PlanCard({ plan, monthlyPlan }: { plan: Plan; monthlyPlan?: Plan }) {
  const period = PLAN_PERIOD[plan.license_type] ?? plan.license_type;
  const price = formatPrice(plan.price, plan.currency);
  const savings = calcSavings(plan, monthlyPlan);

  return (
    <article className={`card plan-card${plan.highlighted ? ' plan-card-featured' : ''}`}>
      {plan.highlighted && <div className="plan-ribbon">Recomendado</div>}

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
        <div className="plan-equiv">
          <span>Precio base de referencia</span>
        </div>
      )}

      <p className="plan-desc">{plan.description}</p>

      <div className="plan-meta">
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
        <Button
          href={`${APP_ORIGIN}/register`}
          variant={plan.highlighted ? 'primary' : 'secondary'}
          size="sm"
        >
          Empezar prueba gratis
        </Button>
      </div>
    </article>
  );
}

export default function Pricing() {
  const [plans, setPlans] = useState<Plan[]>([]);

  useEffect(() => {
    fetch(`${API_BASE}/billing/public/plans`)
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

  return (
    <section className="section" id="precios">
      <div className="container">
        <div className="section-heading section-heading-centered">
          <span className="eyebrow"><span className="eyebrow-dot" />Precios públicos</span>
          <h2>Planes claros, prueba gratis y sin letra pequeña.</h2>
          <p>
            Precios directamente desde el sistema.
            <br />
            14 días de prueba gratis, sin tarjeta · Cancela cuando quieras.
          </p>
        </div>

        <div className="plan-grid">
          {displayPlans.map(plan => (
            <PlanCard key={plan.key} plan={plan} monthlyPlan={monthlyPlan} />
          ))}
        </div>

        <ScrollReveal className="pricing-foot-note">
          <span>
            Prueba de 14 días sin tarjeta · Sin contrato de permanencia · IVA aplica solo en CLP
          </span>
        </ScrollReveal>
      </div>
    </section>
  );
}
