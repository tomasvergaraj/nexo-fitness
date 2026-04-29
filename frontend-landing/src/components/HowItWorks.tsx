import ScrollReveal from '../animations/ScrollReveal';

const STEPS = [
  { n: '1', title: 'Captas interés', body: 'Campañas, redes y links llevan al plan correcto sin depender de mensajes manuales.' },
  { n: '2', title: 'Cierras la venta', body: 'El cliente compra online o tu equipo cobra desde caja con el mismo inventario de planes.' },
  { n: '3', title: 'Coordinas y accedes', body: 'Reservas, aforos y check-in quedan alineados sin doble digitación ni confusiones.' },
  { n: '4', title: 'Fidelizas y escalas', body: 'Usas reportes, programas y campañas para retener mejor. Cuando abres otra sede, el sistema ya está listo.' },
];

export default function HowItWorks() {
  return (
    <section className="section section-alt" id="como-funciona">
      <div className="container">
        <ScrollReveal className="section-heading section-heading-centered">
          <span className="eyebrow"><span className="eyebrow-dot" />Cómo se siente en la práctica</span>
          <h2>Un flujo simple para tu equipo, claro para tus miembros.</h2>
          <p>La idea no es agregar otra herramienta: es reemplazar el desorden por un sistema entendible.</p>
        </ScrollReveal>

        <div className="timeline-grid">
          {STEPS.map(({ n, title, body }, i) => (
            <ScrollReveal key={n} delay={i * 0.1}>
              <article className="card timeline-card">
                <span className="timeline-step">{n}</span>
                <div className="timeline-content">
                  <h3>{title}</h3>
                  <p>{body}</p>
                </div>
              </article>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
