import { forwardRef } from 'react';
import QRCode from 'react-qr-code';

const NEXO_LOGO_URL = '/logo.png';

export const CARD_WIDTH_PX = 327;
export const CARD_HEIGHT_PX = 207;

const QR_SIZE = 124;
const QR_PAD = 6;
const HPAD = 14;
const GAP = 12;
const QR_TOTAL = QR_SIZE + QR_PAD * 2; // 136px
const LEFT_W = CARD_WIDTH_PX - HPAD * 2 - GAP - QR_TOTAL; // ~151px

type Props = {
  clientName: string;
  qrValue: string;
  gymName: string;
  logoUrl?: string | null;
  primaryColor: string;
  secondaryColor: string;
};

const MembershipCard = forwardRef<HTMLDivElement, Props>(function MembershipCard(
  { clientName, qrValue, gymName, logoUrl, primaryColor, secondaryColor },
  ref,
) {
  const logo = logoUrl || NEXO_LOGO_URL;

  return (
    <div
      ref={ref}
      style={{
        width: CARD_WIDTH_PX,
        height: CARD_HEIGHT_PX,
        backgroundImage: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`,
        backgroundColor: primaryColor,
        borderRadius: 12,
        overflow: 'hidden',   // único overflow:hidden — en la raíz de la tarjeta
        position: 'relative',
        fontFamily: 'Arial, Helvetica, sans-serif',
        boxSizing: 'border-box',
      }}
    >
      {/* Círculos decorativos */}
      <div style={{ position: 'absolute', top: -30, right: -30, width: 120, height: 120, borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.08)' }} />
      <div style={{ position: 'absolute', bottom: -20, left: -20, width: 80,  height: 80,  borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.06)' }} />

      {/* ── Columna izquierda ── */}
      <div style={{ position: 'absolute', top: HPAD, left: HPAD, width: LEFT_W }}>

        {/* Logo + nombre del gym */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <img
            src={logo}
            alt=""
            width={26}
            height={26}
            style={{ objectFit: 'contain', borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.15)', flexShrink: 0 }}
            crossOrigin="anonymous"
          />
          {/* Sin overflow/maxHeight — el card raíz lo clipa si desborda */}
          <div style={{ color: '#fff', fontSize: 9, fontWeight: 700, lineHeight: 1.3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {gymName}
          </div>
        </div>

        {/* Divisor */}
        <div style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.3)', marginTop: 10, marginBottom: 12 }} />

        {/* Etiqueta */}
        <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 7, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', lineHeight: 1.4, marginBottom: 6 }}>
          Tarjeta de acceso
        </div>

        {/* Nombre del socio — sin overflow/maxHeight */}
        <div style={{ color: '#fff', fontSize: 14, fontWeight: 700, lineHeight: 1.3, whiteSpace: 'nowrap' }}>
          {clientName}
        </div>
      </div>

      {/* Badge inferior izquierdo */}
      <div style={{ position: 'absolute', bottom: HPAD, left: HPAD, color: 'rgba(255,255,255,0.45)', fontSize: 7, lineHeight: 1 }}>
        powered by NexoFitness
      </div>

      {/* ── Columna QR (centrado verticalmente) ── */}
      <div style={{
        position: 'absolute',
        top: HPAD,
        right: HPAD,
        bottom: HPAD,
        width: QR_TOTAL,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div style={{ backgroundColor: '#fff', borderRadius: 8, padding: QR_PAD, lineHeight: 0 }}>
          <QRCode value={qrValue} size={QR_SIZE} bgColor="#ffffff" fgColor="#0a0f14" level="M" />
        </div>
      </div>
    </div>
  );
});

export default MembershipCard;
