import ScrollReveal from '../animations/ScrollReveal';

const ArrowIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
  </svg>
);

const PROBLEMS = [
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
    color: 'red',
    title: 'Ventas que se pierden',
    body: 'Un cliente llega interesado y no puede pagar online en ese momento. Mañana ya olvidó. Sin checkout activo, pierdes conversiones todo el tiempo.',
    solution: 'Nexo: checkout público 24/7',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
    color: 'amber',
    title: 'Clases sin control real',
    body: 'La agenda de clases vive en grupos de WhatsApp y hojas de cálculo. Doble reservas, aforos desbordados, instructores con listas distintas.',
    solution: 'Nexo: calendario + aforos en tiempo real',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    color: 'purple',
    title: 'Miembros que no renuevan',
    body: 'Sin recordatorios automáticos ni app propia, los miembros olvidan renovar. La retención baja y el equipo pierde tiempo en cobros manuales.',
    solution: 'Nexo: app del miembro + avisos automáticos',
  },
];

export default function ProblemSolution() {
  return (
    <section className="section section-alt" id="solucion">
      <div className="container">
        <ScrollReveal className="section-heading">
          <span className="eyebrow"><span className="eyebrow-dot" />El problema real</span>
          <h2>Los gimnasios pierden dinero por fragmentación operativa.</h2>
          <p>WhatsApp para reservas, planillas para membresías, efectivo sin registro. Nexo elimina ese caos y lo reemplaza por un sistema único.</p>
        </ScrollReveal>

        <div className="problem-grid">
          {PROBLEMS.map(({ icon, color, title, body, solution }, i) => (
            <ScrollReveal key={title} delay={i * 0.1}>
              <article className="card problem-card">
                <div className={`problem-icon ${color}`}>{icon}</div>
                <div className="problem-content">
                  <h3>{title}</h3>
                  <p>{body}</p>
                  <span className="problem-arrow">
                    {solution}
                    <ArrowIcon />
                  </span>
                </div>
              </article>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
