import { useEffect, useRef } from 'react';

export default function MobileStickyBar() {
  const barRef = useRef<HTMLDivElement>(null);
  const lastY = useRef(0);

  useEffect(() => {
    const handler = () => {
      const y = window.scrollY;
      if (barRef.current) {
        barRef.current.style.transform =
          y > lastY.current && y > 200 ? 'translateY(110%)' : 'translateY(0)';
      }
      lastY.current = y;
    };
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, []);

  return (
    <div className="mobile-sticky-bar" ref={barRef} aria-hidden="true">
      <a className="btn btn-secondary" style={{ flex: 1 }} href="https://app.nexofitness.cl/login">Ingresar</a>
      <a className="btn btn-primary" style={{ flex: 2 }} href="https://app.nexofitness.cl/register">Prueba gratis</a>
    </div>
  );
}
