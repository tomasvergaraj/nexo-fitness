import { useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ShoppingCart, Search, Plus, Minus, CreditCard,
  Banknote, Package, ChevronRight, X, Loader2, Receipt,
  Lock, Unlock, Wallet,
} from 'lucide-react';
import Modal from '@/components/ui/Modal';
import Drawer from '@/components/ui/Drawer';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { posApi } from '@/services/api';
import { cn, getApiError } from '@/utils';
import type { Product, ProductCategory, POSTransaction, CashSession } from '@/types';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CartItem {
  product: Product;
  quantity: number;
}

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Efectivo', icon: <Banknote size={16} /> },
  { value: 'debit_card', label: 'Débito', icon: <CreditCard size={16} /> },
  { value: 'credit_card', label: 'Crédito', icon: <CreditCard size={16} /> },
  { value: 'transfer', label: 'Transferencia', icon: <Wallet size={16} /> },
  { value: 'other', label: 'Otro', icon: <Receipt size={16} /> },
];

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  debit_card: 'Débito',
  credit_card: 'Crédito',
  transfer: 'Transferencia',
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

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function POSPage() {
  const queryClient = useQueryClient();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState('');
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const isCompact = useMediaQuery('(max-width: 1279px)');
  const [cartSheetOpen, setCartSheetOpen] = useState(false);

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
      setCheckoutOpen(false);
      queryClient.invalidateQueries({ queryKey: ['pos-transactions-today'] });
      queryClient.invalidateQueries({ queryKey: ['pos-products'] });
      queryClient.invalidateQueries({ queryKey: ['pos-cash-session'] });
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

  const expectedCash = session ? Number(session.opening_amount) + Number(session.cash_sales) : 0;

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

  // ── Checkout ──────────────────────────────────────────────────────────────
  function handleCheckout() {
    saleMutation.mutate({
      items: cart.map(i => ({ product_id: i.product.id, quantity: i.quantity })),
      payment_method: paymentMethod,
      discount_amount: discount,
      notes: notes || undefined,
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

        <button
          onClick={() => {
            if (cart.length === 0 || !hasOpenCaja) return;
            setCartSheetOpen(false);
            setCheckoutOpen(true);
          }}
          disabled={cart.length === 0 || !hasOpenCaja}
          className={cn(
            'w-full py-3 rounded-2xl font-bold text-sm transition-all flex items-center justify-center gap-2',
            cart.length > 0 && hasOpenCaja
              ? 'bg-brand-500 hover:bg-brand-600 text-white shadow-lg shadow-brand-500/25 active:scale-[0.98]'
              : 'bg-surface-100 dark:bg-surface-800 text-surface-400 cursor-not-allowed',
          )}
        >
          <ShoppingCart size={16} />
          Cobrar {cart.length > 0 ? formatCLP(total) : ''}
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

        {hasOpenCaja && session && (
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

      {/* Main split layout */}
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

      {/* ── Compact bottom action bar + sheet ────────────────────────────── */}
      {isCompact ? (
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
            <div className="flex justify-between font-bold text-lg border-t border-surface-200 dark:border-surface-700 pt-2">
              <span>Total</span>
              <span>{formatCLP(total)}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 p-3 bg-surface-100 dark:bg-surface-800 rounded-xl">
            <span className="text-sm text-surface-500">Pago:</span>
            <span className="font-medium text-surface-800 dark:text-white">{paymentLabel(paymentMethod)}</span>
          </div>

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
              disabled={saleMutation.isPending}
              className="flex-1 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-sm
                         flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {saleMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <ChevronRight size={16} />}
              Confirmar cobro
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
