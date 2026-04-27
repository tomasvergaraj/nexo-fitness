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
            <span className="eyebrow"><span className="eyebrow-dot" />Listo para activar</span>
            <h2 className="cta-headline">Tu gimnasio merece operar como un negocio moderno.</h2>
            <p className="cta-sub">Activa tu cuenta, configura tu gimnasio en minutos y empieza a vender desde el día 1. Sin tarjeta, sin permanencia.</p>
            <div className="cta-actions">
              <GlowButton href="https://app.nexofitness.cl/register" size="lg">
                <ChevronIcon />
                Activa gratis por 14 días
              </GlowButton>
              <a className="btn btn-secondary btn-lg" href="mailto:contacto@nexosoftware.cl">Contactar</a>
            </div>
            <p className="cta-note">Sin tarjeta · Sin permanencia · Soporte desde el día 1</p>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
