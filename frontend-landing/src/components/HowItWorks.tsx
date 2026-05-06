import { useRef, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ScrollReveal from '../animations/ScrollReveal';

const STEPS = [
  {
    n: '1',
    title: 'Captas interés',
    body: 'Tu landing y tienda online están siempre activas. Campañas en Instagram y WhatsApp llevan al plan correcto sin mensajes manuales.',
    bullets: ['Tienda pública 24/7', 'Links de pago directos', 'Cupones de campaña'],
  },
  {
    n: '2',
    title: 'Cierras la venta',
    body: 'El cliente paga solo desde el celular o tu equipo cobra desde caja. Webpay confirma, el plan se activa al instante.',
    bullets: ['Checkout integrado con Webpay', 'IVA y boleta automáticos', 'Plan activo en segundos'],
  },
  {
    n: '3',
    title: 'Coordinas y accedes',
    body: 'Reservas, aforos y check-in con QR. La agenda se respeta sola, sin doble digitación ni grupos de WhatsApp.',
    bullets: ['Calendario por sede', 'QR check-in en la entrada', 'Lista de espera automática'],
  },
  {
    n: '4',
    title: 'Fidelizas y escalas',
    body: 'Reportes en vivo, recordatorios automáticos y app del miembro. Cuando abres otra sede, el sistema ya está listo.',
    bullets: ['Renovaciones recordadas', 'Reportes en tiempo real', 'Multi-sede sin reconfigurar'],
  },
];

/* ── Visuals per step ─────────────────────────────────────── */

const StepVisual1 = () => (
  <div className="hiw-scene hiw-scene-1">
    <div className="hiw-browser">
      <div className="hiw-browser-bar">
        <span /><span /><span />
        <div className="hiw-browser-url">app.nexofitness.cl/s/studio-move</div>
      </div>
      <div className="hiw-browser-body">
        <div className="hiw-store-head">
          <span className="hiw-store-pill">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l1-6h16l1 6M5 9v11a1 1 0 001 1h12a1 1 0 001-1V9M9 9V4M15 9V4"/></svg>
            Compra online
          </span>
          <strong>Compra tu plan en Studio Move</strong>
          <span className="hiw-store-sub">Elige duración, completa datos y paga seguro.</span>
        </div>
        <div className="hiw-plans-row">
          {[
            { name: 'Mensual Full', price: '$34.990', save: '' },
            { name: 'Trimestral Pro', price: '$94.990', save: 'Ahorra 9%', featured: true },
            { name: 'Anual Champion', price: '$349.900', save: '2 meses gratis' },
          ].map((p) => (
            <div key={p.name} className={`hiw-plan${p.featured ? ' featured' : ''}`}>
              {p.save && <span className="hiw-plan-tag">{p.save}</span>}
              <strong>{p.name}</strong>
              <span className="hiw-plan-price">{p.price}</span>
              <button>Comprar</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
);

const StepVisual2 = () => (
  <div className="hiw-scene hiw-scene-2">
    <div className="hiw-checkout">
      <span className="bento-eyebrow-mini">Checkout · Plan Trimestral</span>
      <strong className="hiw-checkout-amount">$94.990</strong>
      <div className="hiw-checkout-rows">
        <div><span>Cliente</span><strong>Camila Vergara</strong></div>
        <div><span>Email</span><strong>camila@correo.cl</strong></div>
        <div><span>Sede</span><strong>Las Condes</strong></div>
      </div>
      <button className="hiw-checkout-btn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
        Pagar con Webpay
      </button>
    </div>
    <motion.div
      className="hiw-success-toast"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3, duration: 0.5 }}
    >
      <div className="hiw-success-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <div>
        <strong>Plan activo</strong>
        <span>Boleta enviada al cliente</span>
      </div>
    </motion.div>
  </div>
);

const StepVisual3 = () => (
  <div className="hiw-scene hiw-scene-3">
    <div className="hiw-class-card">
      <div className="hiw-class-head">
        <span className="bento-eyebrow-mini">Hoy · 7:00</span>
        <strong>CrossFit Open</strong>
        <span className="hiw-class-coach">con Rodrigo · Sala A</span>
      </div>
      <div className="hiw-class-meter">
        <div className="hiw-class-meter-bar"><span style={{ width: '90%' }} /></div>
        <span className="hiw-class-meter-label"><strong>18</strong> / 20 reservados</span>
      </div>
      <div className="hiw-class-attendees">
        {['F', 'R', 'C', 'M', 'J', '+13'].map((a, i) => (
          <span key={i} className={`hiw-attendee${a.startsWith('+') ? ' more' : ''}`}>{a}</span>
        ))}
      </div>
    </div>

    <motion.div
      className="hiw-qr-card"
      animate={{ scale: [1, 1.04, 1] }}
      transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
    >
      <div className="hiw-qr-ring">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
          <rect x="14" y="14" width="3" height="3"/><rect x="18" y="14" width="3" height="3"/><rect x="14" y="18" width="3" height="3"/><rect x="18" y="18" width="3" height="3"/>
        </svg>
      </div>
      <strong>Check-in OK</strong>
      <span>Camila V. · 06:54</span>
    </motion.div>
  </div>
);

const StepVisual4 = () => {
  const segs = [
    { color: 'var(--brand)', dash: '32 100', offset: 0 },
    { color: '#10b981', dash: '24 100', offset: -32 },
    { color: '#a78bfa', dash: '18 100', offset: -56 },
    { color: '#f97316', dash: '14 100', offset: -74 },
  ];
  return (
    <div className="hiw-scene hiw-scene-4">
      <div className="hiw-report">
        <div className="hiw-report-head">
          <span className="bento-eyebrow-mini">Reportes · Mayo</span>
          <strong>$12.838.690 · Ingresos membresías</strong>
        </div>
        <div className="hiw-report-stats">
          <div>
            <span>Renovación</span>
            <strong className="up">92%</strong>
            <span className="up">▲ 4 pts</span>
          </div>
          <div>
            <span>Activos</span>
            <strong>247</strong>
            <span className="up">▲ 18</span>
          </div>
          <div>
            <span>Churn</span>
            <strong>2.8%</strong>
            <span className="up">▼ 1 pt</span>
          </div>
        </div>
        <div className="hiw-report-grid">
          <div className="hiw-report-spark-wrap">
            <span className="hiw-report-cap">Ingresos en el tiempo</span>
            <div className="hiw-report-spark">
              {[30, 38, 32, 46, 42, 54, 50, 62, 58, 70, 64, 78].map((h, i) => (
                <span key={i} style={{ height: `${h}%` }} />
              ))}
            </div>
          </div>
          <div className="hiw-report-donut-wrap">
            <span className="hiw-report-cap">Mix por plan</span>
            <svg viewBox="0 0 36 36" width="56" height="56">
              <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
              {segs.map((s, i) => (
                <circle key={i} cx="18" cy="18" r="15.915" fill="transparent" stroke={s.color} strokeWidth="4" strokeDasharray={s.dash} strokeDashoffset={s.offset} transform="rotate(-90 18 18)" />
              ))}
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
};

const SCENES = [StepVisual1, StepVisual2, StepVisual3, StepVisual4];

/* ── Step tracker ─────────────────────────────────────────── */

function useActiveStep(refs: React.MutableRefObject<(HTMLDivElement | null)[]>) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) {
          const idx = refs.current.findIndex(r => r === visible.target);
          if (idx >= 0) setActive(idx);
        }
      },
      { rootMargin: '-40% 0px -40% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] }
    );
    refs.current.forEach(el => el && observer.observe(el));
    return () => observer.disconnect();
  }, [refs]);
  return active;
}

export default function HowItWorks() {
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const active = useActiveStep(refs);
  const Scene = SCENES[active];

  return (
    <section className="section section-alt hiw-section" id="como-funciona">
      <div className="container">
        <ScrollReveal className="section-heading section-heading-centered">
          <span className="eyebrow"><span className="eyebrow-dot" />Cómo se siente en la práctica</span>
          <h2>Un flujo simple para tu equipo, claro para tus miembros.</h2>
          <p>La idea no es agregar otra herramienta: es reemplazar el desorden por un sistema entendible.</p>
        </ScrollReveal>

        <div className="hiw-scrolly">
          <div className="hiw-steps">
            {STEPS.map((s, i) => {
              const InlineScene = SCENES[i];
              return (
                <div
                  key={s.n}
                  ref={(el) => { refs.current[i] = el; }}
                  className={`hiw-step${active === i ? ' is-active' : ''}`}
                >
                  <div className="hiw-step-rail">
                    <span className="hiw-step-num">{s.n}</span>
                  </div>
                  <div className="hiw-step-content">
                    <h3>{s.title}</h3>
                    <p>{s.body}</p>
                    <ul className="hiw-step-bullets">
                      {s.bullets.map((b) => (
                        <li key={b}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          {b}
                        </li>
                      ))}
                    </ul>
                    <div className="hiw-step-inline-scene">
                      <div className="hiw-step-inline-glow" aria-hidden />
                      <InlineScene />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="hiw-stage">
            <div className="hiw-stage-inner">
              <div className="hiw-stage-glow" aria-hidden />
              <div className="hiw-stage-progress">
                {STEPS.map((_, i) => (
                  <span key={i} className={`hiw-pip${active >= i ? ' done' : ''}${active === i ? ' current' : ''}`} />
                ))}
              </div>
              <AnimatePresence mode="wait">
                <motion.div
                  key={active}
                  initial={{ opacity: 0, y: 20, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -16, scale: 0.97 }}
                  transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
                  className="hiw-stage-scene"
                >
                  <Scene />
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
