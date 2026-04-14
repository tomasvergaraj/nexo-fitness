import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Package, TrendingDown, ShoppingBag, Truck, Plus, Edit2, Trash2,
  AlertTriangle, Loader2, ArrowUp, ArrowDown, Check, X,
} from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { posApi } from '@/services/api';
import { cn, getApiError } from '@/utils';
import type {
  Product, ProductCategory, InventoryItem, InventoryMovement,
  Supplier, PurchaseOrder,
} from '@/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCLP(n: number) {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
}

const MOVEMENT_LABELS: Record<string, string> = {
  purchase: 'Compra', sale: 'Venta', adjustment: 'Ajuste',
  return: 'Devolución', loss: 'Pérdida', transfer: 'Transferencia',
};

const UNIT_LABELS: Record<string, string> = {
  unit: 'und', kg: 'kg', liter: 'L', gram: 'g', ml: 'ml',
};

const PO_STATUS_LABELS: Record<string, string> = {
  draft: 'Borrador', ordered: 'Ordenado', received: 'Recibido', cancelled: 'Cancelado',
};

const PO_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-400',
  ordered: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  received: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400',
};

const TABS = ['Productos', 'Movimientos', 'Compras', 'Proveedores'] as const;
type Tab = typeof TABS[number];

// ─── Products Tab ─────────────────────────────────────────────────────────────

function ProductsTab() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [stockModalOpen, setStockModalOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [adjustingProduct, setAdjustingProduct] = useState<Product | null>(null);
  const [form, setForm] = useState({
    name: '', sku: '', price: '', cost: '', unit: 'unit', category_id: '',
    description: '', barcode: '',
  });
  const [stockForm, setStockForm] = useState({ quantity: '', min_stock: '' });

  const { data: products = [], isLoading } = useQuery<Product[]>({
    queryKey: ['pos-products-all'],
    queryFn: () => posApi.listProducts({ size: 200 }).then(r => r.data),
  });
  const { data: categories = [] } = useQuery<ProductCategory[]>({
    queryKey: ['pos-categories'],
    queryFn: () => posApi.listCategories().then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => posApi.createProduct(data),
    onSuccess: () => { toast.success('Producto creado'); setModalOpen(false); queryClient.invalidateQueries({ queryKey: ['pos-products'] }); queryClient.invalidateQueries({ queryKey: ['pos-products-all'] }); },
    onError: (err) => toast.error(getApiError(err)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => posApi.updateProduct(id, data),
    onSuccess: () => { toast.success('Producto actualizado'); setModalOpen(false); queryClient.invalidateQueries({ queryKey: ['pos-products'] }); queryClient.invalidateQueries({ queryKey: ['pos-products-all'] }); },
    onError: (err) => toast.error(getApiError(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => posApi.deleteProduct(id),
    onSuccess: () => { toast.success('Producto desactivado'); queryClient.invalidateQueries({ queryKey: ['pos-products-all'] }); },
    onError: (err) => toast.error(getApiError(err)),
  });

  const adjustMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => posApi.adjustStock(id, data),
    onSuccess: () => { toast.success('Stock actualizado'); setStockModalOpen(false); queryClient.invalidateQueries({ queryKey: ['pos-products-all'] }); queryClient.invalidateQueries({ queryKey: ['pos-products'] }); },
    onError: (err) => toast.error(getApiError(err)),
  });

  function openCreate() {
    setEditing(null);
    setForm({ name: '', sku: '', price: '', cost: '', unit: 'unit', category_id: '', description: '', barcode: '' });
    setModalOpen(true);
  }

  function openEdit(p: Product) {
    setEditing(p);
    setForm({
      name: p.name, sku: p.sku || '', price: String(p.price), cost: String(p.cost),
      unit: p.unit, category_id: p.category_id || '', description: p.description || '',
      barcode: p.barcode || '',
    });
    setModalOpen(true);
  }

  function openAdjust(p: Product) {
    setAdjustingProduct(p);
    setStockForm({ quantity: String(p.stock ?? 0), min_stock: '' });
    setStockModalOpen(true);
  }

  function handleSubmit() {
    const data: Record<string, unknown> = {
      name: form.name,
      price: Number(form.price),
      cost: Number(form.cost),
      unit: form.unit,
    };
    if (form.sku) data.sku = form.sku;
    if (form.barcode) data.barcode = form.barcode;
    if (form.description) data.description = form.description;
    if (form.category_id) data.category_id = form.category_id;

    if (editing) {
      updateMutation.mutate({ id: editing.id, data });
    } else {
      createMutation.mutate(data);
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-surface-500">{products.length} productos</p>
        <button onClick={openCreate} className="btn-primary flex items-center gap-1.5 text-sm px-3 py-2">
          <Plus size={15} /> Nuevo producto
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-brand-500" /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-surface-400 border-b border-surface-200 dark:border-surface-800">
                <th className="pb-2 pr-4 font-medium">Producto</th>
                <th className="pb-2 pr-4 font-medium">SKU</th>
                <th className="pb-2 pr-4 font-medium">Precio</th>
                <th className="pb-2 pr-4 font-medium">Costo</th>
                <th className="pb-2 pr-4 font-medium">Stock</th>
                <th className="pb-2 pr-4 font-medium">Estado</th>
                <th className="pb-2 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
              {products.map(p => (
                <tr key={p.id} className="hover:bg-surface-50 dark:hover:bg-surface-800/30">
                  <td className="py-3 pr-4">
                    <div>
                      <p className="font-medium text-surface-800 dark:text-surface-200">{p.name}</p>
                      {p.category_name && <p className="text-xs text-surface-400">{p.category_name}</p>}
                    </div>
                  </td>
                  <td className="py-3 pr-4 text-surface-500 font-mono text-xs">{p.sku || '—'}</td>
                  <td className="py-3 pr-4 font-medium text-surface-800 dark:text-surface-200">{formatCLP(p.price)}</td>
                  <td className="py-3 pr-4 text-surface-500">{formatCLP(p.cost)}</td>
                  <td className="py-3 pr-4">
                    <button
                      onClick={() => openAdjust(p)}
                      className={cn(
                        'px-2 py-0.5 rounded-lg text-xs font-bold',
                        (p.stock ?? 0) === 0
                          ? 'bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400'
                          : (p.stock ?? 0) <= 5
                            ? 'bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400'
                            : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400',
                      )}
                    >
                      {p.stock ?? 0} {UNIT_LABELS[p.unit] || p.unit}
                    </button>
                  </td>
                  <td className="py-3 pr-4">
                    <span className={cn(
                      'px-2 py-0.5 rounded-full text-xs font-medium',
                      p.is_active
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400'
                        : 'bg-surface-100 text-surface-500 dark:bg-surface-800',
                    )}>
                      {p.is_active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="py-3">
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(p)} className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-400 hover:text-brand-500">
                        <Edit2 size={14} />
                      </button>
                      <button onClick={() => deleteMutation.mutate(p.id)} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 text-surface-400 hover:text-red-500">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Product form modal */}
      <Modal open={modalOpen} title={editing ? 'Editar producto' : 'Nuevo producto'} onClose={() => setModalOpen(false)}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="text-xs text-surface-500 block mb-1">Nombre *</label>
              <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="input-field w-full" placeholder="Ej: Barrita Proteína 30g" />
            </div>
            <div>
              <label className="text-xs text-surface-500 block mb-1">Precio de venta ($) *</label>
              <input type="number" min={0} value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                className="input-field w-full" placeholder="2990" />
            </div>
            <div>
              <label className="text-xs text-surface-500 block mb-1">Costo de compra ($) *</label>
              <input type="number" min={0} value={form.cost} onChange={e => setForm(f => ({ ...f, cost: e.target.value }))}
                className="input-field w-full" placeholder="1500" />
            </div>
            <div>
              <label className="text-xs text-surface-500 block mb-1">SKU</label>
              <input type="text" value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))}
                className="input-field w-full" placeholder="BAR-PRO-30G" />
            </div>
            <div>
              <label className="text-xs text-surface-500 block mb-1">Unidad</label>
              <select value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} className="input-field w-full">
                {Object.entries(UNIT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-surface-500 block mb-1">Categoría</label>
              <select value={form.category_id} onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))} className="input-field w-full">
                <option value="">Sin categoría</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-surface-500 block mb-1">Código de barras</label>
              <input type="text" value={form.barcode} onChange={e => setForm(f => ({ ...f, barcode: e.target.value }))}
                className="input-field w-full" placeholder="7891234567890" />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setModalOpen(false)} className="flex-1 btn-secondary text-sm py-2.5">Cancelar</button>
            <button onClick={handleSubmit} disabled={isPending || !form.name || !form.price || !form.cost}
              className="flex-1 btn-primary text-sm py-2.5 flex items-center justify-center gap-2">
              {isPending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              {editing ? 'Guardar' : 'Crear'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Stock adjust modal */}
      <Modal open={stockModalOpen} title={`Ajustar stock — ${adjustingProduct?.name}`} onClose={() => setStockModalOpen(false)}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-surface-500 block mb-1">Stock actual *</label>
              <input type="number" min={0} value={stockForm.quantity}
                onChange={e => setStockForm(f => ({ ...f, quantity: e.target.value }))}
                className="input-field w-full" />
            </div>
            <div>
              <label className="text-xs text-surface-500 block mb-1">Stock mínimo (alerta)</label>
              <input type="number" min={0} value={stockForm.min_stock}
                onChange={e => setStockForm(f => ({ ...f, min_stock: e.target.value }))}
                className="input-field w-full" placeholder="5" />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setStockModalOpen(false)} className="flex-1 btn-secondary text-sm py-2.5">Cancelar</button>
            <button
              onClick={() => adjustingProduct && adjustMutation.mutate({
                id: adjustingProduct.id,
                data: {
                  quantity: Number(stockForm.quantity),
                  ...(stockForm.min_stock ? { min_stock: Number(stockForm.min_stock) } : {}),
                },
              })}
              disabled={adjustMutation.isPending || !stockForm.quantity}
              className="flex-1 btn-primary text-sm py-2.5 flex items-center justify-center gap-2"
            >
              {adjustMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              Guardar
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── Movements Tab ────────────────────────────────────────────────────────────

function MovementsTab() {
  const { data: movements = [], isLoading } = useQuery<InventoryMovement[]>({
    queryKey: ['pos-movements'],
    queryFn: () => posApi.listMovements({ size: 100 }).then(r => r.data),
  });

  return (
    <div>
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-brand-500" /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-surface-400 border-b border-surface-200 dark:border-surface-800">
                <th className="pb-2 pr-4 font-medium">Producto</th>
                <th className="pb-2 pr-4 font-medium">Tipo</th>
                <th className="pb-2 pr-4 font-medium">Cantidad</th>
                <th className="pb-2 pr-4 font-medium">Costo unit.</th>
                <th className="pb-2 pr-4 font-medium">Referencia</th>
                <th className="pb-2 font-medium">Fecha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
              {movements.map(m => (
                <tr key={m.id} className="hover:bg-surface-50 dark:hover:bg-surface-800/30">
                  <td className="py-3 pr-4 font-medium text-surface-800 dark:text-surface-200">{m.product_name}</td>
                  <td className="py-3 pr-4">
                    <span className={cn(
                      'px-2 py-0.5 rounded-full text-xs font-medium',
                      m.movement_type === 'sale' || m.movement_type === 'loss'
                        ? 'bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400'
                        : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400',
                    )}>
                      {MOVEMENT_LABELS[m.movement_type] || m.movement_type}
                    </span>
                  </td>
                  <td className="py-3 pr-4">
                    <span className={cn('flex items-center gap-1 font-mono text-sm font-bold',
                      m.quantity < 0 ? 'text-red-500' : 'text-emerald-600')}>
                      {m.quantity > 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                      {Math.abs(m.quantity)}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-surface-500">{m.unit_cost ? formatCLP(m.unit_cost) : '—'}</td>
                  <td className="py-3 pr-4 text-xs text-surface-400">{m.reference_type || '—'}</td>
                  <td className="py-3 text-xs text-surface-400">
                    {new Date(m.created_at).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {movements.length === 0 && (
            <p className="text-center text-surface-400 py-8 text-sm">Sin movimientos</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Purchase Orders Tab ──────────────────────────────────────────────────────

function PurchaseOrdersTab() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
  const [items, setItems] = useState<{ product_id: string; quantity_ordered: number; unit_cost: number }[]>([]);

  const { data: orders = [], isLoading } = useQuery<PurchaseOrder[]>({
    queryKey: ['pos-purchase-orders'],
    queryFn: () => posApi.listPurchaseOrders().then(r => r.data),
  });
  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ['pos-products-all'],
    queryFn: () => posApi.listProducts({ size: 200, active: true }).then(r => r.data),
  });
  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ['pos-suppliers'],
    queryFn: () => posApi.listSuppliers().then(r => r.data),
  });

  const [form, setForm] = useState({ supplier_id: '', notes: '' });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => posApi.createPurchaseOrder(data),
    onSuccess: () => { toast.success('Orden creada'); setModalOpen(false); queryClient.invalidateQueries({ queryKey: ['pos-purchase-orders'] }); },
    onError: (err) => toast.error(getApiError(err)),
  });

  const receiveMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => posApi.receivePurchaseOrder(id, data),
    onSuccess: () => { toast.success('Orden recibida — stock actualizado'); setReceiveOpen(false); queryClient.invalidateQueries({ queryKey: ['pos-purchase-orders'] }); queryClient.invalidateQueries({ queryKey: ['pos-products-all'] }); queryClient.invalidateQueries({ queryKey: ['pos-products'] }); },
    onError: (err) => toast.error(getApiError(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => posApi.deletePurchaseOrder(id),
    onSuccess: () => { toast.success('Orden eliminada'); queryClient.invalidateQueries({ queryKey: ['pos-purchase-orders'] }); },
    onError: (err) => toast.error(getApiError(err)),
  });

  function addItem() {
    if (products.length > 0) {
      setItems(prev => [...prev, { product_id: products[0].id, quantity_ordered: 1, unit_cost: products[0].cost }]);
    }
  }

  function handleCreate() {
    if (items.length === 0) return;
    createMutation.mutate({
      supplier_id: form.supplier_id || undefined,
      notes: form.notes || undefined,
      items,
    });
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-surface-500">{orders.length} órdenes</p>
        <button onClick={() => { setItems([]); setForm({ supplier_id: '', notes: '' }); setModalOpen(true); }}
          className="btn-primary flex items-center gap-1.5 text-sm px-3 py-2">
          <Plus size={15} /> Nueva orden
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-brand-500" /></div>
      ) : (
        <div className="space-y-3">
          {orders.map(po => (
            <div key={po.id} className="bg-white dark:bg-surface-800 rounded-2xl border border-surface-200 dark:border-surface-700 p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', PO_STATUS_COLORS[po.status])}>
                      {PO_STATUS_LABELS[po.status]}
                    </span>
                    {po.supplier_name && (
                      <span className="text-sm text-surface-600 dark:text-surface-400">{po.supplier_name}</span>
                    )}
                  </div>
                  <p className="text-xs text-surface-400 mt-1">
                    {new Date(po.created_at).toLocaleDateString('es-CL')}
                    {po.total_cost != null && ` · ${formatCLP(po.total_cost)}`}
                  </p>
                </div>
                <div className="flex gap-2">
                  {po.status === 'draft' && (
                    <>
                      <button
                        onClick={() => { setSelectedPO(po); setReceiveOpen(true); }}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 text-xs font-medium hover:opacity-80"
                      >
                        <Check size={13} /> Recibir
                      </button>
                      <button onClick={() => deleteMutation.mutate(po.id)}
                        className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 text-surface-400 hover:text-red-500">
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="space-y-1">
                {po.items.map(item => (
                  <div key={item.id} className="flex justify-between text-xs text-surface-600 dark:text-surface-400">
                    <span>{item.product_name} × {item.quantity_ordered}</span>
                    <span>{formatCLP(item.unit_cost)} c/u</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {orders.length === 0 && (
            <p className="text-center text-surface-400 py-8 text-sm">Sin órdenes de compra</p>
          )}
        </div>
      )}

      {/* Create PO modal */}
      <Modal open={modalOpen} title="Nueva orden de compra" onClose={() => setModalOpen(false)}>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-surface-500 block mb-1">Proveedor</label>
            <select value={form.supplier_id} onChange={e => setForm(f => ({ ...f, supplier_id: e.target.value }))} className="input-field w-full">
              <option value="">Sin proveedor</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs text-surface-500">Productos *</label>
              <button onClick={addItem} className="text-xs text-brand-500 hover:text-brand-600 flex items-center gap-1">
                <Plus size={12} /> Agregar
              </button>
            </div>
            <div className="space-y-2">
              {items.map((item, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <select
                    value={item.product_id}
                    onChange={e => {
                      const prod = products.find(p => p.id === e.target.value);
                      setItems(prev => prev.map((it, i) => i === idx ? { ...it, product_id: e.target.value, unit_cost: prod?.cost || it.unit_cost } : it));
                    }}
                    className="input-field flex-1 text-xs"
                  >
                    {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <input type="number" min={1} value={item.quantity_ordered}
                    onChange={e => setItems(prev => prev.map((it, i) => i === idx ? { ...it, quantity_ordered: Number(e.target.value) } : it))}
                    className="input-field w-16 text-xs" placeholder="Qty" />
                  <input type="number" min={0} value={item.unit_cost}
                    onChange={e => setItems(prev => prev.map((it, i) => i === idx ? { ...it, unit_cost: Number(e.target.value) } : it))}
                    className="input-field w-24 text-xs" placeholder="Costo" />
                  <button onClick={() => setItems(prev => prev.filter((_, i) => i !== idx))} className="text-surface-400 hover:text-red-500">
                    <X size={14} />
                  </button>
                </div>
              ))}
              {items.length === 0 && (
                <p className="text-xs text-surface-400 text-center py-2">Sin productos — agrega uno</p>
              )}
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={() => setModalOpen(false)} className="flex-1 btn-secondary text-sm py-2.5">Cancelar</button>
            <button onClick={handleCreate} disabled={createMutation.isPending || items.length === 0}
              className="flex-1 btn-primary text-sm py-2.5 flex items-center justify-center gap-2">
              {createMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              Crear orden
            </button>
          </div>
        </div>
      </Modal>

      {/* Receive PO modal */}
      <Modal open={receiveOpen} title="Recibir orden" description="Confirmar recepción actualiza el stock automáticamente."
        onClose={() => setReceiveOpen(false)}>
        <div className="space-y-4">
          {selectedPO?.items.map(item => (
            <div key={item.id} className="flex justify-between items-center">
              <span className="text-sm text-surface-700 dark:text-surface-300">{item.product_name}</span>
              <span className="text-sm font-medium">× {item.quantity_ordered}</span>
            </div>
          ))}
          <div className="flex gap-3 pt-2">
            <button onClick={() => setReceiveOpen(false)} className="flex-1 btn-secondary text-sm py-2.5">Cancelar</button>
            <button
              onClick={() => selectedPO && receiveMutation.mutate({
                id: selectedPO.id,
                data: { items: selectedPO.items.map(i => ({ product_id: i.product_id, quantity_received: i.quantity_ordered })) },
              })}
              disabled={receiveMutation.isPending}
              className="flex-1 btn-primary text-sm py-2.5 flex items-center justify-center gap-2"
            >
              {receiveMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              Confirmar recepción
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── Suppliers Tab ────────────────────────────────────────────────────────────

function SuppliersTab() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState({ name: '', contact_name: '', email: '', phone: '', notes: '' });

  const { data: suppliers = [], isLoading } = useQuery<Supplier[]>({
    queryKey: ['pos-suppliers'],
    queryFn: () => posApi.listSuppliers().then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => posApi.createSupplier(data),
    onSuccess: () => { toast.success('Proveedor creado'); setModalOpen(false); queryClient.invalidateQueries({ queryKey: ['pos-suppliers'] }); },
    onError: (err) => toast.error(getApiError(err)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => posApi.updateSupplier(id, data),
    onSuccess: () => { toast.success('Proveedor actualizado'); setModalOpen(false); queryClient.invalidateQueries({ queryKey: ['pos-suppliers'] }); },
    onError: (err) => toast.error(getApiError(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => posApi.deleteSupplier(id),
    onSuccess: () => { toast.success('Proveedor desactivado'); queryClient.invalidateQueries({ queryKey: ['pos-suppliers'] }); },
    onError: (err) => toast.error(getApiError(err)),
  });

  function openCreate() {
    setEditing(null);
    setForm({ name: '', contact_name: '', email: '', phone: '', notes: '' });
    setModalOpen(true);
  }

  function openEdit(s: Supplier) {
    setEditing(s);
    setForm({ name: s.name, contact_name: s.contact_name || '', email: s.email || '', phone: s.phone || '', notes: s.notes || '' });
    setModalOpen(true);
  }

  function handleSubmit() {
    const data: Record<string, unknown> = { name: form.name };
    if (form.contact_name) data.contact_name = form.contact_name;
    if (form.email) data.email = form.email;
    if (form.phone) data.phone = form.phone;
    if (form.notes) data.notes = form.notes;

    if (editing) {
      updateMutation.mutate({ id: editing.id, data });
    } else {
      createMutation.mutate(data);
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-surface-500">{suppliers.length} proveedores</p>
        <button onClick={openCreate} className="btn-primary flex items-center gap-1.5 text-sm px-3 py-2">
          <Plus size={15} /> Nuevo proveedor
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-brand-500" /></div>
      ) : (
        <div className="space-y-2">
          {suppliers.map(s => (
            <div key={s.id} className="flex items-center justify-between p-4 bg-white dark:bg-surface-800 rounded-2xl border border-surface-200 dark:border-surface-700">
              <div>
                <p className="font-medium text-surface-800 dark:text-surface-200">{s.name}</p>
                <p className="text-xs text-surface-400">{[s.contact_name, s.email, s.phone].filter(Boolean).join(' · ')}</p>
              </div>
              <div className="flex gap-1">
                <button onClick={() => openEdit(s)} className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-400 hover:text-brand-500">
                  <Edit2 size={14} />
                </button>
                <button onClick={() => deleteMutation.mutate(s.id)} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 text-surface-400 hover:text-red-500">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
          {suppliers.length === 0 && <p className="text-center text-surface-400 py-8 text-sm">Sin proveedores</p>}
        </div>
      )}

      <Modal open={modalOpen} title={editing ? 'Editar proveedor' : 'Nuevo proveedor'} onClose={() => setModalOpen(false)}>
        <div className="space-y-4">
          {[
            { key: 'name', label: 'Nombre *', placeholder: 'NutriSupply S.A.' },
            { key: 'contact_name', label: 'Contacto', placeholder: 'Juan Pérez' },
            { key: 'email', label: 'Email', placeholder: 'contacto@nutrisupply.cl' },
            { key: 'phone', label: 'Teléfono', placeholder: '+56912345678' },
          ].map(field => (
            <div key={field.key}>
              <label className="text-xs text-surface-500 block mb-1">{field.label}</label>
              <input type="text" value={form[field.key as keyof typeof form]}
                onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))}
                className="input-field w-full" placeholder={field.placeholder} />
            </div>
          ))}
          <div className="flex gap-3 pt-2">
            <button onClick={() => setModalOpen(false)} className="flex-1 btn-secondary text-sm py-2.5">Cancelar</button>
            <button onClick={handleSubmit} disabled={isPending || !form.name}
              className="flex-1 btn-primary text-sm py-2.5 flex items-center justify-center gap-2">
              {isPending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              {editing ? 'Guardar' : 'Crear'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function InventoryPage() {
  const [activeTab, setActiveTab] = useState<Tab>('Productos');

  const { data: inventory = [] } = useQuery<InventoryItem[]>({
    queryKey: ['pos-inventory-overview'],
    queryFn: () => posApi.listInventory().then(r => r.data),
  });

  const lowStockCount = inventory.filter(i => i.low_stock).length;

  const TAB_ICONS: Record<Tab, React.ReactNode> = {
    'Productos': <Package size={16} />,
    'Movimientos': <TrendingDown size={16} />,
    'Compras': <ShoppingBag size={16} />,
    'Proveedores': <Truck size={16} />,
  };

  return (
    <div className="px-6 py-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Inventario</h1>
          <p className="text-sm text-surface-500 mt-0.5">Gestión de productos y stock</p>
        </div>
        {lowStockCount > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40">
            <AlertTriangle size={14} className="text-amber-500" />
            <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
              {lowStockCount} producto{lowStockCount > 1 ? 's' : ''} con stock bajo
            </span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-surface-100 dark:bg-surface-800 rounded-2xl w-fit mb-6">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all',
              activeTab === tab
                ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-white shadow-sm'
                : 'text-surface-500 hover:text-surface-700 dark:hover:text-surface-300',
            )}
          >
            {TAB_ICONS[tab]}
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="bg-white dark:bg-surface-800 rounded-3xl border border-surface-200 dark:border-surface-700 p-6">
        {activeTab === 'Productos' && <ProductsTab />}
        {activeTab === 'Movimientos' && <MovementsTab />}
        {activeTab === 'Compras' && <PurchaseOrdersTab />}
        {activeTab === 'Proveedores' && <SuppliersTab />}
      </div>
    </div>
  );
}
