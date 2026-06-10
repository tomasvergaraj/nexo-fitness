import { useState, useEffect, useRef } from 'react';

export default function Nav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    // inert evita foco y lectura dentro del drawer cerrado (React 18 no tipa la prop)
    if (drawerRef.current) drawerRef.current.inert = !menuOpen;
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  return (
    <>
      <header className="navbar" id="top">
        <div className="container navbar-inner">
          <a className="brand" href="#top">
            <div className="brand-icon">
              <img src="/logo-80.png" width="40" height="40" alt="" />
            </div>
            <span className="brand-name"><strong>Nexo</strong><span>Fitness</span></span>
          </a>

          <nav className="navbar-nav" aria-label="Principal">
            <a className="nav-link" href="#solucion">Solución</a>
            <a className="nav-link" href="#como-funciona">Cómo funciona</a>
            <a className="nav-link" href="#precios">Precios</a>
            <a className="nav-link" href="#faq">FAQ</a>
          </nav>

          <div className="navbar-actions">
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

      <div className={`mobile-drawer${menuOpen ? ' open' : ''}`} ref={drawerRef} aria-hidden={!menuOpen}>
        {(['solucion', 'como-funciona', 'precios', 'faq'] as const).map((id) => (
          <a key={id} className="nav-link" href={`#${id}`} onClick={closeMenu}>
            {{ solucion: 'Solución', 'como-funciona': 'Cómo funciona', precios: 'Precios', faq: 'FAQ' }[id]}
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
