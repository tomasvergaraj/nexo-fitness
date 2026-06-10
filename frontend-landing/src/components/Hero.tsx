import Button from './Button';

const ChevronIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

export default function Hero() {
  return (
    <section className="hero" id="hero">
      <div className="container">
        <h1 className="hero-headline">
          Gestión integral para gimnasios y estudios.
        </h1>

        <p className="hero-lead">
          Ventas, clases, check-in y pagos en un solo panel.
        </p>

        <div className="hero-actions">
          <Button href="https://app.nexofitness.cl/register" size="lg">
            Empezar prueba gratis
          </Button>
          <a className="hero-link" href="#precios">
            Ver precios
            <ChevronIcon />
          </a>
        </div>

        <p className="hero-trust">14 días gratis · Sin tarjeta · Cancela cuando quieras</p>

        <figure className="hero-shot">
          {/* Screenshot real del dashboard (fuente: docs/screens-fuente/, 1916×941) */}
          <picture>
            <source
              type="image/avif"
              srcSet="/screens/dashboard-1440.avif?v=2 1440w, /screens/dashboard-1916.avif?v=2 1916w"
              sizes="(min-width: 1448px) 1400px, calc(100vw - 48px)"
            />
            <source
              type="image/webp"
              srcSet="/screens/dashboard-1440.webp?v=2 1440w, /screens/dashboard-1916.webp?v=2 1916w"
              sizes="(min-width: 1448px) 1400px, calc(100vw - 48px)"
            />
            <img
              src="/screens/dashboard-1440.png?v=2"
              width={1916}
              height={941}
              alt="Panel de NexoFitness con el plan contratado, miembros activos y la operación del día"
              loading="eager"
              fetchPriority="high"
              decoding="async"
            />
          </picture>
        </figure>
      </div>
    </section>
  );
}
