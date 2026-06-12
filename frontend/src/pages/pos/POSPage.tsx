import { useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ShoppingCart, Search, Plus, Minus, CreditCard,
  Banknote, Package, ChevronRight, X, Loader2, Receipt,
  Lock, Unlock, Wallet, Users, User, ArrowLeft, Coins,
} from 'lucide-react';
import Modal from '@/components/ui/Modal';
import Drawer from '@/components/ui/Drawer';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { posApi, giftCardsApi, clientsApi } from '@/services/api';
import { cn, getApiError } from '@/utils';
import type {
  Product, ProductCategory, POSTransaction, CashSession,
  ClientDebtor, ClientAccountStatement, DebtorsResponse,
} from '@/types';

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

function RecentSaleRow({ tx, onRefund }: { tx: POSTransaction; onRefund: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-2 border-b border-surface-100 py-2 last:border-0 dark:border-surface-800 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium text-surface-800 dark:text-surface-200 truncate">
          {tx.items.map(i => i.product_name).join(', ')}
        </p>
        <p className="text-xs text-surface-400">
          {new Date(tx.sold_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })} · {paymentLabel(tx.payment_method)}
        </p>
      </div>
      <div className="flex items-center gap-2 sm:flex-shrink-0">
        <span className={cn(
          'text-sm font-bold',
          tx.status === 'refunded' ? 'text-surface-400 line-through' : 'text-emerald-600 dark:text-emerald-400',
        )}>
          {formatCLP(tx.total)}
        </span>
        {tx.status === 'completed' && (
          <button
            onClick={() => onRefund(tx.id)}
            className="text-xs text-red-500 hover:text-red-700 underline"
          >
            Devolver
          </button>
        )}
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
        <div className="absolute z-20 mt-1 max-h-44 w-full overflow-y-auto rounded-xl border border-surface-200 bg-white shadow-lg dark:border-surface-700 dark:bg-surface-800">
          {isFetching ? (
            <div className="flex items-center justify-center py-3"><Loader2 size={16} className="animate-spin text-brand-500" /></div>
          ) : results.length === 0 ? (
            <p className="px-3 py-3 text-xs text-surface-400">Sin resultados</p>
          ) : results.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => { onChange(c); setQ(''); }}
              className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-surface-50 dark:hover:bg-surface-700/50"
            >
              <span className="text-sm font-medium text-surface-800 dark:text-surface-200">{c.first_name} {c.last_name}</span>
              {c.email && <span className="text-xs text-surface-400">{c.email}</span>}
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

  const { data: debtors, isLoading } = useQuery<DebtorsResponse>({
    queryKey: ['pos-debtors'],
    queryFn: () => posApi.accountDebtors().then(r => r.data),
  });

  const { data: statement, isLoading: loadingStatement } = useQuery<ClientAccountStatement>({
    queryKey: ['pos-statement', selected?.client_id],
    queryFn: () => posApi.accountStatement(selected!.client_id).then(r => r.data),
    enabled: !!selected,
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
            {selected.email && <p className="text-sm text-surface-400">{selected.email}</p>}
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-surface-400">Saldo deudor</p>
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
            <p className="mt-2 text-xs text-surface-400">Un abono en efectivo entra al arqueo del turno de caja abierto.</p>
          )}
        </div>

        {/* Movimientos */}
        <h3 className="mb-2 text-sm font-semibold text-surface-700 dark:text-surface-300">Movimientos</h3>
        {loadingStatement ? (
          <div className="flex items-center justify-center py-8"><Loader2 size={20} className="animate-spin text-brand-500" /></div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-surface-200 dark:border-surface-800">
            {statement?.entries.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-surface-400">Sin movimientos</p>
            ) : statement?.entries.map(e => (
              <div key={e.id} className="flex items-center justify-between gap-3 border-b border-surface-100 px-4 py-2.5 last:border-0 dark:border-surface-800">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-surface-800 dark:text-surface-200">
                    {e.kind === 'charge' ? 'Cargo (venta a crédito)' : `Abono${e.payment_method ? ` · ${paymentLabel(e.payment_method)}` : ''}`}
                  </p>
                  <p className="text-xs text-surface-400">
                    {new Date(e.created_at).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    {e.created_by_name ? ` · ${e.created_by_name}` : ''}
                    {e.notes ? ` · ${e.notes}` : ''}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={cn('text-sm font-bold', e.kind === 'charge' ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400')}>
                    {e.kind === 'charge' ? '+' : '−'}{formatCLP(e.amount)}
                  </p>
                  <p className="text-xs text-surface-400">saldo {formatCLP(e.balance_after)}</p>
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
            <p className="text-xs uppercase tracking-wide text-surface-400">Total por cobrar</p>
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
                <p className="text-xs text-surface-400">
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
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState('');
  const [giftCode, setGiftCode] = useState('');
  const [giftApplied, setGiftApplied] = useState(0);
  const [giftChecking, setGiftChecking] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const isCompact = useMediaQuery('(max-width: 1279px)');
  const [cartSheetOpen, setCartSheetOpen] = useState(false);
  const [view, setView] = useState<'sell' | 'fiados'>('sell');
  const [creditClient, setCreditClient] = useState<ClientLite | null>(null);

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

  // ── Mutations ─────────────────────────────────────────────────────────────
  const saleMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => posApi.createTransaction(data),
    onSuccess: () => {
      toast.success('Venta registrada');
      setCart([]);
      setDiscount(0);
      setNotes('');
      setGiftCode('');
      setGiftApplied(0);
      setCreditClient(null);
      setPaymentMethod('cash');
      setCheckoutOpen(false);
      queryClient.invalidateQueries({ queryKey: ['pos-transactions-today'] });
      queryClient.invalidateQueries({ queryKey: ['pos-products'] });
      queryClient.invalidateQueries({ queryKey: ['pos-cash-session'] });
      queryClient.invalidateQueries({ queryKey: ['pos-debtors'] });
    },
    onError: (err) => toast.error(getApiError(err)),
  });

  const refundMutation = useMutation({
    mutationFn: (id: string) => posApi.refundTransaction(id),
    onSuccess: () => {
      toast.success('Devolución registrada');
      queryClient.invalidateQueries({ queryKey: ['pos-transactions-today'] });
      queryClient.invalidateQueries({ queryKey: ['pos-products'] });
      queryClient.invalidateQueries({ queryKey: ['pos-cash-session'] });
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
  const canCheckout = cart.length > 0 && hasOpenCaja && (!isCredit || !!creditClient);

  function handleCheckout() {
    if (isCredit && !creditClient) {
      toast.error('Selecciona el socio para fiar');
      return;
    }
    saleMutation.mutate({
      items: cart.map(i => ({ product_id: i.product.id, quantity: i.quantity })),
      payment_method: paymentMethod,
      discount_amount: discount,
      gift_card_code: !isCredit && giftApplied > 0 && giftCode.trim() ? giftCode.trim() : undefined,
      notes: notes || undefined,
      client_id: isCredit ? creditClient!.id : undefined,
    });
  }

  const cartCount = cart.reduce((s, i) => s + i.quantity, 0);

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
                <p className="text-xs text-surface-400">{formatCLP(item.product.price)} c/u</p>
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
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="text-xs text-surface-500 sm:flex-shrink-0">Descuento ($)</label>
          <input
            type="number"
            min={0}
            value={discount || ''}
            onChange={e => setDiscount(Number(e.target.value) || 0)}
            placeholder="0"
            className="input min-w-0 flex-1 text-sm"
          />
        </div>

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
              onClick={() => setPaymentMethod(pm.value)}
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

        {isCredit && (
          <div className="space-y-1">
            <label className="text-xs text-surface-500">Socio a fiar</label>
            <ClientPicker value={creditClient} onChange={setCreditClient} />
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
            <p className="text-xs font-semibold text-surface-400 uppercase tracking-wide mb-2">Últimas ventas</p>
            <div className="max-h-40 overflow-y-auto">
              {todaySales.slice(0, 10).map(tx => (
                <RecentSaleRow key={tx.id} tx={tx} onRefund={id => refundMutation.mutate(id)} />
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
                type="text"
                placeholder="Buscar producto, SKU..."
                value={search}
                onChange={e => setSearch(e.target.value)}
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

          {/* Gift card (no aplica a ventas fiadas) */}
          {!isCredit && (
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

          {isCredit && (
            <div className="flex items-center gap-2 rounded-xl border border-brand-300 bg-brand-50/60 p-3 dark:border-brand-800 dark:bg-brand-950/30">
              <User size={15} className="shrink-0 text-brand-600 dark:text-brand-400" />
              <span className="text-sm text-surface-500">Fiar a:</span>
              <span className="truncate font-medium text-surface-800 dark:text-white">
                {creditClient ? `${creditClient.first_name} ${creditClient.last_name}` : '—'}
              </span>
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
              disabled={saleMutation.isPending || (isCredit && !creditClient)}
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
    </div>
  );
}
