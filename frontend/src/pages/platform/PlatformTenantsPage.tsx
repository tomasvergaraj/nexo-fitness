import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import {
  Ban,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Clock3,
  Copy,
  CreditCard,
  Download,
  ExternalLink,
  FileText,
  KeyRound,
  Loader2,
  Mail,
  Plus,
  Power,
  Rows3,
  Rows4,
  Search,
  ShieldCheck,
  ShieldOff,
  UserCog,
  WalletCards,
  X,
} from 'lucide-react';
import { NEXO_BRAND_SLOGAN } from '@/components/branding/NexoBrand';
import Drawer from '@/components/ui/Drawer';
import StatCard from '@/components/dashboard/StatCard';
import { billingApi, platformAdminApi } from '@/services/api';
import { fadeInUp, staggerContainer } from '@/utils/animations';
import { formatCurrency, formatDate, formatDateTime, getApiError, parseApiNumber } from '@/utils';
import type {
  AdminSaaSPlan,
  AdminTenantBilling,
  AdminTenantManualPaymentRequest,
  PaginatedResponse,
  PlatformBillingPayment,
  PlatformPromoCode,
} from '@/types';

type ManualPaymentFormState = {
  plan_key: string;
  starts_at: string;
  promo_code_id: string;
  transfer_reference: string;
  notes: string;
};

const statusLabels: Record<string, string> = {
  active: 'Activo',
  trial: 'En prueba',
  suspended: 'Suspendido',
  expired: 'Vencido',
  cancelled: 'Cancelado',
};

const statusClasses: Record<string, string> = {
  active: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300',
  trial: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/40 dark:bg-sky-950/20 dark:text-sky-300',
  suspended: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300',
  expired: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300',
  cancelled: 'border-surface-300 bg-surface-100 text-surface-700 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-300',
};

const planLabels: Record<string, string> = {
  monthly: 'Mensual',
  quarterly: 'Trimestral',
  semi_annual: 'Semestral',
  annual: 'Anual',
  perpetual: 'Perpetuo',
};

function statusLabel(status: string): string {
  return statusLabels[status] ?? status;
}

function statusClass(status: string): string {
  return statusClasses[status] ?? statusClasses.cancelled;
}

function planLabel(planKey: string): string {
  return planLabels[planKey] ?? planKey;
}

function todayDateValue() {
  return new Date().toISOString().slice(0, 10);
}

function buildManualPaymentForm(
  tenant: AdminTenantBilling | null,
  plans: AdminSaaSPlan[],
): ManualPaymentFormState {
  const fallbackPlan = plans.find((plan) => plan.is_active) ?? plans[0];
  return {
    plan_key: tenant?.plan_key || fallbackPlan?.key || '',
    starts_at: todayDateValue(),
    promo_code_id: '',
    transfer_reference: '',
    notes: '',
  };
}

function getPromoPreview(plan: AdminSaaSPlan | null, promo: PlatformPromoCode | null) {
  if (!plan) {
    return null;
  }

  const baseAmount = parseApiNumber(plan.price);
  const taxRate = parseApiNumber(plan.tax_rate);

  if (!promo) {
    const taxAmount = parseApiNumber(plan.tax_amount);
    const totalAmount = parseApiNumber(plan.total_price);
    return {
      baseAmount,
      discountAmount: 0,
      subtotal: baseAmount,
      taxRate,
      taxAmount,
      totalAmount,
      valid: true,
      reason: null as string | null,
    };
  }

  const now = Date.now();
  if (!promo.is_active) {
    return {
      baseAmount,
      discountAmount: 0,
      subtotal: baseAmount,
      taxRate,
      taxAmount: Math.round(baseAmount * taxRate / 100),
      totalAmount: Math.round(baseAmount * (1 + taxRate / 100)),
      valid: false,
      reason: 'El promo code está inactivo.',
    };
  }

  if (promo.expires_at && new Date(promo.expires_at).getTime() < now) {
    return {
      baseAmount,
      discountAmount: 0,
      subtotal: baseAmount,
      taxRate,
      taxAmount: Math.round(baseAmount * taxRate / 100),
      totalAmount: Math.round(baseAmount * (1 + taxRate / 100)),
      valid: false,
      reason: 'El promo code ya expiró.',
    };
  }

  if (promo.max_uses != null && promo.uses_count >= promo.max_uses) {
    return {
      baseAmount,
      discountAmount: 0,
      subtotal: baseAmount,
      taxRate,
      taxAmount: Math.round(baseAmount * taxRate / 100),
      totalAmount: Math.round(baseAmount * (1 + taxRate / 100)),
      valid: false,
      reason: 'El promo code ya no tiene usos disponibles.',
    };
  }

  if (promo.plan_keys?.length && !promo.plan_keys.includes(plan.key)) {
    return {
      baseAmount,
      discountAmount: 0,
      subtotal: baseAmount,
      taxRate,
      taxAmount: Math.round(baseAmount * taxRate / 100),
      totalAmount: Math.round(baseAmount * (1 + taxRate / 100)),
      valid: false,
      reason: 'El promo code no aplica a este plan.',
    };
  }

  const rawDiscount = promo.discount_type === 'percent'
    ? Math.round(baseAmount * parseApiNumber(promo.discount_value) / 100)
    : parseApiNumber(promo.discount_value);
  const discountAmount = Math.min(baseAmount, rawDiscount);
  const subtotal = Math.max(baseAmount - discountAmount, 0);
  const taxAmount = Math.round(subtotal * taxRate / 100);
  const totalAmount = subtotal + taxAmount;

  return {
    baseAmount,
    discountAmount,
    subtotal,
    taxRate,
    taxAmount,
    totalAmount,
    valid: true,
    reason: null as string | null,
  };
}

type DrawerTab = 'summary' | 'payments' | 'actions' | 'flags';

const STATUS_FILTERS: Array<{ key: 'all' | keyof typeof statusLabels; label: string }> = [
  { key: 'all', label: 'Todos' },
  { key: 'active', label: 'Activos' },
  { key: 'trial', label: 'En prueba' },
  { key: 'expired', label: 'Vencidos' },
  { key: 'suspended', label: 'Suspendidos' },
  { key: 'cancelled', label: 'Cancelados' },
];

function daysUntil(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  const ms = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(ms / 86400000);
}

function expiryTone(days: number | null): string {
  if (days === null) return 'text-surface-500';
  if (days < 0) return 'text-rose-600 dark:text-rose-400 font-medium';
  if (days <= 7) return 'text-amber-600 dark:text-amber-400 font-medium';
  if (days <= 30) return 'text-amber-500 dark:text-amber-300';
  return 'text-surface-600 dark:text-surface-300';
}

const HEALTH_LEVEL_TONE: Record<string, string> = {
  healthy: 'text-emerald-600 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-950/30 dark:border-emerald-900/40',
  watch: 'text-sky-600 bg-sky-50 border-sky-200 dark:text-sky-300 dark:bg-sky-950/30 dark:border-sky-900/40',
  at_risk: 'text-amber-600 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/30 dark:border-amber-900/40',
  critical: 'text-rose-600 bg-rose-50 border-rose-200 dark:text-rose-300 dark:bg-rose-950/30 dark:border-rose-900/40',
};

const HEALTH_LEVEL_LABEL: Record<string, string> = {
  healthy: 'Sano',
  watch: 'Vigilar',
  at_risk: 'En riesgo',
  critical: 'Crítico',
};

const KNOWN_FEATURE_FLAGS: { key: string; label: string; description: string }[] = [
  { key: 'beta_marketing', label: 'Marketing beta', description: 'Acceso anticipado al módulo de campañas' },
  { key: 'beta_pos', label: 'POS avanzado', description: 'Funcionalidades nuevas de punto de venta' },
  { key: 'beta_member_app', label: 'App miembro v2', description: 'Nueva versión de la app para clientes' },
  { key: 'beta_reports', label: 'Reportes premium', description: 'Reportes adicionales (cohort, NPS, etc.)' },
  { key: 'allow_multi_currency', label: 'Multi-moneda', description: 'Permitir cobros en monedas distintas a CLP' },
  { key: 'priority_support', label: 'Soporte prioritario', description: 'Cola de soporte preferente' },
  { key: 'export_unlimited', label: 'Exportes ilimitados', description: 'Sin límite mensual en exportes CSV/Excel' },
];

// ── Density / sort / saved views ─────────────────────────────
type DensityMode = 'comfy' | 'compact';
type SortKey = 'name' | 'plan' | 'expires' | 'capacity' | 'status' | 'health';
type SortDir = 'asc' | 'desc';

interface SavedView {
  key: string;
  label: string;
  statusFilter: string;
  sortBy?: SortKey;
  sortDir?: SortDir;
  removable?: boolean;
}

const PRESET_VIEWS: SavedView[] = [
  { key: 'all', label: 'Todos', statusFilter: 'all' },
  { key: 'unhealthy', label: 'En riesgo', statusFilter: 'all', sortBy: 'health', sortDir: 'asc' },
  { key: 'trials_expiring', label: 'Trials por vencer', statusFilter: 'trial', sortBy: 'expires', sortDir: 'asc' },
  { key: 'expired_recent', label: 'Vencidos recientes', statusFilter: 'expired', sortBy: 'expires', sortDir: 'desc' },
  { key: 'suspended', label: 'Suspendidos', statusFilter: 'suspended' },
  { key: 'top_capacity', label: 'Top capacidad', statusFilter: 'active', sortBy: 'capacity', sortDir: 'desc' },
];

function downloadTenantsCsv(filename: string, rows: AdminTenantBilling[]) {
  const headers = [
    'Cuenta', 'Slug', 'Estado', 'Plan', 'Plan key', 'Vence', 'Trial hasta',
    'Propietario', 'Email', 'Miembros max', 'Sedes max', 'Cobro online', 'Activo',
  ];
  const data = rows.map((t) => [
    t.tenant_name, t.tenant_slug, t.status, t.plan_name ?? '', t.plan_key ?? '',
    t.license_expires_at ?? '', t.trial_ends_at ?? '', t.owner_name ?? '', t.owner_email ?? '',
    String(t.max_members ?? ''), String(t.max_branches ?? ''),
    t.checkout_enabled ? 'Sí' : 'No', t.is_active ? 'Sí' : 'No',
  ]);
  const escape = (cell: unknown) => `"${String(cell ?? '').replace(/"/g, '""')}"`;
  const csv = [headers, ...data].map((row) => row.map(escape).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function SortableTh({
  label,
  sortKey,
  current,
  dir,
  onClick,
  align = 'left',
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onClick: (key: SortKey) => void;
  align?: 'left' | 'right';
}) {
  const isActive = current === sortKey;
  const Icon = !isActive ? ChevronsUpDown : dir === 'asc' ? ChevronUp : ChevronDown;
  return (
    <th
      className={`px-4 py-2.5 ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      <button
        type="button"
        onClick={() => onClick(sortKey)}
        className={`group inline-flex items-center gap-1 ${align === 'right' ? 'flex-row-reverse' : ''} ${
          isActive ? 'text-brand-600 dark:text-brand-300' : 'text-surface-500 hover:text-surface-700 dark:hover:text-surface-300'
        }`}
      >
        {label}
        <Icon size={11} className={isActive ? 'opacity-100' : 'opacity-50 group-hover:opacity-100'} />
      </button>
    </th>
  );
}

function compareTenants(a: AdminTenantBilling, b: AdminTenantBilling, key: SortKey, dir: SortDir): number {
  const sign = dir === 'asc' ? 1 : -1;
  switch (key) {
    case 'name':
      return a.tenant_name.localeCompare(b.tenant_name) * sign;
    case 'plan':
      return (a.plan_name || a.plan_key || '').localeCompare(b.plan_name || b.plan_key || '') * sign;
    case 'expires': {
      const aDate = a.license_expires_at ?? a.trial_ends_at ?? '';
      const bDate = b.license_expires_at ?? b.trial_ends_at ?? '';
      if (!aDate && !bDate) return 0;
      if (!aDate) return 1; // nulls last
      if (!bDate) return -1;
      return aDate.localeCompare(bDate) * sign;
    }
    case 'capacity':
      return ((a.max_members ?? 0) - (b.max_members ?? 0)) * sign;
    case 'status':
      return a.status.localeCompare(b.status) * sign;
    case 'health':
      return ((a.health_score ?? -1) - (b.health_score ?? -1)) * sign;
    default:
      return 0;
  }
}

type ActionRowProps = {
  icon: React.ReactNode;
  iconClass?: string;
  title: string;
  description: string;
  buttonLabel: React.ReactNode;
  buttonClass?: string;
  pending?: boolean;
  disabled?: boolean;
  confirm?: string;
  onClick?: () => void;
  asLink?: boolean;
  href?: string;
};

function ActionRow({
  icon,
  iconClass = 'bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-300',
  title,
  description,
  buttonLabel,
  buttonClass = '',
  pending = false,
  disabled = false,
  confirm,
  onClick,
  asLink,
  href,
}: ActionRowProps) {
  const handleClick = () => {
    if (confirm && !window.confirm(confirm)) return;
    onClick?.();
  };
  return (
    <div className="flex items-start gap-3 rounded-xl border border-surface-200 px-3 py-3 dark:border-surface-800">
      <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconClass}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-surface-900 dark:text-white">{title}</p>
        <p className="mt-0.5 text-xs text-surface-500">{description}</p>
      </div>
      {asLink && href ? (
        <Link to={href} className={`btn-secondary inline-flex items-center gap-1 text-xs ${buttonClass}`}>
          {buttonLabel}
        </Link>
      ) : (
        <button
          type="button"
          onClick={handleClick}
          disabled={pending || disabled}
          className={`btn-secondary text-xs disabled:opacity-50 ${buttonClass}`}
        >
          {pending ? '…' : buttonLabel}
        </button>
      )}
    </div>
  );
}

export default function PlatformTenantsPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [drawerTenantId, setDrawerTenantId] = useState<string | null>(null);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('summary');
  const [density, setDensity] = useState<DensityMode>(() => {
    if (typeof window === 'undefined') return 'comfy';
    return (localStorage.getItem('platform.tenants.density') as DensityMode) || 'comfy';
  });
  const [sortBy, setSortBy] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeViewKey, setActiveViewKey] = useState<string>('all');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [folioForm, setFolioForm] = useState({ folio_number: '', invoice_date: todayDateValue() });
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [refundForm, setRefundForm] = useState({ amount: '', reason: '' });
  const [manualPaymentForm, setManualPaymentForm] = useState<ManualPaymentFormState>({
    plan_key: '',
    starts_at: todayDateValue(),
    promo_code_id: '',
    transfer_reference: '',
    notes: '',
  });

  const tenantsQuery = useQuery<PaginatedResponse<AdminTenantBilling>>({
    queryKey: ['platform-tenants'],
    queryFn: async () => {
      const response = await billingApi.listAdminTenants({ page: 1, per_page: 100 });
      return response.data;
    },
  });

  const plansQuery = useQuery<AdminSaaSPlan[]>({
    queryKey: ['platform-saas-plans'],
    queryFn: async () => (await billingApi.listAdminPlans()).data,
  });

  const promoCodesQuery = useQuery<PlatformPromoCode[]>({
    queryKey: ['platform-promo-codes'],
    queryFn: async () => (await billingApi.listAdminPromoCodes()).data,
  });

  const drawerTenant = useMemo(
    () => (tenantsQuery.data?.items ?? []).find((t) => t.tenant_id === drawerTenantId) ?? null,
    [drawerTenantId, tenantsQuery.data?.items],
  );

  const paymentsQuery = useQuery<PaginatedResponse<PlatformBillingPayment>>({
    queryKey: ['admin-tenant-payments', drawerTenant?.tenant_id],
    queryFn: async () => {
      const response = await billingApi.listAdminTenantPayments(drawerTenant!.tenant_id);
      return response.data;
    },
    enabled: Boolean(drawerTenant) && drawerTab === 'payments',
  });

  const recordInvoice = useMutation({
    mutationFn: async ({ paymentId, data }: { paymentId: string; data: { folio_number: number; invoice_date: string } }) => {
      const response = await billingApi.recordPaymentInvoice(paymentId, data);
      return response.data;
    },
    onSuccess: () => {
      toast.success('Folio registrado correctamente.');
      setEditingPaymentId(null);
      paymentsQuery.refetch();
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No se pudo registrar el folio.'));
    },
  });

  const registerManualPayment = useMutation({
    mutationFn: async ({ tenantId, payload }: { tenantId: string; payload: AdminTenantManualPaymentRequest }) => {
      const response = await billingApi.registerTenantManualPayment(tenantId, payload);
      return response.data;
    },
    onSuccess: async (result: any) => {
      const expiry = result?.license_expires_at ? ` Vence ${formatDate(result.license_expires_at)}.` : '';
      toast.success(`Transferencia registrada.${expiry}`);
      setShowManualForm(false);
      await Promise.all([
        tenantsQuery.refetch(),
        promoCodesQuery.refetch(),
        paymentsQuery.refetch(),
      ]);
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No se pudo registrar la transferencia.'));
    },
  });

  const setAccessMutation = useMutation({
    mutationFn: async ({ tenantId, isActive }: { tenantId: string; isActive: boolean }) =>
      billingApi.setTenantAccess(tenantId, { is_active: isActive }),
    onSuccess: async (_res, vars) => {
      toast.success(vars.isActive ? 'Acceso desbloqueado.' : 'Acceso bloqueado.');
      await tenantsQuery.refetch();
    },
    onError: (error: any) =>
      toast.error(getApiError(error, 'No se pudo actualizar el acceso de la cuenta.')),
  });

  const sendOwnerResetMutation = useMutation({
    mutationFn: async (tenantId: string) => billingApi.sendOwnerPasswordReset(tenantId),
    onSuccess: (res: any) => {
      const email = res?.data?.owner_email;
      toast.success(email ? `Correo enviado a ${email}.` : 'Correo enviado.');
    },
    onError: (error: any) =>
      toast.error(getApiError(error, 'No se pudo enviar el correo de recuperación.')),
  });

  const disable2faMutation = useMutation({
    mutationFn: async (userId: string) => platformAdminApi.disableUser2fa(userId),
    onSuccess: () => toast.success('2FA del propietario desactivado.'),
    onError: (error: any) =>
      toast.error(getApiError(error, 'No se pudo desactivar 2FA del propietario.')),
  });

  const refundMutation = useMutation({
    mutationFn: async ({ paymentId, amount, reason }: { paymentId: string; amount?: number; reason?: string }) => {
      const response = await platformAdminApi.refundPayment(paymentId, { amount, reason });
      return response.data;
    },
    onSuccess: async (result: any) => {
      const status = result?.refund_status ?? 'refunded';
      toast.success(status === 'manual' ? 'Reembolso marcado manual.' : 'Reembolso procesado.');
      setRefundingId(null);
      setRefundForm({ amount: '', reason: '' });
      await paymentsQuery.refetch();
    },
    onError: (error: any) => toast.error(getApiError(error, 'No se pudo procesar el reembolso.')),
  });

  const featureFlagsMutation = useMutation({
    mutationFn: async ({ tenantId, flags }: { tenantId: string; flags: Record<string, unknown> }) => {
      const response = await platformAdminApi.updateTenantFeatureFlags(tenantId, flags);
      return response.data;
    },
    onSuccess: async () => {
      toast.success('Flags actualizados.');
      await tenantsQuery.refetch();
    },
    onError: (error: any) => toast.error(getApiError(error, 'No se pudieron actualizar los flags.')),
  });

  const impersonateMutation = useMutation({
    mutationFn: async (tenantId: string) => {
      const { startImpersonation } = await import('@/utils/impersonation');
      const response = await platformAdminApi.impersonateTenantOwner(tenantId);
      const token = (response.data as { access_token: string }).access_token;
      await startImpersonation(token);
      return response.data;
    },
    onSuccess: (data: any) => {
      toast.success(`Sesión impersonada como ${data?.owner_email ?? 'owner'}. Redirigiendo…`);
      setTimeout(() => {
        window.location.href = '/dashboard';
      }, 600);
    },
    onError: (error: any) =>
      toast.error(getApiError(error, 'No se pudo iniciar la impersonación.')),
  });

  const tenants = tenantsQuery.data?.items ?? [];
  const plans = plansQuery.data ?? [];
  const promoCodes = promoCodesQuery.data ?? [];

  useEffect(() => {
    if (!showManualForm || !drawerTenant) return;
    setManualPaymentForm(buildManualPaymentForm(drawerTenant, plans));
  }, [showManualForm, drawerTenant, plans]);

  const openDrawer = (tenantId: string, tab: DrawerTab = 'summary') => {
    setDrawerTenantId(tenantId);
    setDrawerTab(tab);
    setShowManualForm(false);
    setEditingPaymentId(null);
  };

  const closeDrawer = () => {
    setDrawerTenantId(null);
    setShowManualForm(false);
    setEditingPaymentId(null);
  };

  const filteredTenants = useMemo(() => {
    let list = tenants;
    if (statusFilter !== 'all') list = list.filter((t) => t.status === statusFilter);
    const normalizedSearch = search.trim().toLowerCase();
    if (normalizedSearch) {
      list = list.filter((tenant) =>
        [
          tenant.tenant_name,
          tenant.tenant_slug,
          tenant.owner_email,
          tenant.owner_name,
          tenant.plan_name,
          tenant.plan_key,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedSearch)),
      );
    }
    return list;
  }, [search, statusFilter, tenants]);

  const summary = useMemo(() => {
    const active = tenants.filter((tenant) => tenant.status === 'active').length;
    const trial = tenants.filter((tenant) => tenant.status === 'trial').length;
    const atRisk = tenants.filter((tenant) => ['suspended', 'expired', 'cancelled'].includes(tenant.status)).length;
    const checkoutReady = tenants.filter((tenant) => tenant.checkout_enabled).length;

    return { active, trial, atRisk, checkoutReady };
  }, [tenants]);

  const sortedTenants = useMemo(() => {
    return [...filteredTenants].sort((a, b) => compareTenants(a, b, sortBy, sortDir));
  }, [filteredTenants, sortBy, sortDir]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('platform.tenants.density', density);
  }, [density]);

  // Drop selections that disappear from the visible list (e.g. filter change)
  useEffect(() => {
    setSelectedIds((prev) => {
      const visible = new Set(sortedTenants.map((t) => t.tenant_id));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (visible.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [sortedTenants]);

  const applyView = (view: SavedView) => {
    setActiveViewKey(view.key);
    setStatusFilter(view.statusFilter);
    if (view.sortBy) setSortBy(view.sortBy);
    if (view.sortDir) setSortDir(view.sortDir);
    setSelectedIds(new Set());
  };

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortDir(key === 'expires' || key === 'capacity' ? 'desc' : 'asc');
    }
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      if (prev.size === sortedTenants.length) return new Set();
      return new Set(sortedTenants.map((t) => t.tenant_id));
    });
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const bulkSetAccess = async (isActive: boolean) => {
    if (selectedIds.size === 0) return;
    const label = isActive ? 'desbloquear' : 'bloquear';
    if (!window.confirm(`¿Confirmar ${label} acceso de ${selectedIds.size} cuenta(s)?`)) return;
    setBulkBusy(true);
    let ok = 0;
    let fail = 0;
    for (const id of selectedIds) {
      try {
        await billingApi.setTenantAccess(id, { is_active: isActive });
        ok += 1;
      } catch {
        fail += 1;
      }
    }
    setBulkBusy(false);
    if (fail === 0) toast.success(`${ok} cuenta(s) actualizada(s).`);
    else toast.error(`${ok} ok · ${fail} fallaron.`);
    setSelectedIds(new Set());
    void tenantsQuery.refetch();
  };

  const bulkExportCsv = () => {
    const rows = sortedTenants.filter((t) => selectedIds.has(t.tenant_id));
    if (rows.length === 0) return;
    const stamp = new Date().toISOString().slice(0, 10);
    downloadTenantsCsv(`nexo-tenants-${stamp}.csv`, rows);
  };

  const exportAllCsv = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadTenantsCsv(`nexo-tenants-${stamp}.csv`, sortedTenants);
  };

  const selectedManualPlan = useMemo(
    () => plans.find((plan) => plan.key === manualPaymentForm.plan_key) ?? null,
    [manualPaymentForm.plan_key, plans],
  );

  const selectedManualPromo = useMemo(
    () => promoCodes.find((promo) => promo.id === manualPaymentForm.promo_code_id) ?? null,
    [manualPaymentForm.promo_code_id, promoCodes],
  );

  const manualPreview = useMemo(
    () => getPromoPreview(selectedManualPlan, selectedManualPromo),
    [selectedManualPlan, selectedManualPromo],
  );

  const activePromoCodes = useMemo(
    () => promoCodes.filter((promo) => promo.is_active),
    [promoCodes],
  );

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-6">
      <motion.div variants={fadeInUp} className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-brand-200/50 bg-brand-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-brand-700 dark:border-brand-900/40 dark:bg-brand-950/20 dark:text-brand-300">
            <ShieldCheck size={14} />
            {NEXO_BRAND_SLOGAN}
          </div>
          <h1 className="mt-3 text-2xl font-bold font-display text-surface-900 dark:text-white">Cuentas SaaS y ventas online</h1>
          <p className="mt-1 text-sm text-surface-500">
            Vista operativa para seguir pruebas, activaciones, propietarios y capacidad del SaaS.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Link to="/platform/plans" className="btn-secondary">
            Administrar planes
          </Link>
          <Link to="/platform/promo-codes" className="btn-secondary">
            Promo codes SaaS
          </Link>
        </div>
      </motion.div>

      {tenantsQuery.isError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-600 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
          No pudimos cargar las cuentas SaaS. Revisa el backend o tu sesión de superadmin.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Cuentas totales" value={tenants.length} icon={Building2} color="brand" />
        <StatCard label="Cuentas activas" value={summary.active} icon={CheckCircle2} color="emerald" />
        <StatCard label="Pruebas en curso" value={summary.trial} icon={Clock3} color="blue" />
        <StatCard label="Cobro online listo" value={summary.checkoutReady} icon={WalletCards} color="violet" />
      </div>

      {/* Saved views */}
      <motion.div variants={fadeInUp} className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] font-bold uppercase tracking-[0.16em] text-surface-400">Vistas</span>
        {PRESET_VIEWS.map((view) => {
          const active = activeViewKey === view.key;
          const count =
            view.statusFilter === 'all'
              ? tenants.length
              : tenants.filter((t) => t.status === view.statusFilter).length;
          return (
            <button
              key={view.key}
              type="button"
              onClick={() => applyView(view)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? 'border-brand-500 bg-brand-500/15 text-brand-700 dark:text-brand-300'
                  : 'border-surface-200 bg-white text-surface-600 hover:border-surface-300 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-300'
              }`}
            >
              {view.label}
              <span
                className={`rounded-full px-1.5 py-px text-[10px] tabular-nums ${
                  active
                    ? 'bg-brand-500/20 text-brand-700 dark:text-brand-200'
                    : 'bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-400'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </motion.div>

      {/* Toolbar: search + status + density */}
      <motion.div
        variants={fadeInUp}
        className="rounded-2xl border border-surface-200/50 bg-white p-3 dark:border-surface-800/50 dark:bg-surface-900"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 flex-1">
            <div className="relative flex-1 min-w-[240px] max-w-md">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar gimnasio, propietario, slug…"
                className="input w-full pl-9 py-1.5 text-sm"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setActiveViewKey('custom');
              }}
              className="input py-1.5 text-sm"
            >
              {STATUS_FILTERS.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            {/* Density toggle */}
            <div className="inline-flex rounded-lg border border-surface-200 dark:border-surface-700 p-0.5">
              <button
                type="button"
                onClick={() => setDensity('comfy')}
                className={`p-1.5 rounded-md ${density === 'comfy' ? 'bg-brand-500/15 text-brand-700 dark:text-brand-300' : 'text-surface-400 hover:text-surface-700 dark:hover:text-surface-200'}`}
                title="Densidad cómoda"
              >
                <Rows3 size={14} />
              </button>
              <button
                type="button"
                onClick={() => setDensity('compact')}
                className={`p-1.5 rounded-md ${density === 'compact' ? 'bg-brand-500/15 text-brand-700 dark:text-brand-300' : 'text-surface-400 hover:text-surface-700 dark:hover:text-surface-200'}`}
                title="Densidad compacta"
              >
                <Rows4 size={14} />
              </button>
            </div>
            <button
              type="button"
              onClick={exportAllCsv}
              className="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 bg-white px-3 py-1.5 text-xs font-medium text-surface-700 hover:border-surface-300 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-300"
              title="Exportar todo a CSV"
            >
              <Download size={13} /> CSV
            </button>
            <button
              type="button"
              onClick={() => void tenantsQuery.refetch()}
              className="btn-secondary text-sm"
              disabled={tenantsQuery.isFetching}
            >
              {tenantsQuery.isFetching ? '…' : 'Actualizar'}
            </button>
          </div>
        </div>
      </motion.div>

      {/* Tabla / lista */}
      <motion.div
        variants={fadeInUp}
        className="overflow-hidden rounded-2xl border border-surface-200/50 bg-white dark:border-surface-800/50 dark:bg-surface-900"
      >
        <div className="flex items-center justify-between border-b border-surface-100 px-5 py-3 dark:border-surface-800">
          <p className="text-sm text-surface-500">
            {tenantsQuery.isLoading
              ? 'Cargando cuentas…'
              : `${filteredTenants.length} visibles de ${tenants.length}`}
          </p>
          <p className="text-xs uppercase tracking-[0.18em] text-surface-400">
            Última actualización: {formatDateTime(new Date())}
          </p>
        </div>

        {tenantsQuery.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-surface-100 dark:bg-surface-800/60" />
            ))}
          </div>
        ) : filteredTenants.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <p className="text-base font-semibold text-surface-900 dark:text-white">
              No hay cuentas con esos filtros
            </p>
            <p className="mt-2 text-sm text-surface-500">Prueba con otro estado o limpia la búsqueda.</p>
            {(statusFilter !== 'all' || search) && (
              <button
                type="button"
                onClick={() => { setStatusFilter('all'); setSearch(''); }}
                className="btn-secondary mt-4 text-sm"
              >
                Limpiar filtros
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-surface-50/90 backdrop-blur dark:bg-surface-800/60">
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-surface-500">
                  <th className="w-10 px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={sortedTenants.length > 0 && selectedIds.size === sortedTenants.length}
                      ref={(el) => {
                        if (el) {
                          el.indeterminate = selectedIds.size > 0 && selectedIds.size < sortedTenants.length;
                        }
                      }}
                      onChange={toggleSelectAll}
                      className="h-3.5 w-3.5 cursor-pointer rounded border-surface-300 text-brand-500 focus:ring-brand-400 dark:border-surface-600"
                      aria-label="Seleccionar todas"
                    />
                  </th>
                  <SortableTh label="Cuenta" sortKey="name" current={sortBy} dir={sortDir} onClick={toggleSort} />
                  <SortableTh label="Plan" sortKey="plan" current={sortBy} dir={sortDir} onClick={toggleSort} />
                  <SortableTh label="Estado / vence" sortKey="expires" current={sortBy} dir={sortDir} onClick={toggleSort} />
                  <SortableTh label="Capacidad" sortKey="capacity" current={sortBy} dir={sortDir} onClick={toggleSort} align="right" />
                  <SortableTh label="Salud" sortKey="health" current={sortBy} dir={sortDir} onClick={toggleSort} align="right" />
                  <th className="px-4 py-2.5 text-right">Pago</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
                {sortedTenants.map((tenant) => {
                  const days = daysUntil(tenant.license_expires_at);
                  const isBlocked = !tenant.is_active;
                  const isSelected = selectedIds.has(tenant.tenant_id);
                  const padY = density === 'compact' ? 'py-1.5' : 'py-3';
                  return (
                    <tr
                      key={tenant.tenant_id}
                      onClick={() => openDrawer(tenant.tenant_id, 'summary')}
                      className={`group cursor-pointer transition-colors hover:bg-brand-50/40 dark:hover:bg-surface-800/40 ${
                        isSelected ? 'bg-brand-50/60 dark:bg-brand-950/15' : ''
                      }`}
                    >
                      <td className={`px-4 ${padY}`} onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectOne(tenant.tenant_id)}
                          className="h-3.5 w-3.5 cursor-pointer rounded border-surface-300 text-brand-500 focus:ring-brand-400 dark:border-surface-600"
                          aria-label={`Seleccionar ${tenant.tenant_name}`}
                        />
                      </td>
                      <td className={`px-4 ${padY} min-w-0`}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-semibold text-surface-900 dark:text-white">
                            {tenant.tenant_name}
                          </span>
                          {isBlocked && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
                              <Ban size={10} /> Bloqueado
                            </span>
                          )}
                        </div>
                        <p className="truncate font-mono text-[11px] text-surface-500">{tenant.tenant_slug}</p>
                        {density === 'comfy' && tenant.owner_email && (
                          <p className="mt-0.5 truncate text-xs text-surface-500">{tenant.owner_email}</p>
                        )}
                      </td>
                      <td className={`px-4 ${padY} text-sm text-surface-700 dark:text-surface-300`}>
                        {tenant.plan_name || planLabel(tenant.plan_key)}
                      </td>
                      <td className={`px-4 ${padY}`}>
                        <div className="flex flex-col gap-0.5">
                          <span className={`inline-flex w-fit rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusClass(tenant.status)}`}>
                            {statusLabel(tenant.status)}
                          </span>
                          {tenant.license_expires_at ? (
                            <span className={`text-xs ${expiryTone(days)}`}>
                              {days! < 0
                                ? `Venció hace ${-days!}d`
                                : days! === 0
                                  ? 'Vence hoy'
                                  : `${days}d · ${formatDate(tenant.license_expires_at)}`}
                            </span>
                          ) : tenant.trial_ends_at ? (
                            <span className="text-xs text-sky-600 dark:text-sky-300">
                              Prueba hasta {formatDate(tenant.trial_ends_at)}
                            </span>
                          ) : (
                            <span className="text-xs text-surface-400">Sin fecha</span>
                          )}
                        </div>
                      </td>
                      <td className={`px-4 ${padY} text-right text-xs text-surface-600 dark:text-surface-300 tabular-nums`}>
                        <div>{tenant.max_members ?? 0} miembros</div>
                        <div className="text-surface-400">{tenant.max_branches ?? 0} sedes</div>
                      </td>
                      <td className={`px-4 ${padY} text-right`}>
                        {tenant.health_level ? (
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums ${HEALTH_LEVEL_TONE[tenant.health_level] ?? HEALTH_LEVEL_TONE.watch}`}
                            title={(tenant.health_factors ?? []).map((f) => `${f.label} (${f.delta >= 0 ? '+' : ''}${f.delta})`).join('\n') || 'Sin factores'}
                          >
                            <span className="font-display font-bold">{Math.round(tenant.health_score ?? 0)}</span>
                            <span className="text-[10px] uppercase tracking-wider">{HEALTH_LEVEL_LABEL[tenant.health_level]}</span>
                          </span>
                        ) : (
                          <span className="text-xs text-surface-400">—</span>
                        )}
                      </td>
                      <td className={`px-4 ${padY} text-right`}>
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <span
                            className={`inline-flex h-2 w-2 rounded-full ${
                              tenant.checkout_enabled ? 'bg-emerald-500' : 'bg-surface-300 dark:bg-surface-600'
                            }`}
                          />
                          <span className="text-surface-600 dark:text-surface-300">
                            {tenant.checkout_enabled ? 'Online' : 'Manual'}
                          </span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>

      {/* Bulk action bar */}
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.18 }}
            className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2"
          >
            <div className="flex items-center gap-2 rounded-full border border-surface-200 bg-white px-3 py-2 shadow-2xl dark:border-surface-700 dark:bg-surface-900">
              <span className="px-2 text-xs font-semibold text-surface-700 dark:text-surface-200 tabular-nums">
                {selectedIds.size} seleccionado{selectedIds.size === 1 ? '' : 's'}
              </span>
              <span className="h-5 w-px bg-surface-200 dark:bg-surface-700" />
              <button
                type="button"
                onClick={bulkExportCsv}
                disabled={bulkBusy}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-surface-700 hover:bg-surface-100 dark:text-surface-200 dark:hover:bg-surface-800"
              >
                <Download size={13} /> Exportar
              </button>
              <button
                type="button"
                onClick={() => void bulkSetAccess(true)}
                disabled={bulkBusy}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
              >
                <ShieldCheck size={13} /> Desbloquear
              </button>
              <button
                type="button"
                onClick={() => void bulkSetAccess(false)}
                disabled={bulkBusy}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/30"
              >
                <ShieldOff size={13} /> Bloquear
              </button>
              {bulkBusy && <Loader2 size={14} className="animate-spin text-surface-400" />}
              <span className="h-5 w-px bg-surface-200 dark:bg-surface-700" />
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="rounded-full p-1.5 text-surface-400 hover:bg-surface-100 hover:text-surface-700 dark:hover:bg-surface-800 dark:hover:text-surface-200"
                title="Limpiar selección"
                aria-label="Limpiar selección"
              >
                <X size={14} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Drawer detalle */}
      <Drawer
        open={!!drawerTenant}
        onClose={closeDrawer}
        width={560}
        title={
          drawerTenant ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate">{drawerTenant.tenant_name}</span>
              <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusClass(drawerTenant.status)}`}>
                {statusLabel(drawerTenant.status)}
              </span>
            </div>
          ) : null
        }
        description={
          drawerTenant ? (
            <span className="font-mono text-xs">{drawerTenant.tenant_slug}</span>
          ) : null
        }
      >
        {drawerTenant ? (
          <>
            {/* Tabs */}
            <div className="-mx-5 mb-5 border-b border-surface-200 px-5 dark:border-surface-800">
              <div className="flex gap-1">
                {([
                  { key: 'summary', label: 'Resumen' },
                  { key: 'payments', label: 'Pagos' },
                  { key: 'flags', label: 'Flags' },
                  { key: 'actions', label: 'Acciones' },
                ] as const).map((t) => {
                  const active = drawerTab === t.key;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => { setDrawerTab(t.key); setShowManualForm(false); setEditingPaymentId(null); }}
                      className={`relative px-3 py-2.5 text-sm font-medium transition-colors ${
                        active
                          ? 'text-brand-600 dark:text-brand-400'
                          : 'text-surface-500 hover:text-surface-800 dark:hover:text-surface-200'
                      }`}
                    >
                      {t.label}
                      {active ? (
                        <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-500" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Tab: Resumen */}
            {drawerTab === 'summary' && (
              <div className="space-y-5">
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500">Plan actual</h3>
                  <div className="mt-2 rounded-xl border border-surface-200 bg-surface-50 p-3 dark:border-surface-800 dark:bg-surface-900/40">
                    <p className="text-sm font-semibold text-surface-900 dark:text-white">
                      {drawerTenant.plan_name || planLabel(drawerTenant.plan_key)}
                    </p>
                    <p className="text-xs text-surface-500">
                      Moneda: {drawerTenant.currency} · Tipo: {planLabel(drawerTenant.license_type)}
                    </p>
                    {drawerTenant.next_plan_name ? (
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                        Próximo: {drawerTenant.next_plan_name}
                        {drawerTenant.next_plan_starts_at ? ` desde ${formatDate(drawerTenant.next_plan_starts_at)}` : ''}
                        {drawerTenant.next_plan_paid ? ' · pagado' : ' · pendiente'}
                      </p>
                    ) : null}
                  </div>
                </section>

                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500">Propietario</h3>
                  {drawerTenant.owner_email ? (
                    <div className="mt-2 space-y-1">
                      <p className="text-sm font-medium text-surface-900 dark:text-white">
                        {drawerTenant.owner_name ?? '—'}
                      </p>
                      <button
                        type="button"
                        onClick={() => { void navigator.clipboard.writeText(drawerTenant.owner_email!); toast.success('Correo copiado.'); }}
                        className="inline-flex items-center gap-1.5 text-sm text-surface-600 hover:text-brand-600 dark:text-surface-300"
                      >
                        <Mail size={13} /> {drawerTenant.owner_email}
                        <Copy size={12} />
                      </button>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-surface-400">Sin propietario asignado.</p>
                  )}
                </section>

                <section className="grid grid-cols-2 gap-3">
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500">Ciclo</h3>
                    <dl className="mt-2 space-y-1.5 text-sm">
                      <div className="flex justify-between gap-2">
                        <dt className="text-surface-500">Creado</dt>
                        <dd className="text-surface-800 dark:text-surface-200">{formatDate(drawerTenant.created_at)}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-surface-500">Prueba</dt>
                        <dd className="text-surface-800 dark:text-surface-200">
                          {drawerTenant.trial_ends_at ? formatDate(drawerTenant.trial_ends_at) : '—'}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-surface-500">Vence</dt>
                        <dd className={expiryTone(daysUntil(drawerTenant.license_expires_at))}>
                          {drawerTenant.license_expires_at ? formatDate(drawerTenant.license_expires_at) : '—'}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-surface-500">Acceso</dt>
                        <dd className={drawerTenant.is_active ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                          {drawerTenant.is_active ? 'Habilitado' : 'Bloqueado'}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500">Capacidad</h3>
                    <dl className="mt-2 space-y-1.5 text-sm">
                      <div className="flex justify-between gap-2">
                        <dt className="text-surface-500">Miembros</dt>
                        <dd className="text-surface-800 dark:text-surface-200">
                          {drawerTenant.usage_active_clients} / {drawerTenant.max_members ?? 0}
                          {drawerTenant.over_client_limit ? <span className="ml-1 text-rose-500">!</span> : null}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-surface-500">Sedes</dt>
                        <dd className="text-surface-800 dark:text-surface-200">
                          {drawerTenant.usage_active_branches} / {drawerTenant.max_branches ?? 0}
                          {drawerTenant.over_branch_limit ? <span className="ml-1 text-rose-500">!</span> : null}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-surface-500">Pago</dt>
                        <dd className="text-surface-800 dark:text-surface-200">
                          {drawerTenant.checkout_enabled ? 'Online' : 'Manual'}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </section>

                {drawerTenant.stripe_customer_id || drawerTenant.stripe_subscription_id ? (
                  <section>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500">Stripe</h3>
                    <div className="mt-2 space-y-1 text-xs text-surface-500">
                      {drawerTenant.stripe_customer_id ? (
                        <p>Cliente: <span className="font-mono">{drawerTenant.stripe_customer_id}</span></p>
                      ) : null}
                      {drawerTenant.stripe_subscription_id ? (
                        <p>Suscripción: <span className="font-mono">{drawerTenant.stripe_subscription_id}</span></p>
                      ) : null}
                    </div>
                  </section>
                ) : null}

                {drawerTenant.features.length ? (
                  <section>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500">Features</h3>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {drawerTenant.features.map((f) => (
                        <span
                          key={f}
                          className="rounded-full bg-surface-100 px-2 py-0.5 text-[11px] font-medium text-surface-600 dark:bg-surface-800 dark:text-surface-300"
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>
            )}

            {/* Tab: Pagos */}
            {drawerTab === 'payments' && (
              <div className="space-y-4">
                {!showManualForm ? (
                  <>
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-surface-900 dark:text-white">Historial</h3>
                      <button
                        type="button"
                        onClick={() => setShowManualForm(true)}
                        className="btn-primary inline-flex items-center gap-1 text-xs"
                      >
                        <Plus size={12} /> Registrar transferencia
                      </button>
                    </div>

                    {paymentsQuery.isLoading && (
                      <p className="py-6 text-center text-sm text-surface-500">Cargando…</p>
                    )}
                    {paymentsQuery.isSuccess && (paymentsQuery.data?.items ?? []).length === 0 && (
                      <div className="rounded-xl border border-dashed border-surface-300 px-4 py-8 text-center text-sm text-surface-500 dark:border-surface-700">
                        Sin pagos registrados.
                      </div>
                    )}
                    {paymentsQuery.isSuccess && (paymentsQuery.data?.items ?? []).length > 0 && (
                      <ul className="divide-y divide-surface-100 rounded-xl border border-surface-200 dark:divide-surface-800 dark:border-surface-800">
                        {(paymentsQuery.data?.items ?? []).map((payment) => (
                          <li key={payment.id} className="px-3 py-2.5">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-surface-900 dark:text-white">
                                  {payment.plan_name}
                                </p>
                                <p className="text-xs text-surface-500">
                                  {formatDate(payment.starts_at)}
                                  {payment.expires_at ? ` → ${formatDate(payment.expires_at)}` : ''} ·
                                  {' '}{formatCurrency(payment.total_amount, payment.currency)}
                                </p>
                                <p className="text-[11px] text-surface-400">
                                  {payment.payment_method}
                                  {payment.external_reference ? ` · ${payment.external_reference}` : ''}
                                </p>
                              </div>
                              <div className="flex shrink-0 flex-col items-end gap-1.5">
                                {payment.invoice_status === 'manual' ? (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300">
                                    <FileText size={11} /> Folio {payment.folio_number}
                                  </span>
                                ) : (
                                  <span className="rounded-full border border-surface-200 bg-surface-100 px-2 py-0.5 text-[11px] text-surface-500 dark:border-surface-700 dark:bg-surface-800">
                                    Sin factura
                                  </span>
                                )}
                                <button
                                  type="button"
                                  className="text-[11px] text-brand-600 hover:underline dark:text-brand-400"
                                  onClick={() => {
                                    setEditingPaymentId(payment.id);
                                    setFolioForm({
                                      folio_number: payment.folio_number ? String(payment.folio_number) : '',
                                      invoice_date: payment.invoice_date ?? todayDateValue(),
                                    });
                                  }}
                                >
                                  {payment.invoice_status === 'manual' ? 'Editar folio' : 'Registrar folio'}
                                </button>
                                {payment.refund_status ? (
                                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                                    payment.refund_status === 'failed'
                                      ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300'
                                      : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300'
                                  }`}>
                                    {payment.refund_status === 'manual' ? 'Reembolso manual' :
                                      payment.refund_status === 'partial' ? `Parcial ${formatCurrency(payment.refunded_amount ?? 0, payment.currency)}` :
                                      payment.refund_status === 'failed' ? 'Reembolso falló' : 'Reembolsado'}
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    className="text-[11px] text-rose-600 hover:underline dark:text-rose-400"
                                    onClick={() => {
                                      setRefundingId(payment.id);
                                      setRefundForm({ amount: String(payment.total_amount), reason: '' });
                                    }}
                                  >
                                    Reembolsar
                                  </button>
                                )}
                              </div>
                            </div>

                            {refundingId === payment.id && (
                              <form
                                className="mt-3 flex flex-wrap items-end gap-2 border-t border-rose-200/60 pt-3 dark:border-rose-900/40"
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  const amt = parseFloat(refundForm.amount);
                                  if (!amt || amt <= 0) { toast.error('Monto inválido'); return; }
                                  if (amt > Number(payment.total_amount) - Number(payment.refunded_amount ?? 0)) {
                                    toast.error('Monto excede saldo refundable'); return;
                                  }
                                  if (!window.confirm(`Reembolsar ${formatCurrency(amt, payment.currency)} a través de ${payment.payment_method}?`)) return;
                                  refundMutation.mutate({ paymentId: payment.id, amount: amt, reason: refundForm.reason.trim() || undefined });
                                }}
                              >
                                <div className="flex flex-col gap-0.5">
                                  <label className="text-[10px] font-semibold uppercase tracking-wider text-surface-500">Monto</label>
                                  <input
                                    type="number"
                                    step="0.01"
                                    min={0.01}
                                    max={Number(payment.total_amount)}
                                    className="input w-32 text-xs"
                                    value={refundForm.amount}
                                    onChange={(e) => setRefundForm((f) => ({ ...f, amount: e.target.value }))}
                                    required
                                  />
                                </div>
                                <div className="flex flex-1 flex-col gap-0.5">
                                  <label className="text-[10px] font-semibold uppercase tracking-wider text-surface-500">Razón (opcional)</label>
                                  <input
                                    type="text"
                                    maxLength={250}
                                    className="input text-xs"
                                    placeholder="ej. error de cobro, cancelación cliente"
                                    value={refundForm.reason}
                                    onChange={(e) => setRefundForm((f) => ({ ...f, reason: e.target.value }))}
                                  />
                                </div>
                                <button type="button" className="btn-secondary text-xs" onClick={() => setRefundingId(null)}>
                                  Cancelar
                                </button>
                                <button type="submit" className="btn-primary bg-rose-600 hover:bg-rose-700 text-xs" disabled={refundMutation.isPending}>
                                  {refundMutation.isPending ? '…' : 'Procesar reembolso'}
                                </button>
                              </form>
                            )}

                            {editingPaymentId === payment.id && (
                              <form
                                className="mt-3 flex flex-wrap items-end gap-2 border-t border-surface-100 pt-3 dark:border-surface-800"
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  const folio = parseInt(folioForm.folio_number, 10);
                                  if (!folio || folio < 1) { toast.error('Folio inválido'); return; }
                                  if (!folioForm.invoice_date) { toast.error('Ingresa la fecha'); return; }
                                  recordInvoice.mutate({ paymentId: payment.id, data: { folio_number: folio, invoice_date: folioForm.invoice_date } });
                                }}
                              >
                                <input
                                  type="number"
                                  min={1}
                                  className="input w-24 text-xs"
                                  placeholder="Folio"
                                  value={folioForm.folio_number}
                                  onChange={(e) => setFolioForm((f) => ({ ...f, folio_number: e.target.value }))}
                                  required
                                />
                                <input
                                  type="date"
                                  className="input w-36 text-xs"
                                  value={folioForm.invoice_date}
                                  onChange={(e) => setFolioForm((f) => ({ ...f, invoice_date: e.target.value }))}
                                  required
                                />
                                <button type="button" className="btn-secondary text-xs" onClick={() => setEditingPaymentId(null)}>
                                  Cancelar
                                </button>
                                <button type="submit" className="btn-primary text-xs" disabled={recordInvoice.isPending}>
                                  {recordInvoice.isPending ? '…' : 'Guardar'}
                                </button>
                              </form>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-surface-900 dark:text-white">Registrar transferencia</h3>
                      <button
                        type="button"
                        onClick={() => setShowManualForm(false)}
                        className="text-xs text-surface-500 hover:underline"
                      >
                        Volver al historial
                      </button>
                    </div>
                    <p className="text-xs text-surface-500">
                      La activación manual usa la duración del plan y calcula automáticamente el vencimiento desde la fecha de inicio.
                    </p>
                    <form
                      className="space-y-4"
                      onSubmit={(event) => {
                        event.preventDefault();
                        registerManualPayment.mutate({
                          tenantId: drawerTenant.tenant_id,
                          payload: {
                            plan_key: manualPaymentForm.plan_key,
                            starts_at: manualPaymentForm.starts_at,
                            payment_method: 'transfer',
                            promo_code_id: manualPaymentForm.promo_code_id || null,
                            transfer_reference: manualPaymentForm.transfer_reference.trim(),
                            notes: manualPaymentForm.notes.trim() || undefined,
                          },
                        });
                      }}
                    >
                      <div>
                        <label className="mb-1 block text-xs font-medium text-surface-700 dark:text-surface-300">Plan</label>
                        <select
                          className="input"
                          value={manualPaymentForm.plan_key}
                          onChange={(e) => setManualPaymentForm((c) => ({ ...c, plan_key: e.target.value }))}
                          required
                        >
                          <option value="">Selecciona un plan</option>
                          {plans.map((plan) => (
                            <option key={plan.id} value={plan.key}>
                              {plan.name} · {formatCurrency(parseApiNumber(plan.total_price), plan.currency)}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="mb-1 block text-xs font-medium text-surface-700 dark:text-surface-300">Fecha inicio</label>
                          <input
                            type="date"
                            className="input"
                            value={manualPaymentForm.starts_at}
                            onChange={(e) => setManualPaymentForm((c) => ({ ...c, starts_at: e.target.value }))}
                            required
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-surface-700 dark:text-surface-300">Promo (opcional)</label>
                          <select
                            className="input"
                            value={manualPaymentForm.promo_code_id}
                            onChange={(e) => setManualPaymentForm((c) => ({ ...c, promo_code_id: e.target.value }))}
                          >
                            <option value="">Sin promo</option>
                            {activePromoCodes.map((promo) => (
                              <option key={promo.id} value={promo.id}>
                                {promo.code} · {promo.discount_type === 'percent' ? `${promo.discount_value}%` : formatCurrency(parseApiNumber(promo.discount_value), 'CLP')}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium text-surface-700 dark:text-surface-300">Referencia</label>
                        <input
                          className="input"
                          value={manualPaymentForm.transfer_reference}
                          onChange={(e) => setManualPaymentForm((c) => ({ ...c, transfer_reference: e.target.value }))}
                          placeholder="TRX-20260421-001"
                          required
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium text-surface-700 dark:text-surface-300">Notas</label>
                        <textarea
                          className="input min-h-20 resize-y"
                          value={manualPaymentForm.notes}
                          onChange={(e) => setManualPaymentForm((c) => ({ ...c, notes: e.target.value }))}
                          placeholder="Detalles del depósito o acuerdo."
                        />
                      </div>

                      {selectedManualPlan && manualPreview ? (
                        <div className="rounded-xl border border-surface-200 bg-surface-50 p-3 text-xs dark:border-surface-800 dark:bg-surface-900/40">
                          {manualPreview.reason ? (
                            <p className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
                              {manualPreview.reason}
                            </p>
                          ) : null}
                          <div className="space-y-1">
                            <div className="flex justify-between"><span className="text-surface-500">Neto</span><span>{formatCurrency(manualPreview.baseAmount, selectedManualPlan.currency)}</span></div>
                            {manualPreview.discountAmount > 0 ? (
                              <div className="flex justify-between"><span className="text-surface-500">Descuento</span><span className="text-emerald-600 dark:text-emerald-300">-{formatCurrency(manualPreview.discountAmount, selectedManualPlan.currency)}</span></div>
                            ) : null}
                            <div className="flex justify-between"><span className="text-surface-500">IVA {manualPreview.taxRate}%</span><span>{formatCurrency(manualPreview.taxAmount, selectedManualPlan.currency)}</span></div>
                            <div className="mt-1 flex justify-between border-t border-surface-200 pt-1 text-sm font-semibold dark:border-surface-700">
                              <span>Total</span>
                              <span className="text-brand-700 dark:text-brand-300">{formatCurrency(manualPreview.totalAmount, selectedManualPlan.currency)}</span>
                            </div>
                          </div>
                        </div>
                      ) : null}

                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          className="btn-secondary text-sm"
                          onClick={() => setShowManualForm(false)}
                          disabled={registerManualPayment.isPending}
                        >
                          Cancelar
                        </button>
                        <button type="submit" className="btn-primary text-sm" disabled={registerManualPayment.isPending}>
                          {registerManualPayment.isPending ? 'Registrando…' : 'Registrar'}
                        </button>
                      </div>
                    </form>
                  </>
                )}
              </div>
            )}

            {/* Tab: Acciones */}
            {drawerTab === 'flags' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-surface-200 bg-surface-50 p-4 dark:border-surface-800 dark:bg-surface-800/40">
                  <p className="text-sm font-semibold text-surface-900 dark:text-white">Health score</p>
                  {drawerTenant.health_level ? (
                    <div className="mt-2 flex items-center gap-3">
                      <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold ${HEALTH_LEVEL_TONE[drawerTenant.health_level] ?? HEALTH_LEVEL_TONE.watch}`}>
                        <span className="font-display text-base">{Math.round(drawerTenant.health_score ?? 0)}/100</span>
                        <span className="text-[10px] uppercase tracking-wider">{HEALTH_LEVEL_LABEL[drawerTenant.health_level]}</span>
                      </span>
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-surface-500">Sin datos suficientes para calcular</p>
                  )}
                  {(drawerTenant.health_factors ?? []).length > 0 && (
                    <ul className="mt-3 space-y-1.5">
                      {(drawerTenant.health_factors ?? []).map((factor) => (
                        <li key={factor.key} className="flex items-center justify-between text-xs">
                          <span className={
                            factor.kind === 'critical' ? 'text-rose-600 dark:text-rose-300' :
                            factor.kind === 'warn' ? 'text-amber-600 dark:text-amber-300' :
                            factor.kind === 'ok' ? 'text-emerald-600 dark:text-emerald-300' :
                            'text-surface-600 dark:text-surface-400'
                          }>
                            {factor.label}
                          </span>
                          <span className="font-mono tabular-nums text-surface-500">
                            {factor.delta > 0 ? `+${factor.delta}` : factor.delta < 0 ? factor.delta : '·'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <p className="text-sm font-semibold text-surface-900 dark:text-white mb-2">Feature flags</p>
                  <p className="text-xs text-surface-500 mb-3">
                    Cambios afectan inmediatamente al tenant y quedan registrados en el audit log.
                  </p>
                  <div className="space-y-2">
                    {(() => {
                      const currentFlags = (drawerTenant.feature_flags_full ?? {}) as Record<string, unknown>;
                      return KNOWN_FEATURE_FLAGS.map((flag) => {
                        const enabled = Boolean(currentFlags[flag.key]);
                        return (
                          <label
                            key={flag.key}
                            className="flex items-start gap-3 rounded-xl border border-surface-200 px-3 py-3 dark:border-surface-800 hover:border-surface-300 dark:hover:border-surface-700 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={enabled}
                              disabled={featureFlagsMutation.isPending}
                              onChange={(e) => {
                                const next = { ...currentFlags, [flag.key]: e.target.checked };
                                if (!e.target.checked) delete next[flag.key];
                                featureFlagsMutation.mutate({ tenantId: drawerTenant.tenant_id, flags: next });
                              }}
                              className="mt-0.5 h-4 w-4 rounded border-surface-300 text-brand-500 focus:ring-brand-400 dark:border-surface-600"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-surface-900 dark:text-white">{flag.label}</p>
                              <p className="text-xs text-surface-500">{flag.description}</p>
                              <p className="mt-1 font-mono text-[10px] text-surface-400">{flag.key}</p>
                            </div>
                          </label>
                        );
                      });
                    })()}
                  </div>
                </div>
              </div>
            )}

            {drawerTab === 'actions' && (
              <div className="space-y-3">
                <ActionRow
                  icon={drawerTenant.is_active ? <Ban size={16} /> : <Power size={16} />}
                  iconClass={drawerTenant.is_active
                    ? 'bg-rose-50 text-rose-500 dark:bg-rose-950/30'
                    : 'bg-emerald-50 text-emerald-500 dark:bg-emerald-950/30'}
                  title={drawerTenant.is_active ? 'Bloquear acceso' : 'Desbloquear acceso'}
                  description={drawerTenant.is_active
                    ? 'Impide al staff y a los miembros entrar al sistema. No afecta facturación ni datos.'
                    : 'Restaura el acceso del staff. La cuenta vuelve a operar normalmente.'}
                  buttonLabel={drawerTenant.is_active ? 'Bloquear' : 'Desbloquear'}
                  buttonClass={drawerTenant.is_active ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}
                  pending={setAccessMutation.isPending}
                  confirm={drawerTenant.is_active ? `Bloquear acceso de ${drawerTenant.tenant_name}?` : undefined}
                  onClick={() => setAccessMutation.mutate({ tenantId: drawerTenant.tenant_id, isActive: !drawerTenant.is_active })}
                />

                <ActionRow
                  icon={<KeyRound size={16} />}
                  iconClass="bg-sky-50 text-sky-500 dark:bg-sky-950/30"
                  title="Enviar correo de recuperación"
                  description="Le mandamos al propietario un email con enlace para reestablecer su contraseña (TTL 1h)."
                  buttonLabel="Enviar"
                  pending={sendOwnerResetMutation.isPending}
                  disabled={!drawerTenant.owner_email}
                  onClick={() => sendOwnerResetMutation.mutate(drawerTenant.tenant_id)}
                />

                <ActionRow
                  icon={<ShieldOff size={16} />}
                  iconClass="bg-amber-50 text-amber-500 dark:bg-amber-950/30"
                  title="Desactivar 2FA del propietario"
                  description="Solo si perdió el dispositivo y los códigos de respaldo. La acción queda auditada."
                  buttonLabel="Desactivar 2FA"
                  buttonClass="text-amber-600 dark:text-amber-400"
                  pending={disable2faMutation.isPending}
                  disabled={!drawerTenant.owner_user_id}
                  confirm={`Desactivar 2FA del propietario de ${drawerTenant.tenant_name}?`}
                  onClick={() => drawerTenant.owner_user_id && disable2faMutation.mutate(drawerTenant.owner_user_id)}
                />

                <ActionRow
                  icon={<CreditCard size={16} />}
                  iconClass="bg-violet-50 text-violet-500 dark:bg-violet-950/30"
                  title="Cambiar plan"
                  description="Administrar el catálogo de planes SaaS y sus precios."
                  buttonLabel={<>Ir a planes <ExternalLink size={12} className="inline" /></>}
                  asLink
                  href="/platform/plans"
                />

                <ActionRow
                  icon={<UserCog size={16} />}
                  iconClass="bg-rose-50 text-rose-500 dark:bg-rose-950/30"
                  title="Impersonar propietario"
                  description="Inicia sesión como el owner para reproducir bugs o validar configuración. Token expira en 30 min y la acción queda registrada en el audit log."
                  buttonLabel="Impersonar"
                  buttonClass="text-rose-600 dark:text-rose-400"
                  pending={impersonateMutation.isPending}
                  disabled={!drawerTenant.owner_user_id || !drawerTenant.is_active}
                  confirm={`Iniciar sesión como propietario de ${drawerTenant.tenant_name}? Toda acción quedará en el audit log.`}
                  onClick={() => impersonateMutation.mutate(drawerTenant.tenant_id)}
                />
              </div>
            )}
          </>
        ) : null}
      </Drawer>

    </motion.div>
  );
}
