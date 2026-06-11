import ScrollReveal from '../animations/ScrollReveal';

// Beneficios con UI real del producto (capturas del tenant demo).
// Solo claims verificados: Webpay/Transbank, hasta 3 sucursales, CSV,
// reservas/check-in/reportes son módulos reales del sistema.
interface Feature {
  key: string;
  title: string;
  text: string;
  detail: string;
  img: string;
  width: number;
  height: number;
  alt: string;
}

const FEATURES: Feature[] = [
  {
    key: 'venta',
    title: 'Vende planes aunque el mesón esté cerrado',
    text: 'Tu tienda online publica precios y cobra con Webpay (Transbank). El socio compra desde el celular y su plan queda activo al instante.',
    detail: 'Tienda pública de Studio Alto Norte, el gimnasio demo.',
    img: 'feat-venta',
    width: 1600,
    height: 800,
    alt: 'Tienda online del gimnasio con tres planes y sus precios listos para comprar',
  },
  {
    key: 'socios',
    title: 'Gestiona a tus socios sin planillas',
    text: 'Estados, vencimientos y riesgo de fuga a la vista, con filtros por plan y sede. Exporta todo a CSV cuando lo necesites.',
    detail: 'Listado real de clientes con estados y acciones.',
    img: 'feat-socios',
    width: 1600,
    height: 800,
    alt: 'Listado de socios con estado activo, riesgo y botones de gestión',
  },
  {
    key: 'clases',
    title: 'Llena tus clases sin cadenas de WhatsApp',
    text: 'Agenda semanal con cupos e instructores por sede. Tus socios reservan solos desde la app y tú ves la ocupación en vivo.',
    detail: 'Calendario semanal con la ocupación de cada bloque.',
    img: 'feat-clases',
    width: 1600,
    height: 600,
    alt: 'Calendario semanal de clases con bloques de funcional, spinning, yoga y HIIT',
  },
  {
    key: 'checkin',
    title: 'Check-in en segundos, no en filas',
    text: 'QR o búsqueda por nombre en recepción. Cada ingreso queda registrado con fecha, sede y operador.',
    detail: 'Pantalla de recepción con el historial del día.',
    img: 'feat-checkin',
    width: 1600,
    height: 800,
    alt: 'Pantalla de check-in con búsqueda de socios e historial de ingresos por QR',
  },
  {
    key: 'reportes',
    title: 'Decide con números, no con intuición',
    text: 'Ingresos, renovación y asistencia en tiempo real, hasta en 3 sucursales. Exporta los reportes y trabaja los datos donde quieras.',
    detail: 'Reportes de membresías con exportación a CSV.',
    img: 'feat-reportes',
    width: 1600,
    height: 800,
    alt: 'Reporte de ingresos de membresías con gráfico de evolución y botón exportar',
  },
];

function FeatureVisual({ f }: { f: Feature }) {
  return (
    <figure className="feature-shot">
      <picture>
        <source
          type="image/avif"
          srcSet={`/screens/${f.img}-800.avif 800w, /screens/${f.img}-1600.avif 1600w`}
          sizes="(min-width: 980px) 640px, calc(100vw - 48px)"
        />
        <source
          type="image/webp"
          srcSet={`/screens/${f.img}-800.webp 800w, /screens/${f.img}-1600.webp 1600w`}
          sizes="(min-width: 980px) 640px, calc(100vw - 48px)"
        />
        <img
          src={`/screens/${f.img}-800.png`}
          width={f.width}
          height={f.height}
          alt={f.alt}
          loading="lazy"
          decoding="async"
        />
      </picture>
      <figcaption>{f.detail}</figcaption>
    </figure>
  );
}

export default function Features() {
  return (
    <section className="section" id="features">
      <div className="container">
        <div className="section-heading">
          <h2>Hecho para el día a día del gimnasio.</h2>
          <p>Lo que ves abajo no son maquetas: es el sistema funcionando con un gimnasio de demostración.</p>
        </div>

        <div className="feature-rows">
          {FEATURES.map((f, i) => (
            <ScrollReveal key={f.key}>
              <article className={`feature-row${i % 2 ? ' feature-row-flip' : ''}`}>
                <div className="feature-copy">
                  <h3>{f.title}</h3>
                  <p>{f.text}</p>
                </div>
                <FeatureVisual f={f} />
              </article>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
