import ScrollReveal from '../animations/ScrollReveal';
import Button from './Button';

const PlusIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

// Solo claims verificados (CLAUDE.md + datos vivos de /billing/public/plans).
const ITEMS = [
  {
    q: '¿Cómo funciona la prueba gratis?',
    a: 'Creas tu cuenta y tienes 14 días con acceso completo a todas las funciones: tienda online, clases, check-in, caja y reportes. Al final eliges un plan; si no contratas, no se te cobra nada.',
  },
  {
    q: '¿Necesito tarjeta para probar?',
    a: 'No. La prueba no pide datos de pago. Solo tu correo para crear la cuenta.',
  },
  {
    q: '¿Puedo cancelar cuando quiera?',
    a: 'Sí. No hay permanencia ni contrato mínimo: el plan Mensual se renueva mes a mes y puedes cancelar cuando quieras. Los planes de más meses se pagan por adelantado y no se renuevan sin tu confirmación.',
  },
  {
    q: '¿Cómo pagan mis socios?',
    a: 'Online con Webpay (Transbank): el socio compra su plan desde la tienda de tu gimnasio y queda activo al instante. En el mesón puedes cobrar con terminal TUU o registrar pagos en la caja del sistema.',
  },
  {
    q: '¿Cuántas sucursales soporta?',
    a: 'Hasta 3 sucursales en los planes Mensual, Trimestral y Semestral, cada una con su agenda, aforos y staff. El plan Anual llega hasta 10.',
  },
  {
    q: '¿Puedo exportar mis datos?',
    a: 'Sí. Socios, ventas y reportes se exportan a CSV cuando quieras. Tus datos son tuyos, también si decides irte.',
  },
  {
    q: '¿Cómo es el soporte?',
    a: 'Por WhatsApp, por correo y dentro del sistema. También puedes escribir a contacto@nexofitness.cl antes de activar tu cuenta.',
  },
];

export default function FAQ() {
  return (
    <section className="section section-sm" id="faq">
      <div className="container faq-layout">
        <ScrollReveal className="faq-heading">
          <span className="eyebrow"><span className="eyebrow-dot" />FAQ</span>
          <h2>Preguntas frecuentes.</h2>
          <p>¿Tienes otra duda? Escríbenos y te respondemos antes de que actives tu cuenta.</p>
          <div style={{ marginTop: '2rem' }}>
            <Button href="https://app.nexofitness.cl/register">Empezar prueba gratis</Button>
          </div>
        </ScrollReveal>

        <ScrollReveal className="faq-list" delay={0.1}>
          {/* <details>/<summary>: accesible y funciona sin JS; las respuestas
              quedan en el HTML prerenderizado. name agrupa el acordeón
              (exclusivo en navegadores que lo soportan; inocuo en el resto). */}
          {ITEMS.map(({ q, a }, i) => (
            <details key={i} className="faq-item" open={i === 0} {...{ name: 'faq' }}>
              <summary className="faq-question">
                {q}
                <span className="faq-icon"><PlusIcon /></span>
              </summary>
              <p className="faq-answer">{a}</p>
            </details>
          ))}
        </ScrollReveal>
      </div>
    </section>
  );
}
