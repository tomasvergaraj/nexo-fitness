import { motion } from 'framer-motion';
import BlurText from '../animations/BlurText';
import Button from './Button';
import HeroMockup from './HeroMockup';

const ChevronIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="13 17 18 12 13 7" /><polyline points="6 17 11 12 6 7" />
  </svg>
);

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export default function Hero() {
  return (
    <section className="hero" id="hero">
      <div className="container hero-grid">
        <div className="hero-copy">
          <motion.div
            className="hero-eyebrow"
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          >
            <span className="eyebrow">
              <span className="eyebrow-dot" />
              Sistema de gestión para gimnasios y estudios
            </span>
          </motion.div>

          <h1 className="hero-headline">
            <BlurText text="Más planes vendidos," delay={0.1} />
            <br />
            <motion.span
              className="brand-word"
              initial={false}
              animate={{ opacity: 1, filter: 'blur(0px)', y: 0 }}
              transition={{ duration: 0.55, delay: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
              style={{ display: 'block' }}
            >
              menos caos
            </motion.span>
            <BlurText text="operativo." delay={0.5} />
          </h1>

          <motion.p
            className="hero-lead"
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.7, ease: 'easeOut' }}
          >
            Nexo Fitness centraliza ventas, clases, check-in y pagos en un solo panel.
            Tu equipo trabaja más rápido. Tus miembros resuelven todo desde el celular.
          </motion.p>

          <motion.div
            className="hero-actions"
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.9, ease: 'easeOut' }}
          >
            <Button href="https://app.nexofitness.cl/register" size="lg">
              <ChevronIcon />
              Activa tu prueba gratis
            </Button>
            <a className="btn btn-secondary btn-lg" href="#precios">Ver planes</a>
          </motion.div>

          <motion.ul
            className="hero-trust-mini"
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 1.05, ease: 'easeOut' }}
          >
            <li><CheckIcon /> 14 días gratis</li>
            <li><CheckIcon /> Sin tarjeta</li>
            <li><CheckIcon /> Cancela cuando quieras</li>
          </motion.ul>
        </div>

        <motion.div
          className="hero-mockup-wrap"
          initial={false}
          animate={{ opacity: 1, x: 0, rotateY: 0 }}
          transition={{ duration: 0.75, delay: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
        >
          <HeroMockup />
        </motion.div>
      </div>
    </section>
  );
}
