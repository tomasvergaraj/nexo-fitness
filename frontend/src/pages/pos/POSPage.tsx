import { useState, useMemo, useRef, useEffect, useCallback, type KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ShoppingCart, Search, Plus, Minus, CreditCard,
  Banknote, Package, ChevronRight, X, Loader2, Receipt,
  Lock, Unlock, Wallet, Users, User, ArrowLeft, Coins, Printer, Check,
} from 'lucide-react';
import Modal from '@/components/ui/Modal';
import Drawer from '@/components/ui/Drawer';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { posApi, giftCardsApi, clientsApi, settingsApi } from '@/services/api';
import { cn, getApiError } from '@/utils';
import type {
  Product, ProductCategory, POSTransaction, CashSession, TenantSettings,
  ClientDebtor, ClientAccountStatement, DebtorsResponse,
} from '@/types';
import { buildReceiptHtml, printReceipt, type ReceiptExtra } from './receiptPrint';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CartItem {
  product: Product;
  quantity: number;
}

interface ClientLite {
  id: string;
  first_name: string;
  last_name: string;
  email?: string | null;
}

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Efectivo', icon: <Banknote size={16} /> },
  { value: 'debit_card', label: 'Débito', icon: <CreditCard size={16} /> },
  { value: 'credit_card', label: 'Crédito', icon: <CreditCard size={16} /> },
  { value: 'transfer', label: 'Transferencia', icon: <Wallet size={16} /> },
  { value: 'credit', label: 'Fiado', icon: <User size={16} /> },
  { value: 'mixed', label: 'Mixto', icon: <Coins size={16} /> },
  { value: 'other', label: 'Otro', icon: <Receipt size={16} /> },
];

// Métodos válidos para abonar una deuda (no incluye 'credit').
const ABONO_METHODS = [
  { value: 'cash', label: 'Efectivo' },
  { value: 'debit_card', label: 'Débito' },
  { value: 'credit_card', label: 'Crédito' },
  { value: 'transfer', label: 'Transferencia' },
  { value: 'other', label: 'Otro' },
];

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  debit_card: 'Débito',
  credit_card: 'Crédito',
  transfer: 'Transferencia',
  credit: 'Fiado',
  refund: 'Devolución',
  mixed: 'Mixto',
  other: 'Otro',
  stripe: 'Stripe',
  webpay: 'WebPay',
  tuu: 'TUU',
  mercadopago: 'MercadoPago',
  fintoc: 'Fintoc',
};

function paymentLabel(value: string): string {
  return PAYMENT_LABELS[value] ?? value;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCLP(n: number) {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(Number(n) || 0);
}

// ─── Recent sale row ──────────────────────────────────────────────────────────

function RecentSaleRow({ tx, onRefund, onReceipt }: { tx: POSTransaction; onRefund: (tx: POSTransaction) => void; onReceipt: (tx: POSTransaction) => void }) {
  const refunded = Number(tx.refunded_amount ?? 0);
  const isPartial = tx.status === 'completed' && refunded > 0;
  return (
    <div className="flex flex-col gap-2 border-b border-surface-100 py-2 last:border-0 dark:border-surface-800 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium text-surface-800 dark:text-surface-200 truncate">
          {tx.items.map(i => i.product_name).join(', ')}
        </p>
        <p className="text-xs text-surface-500 dark:text-surface-400">
          {new Date(tx.sold_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })} · {paymentLabel(tx.payment_method)}
          {isPartial && <span className="ml-1 text-amber-600 dark:text-amber-400">· devuelto {formatCLP(refunded)}</span>}
        </p>
      </div>
      <div className="flex items-center gap-2 sm:flex-shrink-0">
        <span className={cn(
          'text-sm font-bold',
          tx.status === 'refunded' ? 'text-surface-400 line-through' : 'text-emerald-600 dark:text-emerald-400',
        )}>
          {formatCLP(tx.total)}
        </span>
        <button
          onClick={() => onReceipt(tx)}
          title="Ver comprobante"
          className="text-surface-400 transition-colors hover:text-brand-600 dark:hover:text-brand-400"
        >
          <Receipt size={14} />
        </button>
        {tx.status === 'completed' ? (
          <button
            onClick={() => onRefund(tx)}
            className="text-xs text-red-500 hover:text-red-700 underline"
          >
            Devolver
          </button>
        ) : tx.status === 'refunded' ? (
          <span className="text-xs text-surface-500 dark:text-surface-400">Devuelto</span>
        ) : null}
      </div>
    </div>
  );
}

// ─── Client picker (búsqueda de socio para fiar) ───────────────────────────────

function ClientPicker({ value, onChange }: { value: ClientLite | null; onChange: (c: ClientLite | null) => void }) {
  const [q, setQ] = useState('');
  const { data: results = [], isFetching } = useQuery<ClientLite[]>({
    queryKey: ['pos-client-search', q],
    queryFn: () => clientsApi.list({ search: q, per_page: 8 }).then(r => r.data.items),
    enabled: q.trim().length >= 2 && !value,
  });

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl border border-brand-300 bg-brand-50/60 px-3 py-2 dark:border-brand-800 dark:bg-brand-950/30">
        <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-brand-700 dark:text-brand-300">
          <User size={14} className="shrink-0" />
          <span className="truncate">{value.first_name} {value.last_name}</span>
        </span>
        <button type="button" onClick={() => onChange(null)} className="shrink-0 text-brand-500 hover:text-brand-700">
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
      <input
        type="text"
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="Buscar socio por nombre o email..."
        className="input w-full pl-9 text-sm"
      />
      {q.trim().length >= 2 && (
        <div className="absolute bottom-full z-20 mb-1 max-h-44 w-full overflow-y-auto rounded-xl border border-surface-200 bg-white shadow-lg dark:border-surface-700 dark:bg-surface-800">
          {isFetching ? (
            <div className="flex items-center justify-center py-3"><Loader2 size={16} className="animate-spin text-brand-500" /></div>
          ) : results.length === 0 ? (
            <p className="px-3 py-3 text-xs text-surface-500 dark:text-surface-400">Sin resultados</p>
          ) : results.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => { onChange(c); setQ(''); }}
              className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-surface-50 dark:hover:bg-surface-700/50"
            >
              <span className="text-sm font-medium text-surface-800 dark:text-surface-200">{c.first_name} {c.last_name}</span>
              {c.email && <span className="text-xs text-surface-500 dark:text-surface-400">{c.email}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Fiados (cuenta corriente de socios) ────────────────────────────────────────

function FiadosPanel() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<ClientDebtor | null>(null);
  const [abonoAmount, setAbonoAmount] = useState(0);
  const [abonoMethod, setAbonoMethod] = useState('cash');
  const [abonoNotes, setAbonoNotes] = useState('');
  const [limitInput, setLimitInput] = useState('');

  const { data: debtors, isLoading } = useQuery<DebtorsResponse>({
    queryKey: ['pos-debtors'],
    queryFn: () => posApi.accountDebtors().then(r => r.data),
  });

  const { data: statement, isLoading: loadingStatement } = useQuery<ClientAccountStatement>({
    queryKey: ['pos-statement', selected?.client_id],
    queryFn: () => posApi.accountStatement(selected!.client_id).then(r => r.data),
    enabled: !!selected,
  });

  // Prefill del input de límite con el valor vigente del socio.
  useEffect(() => {
    setLimitInput(statement?.credit_limit != null ? String(statement.credit_limit) : '');
  }, [statement?.client_id, statement?.credit_limit]);

  const limitMutation = useMutation({
    mutationFn: ({ id, limit }: { id: string; limit: number | null }) => posApi.setCreditLimit(id, limit),
    onSuccess: () => {
      toast.success('Límite de crédito actualizado');
      queryClient.invalidateQueries({ queryKey: ['pos-statement'] });
      queryClient.invalidateQueries({ queryKey: ['pos-debtors'] });
    },
    onError: err => toast.error(getApiError(err)),
  });

  const abonoMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => posApi.accountPayment(id, data),
    onSuccess: () => {
      toast.success('Abono registrado');
      setAbonoAmount(0);
      setAbonoNotes('');
      queryClient.invalidateQueries({ queryKey: ['pos-debtors'] });
      queryClient.invalidateQueries({ queryKey: ['pos-statement'] });
      queryClient.invalidateQueries({ queryKey: ['pos-cash-session'] });
    },
    onError: err => toast.error(getApiError(err)),
  });

  // ── Detalle de un socio ──────────────────────────────────────────────────
  if (selected) {
    const balance = statement ? statement.balance : selected.balance;
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <button
          onClick={() => { setSelected(null); setAbonoAmount(0); setAbonoNotes(''); }}
          className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-surface-500 hover:text-surface-800 dark:hover:text-surface-200"
        >
          <ArrowLeft size={16} /> Volver a deudores
        </button>

        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold font-display text-surface-900 dark:text-white">{selected.client_name}</h2>
            {selected.email && <p className="text-sm text-surface-500 dark:text-surface-400">{selected.email}</p>}
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-surface-500 dark:text-surface-400">Saldo deudor</p>
            <p className={cn('text-2xl font-bold', balance > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600')}>
              {formatCLP(balance)}
            </p>
          </div>
        </div>

        {/* Registrar abono */}
        <div className="mb-6 rounded-2xl border border-surface-200 p-4 dark:border-surface-800">
          <h3 className="mb-3 text-sm font-semibold text-surface-700 dark:text-surface-300">Registrar abono</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-surface-500">Monto ($)</label>
              <input
                type="number"
                min={0}
                value={abonoAmount || ''}
                onChange={e => setAbonoAmount(Number(e.target.value) || 0)}
                placeholder="0"
                className="input w-full text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-surface-500">Método</label>
              <select value={abonoMethod} onChange={e => setAbonoMethod(e.target.value)} className="input w-full text-sm">
                {ABONO_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-3">
            <label className="mb-1 block text-xs text-surface-500">Notas (opcional)</label>
            <input
              type="text"
              value={abonoNotes}
              onChange={e => setAbonoNotes(e.target.value)}
              className="input w-full text-sm"
            />
          </div>
          <button
            onClick={() => abonoMutation.mutate({
              id: selected.client_id,
              data: { amount: abonoAmount, payment_method: abonoMethod, notes: abonoNotes || undefined },
            })}
            disabled={abonoMutation.isPending || abonoAmount <= 0}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 py-2.5 text-sm font-bold text-white hover:bg-brand-600 disabled:opacity-60 sm:w-auto sm:px-6"
          >
            {abonoMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Coins size={16} />}
            Registrar abono
          </button>
          {abonoMethod === 'cash' && (
            <p className="mt-2 text-xs text-surface-500 dark:text-surface-400">Un abono en efectivo entra al arqueo del turno de caja abierto.</p>
          )}
        </div>

        {/* Límite de crédito */}
        <div className="mb-6 rounded-2xl border border-surface-200 p-4 dark:border-surface-800">
          <h3 className="mb-1 text-sm font-semibold text-surface-700 dark:text-surface-300">Límite de crédito</h3>
          <p className="mb-3 text-xs text-surface-500 dark:text-surface-400">
            Tope de deuda del socio. Vacío = sin límite. El modo (avisar o bloquear) se ajusta en Configuración.
          </p>
          <div className="flex gap-2">
            <input
              type="number"
              min={0}
              value={limitInput}
              onChange={e => setLimitInput(e.target.value)}
              placeholder="Sin límite"
              className="input min-w-0 flex-1 text-sm"
            />
            <button
              onClick={() => limitMutation.mutate({
                id: selected.client_id,
                limit: limitInput.trim() === '' ? null : Math.max(0, Number(limitInput) || 0),
              })}
              disabled={limitMutation.isPending}
              className="btn-secondary shrink-0 text-sm"
            >
              {limitMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : 'Guardar'}
            </button>
            {statement?.credit_limit != null && (
              <button
                onClick={() => limitMutation.mutate({ id: selected.client_id, limit: null })}
                disabled={limitMutation.isPending}
                className="shrink-0 rounded-xl px-3 text-sm text-surface-500 dark:text-surface-400 hover:text-surface-600"
              >
                Quitar
              </button>
            )}
          </div>
        </div>

        {/* Movimientos */}
        <h3 className="mb-2 text-sm font-semibold text-surface-700 dark:text-surface-300">Movimientos</h3>
        {loadingStatement ? (
          <div className="flex items-center justify-center py-8"><Loader2 size={20} className="animate-spin text-brand-500" /></div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-surface-200 dark:border-surface-800">
            {statement?.entries.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-surface-500 dark:text-surface-400">Sin movimientos</p>
            ) : statement?.entries.map(e => (
              <div key={e.id} className="flex items-center justify-between gap-3 border-b border-surface-100 px-4 py-2.5 last:border-0 dark:border-surface-800">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-surface-800 dark:text-surface-200">
                    {e.kind === 'charge' ? 'Cargo (venta a crédito)' : `Abono${e.payment_method ? ` · ${paymentLabel(e.payment_method)}` : ''}`}
                  </p>
                  <p className="text-xs text-surface-500 dark:text-surface-400">
                    {new Date(e.created_at).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    {e.created_by_name ? ` · ${e.created_by_name}` : ''}
                    {e.notes ? ` · ${e.notes}` : ''}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={cn('text-sm font-bold', e.kind === 'charge' ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400')}>
                    {e.kind === 'charge' ? '+' : '−'}{formatCLP(e.amount)}
                  </p>
                  <p className="text-xs text-surface-500 dark:text-surface-400">saldo {formatCLP(e.balance_after)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Lista de deudores ──────────────────────────────────────────────────────
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold font-display text-surface-900 dark:text-white">Deudores</h2>
        {debtors && debtors.rows.length > 0 && (
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-surface-500 dark:text-surface-400">Total por cobrar</p>
            <p className="text-lg font-bold text-rose-600 dark:text-rose-400">{formatCLP(debtors.total_outstanding)}</p>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12"><Loader2 size={24} className="animate-spin text-brand-500" /></div>
      ) : !debtors || debtors.rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-surface-400">
          <Users size={32} className="mb-2 opacity-40" />
          <p className="text-sm">Sin deudas pendientes</p>
          <p className="mt-1 text-xs">Las ventas con método Fiado aparecen aquí.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-surface-200 dark:border-surface-800">
          {debtors.rows.map(d => (
            <button
              key={d.client_id}
              onClick={() => setSelected(d)}
              className="flex w-full items-center justify-between gap-3 border-b border-surface-100 px-4 py-3 text-left transition-colors last:border-0 hover:bg-surface-50 dark:border-surface-800 dark:hover:bg-surface-800/50"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-surface-800 dark:text-surface-200">{d.client_name}</p>
                <p className="text-xs text-surface-500 dark:text-surface-400">
                  {d.email ?? d.phone ?? '—'}
                  {d.last_entry_at ? ` · último mov. ${new Date(d.last_entry_at).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' })}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-sm font-bold text-rose-600 dark:text-rose-400">{formatCLP(d.balance)}</span>
                <ChevronRight size={16} className="text-surface-300" />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function POSPage() {
  const queryClient = useQueryClient();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [discountInput, setDiscountInput] = useState(0);
  const [discountMode, setDiscountMode] = useState<'amount' | 'percent'>('amount');
  const [notes, setNotes] = useState('');
  const [giftCode, setGiftCode] = useState('');
  const [giftApplied, setGiftApplied] = useState(0);
  const [giftChecking, setGiftChecking] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [cashReceived, setCashReceived] = useState(0);
  const isCompact = useMediaQuery('(max-width: 1279px)');
  const [cartSheetOpen, setCartSheetOpen] = useState(false);
  const [view, setView] = useState<'sell' | 'fiados'>('sell');
  const [client, setClient] = useState<ClientLite | null>(null);
  // Fiado parcial: abono al momento de la venta a crédito.
  const [downPayment, setDownPayment] = useState(0);
  const [downMethod, setDownMethod] = useState('cash');
  const [refundTx, setRefundTx] = useState<POSTransaction | null>(null);
  const [refundQty, setRefundQty] = useState<Record<string, number>>({});
  const [mixedRows, setMixedRows] = useState<{ method: string; amount: number }[]>([]);
  const [receiptTx, setReceiptTx] = useState<POSTransaction | null>(null);
  const [receiptExtra, setReceiptExtra] = useState<ReceiptExtra>({});
  const searchRef = useRef<HTMLInputElement>(null);
  const focusSearch = useCallback(() => { setTimeout(() => searchRef.current?.focus(), 30); }, []);

  // ── Cash session (turno de caja) ─────────────────────────────────────────────
  const [openCajaModal, setOpenCajaModal] = useState(false);
  const [closeCajaModal, setCloseCajaModal] = useState(false);
  const [openingAmount, setOpeningAmount] = useState(0);
  const [closingAmount, setClosingAmount] = useState(0);
  const [cajaNotes, setCajaNotes] = useState('');

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: session = null, isLoading: loadingSession } = useQuery<CashSession | null>({
    queryKey: ['pos-cash-session'],
    queryFn: () => posApi.currentCashSession().then(r => r.data),
  });
  const hasOpenCaja = !!session;
  const { data: categories = [] } = useQuery<ProductCategory[]>({
    queryKey: ['pos-categories'],
    queryFn: () => posApi.listCategories().then(r => r.data),
  });

  const { data: products = [], isLoading: loadingProducts } = useQuery<Product[]>({
    queryKey: ['pos-products', selectedCategory, search],
    queryFn: () => posApi.listProducts({
      active: true,
      ...(selectedCategory ? { category_id: selectedCategory } : {}),
      ...(search ? { search } : {}),
    }).then(r => r.data),
  });

  const todayStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, []);
  const { data: todaySales = [] } = useQuery<POSTransaction[]>({
    queryKey: ['pos-transactions-today'],
    queryFn: () => posApi.listTransactions({ from_date: todayStart, size: 200 }).then(r => r.data),
  });

  // Datos del gimnasio para el encabezado del comprobante.
  const { data: gymSettings = null } = useQuery<TenantSettings | null>({
    queryKey: ['tenant-settings'],
    queryFn: () => settingsApi.get().then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });

  // Estado de cuenta del socio a fiar: saldo + límite, para advertir/bloquear.
  const { data: creditAccount = null } = useQuery<ClientAccountStatement | null>({
    queryKey: ['pos-credit-account', client?.id],
    queryFn: () => posApi.accountStatement(client!.id).then(r => r.data),
    enabled: checkoutOpen && paymentMethod === 'credit' && !!client,
    staleTime: 0,                 // saldo siempre fresco al abrir el cobro
    refetchOnMount: 'always',
  });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const saleMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => posApi.createTransaction(data),
    onSuccess: (res) => {
      const tx = res.data as POSTransaction;
      toast.success('Venta registrada');
      // Comprobante: si fue efectivo y se ingresó lo recibido, guarda el vuelto.
      const received = paymentMethod === 'cash' && cashReceived > 0 ? cashReceived : null;
      setReceiptExtra({ cashReceived: received, change: received != null ? Math.max(0, received - Number(tx.total)) : null });
      setReceiptTx(tx);
      setCart([]);
      setDiscountInput(0);
      setDiscountMode('amount');
      setNotes('');
      setGiftCode('');
      setGiftApplied(0);
      setClient(null);
      setMixedRows([]);
      setPaymentMethod('cash');
      setCashReceived(0);
      setDownPayment(0);
      setDownMethod('cash');
      setCheckoutOpen(false);
      queryClient.invalidateQueries({ queryKey: ['pos-transactions-today'] });
      queryClient.invalidateQueries({ queryKey: ['pos-products'] });
      queryClient.invalidateQueries({ queryKey: ['pos-cash-session'] });
      queryClient.invalidateQueries({ queryKey: ['pos-debtors'] });
      queryClient.invalidateQueries({ queryKey: ['pos-credit-account'] });
    },
    onError: (err) => toast.error(getApiError(err)),
  });

  const refundMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data?: Record<string, unknown> }) => posApi.refundTransaction(id, data),
    onSuccess: () => {
      toast.success('Devolución registrada');
      setRefundTx(null);
      queryClient.invalidateQueries({ queryKey: ['pos-transactions-today'] });
      queryClient.invalidateQueries({ queryKey: ['pos-products'] });
      queryClient.invalidateQueries({ queryKey: ['pos-cash-session'] });
      queryClient.invalidateQueries({ queryKey: ['pos-debtors'] });
    },
    onError: (err) => toast.error(getApiError(err)),
  });

  const openCajaMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => posApi.openCashSession(data),
    onSuccess: () => {
      toast.success('Caja abierta');
      setOpenCajaModal(false);
      setOpeningAmount(0);
      setCajaNotes('');
      queryClient.invalidateQueries({ queryKey: ['pos-cash-session'] });
    },
    onError: (err) => toast.error(getApiError(err)),
  });

  const closeCajaMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      posApi.closeCashSession(id, data),
    onSuccess: () => {
      toast.success('Caja cerrada');
      setCloseCajaModal(false);
      setClosingAmount(0);
      setCajaNotes('');
      queryClient.invalidateQueries({ queryKey: ['pos-cash-session'] });
    },
    onError: (err) => toast.error(getApiError(err)),
  });

  const expectedCash = session
    ? Number(session.opening_amount)
      + Number(session.cash_sales)
      + Number(session.membership_cash ?? 0)
      + Number(session.cash_credit_payments ?? 0)
      - Number(session.cash_refunds ?? 0)
      - Number(session.cash_expenses ?? 0)
    : 0;

  // ── Cart helpers ──────────────────────────────────────────────────────────
  async function handleSearchEnter(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    const code = search.trim();
    if (!code) return;
    e.preventDefault();
    try {
      const res = await posApi.productByBarcode(code);
      addToCart(res.data);
      setSearch('');
    } catch {
      // sin barcode exacto: si el filtro dejó un único producto, agrégalo
      if (products.length === 1) {
        addToCart(products[0]);
        setSearch('');
      } else if (products.length === 0) {
        toast.error('Sin producto con ese código');
      }
    }
  }

  function addToCart(product: Product) {
    setCart(prev => {
      const existing = prev.find(i => i.product.id === product.id);
      if (existing) {
        const maxQty = product.stock ?? 999;
        if (existing.quantity >= maxQty) {
          toast.error(`Stock máximo: ${maxQty}`);
          return prev;
        }
        return prev.map(i => i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, { product, quantity: 1 }];
    });
  }

  function updateQty(productId: string, delta: number) {
    setCart(prev =>
      prev
        .map(i => i.product.id === productId ? { ...i, quantity: i.quantity + delta } : i)
        .filter(i => i.quantity > 0)
    );
  }

  function removeFromCart(productId: string) {
    setCart(prev => prev.filter(i => i.product.id !== productId));
  }

  // ── Totals ─────────────────────────────────────────────────────────────────
  const subtotal = useMemo(() => cart.reduce((s, i) => s + i.product.price * i.quantity, 0), [cart]);
  // Descuento total en monto o porcentaje (se envía siempre como monto al backend).
  const discount = useMemo(() => {
    if (subtotal <= 0) return 0;
    const raw = discountMode === 'percent' ? Math.round(subtotal * (discountInput / 100)) : discountInput;
    return Math.min(subtotal, Math.max(0, raw));
  }, [discountInput, discountMode, subtotal]);
  const total = Math.max(0, subtotal - discount);
  const todayRevenue = todaySales
    .filter(t => t.status === 'completed')
    .reduce((s, t) => s + Number(t.total), 0);

  // ── Gift card ───────────────────────────────────────────────────────────────
  const giftShown = Math.min(giftApplied, total);
  const finalTotal = Math.max(0, total - giftShown);

  async function validateGift() {
    const code = giftCode.trim();
    if (!code) return;
    if (total <= 0) { toast.error('Agrega productos antes de aplicar la gift card'); return; }
    setGiftChecking(true);
    try {
      const res = await giftCardsApi.validate(code, total);
      setGiftApplied(Number(res.data.applied) || 0);
      toast.success(`Gift card aplicada: -${formatCLP(Number(res.data.applied) || 0)}`);
    } catch (e) {
      setGiftApplied(0);
      toast.error(getApiError(e, 'Gift card inválida o sin saldo'));
    } finally {
      setGiftChecking(false);
    }
  }

  // ── Checkout ──────────────────────────────────────────────────────────────
  const isCredit = paymentMethod === 'credit';
  const isMixed = paymentMethod === 'mixed';
  const mixedAssigned = isMixed ? mixedRows.reduce((s, r) => s + (Number(r.amount) || 0), 0) : 0;
  const mixedRemaining = total - mixedAssigned;
  const mixedValid = !isMixed || (
    total > 0 && mixedRows.length > 0 &&
    mixedRows.every(r => r.method && Number(r.amount) > 0) &&
    mixedAssigned === total
  );
  // Fiado parcial: el abono al momento no puede alcanzar el total (eso es venta normal).
  const downCapped = isCredit ? Math.min(Math.max(0, downPayment), Math.max(0, finalTotal - 1)) : 0;
  const creditDebt = isCredit ? Math.max(0, finalTotal - downCapped) : 0;
  // Advertencia / bloqueo por límite de crédito del socio.
  // La API serializa Decimal como string → coercionar a número antes de sumar
  // (si no, "21410.00" + 1000 concatena en vez de sumar).
  const creditLimit = creditAccount?.credit_limit != null ? Number(creditAccount.credit_limit) : null;
  const currentBalance = Number(creditAccount?.balance ?? 0);
  const creditMode = gymSettings?.credit_limit_mode ?? 'warn';
  const projectedBalance = currentBalance + creditDebt;
  const overCreditLimit =
    isCredit && creditLimit != null && creditMode !== 'off' && projectedBalance > creditLimit;
  const creditBlocked = overCreditLimit && creditMode === 'block';
  const canCheckout =
    cart.length > 0 && hasOpenCaja && (!isCredit || !!client) && mixedValid && !creditBlocked;
  // Vuelto (solo venta en efectivo): efectivo recibido − total.
  const change = paymentMethod === 'cash' && cashReceived > 0 ? Math.max(0, cashReceived - finalTotal) : 0;
  const cashShort = paymentMethod === 'cash' && cashReceived > 0 && cashReceived < finalTotal;

  function addMixedRow() { setMixedRows(p => [...p, { method: 'cash', amount: 0 }]); }
  function removeMixedRow(idx: number) { setMixedRows(p => p.filter((_, i) => i !== idx)); }
  function setMixedRow(idx: number, patch: Partial<{ method: string; amount: number }>) {
    setMixedRows(p => p.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }

  function selectPaymentMethod(value: string) {
    setPaymentMethod(value);
    if (value === 'mixed' && mixedRows.length === 0) {
      setMixedRows([{ method: 'cash', amount: 0 }]);
    }
  }

  function handleCheckout() {
    if (isCredit && !client) {
      toast.error('Selecciona el socio para fiar');
      return;
    }
    if (isMixed && !mixedValid) {
      toast.error('La suma de los métodos debe igualar el total');
      return;
    }
    if (creditBlocked) {
      toast.error('La venta supera el límite de crédito del socio');
      return;
    }
    saleMutation.mutate({
      items: cart.map(i => ({ product_id: i.product.id, quantity: i.quantity })),
      payment_method: paymentMethod,
      discount_amount: discount,
      gift_card_code: !isCredit && !isMixed && giftApplied > 0 && giftCode.trim() ? giftCode.trim() : undefined,
      notes: notes || undefined,
      client_id: client?.id,
      payments: isMixed ? mixedRows.map(r => ({ method: r.method, amount: Number(r.amount) })) : undefined,
      credit_down_payment: isCredit && downCapped > 0 ? downCapped : undefined,
      credit_down_payment_method: isCredit && downCapped > 0 ? downMethod : undefined,
    });
  }

  function openRefund(tx: POSTransaction) {
    const init: Record<string, number> = {};
    tx.items.forEach(i => { init[i.id] = Math.max(0, i.quantity - (i.refunded_quantity ?? 0)); });
    setRefundQty(init);
    setRefundTx(tx);
  }

  function submitRefund() {
    if (!refundTx) return;
    const items = refundTx.items
      .filter(i => (refundQty[i.id] ?? 0) > 0)
      .map(i => ({ item_id: i.id, quantity: refundQty[i.id] }));
    if (items.length === 0) { toast.error('Elige al menos una unidad a devolver'); return; }
    const allFull = refundTx.items.every(i => (refundQty[i.id] ?? 0) === Math.max(0, i.quantity - (i.refunded_quantity ?? 0)));
    // devolución total → body vacío; parcial → items
    refundMutation.mutate({ id: refundTx.id, data: allFull ? {} : { items } });
  }

  const refundTotalEstimate = refundTx
    ? refundTx.items.reduce((s, i) => {
        const factor = refundTx.subtotal > 0 ? refundTx.total / refundTx.subtotal : 1;
        return s + Math.round(i.unit_price * (refundQty[i.id] ?? 0) * factor);
      }, 0)
    : 0;

  const cartCount = cart.reduce((s, i) => s + i.quantity, 0);

  // ── Comprobante ─────────────────────────────────────────────────────────────
  function openReceipt(tx: POSTransaction) {
    setReceiptExtra({});   // reimpresión: el vuelto no se persiste, solo aplica a la venta recién hecha
    setReceiptTx(tx);
  }
  function doPrintReceipt() {
    if (!receiptTx) return;
    printReceipt(buildReceiptHtml(receiptTx, gymSettings, receiptExtra));
  }
  function closeReceipt() {
    setReceiptTx(null);
    setReceiptExtra({});
    focusSearch();
  }

  // ── Teclado: foco automático en el buscador + atajos para uso sin mouse ───────
  useEffect(() => {
    if (view === 'sell' && hasOpenCaja) focusSearch();
  }, [view, hasOpenCaja, focusSearch]);

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      // F2 = cobrar (abrir confirmación). Funciona aunque el foco esté en el buscador.
      if (e.key === 'F2' && view === 'sell' && !checkoutOpen && !receiptTx && canCheckout) {
        e.preventDefault();
        setCartSheetOpen(false);
        setCheckoutOpen(true);
        return;
      }
      // En la confirmación: Enter cobra (si no se está escribiendo en un campo).
      if (e.key === 'Enter' && checkoutOpen && !typing && !saleMutation.isPending && canCheckout) {
        e.preventDefault();
        handleCheckout();
        return;
      }
      // En el comprobante: P imprime, Enter inicia nueva venta.
      if (receiptTx && !typing) {
        if (e.key === 'p' || e.key === 'P') { e.preventDefault(); doPrintReceipt(); }
        else if (e.key === 'Enter') { e.preventDefault(); closeReceipt(); }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, checkoutOpen, receiptTx, canCheckout, saleMutation.isPending]);

  const cartPanelContent = (
    <>
      {/* Cart items */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-2">
        <h2 className="text-sm font-semibold text-surface-600 dark:text-surface-400 uppercase tracking-wide mb-3">
          Carrito ({cart.length})
        </h2>
        {cart.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-surface-300 dark:text-surface-600">
            <ShoppingCart size={32} className="mb-2" />
            <p className="text-sm">Vacío — agrega productos</p>
          </div>
        ) : (
          cart.map(item => (
            <div key={item.product.id}
              className="flex flex-col gap-3 rounded-xl bg-white p-3 shadow-sm dark:bg-surface-800 sm:flex-row sm:items-center"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-surface-800 dark:text-surface-200 truncate">
                  {item.product.name}
                </p>
                <p className="text-xs text-surface-500 dark:text-surface-400">{formatCLP(item.product.price)} c/u</p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => updateQty(item.product.id, -1)}
                  className="w-6 h-6 rounded-lg bg-surface-100 dark:bg-surface-700 flex items-center justify-center hover:bg-surface-200 dark:hover:bg-surface-600"
                >
                  <Minus size={12} />
                </button>
                <span className="w-6 text-center text-sm font-bold text-surface-800 dark:text-white">
                  {item.quantity}
                </span>
                <button
                  onClick={() => updateQty(item.product.id, 1)}
                  className="w-6 h-6 rounded-lg bg-surface-100 dark:bg-surface-700 flex items-center justify-center hover:bg-surface-200 dark:hover:bg-surface-600"
                >
                  <Plus size={12} />
                </button>
              </div>
              <div className="text-right min-w-[56px]">
                <p className="text-sm font-bold text-surface-800 dark:text-white">
                  {formatCLP(item.product.price * item.quantity)}
                </p>
              </div>
              <button onClick={() => removeFromCart(item.product.id)} className="self-end text-surface-300 transition-colors hover:text-red-500 sm:self-auto">
                <X size={14} />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Totals + checkout */}
      <div className="shrink-0 border-t border-surface-200 dark:border-surface-800 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-surface-500 shrink-0">Descuento</label>
          <input
            type="number"
            min={0}
            max={discountMode === 'percent' ? 100 : undefined}
            value={discountInput || ''}
            onChange={e => setDiscountInput(Math.max(0, Number(e.target.value) || 0))}
            placeholder="0"
            className="input min-w-0 flex-1 text-sm"
          />
          <div className="flex shrink-0 overflow-hidden rounded-lg border border-surface-200 dark:border-surface-700">
            {(['amount', 'percent'] as const).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setDiscountMode(m)}
                className={cn(
                  'px-2.5 py-1.5 text-xs font-semibold transition-colors',
                  discountMode === m
                    ? 'bg-brand-500 text-white'
                    : 'bg-white text-surface-500 hover:bg-surface-50 dark:bg-surface-800 dark:hover:bg-surface-700',
                )}
              >
                {m === 'amount' ? '$' : '%'}
              </button>
            ))}
          </div>
        </div>
        {discountMode === 'percent' && discount > 0 && (
          <p className="-mt-1 text-right text-xs text-surface-500 dark:text-surface-400">{discountInput}% = {formatCLP(discount)}</p>
        )}

        <div className="space-y-1 text-sm">
          {discount > 0 && (
            <div className="flex justify-between text-surface-400">
              <span>Subtotal</span>
              <span>{formatCLP(subtotal)}</span>
            </div>
          )}
          {discount > 0 && (
            <div className="flex justify-between text-red-500">
              <span>Descuento</span>
              <span>- {formatCLP(discount)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-lg text-surface-900 dark:text-white pt-1 border-t border-surface-100 dark:border-surface-800">
            <span>Total</span>
            <span>{formatCLP(total)}</span>
          </div>
        </div>

        {!hasOpenCaja && !loadingSession && (
          <button
            type="button"
            onClick={() => { setCartSheetOpen(false); setOpenCajaModal(true); }}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-400"
          >
            <Lock size={14} /> Caja cerrada — abre la caja para cobrar
          </button>
        )}

        <div className="grid grid-cols-3 gap-2">
          {PAYMENT_METHODS.map(pm => (
            <button
              key={pm.value}
              onClick={() => selectPaymentMethod(pm.value)}
              className={cn(
                'flex-1 flex flex-col items-center gap-1 py-2 px-1 rounded-xl border text-xs font-medium transition-all',
                paymentMethod === pm.value
                  ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/40 text-brand-600 dark:text-brand-400'
                  : 'border-surface-200 dark:border-surface-700 text-surface-500 hover:border-surface-300',
              )}
            >
              {pm.icon}
              {pm.label}
            </button>
          ))}
        </div>

        <div className="space-y-1">
          <label className="text-xs text-surface-500">
            {isCredit ? 'Socio a fiar' : 'Socio (opcional)'}
            {isCredit && <span className="ml-1 text-rose-500">· obligatorio</span>}
          </label>
          <ClientPicker value={client} onChange={setClient} />
        </div>

        {isMixed && (
          <div className="space-y-2">
            <label className="text-xs text-surface-500">Pago mixto</label>
            {mixedRows.map((r, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <select
                  value={r.method}
                  onChange={e => setMixedRow(idx, { method: e.target.value })}
                  className="input min-w-0 flex-1 text-sm"
                >
                  {ABONO_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
                <input
                  type="number"
                  min={0}
                  value={r.amount || ''}
                  onChange={e => setMixedRow(idx, { amount: Number(e.target.value) || 0 })}
                  placeholder="0"
                  className="input w-24 text-sm"
                />
                {mixedRows.length > 1 && (
                  <button type="button" onClick={() => removeMixedRow(idx)} className="text-surface-300 hover:text-red-500">
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
            <div className="flex items-center justify-between">
              <button type="button" onClick={addMixedRow} className="text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400">
                + Agregar método
              </button>
              <span className={cn('text-xs font-medium', mixedRemaining === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-surface-500')}>
                {formatCLP(mixedAssigned)} / {formatCLP(total)}
                {mixedRemaining !== 0 && <span className="text-amber-600 dark:text-amber-400"> · falta {formatCLP(mixedRemaining)}</span>}
              </span>
            </div>
          </div>
        )}

        <button
          onClick={() => {
            if (!canCheckout) return;
            setCartSheetOpen(false);
            setCheckoutOpen(true);
          }}
          disabled={!canCheckout}
          className={cn(
            'w-full py-3 rounded-2xl font-bold text-sm transition-all flex items-center justify-center gap-2',
            canCheckout
              ? 'bg-brand-500 hover:bg-brand-600 text-white shadow-lg shadow-brand-500/25 active:scale-[0.98]'
              : 'bg-surface-100 dark:bg-surface-800 text-surface-400 cursor-not-allowed',
          )}
        >
          {isCredit ? <User size={16} /> : <ShoppingCart size={16} />}
          {isCredit ? 'Fiar' : 'Cobrar'} {cart.length > 0 ? formatCLP(total) : ''}
        </button>

        {todaySales.length > 0 && (
          <div className="mt-2">
            <p className="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-2">Últimas ventas</p>
            <div className="max-h-40 overflow-y-auto">
              {todaySales.slice(0, 10).map(tx => (
                <RecentSaleRow key={tx.id} tx={tx} onRefund={openRefund} onReceipt={openReceipt} />
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col gap-0 -my-6 overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-surface-200 px-4 py-4 dark:border-surface-800 sm:px-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Punto de Venta</h1>
            <p className="text-sm text-surface-500 dark:text-surface-400">
              Ventas hoy: <span className="font-semibold text-emerald-600">{formatCLP(todayRevenue)}</span>
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold',
              hasOpenCaja
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                : 'bg-surface-100 text-surface-500 dark:bg-surface-800',
            )}>
              {hasOpenCaja ? <Unlock size={12} /> : <Lock size={12} />}
              {hasOpenCaja ? 'Caja abierta' : 'Caja cerrada'}
            </span>
            {hasOpenCaja ? (
              <button
                onClick={() => { setClosingAmount(0); setCajaNotes(''); setCloseCajaModal(true); }}
                className="rounded-xl border border-surface-200 px-3 py-1.5 text-xs font-medium text-surface-600 hover:bg-surface-50 dark:border-surface-700 dark:text-surface-400 dark:hover:bg-surface-800"
              >
                Cerrar caja
              </button>
            ) : (
              <button
                onClick={() => { setOpeningAmount(0); setCajaNotes(''); setOpenCajaModal(true); }}
                disabled={loadingSession}
                className="rounded-xl bg-brand-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-600 disabled:opacity-60"
              >
                Abrir caja
              </button>
            )}
          </div>
        </div>

        <div className="mt-3 flex w-fit gap-1 rounded-xl bg-surface-100 p-1 dark:bg-surface-800">
          {([['sell', 'Vender'], ['fiados', 'Fiados']] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                'rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors',
                view === v
                  ? 'bg-white text-surface-900 shadow-sm dark:bg-surface-700 dark:text-white'
                  : 'text-surface-500 hover:text-surface-700 dark:hover:text-surface-300',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {view === 'sell' && hasOpenCaja && session && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-surface-500 dark:text-surface-400">
            <span>Abrió: <span className="font-medium text-surface-700 dark:text-surface-300">{session.opened_by_name ?? '—'}</span></span>
            <span>Fondo inicial: <span className="font-medium text-surface-700 dark:text-surface-300">{formatCLP(session.opening_amount)}</span></span>
            <span>Turno: <span className="font-semibold text-emerald-600">{formatCLP(session.sales_total)}</span> ({session.sales_count})</span>
            {session.by_method.map(m => (
              <span key={m.payment_method} className="rounded-full bg-surface-100 px-2 py-0.5 dark:bg-surface-800">
                {m.label}: <span className="font-medium text-surface-700 dark:text-surface-300">{formatCLP(m.total)}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {view === 'fiados' && <FiadosPanel />}

      {/* Main split layout */}
      {view === 'sell' && (
      <div className="flex min-h-0 flex-1 flex-col xl:flex-row xl:overflow-hidden">
        {/* ── Left: Catalog ──────────────────────────────────────────────── */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden xl:border-r xl:border-surface-200 xl:dark:border-surface-800">
          {/* Search + Category filter */}
          <div className="p-4 space-y-3 border-b border-surface-100 dark:border-surface-800">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
              <input
                ref={searchRef}
                type="text"
                autoFocus
                placeholder="Buscar o escanear código…  (Enter agrega · F2 cobra)"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={handleSearchEnter}
                className="input w-full pl-9 pr-4 text-sm"
              />
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              <button
                onClick={() => setSelectedCategory(null)}
                className={cn(
                  'flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors',
                  !selectedCategory
                    ? 'bg-brand-500 text-white'
                    : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700',
                )}
              >
                Todos
              </button>
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id === selectedCategory ? null : cat.id)}
                  className={cn(
                    'flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors',
                    cat.id === selectedCategory
                      ? 'text-white'
                      : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200',
                  )}
                  style={cat.id === selectedCategory && cat.color ? { backgroundColor: cat.color } : undefined}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>

          {/* Product grid */}
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {loadingProducts ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 size={24} className="animate-spin text-brand-500" />
              </div>
            ) : products.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-surface-400">
                <Package size={32} className="mb-2 opacity-40" />
                <p className="text-sm">Sin productos</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {products.map(product => {
                  const inCart = cart.find(i => i.product.id === product.id);
                  const outOfStock = (product.stock ?? 0) <= 0;
                  return (
                    <button
                      key={product.id}
                      onClick={() => !outOfStock && addToCart(product)}
                      disabled={outOfStock}
                      className={cn(
                        'relative flex flex-col rounded-2xl border p-3 text-left transition-all',
                        outOfStock
                          ? 'opacity-40 cursor-not-allowed border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900'
                          : 'border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 hover:border-brand-400 hover:shadow-md hover:shadow-brand-500/10 active:scale-[0.98]',
                        inCart && !outOfStock && 'border-brand-400 bg-brand-50/50 dark:bg-brand-950/30',
                      )}
                    >
                      {inCart && (
                        <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-brand-500 text-white text-xs flex items-center justify-center font-bold">
                          {inCart.quantity}
                        </span>
                      )}
                      {product.image_url ? (
                        <img
                          src={product.image_url}
                          alt={product.name}
                          className="w-full aspect-square object-cover rounded-xl mb-2"
                        />
                      ) : (
                        <div className="w-full aspect-square rounded-xl bg-surface-100 dark:bg-surface-700 flex items-center justify-center mb-2">
                          <Package size={24} className="text-surface-400" />
                        </div>
                      )}
                      <p className="text-xs font-medium text-surface-800 dark:text-surface-200 leading-tight line-clamp-2">
                        {product.name}
                      </p>
                      <p className="text-sm font-bold text-brand-600 dark:text-brand-400 mt-1">
                        {formatCLP(product.price)}
                      </p>
                      <p className={cn(
                        'text-xs mt-0.5',
                        (product.stock ?? 0) <= (5) ? 'text-amber-500' : 'text-surface-400',
                      )}>
                        {outOfStock ? 'Sin stock' : `Stock: ${product.stock}`}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Cart + Recent sales (xl+ inline) ────────────────────── */}
        {!isCompact ? (
          <div className="hidden min-h-0 xl:flex w-96 shrink-0 flex-col bg-surface-50 dark:bg-surface-900/50">
            {cartPanelContent}
          </div>
        ) : null}
      </div>
      )}

      {/* ── Compact bottom action bar + sheet ────────────────────────────── */}
      {view === 'sell' && isCompact ? (
        <>
          <div className="sticky bottom-0 z-30 border-t border-surface-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-surface-800 dark:bg-surface-950/95">
            <button
              type="button"
              onClick={() => setCartSheetOpen(true)}
              className={cn(
                'flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition-colors',
                cartCount > 0
                  ? 'bg-brand-500 text-white shadow-lg shadow-brand-500/25'
                  : 'bg-surface-100 text-surface-500 dark:bg-surface-800',
              )}
            >
              <span className="flex items-center gap-2">
                <ShoppingCart size={18} />
                {cartCount > 0 ? `${cartCount} ${cartCount === 1 ? 'item' : 'items'}` : 'Carrito vacío'}
              </span>
              <span className="flex items-center gap-2">
                {cartCount > 0 ? formatCLP(total) : null}
                <ChevronRight size={16} />
              </span>
            </button>
          </div>
          <Drawer
            open={cartSheetOpen}
            onClose={() => setCartSheetOpen(false)}
            side="bottom"
            title="Carrito"
            bodyClassName="!px-0 !py-0"
          >
            <div className="flex h-full flex-col">{cartPanelContent}</div>
          </Drawer>
        </>
      ) : null}

      {/* ── Checkout Confirmation Modal ─────────────────────────────────────── */}
      <Modal open={checkoutOpen} title="Confirmar venta" onClose={() => setCheckoutOpen(false)}>
        <div className="space-y-4">
          <div className="bg-surface-50 dark:bg-surface-800/50 rounded-2xl p-4 space-y-2">
            {cart.map(item => (
              <div key={item.product.id} className="flex items-start justify-between gap-3 text-sm">
                <span className="min-w-0 flex-1 text-surface-600 dark:text-surface-400">
                  {item.product.name} × {item.quantity}
                </span>
                <span className="shrink-0 font-medium text-surface-800 dark:text-surface-200">
                  {formatCLP(item.product.price * item.quantity)}
                </span>
              </div>
            ))}
            {discount > 0 && (
              <div className="flex justify-between text-sm text-red-500 border-t border-surface-200 dark:border-surface-700 pt-2">
                <span>Descuento</span>
                <span>- {formatCLP(discount)}</span>
              </div>
            )}
            {giftShown > 0 && (
              <div className="flex justify-between text-sm text-emerald-600">
                <span>Gift card</span>
                <span>- {formatCLP(giftShown)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-lg border-t border-surface-200 dark:border-surface-700 pt-2">
              <span>Total</span>
              <span>{formatCLP(finalTotal)}</span>
            </div>
          </div>

          {/* Gift card (no aplica a fiado ni pago mixto) */}
          {!isCredit && !isMixed && (
          <div>
            <label className="text-xs text-surface-500 block mb-1">Gift card (opcional)</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={giftCode}
                onChange={e => { setGiftCode(e.target.value.toUpperCase()); setGiftApplied(0); }}
                placeholder="GIFT-XXXX-XXXX"
                className="input min-w-0 flex-1 text-sm font-mono"
              />
              <button
                type="button"
                onClick={validateGift}
                disabled={giftChecking || !giftCode.trim()}
                className="btn-secondary shrink-0 text-sm"
              >
                {giftChecking ? <Loader2 size={14} className="animate-spin" /> : 'Aplicar'}
              </button>
            </div>
            {giftApplied > 0 && (
              <p className="mt-1 text-xs text-emerald-600">Se descontarán {formatCLP(giftShown)} del total.</p>
            )}
          </div>
          )}

          <div className="flex items-center gap-2 p-3 bg-surface-100 dark:bg-surface-800 rounded-xl">
            <span className="text-sm text-surface-500">Pago:</span>
            <span className="font-medium text-surface-800 dark:text-white">{paymentLabel(paymentMethod)}</span>
          </div>

          {/* Vuelto (solo efectivo) */}
          {paymentMethod === 'cash' && (
            <div className="rounded-xl border border-surface-200 p-3 dark:border-surface-700">
              <label className="mb-1 block text-xs text-surface-500">Efectivo recibido (para calcular vuelto)</label>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={cashReceived || ''}
                onChange={e => setCashReceived(Math.max(0, Number(e.target.value) || 0))}
                placeholder={formatCLP(finalTotal)}
                className="input w-full text-sm"
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {[finalTotal, 1000, 2000, 5000, 10000, 20000].map((v, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setCashReceived(i === 0 ? finalTotal : Math.max(cashReceived, 0) + v)}
                    className="rounded-lg bg-surface-100 px-2.5 py-1 text-xs font-medium text-surface-600 hover:bg-surface-200 dark:bg-surface-700 dark:text-surface-300 dark:hover:bg-surface-600"
                  >
                    {i === 0 ? 'Exacto' : `+${formatCLP(v)}`}
                  </button>
                ))}
                {cashReceived > 0 && (
                  <button type="button" onClick={() => setCashReceived(0)} className="rounded-lg px-2 py-1 text-xs text-surface-500 dark:text-surface-400 hover:text-surface-600">
                    limpiar
                  </button>
                )}
              </div>
              {cashReceived > 0 && (
                <div className={cn(
                  'mt-2 flex items-center justify-between rounded-lg px-3 py-2 text-sm font-bold',
                  cashShort
                    ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'
                    : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
                )}>
                  <span>{cashShort ? 'Falta' : 'Vuelto'}</span>
                  <span>{formatCLP(cashShort ? finalTotal - cashReceived : change)}</span>
                </div>
              )}
            </div>
          )}

          {isCredit && (
            <div className="space-y-2 rounded-xl border border-brand-300 bg-brand-50/60 p-3 dark:border-brand-800 dark:bg-brand-950/30">
              <div className="flex items-center gap-2">
                <User size={15} className="shrink-0 text-brand-600 dark:text-brand-400" />
                <span className="text-sm text-surface-500">Fiar a:</span>
                <span className="truncate font-medium text-surface-800 dark:text-white">
                  {client ? `${client.first_name} ${client.last_name}` : '—'}
                </span>
              </div>
              {/* Saldo actual del socio */}
              {creditAccount && (
                <p className="text-xs text-surface-500">
                  Deuda actual: <span className="font-semibold text-surface-700 dark:text-surface-300">{formatCLP(currentBalance)}</span>
                  {creditLimit != null && <> · Límite: {formatCLP(creditLimit)}</>}
                </p>
              )}
              {/* Fiado parcial: abono al momento */}
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-surface-500">Abona ahora (opcional)</label>
                  <input
                    type="number"
                    min={0}
                    max={Math.max(0, finalTotal - 1)}
                    inputMode="numeric"
                    value={downPayment || ''}
                    onChange={e => setDownPayment(Math.max(0, Number(e.target.value) || 0))}
                    placeholder="0"
                    className="input w-full text-sm"
                  />
                </div>
                <div className="w-32">
                  <label className="mb-1 block text-xs text-surface-500">Medio</label>
                  <select value={downMethod} onChange={e => setDownMethod(e.target.value)} className="input w-full text-sm">
                    {ABONO_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex justify-between border-t border-brand-200 pt-2 text-sm dark:border-brand-800">
                <span className="text-surface-500">Queda fiado</span>
                <span className="font-bold text-surface-800 dark:text-white">{formatCLP(creditDebt)}</span>
              </div>
              {overCreditLimit && (
                <p className={cn(
                  'rounded-lg px-2.5 py-2 text-xs font-medium',
                  creditBlocked
                    ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400'
                    : 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400',
                )}>
                  {creditBlocked ? 'Bloqueado: ' : 'Atención: '}
                  la deuda quedaría en {formatCLP(projectedBalance)}, sobre el límite de {formatCLP(creditLimit ?? 0)}.
                </p>
              )}
            </div>
          )}

          {!isCredit && client && (
            <div className="flex items-center gap-2 rounded-xl border border-surface-200 p-3 dark:border-surface-700">
              <User size={15} className="shrink-0 text-surface-400" />
              <span className="text-sm text-surface-500">Socio:</span>
              <span className="truncate font-medium text-surface-800 dark:text-white">{client.first_name} {client.last_name}</span>
            </div>
          )}

          {isMixed && (
            <div className="rounded-xl border border-surface-200 p-3 dark:border-surface-700">
              <p className="mb-2 text-xs font-medium text-surface-500">Desglose del pago</p>
              <div className="space-y-1">
                {mixedRows.map((r, idx) => (
                  <div key={idx} className="flex justify-between text-sm">
                    <span className="text-surface-600 dark:text-surface-400">{paymentLabel(r.method)}</span>
                    <span className="font-medium text-surface-800 dark:text-surface-200">{formatCLP(Number(r.amount) || 0)}</span>
                  </div>
                ))}
              </div>
              {mixedRemaining !== 0 && (
                <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">Falta asignar {formatCLP(mixedRemaining)}.</p>
              )}
            </div>
          )}

          <div>
            <label className="text-xs text-surface-500 block mb-1">Notas (opcional)</label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Ej: cliente frecuente"
              className="input w-full text-sm"
            />
          </div>

          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row">
            <button
              onClick={() => setCheckoutOpen(false)}
              className="flex-1 py-2.5 rounded-xl border border-surface-200 dark:border-surface-700
                         text-sm font-medium text-surface-600 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800"
            >
              Cancelar
            </button>
            <button
              onClick={handleCheckout}
              disabled={saleMutation.isPending || (isCredit && !client) || !mixedValid || creditBlocked}
              className="flex-1 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-sm
                         flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {saleMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <ChevronRight size={16} />}
              {isCredit ? 'Confirmar fiado' : 'Confirmar cobro'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Abrir caja ──────────────────────────────────────────────────────── */}
      <Modal open={openCajaModal} title="Abrir caja" onClose={() => setOpenCajaModal(false)}>
        <div className="space-y-4">
          <p className="text-sm text-surface-500 dark:text-surface-400">
            Ingresa el efectivo con que abres el turno (fondo inicial).
          </p>
          <div>
            <label className="text-xs text-surface-500 block mb-1">Fondo inicial ($)</label>
            <input
              type="number"
              min={0}
              value={openingAmount || ''}
              onChange={e => setOpeningAmount(Number(e.target.value) || 0)}
              placeholder="0"
              className="input w-full text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-surface-500 block mb-1">Notas (opcional)</label>
            <input
              type="text"
              value={cajaNotes}
              onChange={e => setCajaNotes(e.target.value)}
              className="input w-full text-sm"
            />
          </div>
          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row">
            <button
              onClick={() => setOpenCajaModal(false)}
              className="flex-1 py-2.5 rounded-xl border border-surface-200 dark:border-surface-700 text-sm font-medium text-surface-600 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800"
            >
              Cancelar
            </button>
            <button
              onClick={() => openCajaMutation.mutate({ opening_amount: openingAmount, notes: cajaNotes || undefined })}
              disabled={openCajaMutation.isPending}
              className="flex-1 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {openCajaMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Unlock size={16} />}
              Abrir caja
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Cerrar caja (arqueo) ────────────────────────────────────────────── */}
      <Modal open={closeCajaModal} title="Cerrar caja" onClose={() => setCloseCajaModal(false)}>
        <div className="space-y-4">
          {session && (
            <div className="bg-surface-50 dark:bg-surface-800/50 rounded-2xl p-4 space-y-2 text-sm">
              <div className="flex justify-between text-surface-500">
                <span>Fondo inicial</span><span>{formatCLP(session.opening_amount)}</span>
              </div>
              <div className="flex justify-between text-surface-500">
                <span>Ventas en efectivo</span><span>{formatCLP(session.cash_sales)}</span>
              </div>
              {Number(session.membership_cash ?? 0) > 0 && (
                <div className="flex justify-between text-surface-500">
                  <span>Membresías en efectivo</span><span>+{formatCLP(session.membership_cash)}</span>
                </div>
              )}
              {Number(session.cash_credit_payments ?? 0) > 0 && (
                <div className="flex justify-between text-surface-500">
                  <span>Abonos de fiados en efectivo</span><span>+{formatCLP(session.cash_credit_payments)}</span>
                </div>
              )}
              {Number(session.cash_refunds ?? 0) > 0 && (
                <div className="flex justify-between text-rose-600 dark:text-rose-400">
                  <span>Devoluciones en efectivo</span><span>−{formatCLP(session.cash_refunds)}</span>
                </div>
              )}
              {Number(session.cash_expenses ?? 0) > 0 && (
                <div className="flex justify-between text-rose-600 dark:text-rose-400">
                  <span>Gastos pagados de caja</span><span>−{formatCLP(session.cash_expenses)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold border-t border-surface-200 dark:border-surface-700 pt-2">
                <span>Efectivo esperado</span><span>{formatCLP(expectedCash)}</span>
              </div>
              <div className="flex justify-between text-surface-500 pt-1">
                <span>Total ventas turno</span><span>{formatCLP(session.sales_total)} ({session.sales_count})</span>
              </div>
              {/* Fiados del turno (informativo: no afecta el efectivo salvo abonos cash) */}
              {(Number(session.credit_given ?? 0) > 0 || (session.credit_payments_by_method?.length ?? 0) > 0) && (
                <div className="border-t border-dashed border-surface-200 pt-2 dark:border-surface-700">
                  <p className="mb-1 text-xs font-medium text-surface-400">Fiados (no entra a caja salvo abonos en efectivo)</p>
                  {Number(session.credit_given ?? 0) > 0 && (
                    <div className="flex justify-between text-surface-500">
                      <span>Fiado otorgado en el turno</span><span>{formatCLP(session.credit_given)}</span>
                    </div>
                  )}
                  {session.credit_payments_by_method?.map(cp => (
                    <div key={cp.method} className="flex justify-between text-surface-500">
                      <span>Abonos recibidos · {cp.label}</span><span>{formatCLP(cp.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <div>
            <label className="text-xs text-surface-500 block mb-1">Efectivo contado ($)</label>
            <input
              type="number"
              min={0}
              value={closingAmount || ''}
              onChange={e => setClosingAmount(Number(e.target.value) || 0)}
              placeholder="0"
              className="input w-full text-sm"
            />
          </div>
          {closingAmount > 0 && (
            <div className={cn(
              'flex justify-between rounded-xl px-3 py-2 text-sm font-semibold',
              closingAmount - expectedCash === 0
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                : 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400',
            )}>
              <span>Diferencia</span>
              <span>{closingAmount - expectedCash >= 0 ? '+' : ''}{formatCLP(closingAmount - expectedCash)}</span>
            </div>
          )}
          <div>
            <label className="text-xs text-surface-500 block mb-1">Notas de cierre (opcional)</label>
            <input
              type="text"
              value={cajaNotes}
              onChange={e => setCajaNotes(e.target.value)}
              className="input w-full text-sm"
            />
          </div>
          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row">
            <button
              onClick={() => setCloseCajaModal(false)}
              className="flex-1 py-2.5 rounded-xl border border-surface-200 dark:border-surface-700 text-sm font-medium text-surface-600 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800"
            >
              Cancelar
            </button>
            <button
              onClick={() => session && closeCajaMutation.mutate({ id: session.id, data: { closing_amount: closingAmount, notes: cajaNotes || undefined } })}
              disabled={closeCajaMutation.isPending || !session}
              className="flex-1 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {closeCajaMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Lock size={16} />}
              Cerrar caja
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Devolución (parcial o total) ─────────────────────────────────────── */}
      <Modal open={!!refundTx} title="Devolver venta" onClose={() => setRefundTx(null)}>
        {refundTx && (
          <div className="space-y-4">
            <p className="text-sm text-surface-500 dark:text-surface-400">
              Elige las unidades a devolver. El stock se repone y, si fue fiado, baja la deuda del socio.
            </p>
            <div className="rounded-2xl border border-surface-200 dark:border-surface-800">
              {refundTx.items.map(item => {
                const remaining = Math.max(0, item.quantity - (item.refunded_quantity ?? 0));
                const qty = refundQty[item.id] ?? 0;
                return (
                  <div key={item.id} className="flex items-center justify-between gap-3 border-b border-surface-100 px-3 py-2.5 last:border-0 dark:border-surface-800">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-surface-800 dark:text-surface-200">{item.product_name}</p>
                      <p className="text-xs text-surface-500 dark:text-surface-400">
                        {formatCLP(item.unit_price)} c/u · {remaining} de {item.quantity} por devolver
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setRefundQty(p => ({ ...p, [item.id]: Math.max(0, (p[item.id] ?? 0) - 1) }))}
                        disabled={qty <= 0}
                        className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-100 disabled:opacity-40 dark:bg-surface-700"
                      >
                        <Minus size={13} />
                      </button>
                      <span className="w-7 text-center text-sm font-bold text-surface-800 dark:text-white">{qty}</span>
                      <button
                        type="button"
                        onClick={() => setRefundQty(p => ({ ...p, [item.id]: Math.min(remaining, (p[item.id] ?? 0) + 1) }))}
                        disabled={qty >= remaining}
                        className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-100 disabled:opacity-40 dark:bg-surface-700"
                      >
                        <Plus size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between rounded-xl bg-surface-50 px-3 py-2.5 dark:bg-surface-800/50">
              <span className="text-sm text-surface-500">A devolver (aprox.)</span>
              <span className="text-lg font-bold text-rose-600 dark:text-rose-400">{formatCLP(refundTotalEstimate)}</span>
            </div>

            <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row">
              <button
                onClick={() => setRefundTx(null)}
                className="flex-1 rounded-xl border border-surface-200 py-2.5 text-sm font-medium text-surface-600 hover:bg-surface-50 dark:border-surface-700 dark:text-surface-400 dark:hover:bg-surface-800"
              >
                Cancelar
              </button>
              <button
                onClick={submitRefund}
                disabled={refundMutation.isPending || refundTotalEstimate <= 0}
                className="flex-1 rounded-xl bg-rose-600 py-2.5 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {refundMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Receipt size={16} />}
                Confirmar devolución
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Comprobante de venta (pantalla + PDF) ────────────────────────────── */}
      <Modal open={!!receiptTx} title="Comprobante de venta" onClose={closeReceipt}>
        {receiptTx && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-surface-200 bg-white p-4 dark:border-surface-700 dark:bg-surface-900">
              <div className="text-center">
                <p className="text-base font-bold text-surface-900 dark:text-white">{gymSettings?.gym_name ?? 'Punto de venta'}</p>
                {(gymSettings?.address || gymSettings?.city) && (
                  <p className="text-xs text-surface-500 dark:text-surface-400">{[gymSettings?.address, gymSettings?.city].filter(Boolean).join(', ')}</p>
                )}
                {gymSettings?.phone && <p className="text-xs text-surface-500 dark:text-surface-400">{gymSettings.phone}</p>}
              </div>
              <div className="my-3 border-t border-dashed border-surface-300 dark:border-surface-600" />
              <div className="space-y-0.5 text-xs text-surface-500 dark:text-surface-400">
                <div className="flex justify-between"><span>Comprobante</span><span className="font-mono">#{receiptTx.id.slice(0, 8).toUpperCase()}</span></div>
                <div className="flex justify-between"><span>Fecha</span><span>{new Date(receiptTx.sold_at).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div>
                {receiptTx.cashier_name && <div className="flex justify-between"><span>Cajero</span><span>{receiptTx.cashier_name}</span></div>}
                {receiptTx.client_name && <div className="flex justify-between"><span>Socio</span><span>{receiptTx.client_name}</span></div>}
              </div>
              <div className="my-3 border-t border-dashed border-surface-300 dark:border-surface-600" />
              <div className="space-y-1.5">
                {receiptTx.items.map(i => (
                  <div key={i.id} className="flex justify-between gap-3 text-sm">
                    <span className="min-w-0 text-surface-700 dark:text-surface-300">
                      {i.product_name}
                      <span className="block text-xs text-surface-500 dark:text-surface-400">{i.quantity} × {formatCLP(i.unit_price)}</span>
                    </span>
                    <span className="shrink-0 font-medium text-surface-800 dark:text-surface-200">{formatCLP(i.subtotal)}</span>
                  </div>
                ))}
              </div>
              <div className="my-3 border-t border-dashed border-surface-300 dark:border-surface-600" />
              <div className="space-y-1 text-sm">
                <div className="flex justify-between text-surface-500"><span>Subtotal</span><span>{formatCLP(receiptTx.subtotal)}</span></div>
                {Number(receiptTx.discount_amount) > 0 && <div className="flex justify-between text-rose-600 dark:text-rose-400"><span>Descuento</span><span>- {formatCLP(receiptTx.discount_amount)}</span></div>}
                {Number(receiptTx.gift_card_amount ?? 0) > 0 && <div className="flex justify-between text-emerald-600"><span>Gift card</span><span>- {formatCLP(receiptTx.gift_card_amount!)}</span></div>}
                <div className="flex justify-between border-t border-surface-200 pt-1 text-lg font-bold text-surface-900 dark:border-surface-700 dark:text-white"><span>Total</span><span>{formatCLP(receiptTx.total)}</span></div>
              </div>
              <div className="my-3 border-t border-dashed border-surface-300 dark:border-surface-600" />
              <div className="space-y-1 text-sm">
                {receiptTx.payment_method === 'mixed' && receiptTx.payments?.length
                  ? receiptTx.payments.map((p, i) => (
                      <div key={i} className="flex justify-between text-surface-600 dark:text-surface-400"><span>{paymentLabel(p.method)}</span><span>{formatCLP(p.amount)}</span></div>
                    ))
                  : <div className="flex justify-between text-surface-600 dark:text-surface-400"><span>Medio de pago</span><span>{paymentLabel(receiptTx.payment_method)}</span></div>}
                {receiptExtra.cashReceived != null && receiptExtra.cashReceived > 0 && (
                  <>
                    <div className="flex justify-between text-surface-600 dark:text-surface-400"><span>Efectivo recibido</span><span>{formatCLP(receiptExtra.cashReceived)}</span></div>
                    <div className="flex justify-between font-semibold text-surface-800 dark:text-surface-200"><span>Vuelto</span><span>{formatCLP(receiptExtra.change ?? 0)}</span></div>
                  </>
                )}
              </div>
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row">
              <button
                onClick={doPrintReceipt}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-surface-200 py-2.5 text-sm font-medium text-surface-700 hover:bg-surface-50 dark:border-surface-700 dark:text-surface-300 dark:hover:bg-surface-800"
              >
                <Printer size={16} /> Imprimir / PDF
              </button>
              <button
                onClick={closeReceipt}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand-500 py-2.5 text-sm font-bold text-white hover:bg-brand-600"
              >
                <Check size={16} /> Nueva venta
              </button>
            </div>
            <p className="text-center text-xs text-surface-500 dark:text-surface-400">Enter = nueva venta · P = imprimir</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
