import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import ScrollReveal from '../animations/ScrollReveal';
import GlowButton from '../animations/GlowButton';

const PlusIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const ITEMS = [
  {
    q: '¿Cuánto tiempo toma empezar?',
    a: 'La mayoría de los gimnasios tiene su primera venta online en menos de 48 horas desde que activan la cuenta. No necesitas migrar datos manualmente — el soporte te acompaña en el proceso.',
  },
  {
    q: '¿La prueba gratis requiere tarjeta?',
    a: 'No. Los 14 días de prueba son completamente gratuitos y sin necesidad de ingresar datos de pago. Solo creas tu cuenta y empiezas a configurar tu gimnasio.',
  },
  {
    q: '¿Sirve si tengo más de una sede?',
    a: 'Sí. Nexo contempla multi-sede con aforos, planes y staff independientes por ubicación, todo desde un panel centralizado. Los planes Trimestral y Semestral incluyen hasta 3 sedes. El plan Anual soporta hasta 10.',
  },
  {
    q: '¿Los pagos de mis miembros son seguros?',
    a: 'Sí. Los pagos se procesan vía Webpay, con estándares de seguridad para pagos en Chile. Nexo no almacena datos de tarjeta: la información sensible es manejada por el procesador de pagos.',
  },
  {
    q: '¿Puedo migrar desde mi sistema actual?',
    a: 'Sí. Si vienes de planillas o de otro software, el soporte te explica exactamente qué datos necesitas exportar y cómo importarlos a Nexo. Acompañamos la migración para que no pierdas ni un cliente.',
  },
  {
    q: '¿Hay permanencia o contrato mínimo?',
    a: 'No hay permanencia. El plan Mensual es renovación mes a mes y puedes cancelar cuando quieras. Los planes Trimestral, Semestral y Anual se cobran por adelantado al inicio del período, sin renovación automática obligatoria.',
  },
];

export default function FAQ() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section className="section section-sm" id="faq">
      <div className="container faq-layout">
        <ScrollReveal className="faq-heading">
          <span className="eyebrow"><span className="eyebrow-dot" />FAQ</span>
          <h2>Preguntas frecuentes.</h2>
          <p>¿Tienes dudas sobre la migración o el flujo? Escríbenos y te ayudamos antes de activar tu cuenta.</p>
          <div style={{ marginTop: '2rem' }}>
            <GlowButton href="https://app.nexofitness.cl/register">Comenzar prueba gratis</GlowButton>
          </div>
        </ScrollReveal>

        <ScrollReveal className="faq-list" delay={0.1}>
          {ITEMS.map(({ q, a }, i) => (
            <div key={i} className={`faq-item${open === i ? ' open' : ''}`}>
              <button
                className="faq-question"
                aria-expanded={open === i}
                onClick={() => setOpen(open === i ? null : i)}
              >
                {q}
                <span className="faq-icon"><PlusIcon /></span>
              </button>
              <AnimatePresence initial={false}>
                {open === i && (
                  <motion.div
                    className="faq-body"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
                    style={{ overflow: 'hidden' }}
                  >
                    <motion.p
                      className="faq-answer"
                      initial={{ y: 8, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      exit={{ y: 4, opacity: 0 }}
                      transition={{ duration: 0.22, delay: 0.06, ease: 'easeOut' }}
                    >
                      {a}
                    </motion.p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </ScrollReveal>
      </div>
    </section>
  );
}
