// Franja de confianza: SOLO claims verificados (CLAUDE.md). Sin contadores,
// estrellas ni testimonios hasta tener material real con permiso.
const CLAIMS = [
  '14 días de prueba sin tarjeta',
  'Cancela cuando quieras',
  'Soporte por WhatsApp, email e in-app',
  'Exporta tus datos a CSV',
];

export default function TrustStrip() {
  return (
    <section className="trust-strip" aria-label="Garantías y medios de pago">
      <div className="container trust-strip-inner">
        <div className="trust-strip-payments">
          <span className="trust-strip-label">Pagos procesados con</span>
          <span className="trust-strip-brand">
            Webpay<em>Transbank</em>
          </span>
          <span className="trust-strip-brand">TUU</span>
        </div>
        <ul className="trust-strip-claims">
          {CLAIMS.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
