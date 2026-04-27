import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ScrollReveal from '../animations/ScrollReveal';

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const TABS = [
  {
    key: 'venta',
    label: 'Venta y cobranza',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>,
    chip: 'Venta y cobranza',
    heading: 'Convierte interés en membresías activas.',
    body: 'Landing, tienda online, links de pago, checkout público y cupones conectados al mismo panel. Tu gimnasio vende aunque no esté el equipo presente.',
    features: [
      { title: 'Planes visibles y actualizados', desc: 'Publica precios desde el panel — el checkout se actualiza automáticamente.' },
      { title: 'Checkout online integrado', desc: 'Medios de pago conectados vía Webpay con flujo de pago seguro y trazable.' },
      { title: 'Cupones y promociones', desc: 'Crea descuentos para campañas de Instagram, referidos o temporada.' },
      { title: 'Links de pago directos', desc: 'Genera un link para un plan específico y compártelo donde quieras.' },
    ],
    mockUrl: 'app.nexofitness.cl / ventas',
    mockContent: (
      <div>
        <div className="mock-stat-row">
          <div className="mock-stat"><div className="mock-stat-num">$842K</div><div className="mock-stat-label">Este mes</div></div>
          <div className="mock-stat"><div className="mock-stat-num">34</div><div className="mock-stat-label">Ventas hoy</div></div>
          <div className="mock-stat"><div className="mock-stat-num">92%</div><div className="mock-stat-label">Renovación</div></div>
        </div>
        {[['w70','w40','Pagado','chip-brand'],['w55','w40','Pagado','chip-brand'],['w80','w40','Pendiente','chip-accent']].map(([w1,w2,label,chip],i) => (
          <div key={i} className="mock-row" style={{ marginTop: '.5rem' }}>
            <div className="mock-avatar" />
            <div style={{ flex:1, display:'grid', gap:'6px' }}>
              <div className={`mock-bar ${w1}`} /><div className={`mock-bar ${w2}`} />
            </div>
            <span className={`chip ${chip}`} style={{ fontSize:'.72rem' }}>{label}</span>
          </div>
        ))}
        <div style={{ marginTop:'.5rem' }}><div className="mock-bar brand" style={{ height:'6px', borderRadius:'999px' }} /></div>
      </div>
    ),
  },
  {
    key: 'clases',
    label: 'Agenda y clases',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
    chip: 'Agenda y clases',
    heading: 'Programa tu operación sin desordenar al staff.',
    body: 'Gestiona aforos, sucursales, instructores, programas y reservas desde un calendario coherente. Sin grupos de WhatsApp, sin planillas paralelas.',
    features: [
      { title: 'Calendario unificado', desc: 'Clases presenciales, online o híbridas con instructor asignado y aforo definido.' },
      { title: 'Reservas + lista de espera', desc: 'Los miembros reservan desde la app. Si la clase se llena, entran a lista de espera automática.' },
      { title: 'Programas con seguimiento', desc: 'Crea programas estructurados con clases asignadas y rastrea el progreso del alumno.' },
      { title: 'Multi-sede coordinada', desc: 'Clases en distintas ubicaciones con aforos y staff separados por sede.' },
    ],
    mockUrl: 'app.nexofitness.cl / clases',
    mockContent: (
      <div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:'4px', marginBottom:'.5rem' }}>
          {['L','M','X','J','V','S','D'].map(d => <div key={d} style={{ textAlign:'center', fontSize:'.72rem', color:'var(--muted)', fontWeight:700 }}>{d}</div>)}
        </div>
        <div style={{ display:'grid', gap:'6px' }}>
          {[['CrossFit 7:00','18/20','var(--brand)'],['Yoga 9:00','8/15','var(--success)'],['HIIT 18:30','20/20','var(--accent)'],['Pilates 20:00','11/12','var(--brand)']].map(([name,cap,color]) => (
            <div key={name} style={{ padding:'.6rem .75rem', borderRadius:'10px', background:'var(--surface)', border:'1px solid var(--surface-border)', display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:'.82rem' }}>
              <span style={{ fontWeight:700 }}>{name}</span>
              <span style={{ color, fontWeight:700 }}>{cap}</span>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    key: 'miembro',
    label: 'App del miembro',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
    chip: 'App del miembro',
    heading: 'Haz que el cliente resuelva todo sin depender del mesón.',
    body: 'La app del miembro concentra reservas, pagos, QR de acceso, programas y notificaciones. Sin llamadas, sin mensajes al staff.',
    features: [
      { title: 'Check-in con QR', desc: 'El miembro abre la app y escanea en la entrada. Sin tarjetas, sin papeles.' },
      { title: 'Pagos y wallet', desc: 'Renueva planes, paga cuotas y descarga comprobantes desde el celular.' },
      { title: 'Reservas en 2 taps', desc: 'Ve el calendario, reserva la clase y recibe confirmación inmediata.' },
      { title: 'Notificaciones y recordatorios', desc: 'Recordatorio de clase, vencimiento de plan y novedades del gimnasio.' },
    ],
    mockUrl: 'Mi membresía',
    mockContent: (
      <div>
        <div style={{ textAlign:'center', padding:'1rem', background:'var(--brand-ghost)', borderRadius:'16px', border:'1px solid var(--surface-border)', marginBottom:'.75rem' }}>
          <div style={{ fontSize:'.75rem', color:'var(--muted)', fontWeight:700, letterSpacing:'.08em', textTransform:'uppercase' }}>QR Check-in</div>
          <div style={{ width:'72px', height:'72px', margin:'.6rem auto', background:'linear-gradient(135deg,var(--brand-ghost),var(--surface-border))', borderRadius:'10px', display:'grid', placeItems:'center' }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity=".6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
              <rect x="14" y="14" width="3" height="3"/><rect x="18" y="14" width="3" height="3"/><rect x="14" y="18" width="3" height="3"/><rect x="18" y="18" width="3" height="3"/>
            </svg>
          </div>
          <div style={{ fontSize:'.8rem', color:'var(--brand)', fontWeight:700 }}>Plan Mensual · Activo</div>
        </div>
        <div style={{ display:'grid', gap:'6px' }}>
          {[['CrossFit mañana 7:00','Reservado','var(--brand)'],['Vence en 8 días','Renovar','var(--accent)']].map(([l,r,c]) => (
            <div key={l} style={{ padding:'.55rem .75rem', borderRadius:'10px', background:'var(--surface)', border:'1px solid var(--surface-border)', display:'flex', justifyContent:'space-between', fontSize:'.8rem' }}>
              <span>{l}</span><span style={{ color:c, fontWeight:700 }}>{r}</span>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    key: 'gestion',
    label: 'Gestión y reportes',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
    chip: 'Gestión y reportes',
    heading: 'Decide con datos, no con intuición.',
    body: 'Revisa ingresos, asistencia, ocupación, campañas y tareas críticas desde el mismo lugar. Visibilidad completa, sin exportar a Excel.',
    features: [
      { title: 'Reportes operativos y comerciales', desc: 'Ingresos, ocupación de clases, planes más vendidos y tendencias.' },
      { title: 'Control de inventario y gastos', desc: 'Registra productos, equipamiento y gastos operativos en el mismo panel.' },
      { title: 'Permisos por rol', desc: 'Define qué puede ver y hacer cada miembro del equipo: admin, instructor, recepción.' },
      { title: 'Dashboard en tiempo real', desc: 'Ingreso del día, clases activas y miembros venciendo, todo en la pantalla de inicio.' },
    ],
    mockUrl: 'app.nexofitness.cl / dashboard',
    mockContent: (
      <div>
        <div className="mock-stat-row">
          <div className="mock-stat"><div className="mock-stat-num" style={{ color:'var(--success)' }}>+18%</div><div className="mock-stat-label">Ingresos vs mes anterior</div></div>
          <div className="mock-stat"><div className="mock-stat-num">247</div><div className="mock-stat-label">Miembros activos</div></div>
          <div className="mock-stat"><div className="mock-stat-num" style={{ color:'var(--accent)' }}>12</div><div className="mock-stat-label">Vencen esta semana</div></div>
        </div>
        <div style={{ display:'grid', gap:'5px', marginTop:'.25rem' }}>
          {[['Clases hoy','6 / 6','var(--text)'],['Ocupación promedio','84%','var(--brand)'],['Plan más vendido','Trimestral','var(--text)']].map(([l,v,c]) => (
            <div key={l} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:'.82rem', padding:'.4rem 0', borderBottom:'1px solid var(--surface-border)' }}>
              <span style={{ color:'var(--muted)' }}>{l}</span><strong style={{ color:c }}>{v}</strong>
            </div>
          ))}
        </div>
        <div style={{ marginTop:'.5rem' }}><div className="mock-bar brand" style={{ height:'6px' }} /></div>
      </div>
    ),
  },
];

export default function Features() {
  const [active, setActive] = useState('venta');
  const tab = TABS.find(t => t.key === active)!;

  return (
    <section className="section" id="features">
      <div className="container">
        <ScrollReveal className="section-heading">
          <span className="eyebrow"><span className="eyebrow-dot" />Lo que ordena Nexo</span>
          <h2>Un stack pensado para vender mejor y operar sin fricción.</h2>
          <p>No es solo un sistema de agenda. Es la capa comercial y operativa que conecta a tu equipo con el cliente en cada punto del recorrido.</p>
        </ScrollReveal>

        <ScrollReveal className="tabs-nav" delay={0.1}>
          {TABS.map(t => (
            <button
              key={t.key}
              className={`tab-btn${active === t.key ? ' active' : ''}`}
              onClick={() => setActive(t.key)}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </ScrollReveal>

        <div className="tab-panels">
          <AnimatePresence mode="wait">
            <motion.div
              key={active}
              className="tab-panel active"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.32, ease: 'easeOut' }}
            >
              <div className="tab-content">
                <span className="chip chip-brand">{tab.chip}</span>
                <h3>{tab.heading}</h3>
                <p>{tab.body}</p>
                <div className="feature-list">
                  {tab.features.map(({ title, desc }) => (
                    <div key={title} className="feature-list-item">
                      <span className="fi-icon"><CheckIcon /></span>
                      <div><strong>{title}</strong><p>{desc}</p></div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="tab-visual card">
                <div className="tab-visual-chrome">
                  <span className="chrome-dot" /><span className="chrome-dot" /><span className="chrome-dot" />
                  <span className="chrome-url">{tab.mockUrl}</span>
                </div>
                <div className="tab-visual-body">{tab.mockContent}</div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
