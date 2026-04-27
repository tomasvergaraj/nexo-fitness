import ScrollReveal from '../animations/ScrollReveal';

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const ITEMS = [
  'Sin contrato de permanencia',
  '14 días gratis sin tarjeta',
  'Soporte incluido desde el día 1',
  'Multi-sede y multi-rol',
  'Pagos integrados con Webpay',
];

export default function TrustBar() {
  return (
    <div className="trust-bar">
      <div className="container trust-grid">
        {ITEMS.map((item) => (
          <ScrollReveal key={item} className="trust-item">
            <CheckIcon />
            {item}
          </ScrollReveal>
        ))}
      </div>
    </div>
  );
}
