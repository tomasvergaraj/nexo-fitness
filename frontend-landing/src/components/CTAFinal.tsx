import ScrollReveal from '../animations/ScrollReveal';
import GlowButton from '../animations/GlowButton';

const ChevronIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="13 17 18 12 13 7" /><polyline points="6 17 11 12 6 7" />
  </svg>
);

export default function CTAFinal() {
  return (
    <section className="cta-final">
      <div className="container">
        <ScrollReveal>
          <div className="cta-card">
            <div className="cta-card-glow" aria-hidden />
            <span className="eyebrow"><span className="eyebrow-dot" />Listo para activar</span>
            <h2 className="cta-headline">Empieza hoy.<br /><span className="cta-headline-accent">Vende mañana.</span></h2>
            <p className="cta-sub">14 días gratis, sin tarjeta. Sin permanencia. Cancela cuando quieras.</p>
            <div className="cta-actions">
              <GlowButton href="https://app.nexofitness.cl/register" size="lg">
                <ChevronIcon />
                Activar prueba gratis
              </GlowButton>
            </div>
            <p className="cta-note">
              ¿Dudas? <a href="mailto:contacto@nexosoftware.cl">Escríbenos</a> o agenda una demo de 15 min.
            </p>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
