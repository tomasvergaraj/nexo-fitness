import { motion } from 'framer-motion';

const NavIcon = ({ d }: { d: string }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const SECTION_OPERATION = [
  { label: 'Panel', d: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z', active: true, dot: true },
  { label: 'Clases', d: 'M3 4h18v16H3zM3 10h18M8 3v3M16 3v3' },
  { label: 'Clientes', d: 'M17 21v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2M5 7a4 4 0 108 0 4 4 0 00-8 0' },
  { label: 'Check-in', d: 'M22 11.08V12a10 10 0 11-5.93-9.14M22 4L12 14.01l-3-3' },
  { label: 'Programas', d: 'M9 11H5a2 2 0 00-2 2v7h6v-9zM21 4h-4a2 2 0 00-2 2v14h6V6a2 2 0 00-2-2zM9 11V4a2 2 0 012-2h2a2 2 0 012 2v7' },
  { label: 'Soporte', d: 'M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z' },
];

const STATS_TOP = [
  { label: 'Ingresos del Día', value: '$342.500', icon: 'M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6', tint: 'cyan' },
  { label: 'Miembros Activos', value: '247', icon: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 7a4 4 0 11-8 0 4 4 0 018 0zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75', tint: 'green' },
  { label: 'Clases Hoy', value: '14', sub: '/ 16 totales', icon: 'M3 4h18v16H3zM3 10h18M8 3v3M16 3v3', tint: 'violet' },
  { label: 'Check-ins Hoy', value: '89', icon: 'M22 11.08V12a10 10 0 11-5.93-9.14M22 4L12 14.01l-3-3', tint: 'cyan' },
];

const STATS_BOTTOM = [
  { label: 'Reservas Hoy', value: '64', icon: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8', tint: 'amber' },
  { label: 'Pagos Pendientes', value: '3', icon: 'M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01', tint: 'red' },
  { label: 'Miembros por vencer', value: '12', icon: 'M22 12h-4l-3 9L9 3l-3 9H2', tint: 'green' },
];

const SPARK = [38, 42, 36, 48, 44, 56, 52, 60, 58, 68, 64, 76, 72, 80];

export default function HeroMockup() {
  return (
    <div className="hero-mockup">
      <div className="hero-mockup-glow" aria-hidden />
      <div className="hero-mockup-frame">
        {/* App layout: sidebar + main */}
        <div className="hm2-app">
          {/* Sidebar */}
          <aside className="hm2-sidebar">
            <div className="hm2-brand">
              <div className="hm2-brand-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 17l5-8 4 6 4-9 5 11" />
                </svg>
              </div>
              <div className="hm2-brand-text">
                <strong><span>Nexo</span><em>Fitness</em></strong>
                <span>IMPULSA TU NEGOCIO FITNESS</span>
              </div>
            </div>

            <div className="hm2-nav-section">
              <button className="hm2-nav-item hm2-nav-flat">
                <NavIcon d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" />
                <span>Panel</span>
                <span className="hm2-nav-dot" />
              </button>

              <span className="hm2-nav-label">OPERACIÓN <span className="hm2-nav-caret">⌄</span></span>
              {SECTION_OPERATION.slice(1).map((it) => (
                <button key={it.label} className="hm2-nav-item">
                  <NavIcon d={it.d} />
                  <span>{it.label}</span>
                </button>
              ))}

              <span className="hm2-nav-label">COMERCIAL <span className="hm2-nav-caret">›</span></span>
              <span className="hm2-nav-label">FINANZAS <span className="hm2-nav-caret">›</span></span>

              <button className="hm2-nav-item">
                <NavIcon d="M12 1l3 3 3-1 1 3 3 1-1 3 3 3-3 3 1 3-3 1-1 3-3-1-3 3-3-3-3 1-1-3-3-1 1-3-3-3 3-3-1-3 3-1 1-3 3 1z" />
                <span>Configuración</span>
              </button>
            </div>

            <div className="hm2-sub-block">
              <button className="hm2-nav-item small">
                <NavIcon d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
                <span>Mi Suscripción</span>
              </button>
              <button className="hm2-nav-item small hm2-nav-feedback">
                <NavIcon d="M9 18h6M10 22h4M12 2a7 7 0 00-4 12.7c.7.5 1 1.3 1 2.1V18h6v-1.2c0-.8.3-1.6 1-2.1A7 7 0 0012 2z" />
                <span>Feedback</span>
              </button>
              <div className="hm2-user">
                <span className="hm2-user-avatar">TV</span>
                <div>
                  <strong>Tomás Vergara</strong>
                  <span>Owner</span>
                </div>
              </div>
            </div>
          </aside>

          {/* Main area */}
          <main className="hm2-main">
            <header className="hm2-topbar">
              <span className="hm2-search">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              </span>
              <div className="hm2-topbar-spacer" />
              <button className="hm2-pill-soft">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                Instalar app
              </button>
              <button className="hm2-icon-btn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
              </button>
              <button className="hm2-icon-btn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"/></svg>
                <span className="hm2-bell-dot" />
              </button>
              <div className="hm2-user-pill">
                <span>TV</span>
                Tomás
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              </div>
            </header>

            <div className="hm2-content">
              <div className="hm2-page-head">
                <div>
                  <h4>Dashboard</h4>
                  <span>Resumen operativo del negocio</span>
                </div>
                <div className="hm2-page-actions">
                  <button className="hm2-btn-ghost">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/></svg>
                    Ver clases
                  </button>
                  <button className="hm2-btn-primary">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17l9.2-9.2M17 17V7H7"/></svg>
                    Ver reportes
                  </button>
                </div>
              </div>

              <div className="hm2-stats-grid hm2-stats-top">
                {STATS_TOP.map((s, i) => (
                  <motion.div
                    key={s.label}
                    className="hm2-stat-card"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.6 + i * 0.06, duration: 0.45, ease: 'easeOut' }}
                  >
                    <div className="hm2-stat-info">
                      <span className="hm2-stat-label">{s.label}</span>
                      <strong className="hm2-stat-value">{s.value}{s.sub && <em>{s.sub}</em>}</strong>
                    </div>
                    <span className={`hm2-stat-icon tint-${s.tint}`}>
                      <NavIcon d={s.icon} />
                    </span>
                  </motion.div>
                ))}
              </div>

              <div className="hm2-stats-grid hm2-stats-bot">
                {STATS_BOTTOM.map((s, i) => (
                  <motion.div
                    key={s.label}
                    className="hm2-stat-card"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.85 + i * 0.06, duration: 0.45, ease: 'easeOut' }}
                  >
                    <div className="hm2-stat-info">
                      <span className="hm2-stat-label">{s.label}</span>
                      <strong className="hm2-stat-value">{s.value}</strong>
                    </div>
                    <span className={`hm2-stat-icon tint-${s.tint}`}>
                      <NavIcon d={s.icon} />
                    </span>
                  </motion.div>
                ))}
              </div>

              <div className="hm2-bottom-grid">
                <div className="hm2-card hm2-chart-card">
                  <div className="hm2-card-head">
                    <strong>Ingresos comparados</strong>
                    <span>Hoy, semana y mes</span>
                  </div>
                  <strong className="hm2-chart-amount">$4.842.300</strong>
                  <div className="hm2-chart-bars">
                    {SPARK.map((h, i) => (
                      <motion.span
                        key={i}
                        initial={{ scaleY: 0 }}
                        animate={{ scaleY: 1 }}
                        transition={{ delay: 1 + i * 0.04, duration: 0.5, ease: 'easeOut' }}
                        style={{ height: `${h}%` }}
                      />
                    ))}
                  </div>
                </div>

                <div className="hm2-card hm2-op-card">
                  <div className="hm2-card-head">
                    <strong>Operación del día</strong>
                  </div>
                  <div className="hm2-op-row"><span>Yoga Flow · 07:00</span><strong>14/15</strong></div>
                  <div className="hm2-op-row"><span>HIIT · 18:30</span><strong>20/20</strong></div>
                  <div className="hm2-op-row"><span>Spinning · 20:00</span><strong>11/12</strong></div>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>

      <motion.div
        className="hero-mockup-toast"
        initial={{ opacity: 0, y: 12, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: 1.6, duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
      >
        <div className="hero-mockup-toast-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <div>
          <strong>Pago confirmado</strong>
          <span>Plan Trimestral · $94.990</span>
        </div>
      </motion.div>
    </div>
  );
}
