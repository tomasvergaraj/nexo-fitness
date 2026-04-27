import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import html2canvas from 'html2canvas';
import { Download, Printer } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '@/components/ui/Modal';
import { settingsApi } from '@/services/api';
import { DEFAULT_PRIMARY_COLOR, DEFAULT_SECONDARY_COLOR } from '@/utils';
import type { TenantSettings, User } from '@/types';
import MembershipCard, { CARD_WIDTH_PX, CARD_HEIGHT_PX } from './MembershipCard';

type Props = {
  client: User | null;
  onClose: () => void;
};

function buildQrValue(tenantSlug: string, client: User): string {
  const membershipId = client.membership_id ?? client.id;
  return `nexo:${tenantSlug}:${client.id}:${membershipId}`;
}

const PREVIEW_SCALE = 1.7;

type CardProps = React.ComponentProps<typeof MembershipCard>;

/**
 * Renders MembershipCard into an isolated off-screen container appended to body,
 * positioned at the current scroll offset so html2canvas sees it as "in viewport".
 * After capture the container is removed.
 */
async function captureCardToCanvas(cardProps: CardProps): Promise<HTMLCanvasElement> {
  const container = document.createElement('div');
  container.style.cssText = [
    'position:absolute',
    `top:${window.scrollY}px`,
    'left:-9999px',
    `width:${CARD_WIDTH_PX}px`,
    `height:${CARD_HEIGHT_PX}px`,
    'overflow:visible',
    'pointer-events:none',
    'z-index:-1',
  ].join(';');
  document.body.appendChild(container);

  const root = createRoot(container);
  flushSync(() => {
    root.render(<MembershipCard {...cardProps} />);
  });

  // One animation frame so the browser completes layout/paint
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  try {
    const el = container.firstElementChild as HTMLDivElement;
    return await html2canvas(el, {
      scale: 3,
      useCORS: true,
      allowTaint: false,
      backgroundColor: null,
      logging: false,
    });
  } finally {
    root.unmount();
    document.body.removeChild(container);
  }
}

export default function MembershipCardModal({ client, onClose }: Props) {
  const [downloading, setDownloading] = useState(false);
  const [printing, setPrinting] = useState(false);

  const { data: settings, isLoading } = useQuery<TenantSettings>({
    queryKey: ['tenant-settings'],
    queryFn: async () => (await settingsApi.get()).data,
    staleTime: 5 * 60_000,
    enabled: !!client,
  });

  const primaryColor = settings?.primary_color || DEFAULT_PRIMARY_COLOR;
  const secondaryColor = settings?.secondary_color || DEFAULT_SECONDARY_COLOR;
  const gymName = settings?.gym_name || 'Mi Gimnasio';
  const logoUrl = settings?.logo_url || null;
  const tenantSlug = settings?.slug || '';

  const qrValue = client ? buildQrValue(tenantSlug, client) : '';
  const clientName = client ? `${client.first_name} ${client.last_name}` : '';
  const cardProps: CardProps = { clientName, qrValue, gymName, logoUrl, primaryColor, secondaryColor };

  const handleDownload = async () => {
    if (!client) return;
    setDownloading(true);
    try {
      const canvas = await captureCardToCanvas(cardProps);
      const link = document.createElement('a');
      link.download = `tarjeta-${client.first_name.toLowerCase()}-${client.last_name.toLowerCase()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      toast.success('Tarjeta descargada');
    } catch {
      toast.error('No se pudo exportar la tarjeta');
    } finally {
      setDownloading(false);
    }
  };

  const handlePrint = async () => {
    if (!client) return;
    setPrinting(true);
    try {
      const canvas = await captureCardToCanvas(cardProps);
      const dataUrl = canvas.toDataURL('image/png');

      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;';
      document.body.appendChild(iframe);

      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc) { setPrinting(false); return; }

      doc.open();
      doc.write(`<!DOCTYPE html>
<html>
<head>
<style>
  @page { size: 85.6mm 54mm; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 85.6mm; height: 54mm; overflow: hidden; }
  img { width: 85.6mm; height: 54mm; display: block; }
</style>
</head>
<body><img src="${dataUrl}" /></body>
</html>`);
      doc.close();

      iframe.onload = () => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        setTimeout(() => document.body.removeChild(iframe), 1500);
        setPrinting(false);
      };
    } catch {
      toast.error('No se pudo preparar la impresión');
      setPrinting(false);
    }
  };

  return (
    <Modal
      open={!!client}
      size="lg"
      title={`Tarjeta de ingreso — ${clientName}`}
      description="Descarga o imprime la tarjeta en tamaño crédito (85.6 × 54 mm)."
      onClose={onClose}
    >
      <div className="space-y-6">
        {client && !client.membership_id ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300">
            Este cliente no tiene membresía activa. El QR se genera con su ID pero no funcionará para check-in hasta que se le asigne un plan.
          </div>
        ) : null}

        {/* Preview only — scaled visually, never captured */}
        <div className="flex justify-center" style={{ minHeight: CARD_HEIGHT_PX * PREVIEW_SCALE }}>
          {isLoading ? (
            <div
              className="animate-pulse rounded-xl bg-surface-200 dark:bg-surface-800"
              style={{ width: CARD_WIDTH_PX * PREVIEW_SCALE, height: CARD_HEIGHT_PX * PREVIEW_SCALE }}
            />
          ) : (
            <div
              style={{
                transform: `scale(${PREVIEW_SCALE})`,
                transformOrigin: 'top center',
                marginBottom: CARD_HEIGHT_PX * (PREVIEW_SCALE - 1),
              }}
            >
              <MembershipCard {...cardProps} />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cerrar
          </button>
          <button
            type="button"
            className="btn-secondary flex items-center gap-2"
            onClick={handlePrint}
            disabled={isLoading || printing || downloading}
          >
            <Printer size={16} />
            {printing ? 'Preparando...' : 'Imprimir'}
          </button>
          <button
            type="button"
            className="btn-primary flex items-center gap-2"
            onClick={handleDownload}
            disabled={isLoading || downloading || printing}
          >
            <Download size={16} />
            {downloading ? 'Exportando...' : 'Descargar PNG'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
