import ScrollReveal from '../animations/ScrollReveal';

const STATS = [
  { stat: '1 panel', desc: 'Ventas, clases, check-in, pagos y reportes conectados.' },
  { stat: '24/7', desc: 'Tienda online y autoservicio activos siempre.' },
  { stat: '14 días', desc: 'Prueba gratis, sin tarjeta requerida.' },
];

const PILLARS = [
  { num: '01', title: 'Venta online que convierte', desc: 'Planes, cupones, checkout y enlaces para Instagram y WhatsApp.' },
  { num: '02', title: 'Clases y programas sin planillas', desc: 'Calendario, reservas, aforos y seguimiento desde un solo flujo.' },
  { num: '03', title: 'App clara para el miembro', desc: 'Reservas, pagos, QR de acceso y notificaciones desde el teléfono.' },
];

export default function ValueShowcase() {
  return (
    <section className="section-sm value-showcase">
      <div className="container">
        <div className="value-stats">
          {STATS.map(({ stat, desc }, i) => (
            <ScrollReveal key={stat} delay={i * 0.08}>
              <article className="card proof-card">
                <strong>{stat}</strong>
                <span>{desc}</span>
              </article>
            </ScrollReveal>
          ))}
        </div>

        <div className="value-pillars">
          {PILLARS.map(({ num, title, desc }, i) => (
            <ScrollReveal key={num} delay={0.15 + i * 0.08}>
              <article className="card pillar-card">
                <span className="pillar-num">{num}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{desc}</p>
                </div>
              </article>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
