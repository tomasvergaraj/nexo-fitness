import type { POSTransaction, TenantSettings } from '@/types';

// Comprobante de venta POS para impresión / exportación a PDF.
// Reutiliza el patrón de impresión por iframe de MembershipCardModal: NO usa
// librerías nuevas; el navegador imprime o guarda como PDF desde su diálogo.

export interface ReceiptExtra {
  cashReceived?: number | null;   // efectivo recibido (solo venta en efectivo recién hecha)
  change?: number | null;         // vuelto
}

function clp(n: number): string {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency', currency: 'CLP', maximumFractionDigits: 0,
  }).format(Number(n) || 0);
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Efectivo', debit_card: 'Débito', credit_card: 'Crédito', transfer: 'Transferencia',
  credit: 'Fiado', refund: 'Devolución', mixed: 'Mixto', other: 'Otro',
  stripe: 'Stripe', webpay: 'WebPay', tuu: 'TUU', mercadopago: 'MercadoPago', fintoc: 'Fintoc',
};
function paymentLabel(v: string): string { return PAYMENT_LABELS[v] ?? v; }

export function buildReceiptHtml(
  tx: POSTransaction,
  settings: TenantSettings | null | undefined,
  extra: ReceiptExtra = {},
): string {
  const gym = settings?.gym_name || 'Punto de venta';
  const addr = [settings?.address, settings?.city].filter(Boolean).join(', ');
  const phone = settings?.phone || '';
  const date = new Date(tx.sold_at).toLocaleString('es-CL', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const gift = Number(tx.gift_card_amount ?? 0);
  const discount = Number(tx.discount_amount ?? 0);

  const itemsHtml = tx.items.map(i => `
    <tr>
      <td class="l">${esc(i.product_name)}<br><span class="dim">${i.quantity} × ${clp(i.unit_price)}</span></td>
      <td class="r">${clp(i.subtotal)}</td>
    </tr>`).join('');

  const payHtml = tx.payment_method === 'mixed' && tx.payments?.length
    ? tx.payments.map(p => `<div class="row"><span>${esc(paymentLabel(p.method))}</span><span>${clp(p.amount)}</span></div>`).join('')
    : `<div class="row"><span>Medio de pago</span><span>${esc(paymentLabel(tx.payment_method))}</span></div>`;

  const cashHtml = extra.cashReceived != null && extra.cashReceived > 0
    ? `<div class="row"><span>Efectivo recibido</span><span>${clp(extra.cashReceived)}</span></div>
       <div class="row b"><span>Vuelto</span><span>${clp(extra.change ?? 0)}</span></div>`
    : '';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  @page { size: 80mm auto; margin: 4mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 72mm; font-family: 'Courier New', ui-monospace, monospace; color: #000; font-size: 11px; line-height: 1.35; }
  .c { text-align: center; }
  .r { text-align: right; }
  .l { text-align: left; }
  .dim { color: #444; font-size: 10px; }
  .gym { font-size: 14px; font-weight: 700; }
  .sep { border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { vertical-align: top; padding: 2px 0; }
  .row { display: flex; justify-content: space-between; gap: 8px; }
  .row.b { font-weight: 700; }
  .tot { display: flex; justify-content: space-between; font-size: 14px; font-weight: 700; margin-top: 4px; }
  .foot { margin-top: 8px; font-size: 10px; }
</style></head><body>
  <div class="c">
    <div class="gym">${esc(gym)}</div>
    ${addr ? `<div class="dim">${esc(addr)}</div>` : ''}
    ${phone ? `<div class="dim">${esc(phone)}</div>` : ''}
  </div>
  <div class="sep"></div>
  <div class="row"><span>Comprobante</span><span>#${tx.id.slice(0, 8).toUpperCase()}</span></div>
  <div class="row"><span>Fecha</span><span>${date}</span></div>
  ${tx.cashier_name ? `<div class="row"><span>Cajero</span><span>${esc(tx.cashier_name)}</span></div>` : ''}
  ${tx.client_name ? `<div class="row"><span>Socio</span><span>${esc(tx.client_name)}</span></div>` : ''}
  <div class="sep"></div>
  <table>${itemsHtml}</table>
  <div class="sep"></div>
  <div class="row"><span>Subtotal</span><span>${clp(tx.subtotal)}</span></div>
  ${discount > 0 ? `<div class="row"><span>Descuento</span><span>- ${clp(discount)}</span></div>` : ''}
  ${gift > 0 ? `<div class="row"><span>Gift card</span><span>- ${clp(gift)}</span></div>` : ''}
  <div class="tot"><span>TOTAL</span><span>${clp(tx.total)}</span></div>
  <div class="sep"></div>
  ${payHtml}
  ${cashHtml}
  ${tx.notes ? `<div class="sep"></div><div class="dim">${esc(tx.notes)}</div>` : ''}
  <div class="sep"></div>
  <div class="c foot">Comprobante interno, no es boleta tributaria.<br>¡Gracias por tu compra!</div>
</body></html>`;
}

/** Imprime el comprobante en un iframe oculto (el navegador ofrece imprimir o guardar como PDF). */
export function printReceipt(html: string): void {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) { document.body.removeChild(iframe); return; }
  doc.open();
  doc.write(html);
  doc.close();
  iframe.onload = () => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => { try { document.body.removeChild(iframe); } catch { /* ya removido */ } }, 1500);
  };
}
