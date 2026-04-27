import ScrollReveal from '../animations/ScrollReveal';

const SIGNALS = [
  { label: 'Operación', text: 'Clientes, planes, clases y staff coordinados en tiempo real.' },
  { label: 'Comercial', text: 'Checkout público, campañas y seguimiento de leads sin Excel.' },
  { label: 'Experiencia', text: 'Miembros reservan, pagan y hacen check-in desde la app.' },
  { label: 'Escalabilidad', text: 'Sedes, aforos y reportes centralizados cuando el negocio crece.' },
];

export default function SignalStrip() {
  return (
    <div className="signal-strip">
      <div className="container signal-grid">
        {SIGNALS.map(({ label, text }, i) => (
          <ScrollReveal key={label} delay={i * 0.08}>
            <article className="card signal-card">
              <span className="signal-label">{label}</span>
              <strong>{text}</strong>
            </article>
          </ScrollReveal>
        ))}
      </div>
    </div>
  );
}
