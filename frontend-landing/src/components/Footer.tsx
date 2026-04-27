export default function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <a className="brand" href="#top">
          <div className="brand-icon">
            <img src="/icon.png" width="32" height="32" alt="Nexo" />
          </div>
          <span className="brand-name" style={{ fontSize: '1rem' }}><strong>Nexo</strong><span>Fitness</span></span>
        </a>

        <nav className="footer-links" aria-label="Footer">
          <a href="#solucion">Solución</a>
          <a href="#precios">Precios</a>
          <a href="#faq">FAQ</a>
          <a href="https://app.nexofitness.cl/login">Ingresar</a>
          <a href="https://app.nexofitness.cl/register">Registrarse</a>
        </nav>

        <p className="footer-copy">
          © 2026 Nexo Fitness · Hecho en Chile 🇨🇱 · Desarrollado por{' '}
          <a href="https://nexosoftware.cl" target="_blank" rel="noreferrer">Nexo Software SpA</a>
        </p>
      </div>
    </footer>
  );
}
