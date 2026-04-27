import ScrollReveal from '../animations/ScrollReveal';

const StarIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const Stars = () => (
  <div className="testimonial-stars">
    {Array.from({ length: 5 }).map((_, i) => <StarIcon key={i} />)}
  </div>
);

const TESTIMONIALS = [
  {
    body: '"Antes todo era WhatsApp y una planilla de Google. Mis clientes me mandaban mensajes a las 11 PM para reservar clases. Ahora reservan solos desde la app y yo duermo tranquila."',
    name: 'Francisca M.',
    gym: 'Propietaria · Studio Move, Santiago',
    initial: 'F',
    gradient: 'linear-gradient(135deg,#0891b2,#0e7490)',
  },
  {
    body: '"Teníamos 2 sedes y la coordinación era un caos. Con Nexo un solo panel muestra todo. Los pagos llegan solos y el equipo sabe exactamente qué hacer sin preguntarme."',
    name: 'Rodrigo A.',
    gym: 'Director · CrossFit Norte, Antofagasta',
    initial: 'R',
    gradient: 'linear-gradient(135deg,#7c3aed,#6d28d9)',
  },
  {
    body: '"Lo que más me sorprendió fue la app del miembro. Mis clientes se registran, reservan y pagan sin pedirme nada. La renovación subió y los mensajes de \'cómo pago\' bajaron a cero."',
    name: 'Camila V.',
    gym: 'Fundadora · Reforma Pilates, Viña del Mar',
    initial: 'C',
    gradient: 'linear-gradient(135deg,#059669,#047857)',
  },
];

export default function Testimonials() {
  return (
    <section className="section section-alt" id="testimonios">
      <div className="container">
        <ScrollReveal className="section-heading section-heading-centered">
          <span className="eyebrow"><span className="eyebrow-dot" />Lo que dicen los dueños</span>
          <h2>Gimnasios que cambiaron el desorden por un sistema.</h2>
        </ScrollReveal>

        <div className="testimonial-grid">
          {TESTIMONIALS.map(({ body, name, gym, initial, gradient }, i) => (
            <ScrollReveal key={name} delay={i * 0.1}>
              <article className="card card-hover testimonial-card">
                <Stars />
                <p className="testimonial-body">{body}</p>
                <div className="testimonial-footer">
                  <div className="testimonial-avatar" style={{ background: gradient }}>{initial}</div>
                  <div>
                    <div className="testimonial-name">{name}</div>
                    <div className="testimonial-gym">{gym}</div>
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
