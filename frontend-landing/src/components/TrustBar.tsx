import ScrollReveal from '../animations/ScrollReveal';

const AVATARS = [
  { letter: 'F', grad: 'linear-gradient(135deg,#0891b2,#0e7490)' },
  { letter: 'R', grad: 'linear-gradient(135deg,#7c3aed,#6d28d9)' },
  { letter: 'C', grad: 'linear-gradient(135deg,#059669,#047857)' },
  { letter: 'M', grad: 'linear-gradient(135deg,#f97316,#ea580c)' },
  { letter: 'D', grad: 'linear-gradient(135deg,#db2777,#be185d)' },
];

const CITIES = ['Santiago', 'Antofagasta', 'Viña del Mar', 'Concepción', 'La Serena', 'Valdivia'];

const StarIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

export default function TrustBar() {
  return (
    <section className="trust-bar">
      <div className="container trust-bar-inner">
        <ScrollReveal className="trust-stack-block">
          <div className="trust-avatars">
            {AVATARS.map((a, i) => (
              <span key={i} className="trust-avatar" style={{ background: a.grad }}>{a.letter}</span>
            ))}
          </div>
          <div className="trust-count">
            <strong>+50 gimnasios y estudios</strong>
            <span>ya operan con Nexo Fitness en Chile</span>
          </div>
        </ScrollReveal>

        <div className="trust-bar-divider" aria-hidden />

        <ScrollReveal className="trust-rating-block" delay={0.1}>
          <div className="trust-stars">
            <StarIcon /><StarIcon /><StarIcon /><StarIcon /><StarIcon />
          </div>
          <div className="trust-rating-text">
            <strong>4.9 / 5</strong>
            <span>según dueños activos en plataforma</span>
          </div>
        </ScrollReveal>

        <div className="trust-bar-divider" aria-hidden />

        <ScrollReveal className="trust-cities-block" delay={0.2}>
          <span className="trust-cities-label">Operando en</span>
          <div className="trust-cities">
            {CITIES.map((c, i) => (
              <span key={c} className="trust-city">
                {c}{i < CITIES.length - 1 && <span className="trust-city-sep">·</span>}
              </span>
            ))}
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
