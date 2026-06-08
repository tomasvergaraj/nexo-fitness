import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift, Copy, Loader2, Plus, Ban } from 'lucide-react';
import toast from 'react-hot-toast';
import { giftCardsApi } from '@/services/api';
import { cn, formatCurrency, getApiError } from '@/utils';

interface GiftCard {
  id: string;
  code: string;
  initial_amount: number;
  balance: number;
  currency: string;
  recipient_email?: string | null;
  recipient_name?: string | null;
  message?: string | null;
  status: string;
  created_at: string;
  last_used_at?: string | null;
}

const PRESETS = [10000, 25000, 50000, 100000];

const STATUS_META: Record<string, { label: string; cls: string }> = {
  active: { label: 'Activa', cls: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400' },
  depleted: { label: 'Sin saldo', cls: 'bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-400' },
  void: { label: 'Anulada', cls: 'bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400' },
};

export default function GiftCardsPage() {
  const qc = useQueryClient();
  const [amount, setAmount] = useState<number>(25000);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [message, setMessage] = useState('');

  const { data, isLoading } = useQuery<GiftCard[]>({
    queryKey: ['gift-cards'],
    queryFn: async () => (await giftCardsApi.list()).data,
    staleTime: 60_000,
  });

  const issueMutation = useMutation({
    mutationFn: () =>
      giftCardsApi.issue({
        amount,
        recipient_email: recipientEmail.trim() || undefined,
        recipient_name: recipientName.trim() || undefined,
        message: message.trim() || undefined,
      }),
    onSuccess: (res) => {
      const card = res.data as GiftCard;
      toast.success(`Gift card creada: ${card.code}`);
      setRecipientEmail('');
      setRecipientName('');
      setMessage('');
      void qc.invalidateQueries({ queryKey: ['gift-cards'] });
    },
    onError: (e) => toast.error(getApiError(e, 'No se pudo crear la gift card')),
  });

  const voidMutation = useMutation({
    mutationFn: (id: string) => giftCardsApi.void(id),
    onSuccess: () => {
      toast.success('Gift card anulada');
      void qc.invalidateQueries({ queryKey: ['gift-cards'] });
    },
    onError: (e) => toast.error(getApiError(e, 'No se pudo anular')),
  });

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success('Código copiado');
    } catch {
      toast.error('No se pudo copiar');
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-4 sm:px-6 sm:py-6">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-500 dark:bg-brand-950/40">
          <Gift size={20} />
        </div>
        <div>
          <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Gift Cards</h1>
          <p className="text-sm text-surface-500">Emite tarjetas de regalo con saldo. Se canjean en POS y en venta de planes.</p>
        </div>
      </div>

      {/* Emitir */}
      <div className="mb-6 rounded-2xl border border-surface-200 bg-white p-4 dark:border-surface-800 dark:bg-surface-900 sm:p-6">
        <h2 className="mb-4 text-sm font-semibold text-surface-900 dark:text-white">Emitir nueva gift card</h2>
        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Monto</label>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setAmount(p)}
                  className={cn(
                    'rounded-xl px-4 py-2 text-sm font-semibold transition-colors',
                    amount === p
                      ? 'bg-brand-500 text-white'
                      : 'bg-surface-100 text-surface-600 hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-300',
                  )}
                >
                  {formatCurrency(p, 'CLP')}
                </button>
              ))}
              <input
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
                className="input w-32"
                placeholder="Otro monto"
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <input className="input" type="email" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} placeholder="Email del destinatario (opcional)" />
            <input className="input" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Nombre del destinatario (opcional)" />
          </div>
          <textarea className="input min-h-20 resize-y" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Mensaje para el destinatario (opcional)" maxLength={500} />
          <p className="text-xs text-surface-500">
            Si indicas un email, se le envía la gift card con el código. El pago lo gestionas fuera del sistema (efectivo/transferencia).
          </p>
          <button
            type="button"
            onClick={() => issueMutation.mutate()}
            disabled={issueMutation.isPending || amount <= 0}
            className="btn-primary inline-flex items-center gap-2"
          >
            {issueMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            Emitir gift card
          </button>
        </div>
      </div>

      {/* Listado */}
      <div className="rounded-2xl border border-surface-200 bg-white p-4 dark:border-surface-800 dark:bg-surface-900 sm:p-6">
        <h2 className="mb-4 text-sm font-semibold text-surface-900 dark:text-white">Gift cards emitidas</h2>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-brand-500" /></div>
        ) : !data?.length ? (
          <p className="py-8 text-center text-sm text-surface-400">Aún no has emitido gift cards.</p>
        ) : (
          <div className="space-y-2">
            {data.map((c) => {
              const meta = STATUS_META[c.status] ?? STATUS_META.active;
              return (
                <div key={c.id} className="flex flex-col gap-3 rounded-xl border border-surface-200 px-4 py-3 dark:border-surface-800 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => copyCode(c.code)} className="inline-flex items-center gap-1.5 font-mono text-sm font-bold text-surface-900 hover:text-brand-600 dark:text-white">
                        {c.code} <Copy size={12} />
                      </button>
                      <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', meta.cls)}>{meta.label}</span>
                    </div>
                    <p className="mt-1 text-xs text-surface-500">
                      {c.recipient_email ? `Para ${c.recipient_name || c.recipient_email}` : 'Sin destinatario'}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-sm font-bold text-surface-900 dark:text-white">
                        {formatCurrency(c.balance, c.currency)}
                      </p>
                      <p className="text-xs text-surface-400">de {formatCurrency(c.initial_amount, c.currency)}</p>
                    </div>
                    {c.status === 'active' ? (
                      <button
                        type="button"
                        onClick={() => { if (confirm(`¿Anular la gift card ${c.code}? Su saldo dejará de poder usarse.`)) voidMutation.mutate(c.id); }}
                        className="rounded-lg p-2 text-surface-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"
                        aria-label="Anular"
                      >
                        <Ban size={16} />
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
