import { motion } from 'framer-motion';
import Aurora from '../animations/Aurora';
import BlurText from '../animations/BlurText';
import GlowButton from '../animations/GlowButton';

const ChevronIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="13 17 18 12 13 7" /><polyline points="6 17 11 12 6 7" />
  </svg>
);


export default function Hero() {
  return (
    <section className="hero" id="hero">
      <Aurora />
      <div className="container hero-grid">
        <div className="hero-copy">
          <motion.div
            className="hero-eyebrow"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          >
            <span className="eyebrow">
              <span className="eyebrow-dot" />
              Plataforma para gimnasios y estudios fitness
            </span>
          </motion.div>

          <h1 className="hero-headline">
            <BlurText text="Más planes vendidos," delay={0.1} />
            <br />
            <motion.span
              className="brand-word"
              initial={{ opacity: 0, filter: 'blur(14px)', y: 10 }}
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
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.7, ease: 'easeOut' }}
          >
            Nexo Fitness unifica ventas, clases, check-in, pagos y comunicación con clientes en un solo sistema.
            Tu equipo trabaja más rápido — tus miembros resuelven todo desde el celular.
          </motion.p>

          <motion.div
            className="hero-actions"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.9, ease: 'easeOut' }}
          >
            <GlowButton href="https://app.nexofitness.cl/register" size="lg">
              <ChevronIcon />
              Activa tu prueba gratis
            </GlowButton>
            <a className="btn btn-secondary btn-lg" href="#precios">Ver planes</a>
          </motion.div>

          <motion.div
            className="hero-proof"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 1.05, ease: 'easeOut' }}
          >
            {[
              { stat: '1 panel', desc: 'Ventas, clases, check-in, pagos y reportes conectados.' },
              { stat: '24/7', desc: 'Tienda online y autoservicio activos siempre.' },
              { stat: '14 días', desc: 'Prueba gratis, sin tarjeta requerida.' },
            ].map(({ stat, desc }) => (
              <article key={stat} className="card proof-card">
                <strong>{stat}</strong>
                <span>{desc}</span>
              </article>
            ))}
          </motion.div>

          <motion.div
            className="hero-pillars"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 1.15, ease: 'easeOut' }}
          >
            {[
              { num: '01', title: 'Venta online que convierte', desc: 'Planes, cupones, checkout y enlaces para Instagram y WhatsApp.' },
              { num: '02', title: 'Clases y programas sin planillas', desc: 'Calendario, reservas, aforos y seguimiento desde un solo flujo.' },
              { num: '03', title: 'App clara para el miembro', desc: 'Reservas, pagos, QR de acceso y notificaciones desde el teléfono.' },
            ].map(({ num, title, desc }) => (
              <article key={num} className="card pillar-card">
                <span className="pillar-num">{num}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{desc}</p>
                </div>
              </article>
            ))}
          </motion.div>
        </div>

        {/* CTA panel */}
        <motion.aside
          className="hero-panel"
          initial={{ opacity: 0, x: 32 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.65, delay: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
        >
          <div className="panel-glow" />
          <div className="panel-content">
            <span className="chip chip-brand">Prueba gratis · 14 días · Sin tarjeta</span>
            <h2>Empieza hoy mismo.</h2>
            <p>Actívate en minutos y accede al sistema completo desde el primer día. Sin instalaciones, sin contratos.</p>

            <div className="panel-checklist" style={{ marginTop: '1.5rem' }}>
              <ul>
                {[
                  'Clientes, membresías y check-in QR listos al instante',
                  'Tienda online para vender planes 24/7',
                  'Clases presenciales, online e híbridas incluidas',
                  'Cobros integrados con Webpay (Transbank)',
                  'Hasta 3 sedes en el plan base',
                ].map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>

            <GlowButton
              href="https://app.nexofitness.cl/register"
              className="btn-block"
              style={{ marginTop: '1.5rem' }}
            >
              <ChevronIcon />
              Crear cuenta gratis
            </GlowButton>
            <p style={{ textAlign: 'center', fontSize: '.82rem', color: 'var(--muted)', marginTop: '.75rem' }}>
              Sin tarjeta de crédito. Sin permanencia. Cancela cuando quieras.
            </p>
          </div>
        </motion.aside>
      </div>
    </section>
  );
}
