import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  DollarSign, Plus, Edit2, Trash2, Loader2, Check, TrendingDown, Download,
  ImagePlus, ImageOff, Receipt,
} from 'lucide-react';
import Modal from '@/components/ui/Modal';
import TableScroll from '@/components/ui/TableScroll';
import { posApi } from '@/services/api';
import { cn, getApiError } from '@/utils';
import type { Expense } from '@/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  rent: 'Arriendo', utilities: 'Servicios básicos', equipment: 'Equipamiento',
  supplies: 'Insumos', payroll: 'Nómina', maintenance: 'Mantención',
  marketing: 'Marketing', other: 'Otro',
};

const CATEGORY_COLORS: Record<string, string> = {
  rent: 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-400',
  utilities: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400',
  equipment: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  supplies: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  payroll: 'bg-pink-100 text-pink-700 dark:bg-pink-950/40 dark:text-pink-400',
  maintenance: 'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400',
  marketing: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-400',
  other: 'bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-400',
};

function formatCLP(n: number) {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ExpensesPage() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [form, setForm] = useState({
    category: 'other',
    amount: '',
    description: '',
    expense_date: new Date().toISOString().slice(0, 10),
    receipt_url: '',
    paid_from_cash: false,
  });

  const { data: expenses = [], isLoading } = useQuery<Expense[]>({
    queryKey: ['pos-expenses', categoryFilter],
    queryFn: () => posApi.listExpenses({
      size: 100,
      ...(categoryFilter ? { category: categoryFilter } : {}),
    }).then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => posApi.createExpense(data),
    onSuccess: () => { toast.success('Gasto registrado'); setModalOpen(false); queryClient.invalidateQueries({ queryKey: ['pos-expenses'] }); },
    onError: (err) => toast.error(getApiError(err)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => posApi.updateExpense(id, data),
    onSuccess: () => { toast.success('Gasto actualizado'); setModalOpen(false); queryClient.invalidateQueries({ queryKey: ['pos-expenses'] }); },
    onError: (err) => toast.error(getApiError(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => posApi.deleteExpense(id),
    onSuccess: () => { toast.success('Gasto eliminado'); queryClient.invalidateQueries({ queryKey: ['pos-expenses'] }); },
    onError: (err) => toast.error(getApiError(err)),
  });

  const uploadReceiptMutation = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => posApi.uploadExpenseReceipt(id, file),
    onSuccess: (res) => {
      const updated = res.data as Expense;
      setEditing(prev => (prev && prev.id === updated.id ? { ...prev, receipt_url: updated.receipt_url } : prev));
      setForm(f => ({ ...f, receipt_url: updated.receipt_url || '' }));
      toast.success('Recibo subido');
      queryClient.invalidateQueries({ queryKey: ['pos-expenses'] });
    },
    onError: (err) => toast.error(getApiError(err)),
  });

  const deleteReceiptMutation = useMutation({
    mutationFn: (id: string) => posApi.deleteExpenseReceipt(id),
    onSuccess: (res) => {
      const updated = res.data as Expense;
      setEditing(prev => (prev && prev.id === updated.id ? { ...prev, receipt_url: null } : prev));
      setForm(f => ({ ...f, receipt_url: '' }));
      toast.success('Recibo eliminado');
      queryClient.invalidateQueries({ queryKey: ['pos-expenses'] });
    },
    onError: (err) => toast.error(getApiError(err)),
  });

  function handleReceiptPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !editing) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Archivo excede 5 MB');
      return;
    }
    uploadReceiptMutation.mutate({ id: editing.id, file });
  }

  const [isExporting, setIsExporting] = useState(false);
  async function handleExport() {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const res = await posApi.exportExpenses(categoryFilter ? { category: categoryFilter } : {});
      const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const today = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `gastos_nexo_${today}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Descargado');
    } catch (err) {
      toast.error(getApiError(err, 'No se pudo exportar'));
    } finally {
      setIsExporting(false);
    }
  }

  // ── KPIs ───────────────────────────────────────────────────────────────────
  const toNum = (v: unknown) => {
    const n = typeof v === 'string' ? parseFloat(v) : Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const totalExpenses = expenses.reduce((s, e) => s + toNum(e.amount), 0);
  const byCategory = Object.entries(CATEGORY_LABELS).map(([key, label]) => ({
    key, label,
    total: expenses.filter(e => e.category === key).reduce((s, e) => s + toNum(e.amount), 0),
  })).filter(c => c.total > 0).sort((a, b) => b.total - a.total);

  function openCreate() {
    setEditing(null);
    setForm({
      category: 'other', amount: '', description: '',
      expense_date: new Date().toISOString().slice(0, 10), receipt_url: '',
      paid_from_cash: false,
    });
    setModalOpen(true);
  }

  function openEdit(e: Expense) {
    setEditing(e);
    setForm({
      category: e.category, amount: String(e.amount), description: e.description,
      expense_date: e.expense_date, receipt_url: e.receipt_url || '',
      paid_from_cash: e.paid_from_cash ?? false,
    });
    setModalOpen(true);
  }

  function handleSubmit() {
    const data: Record<string, unknown> = {
      category: form.category,
      amount: Number(form.amount),
      description: form.description,
      expense_date: form.expense_date,
      paid_from_cash: form.paid_from_cash,
    };
    if (form.receipt_url) data.receipt_url = form.receipt_url;

    if (editing) {
      updateMutation.mutate({ id: editing.id, data });
    } else {
      createMutation.mutate(data);
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 sm:py-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Gastos</h1>
          <p className="text-sm text-surface-500 mt-0.5">Registro de gastos operacionales</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <button
            onClick={handleExport}
            disabled={isExporting || expenses.length === 0}
            className="btn-secondary flex w-full items-center justify-center gap-1.5 px-4 py-2.5 text-sm disabled:opacity-60 sm:w-auto"
          >
            {isExporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            Exportar CSV
          </button>
          <button onClick={openCreate} className="btn-primary flex w-full items-center justify-center gap-1.5 px-4 py-2.5 text-sm sm:w-auto">
            <Plus size={15} /> Registrar gasto
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="col-span-2 sm:col-span-1 bg-white dark:bg-surface-800 rounded-2xl border border-surface-200 dark:border-surface-700 p-4">
          <div className="flex items-center gap-2 mb-1">
            <TrendingDown size={16} className="text-red-500" />
            <span className="text-xs text-surface-500 font-medium uppercase tracking-wide">Total gastos</span>
          </div>
          <p className="text-2xl font-bold text-surface-900 dark:text-white">{formatCLP(totalExpenses)}</p>
          <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">{expenses.length} registros</p>
        </div>
        {byCategory.slice(0, 3).map(cat => (
          <div key={cat.key} className="bg-white dark:bg-surface-800 rounded-2xl border border-surface-200 dark:border-surface-700 p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className={cn('w-2 h-2 rounded-full', cat.key === 'rent' ? 'bg-violet-500' : cat.key === 'utilities' ? 'bg-blue-500' : cat.key === 'payroll' ? 'bg-pink-500' : 'bg-amber-500')} />
              <span className="text-xs text-surface-500 font-medium uppercase tracking-wide truncate">{cat.label}</span>
            </div>
            <p className="text-xl font-bold text-surface-900 dark:text-white">{formatCLP(cat.total)}</p>
            <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
              {totalExpenses > 0 ? `${Math.round((cat.total / totalExpenses) * 100)}%` : '0%'} del total
            </p>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        <button
          onClick={() => setCategoryFilter('')}
          className={cn(
            'flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors',
            !categoryFilter
              ? 'bg-brand-500 text-white'
              : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200',
          )}
        >
          Todos
        </button>
        {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setCategoryFilter(key === categoryFilter ? '' : key)}
            className={cn(
              'flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors',
              key === categoryFilter
                ? 'bg-brand-500 text-white'
                : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-3xl border border-surface-200 bg-white dark:border-surface-700 dark:bg-surface-800">
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-brand-500" /></div>
        ) : (
          <TableScroll>
            <table className="min-w-[720px] w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-surface-500 dark:text-surface-400 border-b border-surface-200 dark:border-surface-800">
                  <th className="px-6 py-3 font-medium">Descripción</th>
                  <th className="px-4 py-3 font-medium">Categoría</th>
                  <th className="px-4 py-3 font-medium">Monto</th>
                  <th className="px-4 py-3 font-medium">Fecha</th>
                  <th className="px-4 py-3 font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
                {expenses.map(expense => (
                  <tr key={expense.id} className="hover:bg-surface-50 dark:hover:bg-surface-800/30">
                    <td className="px-6 py-3">
                      <p className="font-medium text-surface-800 dark:text-surface-200">{expense.description}</p>
                      {expense.receipt_url && (
                        <a href={expense.receipt_url} target="_blank" rel="noopener noreferrer"
                          className="text-xs text-brand-500 hover:underline">Ver recibo</a>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', CATEGORY_COLORS[expense.category])}>
                        {CATEGORY_LABELS[expense.category] || expense.category}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-bold text-red-600 dark:text-red-400">
                      {formatCLP(toNum(expense.amount))}
                    </td>
                    <td className="px-4 py-3 text-surface-500 text-xs">
                      {new Date(expense.expense_date + 'T12:00:00').toLocaleDateString('es-CL', { dateStyle: 'medium' })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button onClick={() => openEdit(expense)} aria-label="Editar gasto" title="Editar gasto"
                          className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500 dark:text-surface-400 hover:text-brand-500">
                          <Edit2 size={14} />
                        </button>
                        <button onClick={() => deleteMutation.mutate(expense.id)} aria-label="Eliminar gasto" title="Eliminar gasto"
                          className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 text-surface-500 dark:text-surface-400 hover:text-red-500">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
        {!isLoading && expenses.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-surface-500 dark:text-surface-400">
            <DollarSign size={32} className="mb-2 opacity-30" />
            <p className="text-sm">Sin gastos registrados</p>
          </div>
        )}
      </div>

      {/* Form modal */}
      <Modal open={modalOpen} title={editing ? 'Editar gasto' : 'Registrar gasto'} onClose={() => setModalOpen(false)}>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-surface-500 block mb-1">Categoría *</label>
            <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="input w-full">
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs text-surface-500 block mb-1">Monto ($) *</label>
              <input type="number" min={0} value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                className="input w-full" placeholder="50000" />
            </div>
            <div>
              <label className="text-xs text-surface-500 block mb-1">Fecha *</label>
              <input type="date" value={form.expense_date}
                onChange={e => setForm(f => ({ ...f, expense_date: e.target.value }))}
                className="input w-full" />
            </div>
          </div>
          <div>
            <label className="text-xs text-surface-500 block mb-1">Descripción *</label>
            <input type="text" value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              className="input w-full" placeholder="Arriendo mes de abril" />
          </div>
          <label className="flex items-center gap-2.5 cursor-pointer rounded-xl border border-surface-200 dark:border-surface-700 p-3">
            <input
              type="checkbox"
              checked={form.paid_from_cash}
              onChange={e => setForm(f => ({ ...f, paid_from_cash: e.target.checked }))}
              className="h-4 w-4 rounded border-surface-300 text-brand-500 focus:ring-brand-500"
            />
            <span className="text-sm text-surface-700 dark:text-surface-300">
              Pagado de caja
              <span className="block text-[11px] text-surface-500 dark:text-surface-400">Se descuenta del efectivo esperado en el cierre de caja</span>
            </span>
          </label>
          {editing ? (
            <div className="rounded-xl border border-surface-200 dark:border-surface-700 p-3 space-y-3">
              <div className="flex items-center gap-3">
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-surface-100 dark:bg-surface-800 flex items-center justify-center">
                  {form.receipt_url ? (
                    <img src={form.receipt_url} alt="Recibo" className="h-full w-full object-cover" />
                  ) : (
                    <Receipt size={24} className="text-surface-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-surface-500">Recibo</p>
                  <p className="text-[11px] text-surface-500 dark:text-surface-400">JPG, PNG o WebP · máx 5 MB · se optimiza automáticamente</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <label className="btn-secondary cursor-pointer text-xs py-1.5 px-2.5 inline-flex items-center gap-1.5">
                      {uploadReceiptMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}
                      {form.receipt_url ? 'Cambiar' : 'Subir'}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={handleReceiptPick}
                        disabled={uploadReceiptMutation.isPending}
                        className="hidden"
                      />
                    </label>
                    {form.receipt_url && (
                      <>
                        <a
                          href={form.receipt_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-secondary text-xs py-1.5 px-2.5 inline-flex items-center gap-1.5"
                        >
                          Ver
                        </a>
                        <button
                          type="button"
                          onClick={() => editing && deleteReceiptMutation.mutate(editing.id)}
                          disabled={deleteReceiptMutation.isPending}
                          className="btn-secondary text-xs py-1.5 px-2.5 inline-flex items-center gap-1.5 text-red-500"
                        >
                          {deleteReceiptMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <ImageOff size={13} />}
                          Quitar
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div>
                <label className="text-xs text-surface-500 block mb-1">o pega URL externa</label>
                <input type="url" value={form.receipt_url}
                  onChange={e => setForm(f => ({ ...f, receipt_url: e.target.value }))}
                  className="input w-full" placeholder="https://..." />
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-surface-500 dark:text-surface-400 rounded-lg bg-surface-50 dark:bg-surface-800/40 px-3 py-2">
              Crea el gasto primero; luego podrás adjuntar el recibo editándolo.
            </p>
          )}
          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row">
            <button onClick={() => setModalOpen(false)} className="flex-1 btn-secondary text-sm py-2.5">Cancelar</button>
            <button onClick={handleSubmit}
              disabled={isPending || !form.amount || !form.description || !form.expense_date}
              className="flex-1 btn-primary text-sm py-2.5 flex items-center justify-center gap-2">
              {isPending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              {editing ? 'Guardar' : 'Registrar'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
