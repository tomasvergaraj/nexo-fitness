import ScrollReveal from '../animations/ScrollReveal';

const CartIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/>
  </svg>
);
const CalIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
);
const PhoneIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="2" width="14" height="20" rx="2.5"/><line x1="12" y1="18" x2="12" y2="18"/>
  </svg>
);
const ChartIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
  </svg>
);
const PinIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
  </svg>
);

/* ─── Card visuals ─────────────────────────────────────── */

const VentaVisual = () => (
  <div className="bento-venta">
    <div className="bento-venta-card">
      <div className="bento-venta-card-head">
        <div>
          <span className="bento-eyebrow-mini">Plan Trimestral · CrossFit Norte</span>
          <strong className="bento-venta-price">$94.990</strong>
        </div>
        <span className="hero-mockup-chip mock-chip-ok">Activo</span>
      </div>
      <div className="bento-venta-row"><span>Subtotal</span><span>$79.823</span></div>
      <div className="bento-venta-row"><span>IVA 19%</span><span>$15.167</span></div>
      <div className="bento-venta-row total"><span>Total</span><span>$94.990</span></div>
      <button className="bento-venta-cta">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
        Pagar con Webpay
      </button>
    </div>
    <div className="bento-venta-chips">
      <span className="bento-chip">Cupones</span>
      <span className="bento-chip">Links de pago</span>
      <span className="bento-chip">Checkout 24/7</span>
      <span className="bento-chip">Webpay</span>
    </div>
  </div>
);

const ClasesVisual = () => {
  const days = [
    { d: 'LUN', n: '4' }, { d: 'MAR', n: '5' }, { d: 'MIÉ', n: '6' },
    { d: 'JUE', n: '7' }, { d: 'VIE', n: '8' }, { d: 'SÁB', n: '9' }, { d: 'DOM', n: '10' },
  ];
  type Slot = { day: number; row: number; name: string; meta: string; color: 'violet' | 'pink' | 'amber' | 'orange' | 'cyan' };
  const slots: Slot[] = [
    { day: 0, row: 0, name: 'Pilates Reformer', meta: '07:00 · 9/10', color: 'pink' },
    { day: 1, row: 0, name: 'Yoga Flow', meta: '06:00 · 14/15', color: 'violet' },
    { day: 1, row: 1, name: 'Funcional', meta: '08:00 · 12/16', color: 'amber' },
    { day: 2, row: 0, name: 'Pilates Reformer', meta: '07:00 · 4/10', color: 'pink' },
    { day: 2, row: 1, name: 'HIIT', meta: '14:00 · LLENA', color: 'orange' },
    { day: 3, row: 0, name: 'Yoga Flow', meta: '06:00 · 13/15', color: 'violet' },
    { day: 3, row: 1, name: 'Spinning', meta: '14:00 · 10/12', color: 'cyan' },
    { day: 4, row: 0, name: 'Pilates Reformer', meta: '07:00 · 5/10', color: 'pink' },
    { day: 4, row: 1, name: 'Funcional', meta: '08:00 · 11/16', color: 'amber' },
    { day: 5, row: 0, name: 'Yoga Flow', meta: '06:00 · 12/15', color: 'violet' },
  ];
  return (
    <div className="bento-clases">
      <div className="bento-clases-toolbar">
        <span className="bento-clases-range">4 may – 10 may</span>
        <div className="bento-clases-nav">
          <span>‹</span><span className="active">Hoy</span><span>›</span>
        </div>
      </div>
      <div className="bento-clases-grid">
        {days.map((d, i) => (
          <div key={d.d} className="bento-clases-col">
            <div className="bento-clases-dayhead">
              <span className="bento-clases-day">{d.d}</span>
              <span className="bento-clases-num">{d.n}</span>
            </div>
            {[0, 1].map((row) => {
              const s = slots.find(x => x.day === i && x.row === row);
              return (
                <div key={row} className={`bento-clases-slot${s ? ` slot-${s.color}` : ' empty'}`}>
                  {s && <><strong>{s.name}</strong><span>{s.meta}</span></>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

const MiembroVisual = () => (
  <div className="bento-miembro">
    <div className="bento-phone">
      <div className="bento-phone-notch" />
      <div className="bento-phone-screen">
        <div className="bento-phone-topbar">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          <div className="bento-phone-brand">
            <span className="bento-phone-brand-icon">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l5-8 4 6 4-9 5 11"/></svg>
            </span>
            <div>
              <strong>Nexo Fitness</strong>
              <span>Agenda</span>
            </div>
          </div>
        </div>
        <div className="bento-phone-agenda">
          <strong>Tu agenda</strong>
          <div className="bento-phone-stats">
            <div><span>Clases visibles</span><strong>18</strong></div>
            <div><span>Tus reservas</span><strong className="ok">0</strong></div>
            <div><span>Con cupos</span><strong className="warn">17</strong></div>
          </div>
        </div>
        <div className="bento-phone-pills">
          <span className="active">Todas</span>
          <span>LUN</span><span>MAR</span><span className="dot">MIÉ</span><span>JUE</span><span>VIE</span>
        </div>
        <div className="bento-phone-cards">
          <div className="bento-phone-classcard">
            <div className="bento-phone-classcard-time">
              <strong>14:00</strong><span>p.m.</span>
            </div>
            <div className="bento-phone-classcard-info">
              <strong>HIIT</strong>
              <span>Providencia</span>
            </div>
            <span className="bento-phone-classchip">Libre</span>
          </div>
          <div className="bento-phone-classcard">
            <div className="bento-phone-classcard-time accent2">
              <strong>14:00</strong><span>p.m.</span>
            </div>
            <div className="bento-phone-classcard-info">
              <strong>Spinning</strong>
              <span>Ñuñoa</span>
            </div>
            <span className="bento-phone-classchip">Libre</span>
          </div>
        </div>
      </div>
    </div>
  </div>
);

const ReportesVisual = () => {
  const segments = [
    { color: 'var(--brand)', dash: '32 100', offset: 0, label: 'Anual' },
    { color: '#10b981', dash: '24 100', offset: -32, label: 'Trimestral' },
    { color: '#a78bfa', dash: '18 100', offset: -56, label: 'Mensual' },
    { color: '#f97316', dash: '14 100', offset: -74, label: 'Semestral' },
    { color: '#9ca3af', dash: '12 100', offset: -88, label: 'Solo Clases' },
  ];
  return (
    <div className="bento-reportes">
      <div className="bento-rep-row">
        <div className="bento-rep-card">
          <span className="bento-rep-label">Ingresos membresías</span>
          <strong className="bento-rep-num">$12.838.690</strong>
        </div>
        <div className="bento-rep-card">
          <span className="bento-rep-label">Renovación</span>
          <strong className="bento-rep-num up">+18 pts</strong>
        </div>
      </div>
      <div className="bento-rep-donut-card">
        <div className="bento-rep-donut">
          <svg viewBox="0 0 36 36" width="76" height="76">
            <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />
            {segments.map((s, i) => (
              <circle
                key={i}
                cx="18" cy="18" r="15.915"
                fill="transparent"
                stroke={s.color}
                strokeWidth="4"
                strokeDasharray={s.dash}
                strokeDashoffset={s.offset}
                transform="rotate(-90 18 18)"
              />
            ))}
          </svg>
          <div className="bento-rep-donut-center">
            <strong>Mix</strong>
            <span>actual</span>
          </div>
        </div>
        <div className="bento-rep-legend">
          {segments.map((s) => (
            <div key={s.label}>
              <span className="bento-rep-legend-dot" style={{ background: s.color }} />
              {s.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const SedesVisual = () => (
  <div className="bento-sedes">
    {[
      { name: 'Nexo Las Condes', n: '142 miembros', state: 'Activa', cls: 'ok' },
      { name: 'Nexo Providencia', n: '98 miembros', state: 'Activa', cls: 'ok' },
      { name: 'Nexo Ñuñoa', n: '64 miembros', state: 'Inactiva', cls: 'off' },
    ].map((s) => (
      <div key={s.name} className="bento-sedes-row">
        <span className="bento-sedes-pin">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
        </span>
        <div>
          <strong>{s.name}</strong>
          <span>{s.n}</span>
        </div>
        <span className={`bento-sedes-chip ${s.cls}`}>{s.state}</span>
      </div>
    ))}
  </div>
);

/* ─── Cards config ─────────────────────────────────────── */

const CARDS = [
  {
    key: 'venta',
    span: 'span-7',
    icon: <CartIcon />,
    chip: 'Venta y cobranza',
    title: 'Tu gimnasio vende cuando no estás.',
    body: 'Tienda online, links de pago y checkout integrado con Webpay. Cupones, planes y campañas conectadas al mismo panel.',
    visual: <VentaVisual />,
  },
  {
    key: 'clases',
    span: 'span-5',
    icon: <CalIcon />,
    chip: 'Clases y agenda',
    title: 'Calendario que se respeta solo.',
    body: 'Aforos, instructores y reservas en un calendario único. Lista de espera automática cuando se llena.',
    visual: <ClasesVisual />,
  },
  {
    key: 'miembro',
    span: 'span-5',
    icon: <PhoneIcon />,
    chip: 'App del miembro',
    title: 'Reservas, pagos y QR desde el celular.',
    body: 'El cliente resuelve todo solo. Sin llamadas al mesón, sin mensajes a las 11 PM.',
    visual: <MiembroVisual />,
  },
  {
    key: 'reportes',
    span: 'span-4',
    icon: <ChartIcon />,
    chip: 'Reportes',
    title: 'Decide con datos, no con intuición.',
    body: 'Ingresos, ocupación, planes top y vencimientos en un dashboard en vivo.',
    visual: <ReportesVisual />,
  },
  {
    key: 'sedes',
    span: 'span-3',
    icon: <PinIcon />,
    chip: 'Multi-sede',
    title: 'Hasta 10 sedes coordinadas.',
    body: 'Aforos, staff y reportes separados por sucursal en un mismo panel.',
    visual: <SedesVisual />,
  },
];

export default function Features() {
  return (
    <section className="section" id="features">
      <div className="container">
        <ScrollReveal className="section-heading section-heading-centered">
          <span className="eyebrow"><span className="eyebrow-dot" />Lo que ordena Nexo</span>
          <h2>Un stack pensado para vender mejor y operar sin fricción.</h2>
          <p>No es solo agenda. Es la capa comercial y operativa que conecta a tu equipo con el cliente en cada punto del recorrido.</p>
        </ScrollReveal>

        <div className="bento-grid">
          {CARDS.map((c, i) => (
            <ScrollReveal key={c.key} delay={i * 0.06} className={`bento-card-wrap ${c.span}`}>
              <article className="bento-card">
                <header className="bento-card-head">
                  <span className="bento-card-icon">{c.icon}</span>
                  <span className="bento-card-chip">{c.chip}</span>
                </header>
                <div className="bento-card-body">
                  <h3>{c.title}</h3>
                  <p>{c.body}</p>
                </div>
                <div className="bento-card-visual">{c.visual}</div>
                <div className="bento-card-glow" aria-hidden />
              </article>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
