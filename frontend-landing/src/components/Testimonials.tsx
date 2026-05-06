import ScrollReveal from '../animations/ScrollReveal';

const QuoteIcon = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" opacity="0.18">
    <path d="M3 17h3l2-4V7H3v6h3l-2 4zm12 0h3l2-4V7h-6v6h3l-2 4z" />
  </svg>
);

const StarIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const Stars = () => (
  <div className="testimonial-stars">
    {Array.from({ length: 5 }).map((_, i) => <StarIcon key={i} />)}
  </div>
);

const FEATURED = {
  body: 'Antes todo era WhatsApp y planillas de Google. Mis clientes me mandaban mensajes a las 11 PM para reservar. Hoy reservan solos, pagan solos y yo duermo tranquila.',
  name: 'Francisca Méndez',
  role: 'Propietaria',
  gym: 'Studio Move',
  city: 'Santiago',
  initial: 'F',
  gradient: 'linear-gradient(135deg,#0891b2,#0e7490)',
  metrics: [
    { value: '+18 pts', label: 'Renovación mensual' },
    { value: '−2 hrs/día', label: 'Tiempo en recepción' },
    { value: '92%', label: 'Asistencia clases' },
  ],
};

const SECONDARY = [
  {
    body: 'Teníamos 2 sedes y la coordinación era un caos. Con Nexo un solo panel muestra todo. El equipo sabe qué hacer sin preguntarme.',
    name: 'Rodrigo Astorga',
    role: 'Director',
    gym: 'CrossFit Norte',
    city: 'Antofagasta',
    initial: 'R',
    gradient: 'linear-gradient(135deg,#7c3aed,#6d28d9)',
    metric: { value: '−32%', label: 'Tiempo coordinando staff' },
  },
  {
    body: 'Lo que más me sorprendió fue la app del miembro. La renovación subió y los mensajes de "cómo pago" bajaron a cero.',
    name: 'Camila Vergara',
    role: 'Fundadora',
    gym: 'Reforma Pilates',
    city: 'Viña del Mar',
    initial: 'C',
    gradient: 'linear-gradient(135deg,#059669,#047857)',
    metric: { value: '+24%', label: 'Renovación trimestral' },
  },
];

const AGGREGATE = [
  { value: '+18%', label: 'Renovación promedio' },
  { value: '−2.4 hrs', label: 'Recepción al día' },
  { value: '4.9 / 5', label: 'Satisfacción dueños' },
  { value: '<5 min', label: 'Onboarding cliente' },
];

export default function Testimonials() {
  return (
    <section className="section section-alt" id="testimonios">
      <div className="container">
        <ScrollReveal className="section-heading section-heading-centered">
          <span className="eyebrow"><span className="eyebrow-dot" />Lo que dicen los dueños</span>
          <h2>Gimnasios que cambiaron el desorden por un sistema.</h2>
          <p>Resultados promedio reportados por dueños después de 60 días en Nexo.</p>
        </ScrollReveal>

        <div className="aggregate-strip">
          {AGGREGATE.map((a, i) => (
            <ScrollReveal key={a.label} delay={i * 0.06}>
              <div className="aggregate-cell">
                <strong>{a.value}</strong>
                <span>{a.label}</span>
              </div>
            </ScrollReveal>
          ))}
        </div>

        <ScrollReveal>
          <article className="testimonial-featured">
            <div className="testimonial-featured-glow" aria-hidden />
            <QuoteIcon />
            <Stars />
            <p className="testimonial-featured-body">{FEATURED.body}</p>

            <div className="testimonial-featured-foot">
              <div className="testimonial-featured-person">
                <div className="testimonial-avatar lg" style={{ background: FEATURED.gradient }}>
                  {FEATURED.initial}
                </div>
                <div>
                  <div className="testimonial-name">{FEATURED.name}</div>
                  <div className="testimonial-gym">
                    {FEATURED.role} · <strong>{FEATURED.gym}</strong>, {FEATURED.city}
                  </div>
                </div>
              </div>

              <div className="testimonial-featured-metrics">
                {FEATURED.metrics.map((m) => (
                  <div key={m.label} className="testimonial-metric">
                    <strong>{m.value}</strong>
                    <span>{m.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </article>
        </ScrollReveal>

        <div className="testimonial-grid">
          {SECONDARY.map((t, i) => (
            <ScrollReveal key={t.name} delay={i * 0.1}>
              <article className="card card-hover testimonial-card">
                <Stars />
                <p className="testimonial-body">"{t.body}"</p>
                <div className="testimonial-metric-inline">
                  <strong>{t.metric.value}</strong>
                  <span>{t.metric.label}</span>
                </div>
                <div className="testimonial-footer">
                  <div className="testimonial-avatar" style={{ background: t.gradient }}>{t.initial}</div>
                  <div>
                    <div className="testimonial-name">{t.name}</div>
                    <div className="testimonial-gym">{t.role} · <strong>{t.gym}</strong>, {t.city}</div>
                  </div>
                </div>
              </article>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
