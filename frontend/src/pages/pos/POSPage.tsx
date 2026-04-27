import { useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ShoppingCart, Search, Plus, Minus, CreditCard,
  Banknote, Package, ChevronRight, X, Loader2, Receipt,
} from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { posApi } from '@/services/api';
import { cn, getApiError } from '@/utils';
import type { Product, ProductCategory, POSTransaction } from '@/types';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CartItem {
  product: Product;
  quantity: number;
}

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Efectivo', icon: <Banknote size={16} /> },
  { value: 'transfer', label: 'Transferencia', icon: <CreditCard size={16} /> },
  { value: 'other', label: 'Otro', icon: <Receipt size={16} /> },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCLP(n: number) {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
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
          {new Date(tx.sold_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })} · {tx.payment_method}
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

  // ── Queries ────────────────────────────────────────────────────────────────
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

  const today = new Date().toISOString().slice(0, 10);
  const { data: todaySales = [] } = useQuery<POSTransaction[]>({
    queryKey: ['pos-transactions-today'],
    queryFn: () => posApi.listTransactions({ from_date: `${today}T00:00:00`, size: 20 }).then(r => r.data),
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
    },
    onError: (err) => toast.error(getApiError(err)),
  });

  const refundMutation = useMutation({
    mutationFn: (id: string) => posApi.refundTransaction(id),
    onSuccess: () => {
      toast.success('Devolución registrada');
      queryClient.invalidateQueries({ queryKey: ['pos-transactions-today'] });
      queryClient.invalidateQueries({ queryKey: ['pos-products'] });
    },
    onError: (err) => toast.error(getApiError(err)),
  });

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
    .reduce((s, t) => s + t.total, 0);

  // ── Checkout ──────────────────────────────────────────────────────────────
  function handleCheckout() {
    saleMutation.mutate({
      items: cart.map(i => ({ product_id: i.product.id, quantity: i.quantity })),
      payment_method: paymentMethod,
      discount_amount: discount,
      notes: notes || undefined,
    });
  }

  return (
    <div className="flex min-h-full flex-col gap-0">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-surface-200 px-4 py-4 dark:border-surface-800 sm:px-6">
        <div>
          <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Punto de Venta</h1>
          <p className="text-sm text-surface-500 dark:text-surface-400">
            Ventas hoy: <span className="font-semibold text-emerald-600">{formatCLP(todayRevenue)}</span>
          </p>
        </div>
      </div>

      {/* Main split layout */}
      <div className="flex flex-1 flex-col xl:flex-row xl:overflow-hidden">
        {/* ── Left: Catalog ──────────────────────────────────────────────── */}
        <div className="flex flex-1 flex-col overflow-hidden xl:border-r xl:border-surface-200 xl:dark:border-surface-800">
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
          <div className="flex-1 overflow-y-auto p-4">
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

        {/* ── Right: Cart + Recent sales ─────────────────────────────────── */}
        <div className="w-full shrink-0 border-t border-surface-200 bg-surface-50 dark:border-surface-800 dark:bg-surface-900/50 xl:w-96 xl:border-t-0">
          {/* Cart items */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
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
          <div className="border-t border-surface-200 dark:border-surface-800 p-4 space-y-3">
            {/* Discount */}
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

            {/* Subtotal / total */}
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

            {/* Payment method */}
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
              onClick={() => cart.length > 0 && setCheckoutOpen(true)}
              disabled={cart.length === 0}
              className={cn(
                'w-full py-3 rounded-2xl font-bold text-sm transition-all flex items-center justify-center gap-2',
                cart.length > 0
                  ? 'bg-brand-500 hover:bg-brand-600 text-white shadow-lg shadow-brand-500/25 active:scale-[0.98]'
                  : 'bg-surface-100 dark:bg-surface-800 text-surface-400 cursor-not-allowed',
              )}
            >
              <ShoppingCart size={16} />
              Cobrar {cart.length > 0 ? formatCLP(total) : ''}
            </button>

            {/* Recent sales */}
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
        </div>
      </div>

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
            <span className="font-medium text-surface-800 dark:text-white capitalize">{paymentMethod}</span>
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
    </div>
  );
}
