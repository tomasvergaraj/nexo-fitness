import { useEffect, useRef } from 'react';
import Button from './Button';
import HeroCanvas from './HeroCanvas';

const ChevronIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

export default function Hero() {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Respect prefers-reduced-motion: leave the video paused on its poster frame.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      if (mq.matches) {
        video.pause();
        video.currentTime = 0;
      } else {
        video.play().catch(() => {});
      }
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  return (
    <section className="hero" id="hero">
      <HeroCanvas />
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
          {/* Demo en loop del panel (dashboard, clientes, clases, punto de venta).
              El poster mantiene el LCP; el video se reproduce muteado al cargar. */}
          <video
            ref={videoRef}
            className="hero-video"
            poster="/hero/hero-demo-poster.jpg?v=2"
            width={1920}
            height={1080}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            aria-label="Demostración del panel de NexoFitness: dashboard, clientes, clases y punto de venta"
          >
            <source src="/hero/hero-demo.mp4?v=2" type="video/mp4" />
            {/* Fallback para navegadores sin soporte de video */}
            <img
              src="/screens/dashboard-1440.png?v=3"
              width={1916}
              height={943}
              alt="Panel de NexoFitness con los ingresos, clases, check-ins y reservas del día"
            />
          </video>
        </figure>
      </div>
    </section>
  );
}
