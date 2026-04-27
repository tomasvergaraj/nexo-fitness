import { useState, useEffect } from 'react';

interface NavProps {
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

export default function Nav({ theme, onToggleTheme }: NavProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  return (
    <>
      <header className="navbar" id="top">
        <div className="container navbar-inner">
          <a className="brand" href="#top" aria-label="Nexo Fitness — inicio">
            <div className="brand-icon">
              <img src="/icon.png" width="40" height="40" alt="Nexo" />
            </div>
            <span className="brand-name"><strong>Nexo</strong><span>Fitness</span></span>
          </a>

          <nav className="navbar-nav" aria-label="Principal">
            <a className="nav-link" href="#solucion">Solución</a>
            <a className="nav-link" href="#como-funciona">Cómo funciona</a>
            <a className="nav-link" href="#precios">Precios</a>
            <a className="nav-link" href="#testimonios">Testimonios</a>
            <a className="nav-link" href="#faq">FAQ</a>
          </nav>

          <div className="navbar-actions">
            <button className="theme-toggle" onClick={onToggleTheme} aria-label="Cambiar tema">
              <svg className="icon-moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
              <svg className="icon-sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            </button>
            <a className="btn btn-ghost btn-sm" href="https://app.nexofitness.cl/login">Ingresar</a>
            <a className="btn btn-primary btn-sm" href="https://app.nexofitness.cl/register">Crear cuenta</a>
            <button
              className={`hamburger${menuOpen ? ' open' : ''}`}
              onClick={() => setMenuOpen(v => !v)}
              aria-label="Menú"
              aria-expanded={menuOpen}
            >
              <span /><span /><span />
            </button>
          </div>
        </div>
      </header>

      <div className={`mobile-drawer${menuOpen ? ' open' : ''}`} aria-hidden={!menuOpen}>
        {(['solucion', 'como-funciona', 'precios', 'testimonios', 'faq'] as const).map((id) => (
          <a key={id} className="nav-link" href={`#${id}`} onClick={closeMenu}>
            {{ solucion: 'Solución', 'como-funciona': 'Cómo funciona', precios: 'Precios', testimonios: 'Testimonios', faq: 'FAQ' }[id]}
          </a>
        ))}
        <div className="mobile-ctas">
          <a className="btn btn-secondary btn-block" href="https://app.nexofitness.cl/login" onClick={closeMenu}>Ingresar</a>
          <a className="btn btn-primary btn-block" href="https://app.nexofitness.cl/register" onClick={closeMenu}>Crear cuenta gratis</a>
        </div>
      </div>
    </>
  );
}
