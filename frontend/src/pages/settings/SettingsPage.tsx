import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { Bell, ChevronDown, Clock, CreditCard, Globe, Lock, Mail, MapPin, Palette, Pencil, Plus, Shield, ShieldCheck, Store, Trash2, UserCog, UserMinus, UserPlus, Users } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import LogoUploader from '@/components/ui/LogoUploader';
import { branchesApi, paymentProviderApi, settingsApi, staffApi } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { fadeInUp, staggerContainer } from '@/utils/animations';
import type { Branch, PaymentProviderAccount, TenantSettings } from '@/types';
import {
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_SECONDARY_COLOR,
  buildTenantStorefrontUrl,
  getApiError,
  normalizeCustomDomain,
  normalizeHexColor,
} from '@/utils';

type SettingsForm = Omit<TenantSettings, 'branding'>;
type AccountForm = {
  provider: PaymentProviderAccount['provider'];
  account_label: string;
  public_identifier: string;
  checkout_base_url: string;
  tuu_account_id: string;
  tuu_secret_key: string;
  tuu_environment: 'integration' | 'production';
  fintoc_secret_key: string;
  fintoc_holder_id: string;
  fintoc_account_number: string;
  fintoc_account_type: 'checking_account' | 'sight_account';
  fintoc_institution_id: string;
  webpay_environment: 'integration' | 'production';
  webpay_commerce_code: string;
  webpay_api_key: string;
  status: PaymentProviderAccount['status'];
  is_default: boolean;
};

const emptyAccount: AccountForm = {
  provider: 'webpay',
  account_label: '',
  public_identifier: '',
  checkout_base_url: '',
  tuu_account_id: '',
  tuu_secret_key: '',
  tuu_environment: 'integration',
  fintoc_secret_key: '',
  fintoc_holder_id: '',
  fintoc_account_number: '',
  fintoc_account_type: 'checking_account',
  fintoc_institution_id: '',
  webpay_environment: 'integration',
  webpay_commerce_code: '',
  webpay_api_key: '',
  status: 'pending',
  is_default: true,
};

type BranchForm = {
  name: string;
  address: string;
  city: string;
  phone: string;
  email: string;
  opening_time: string;
  closing_time: string;
  capacity: string;
};

const emptyBranch: BranchForm = {
  name: '',
  address: '',
  city: '',
  phone: '',
  email: '',
  opening_time: '',
  closing_time: '',
  capacity: '',
};

type FintocRecipientAccount = {
  holder_id?: string;
  number?: string;
  type?: string;
  institution_id?: string;
};

function getFintocRecipientAccount(metadata: Record<string, unknown>): FintocRecipientAccount {
  const raw = metadata.recipient_account;
  return raw && typeof raw === 'object' ? raw as FintocRecipientAccount : {};
}

function getFintocAccountTypeLabel(accountType: string | undefined) {
  if (accountType === 'sight_account') return 'Cuenta vista';
  return 'Cuenta corriente';
}

function buildPaymentAccountPayload(
  form: AccountForm,
  existingAccount?: PaymentProviderAccount | null,
) {
  const basePayload = {
    account_label: form.account_label.trim() || null,
    public_identifier: form.public_identifier.trim() || null,
    checkout_base_url: form.provider === 'webpay' || form.provider === 'fintoc' || form.provider === 'tuu' ? null : form.checkout_base_url.trim() || null,
    status: form.status,
    is_default: form.is_default,
  };

  if (form.provider === 'tuu') {
    const metadata: Record<string, unknown> = {
      environment: form.tuu_environment,
      account_id: form.tuu_account_id.trim(),
    };
    const nextSecretKey = form.tuu_secret_key.trim();
    if (nextSecretKey) {
      metadata.secret_key = nextSecretKey;
    }

    const tuuPayload = {
      ...basePayload,
      public_identifier: form.tuu_account_id.trim() || basePayload.public_identifier,
      checkout_base_url: null,
      metadata,
    };

    if (existingAccount) {
      return tuuPayload;
    }

    return {
      provider: form.provider,
      ...tuuPayload,
    };
  }

  if (form.provider === 'fintoc') {
    const fintocMetadata: Record<string, unknown> = {};
    if (form.fintoc_secret_key.trim()) {
      fintocMetadata.secret_key = form.fintoc_secret_key.trim();
    }
    if (form.fintoc_holder_id.trim() || form.fintoc_account_number.trim() || form.fintoc_institution_id.trim()) {
      fintocMetadata.recipient_account = {
        holder_id: form.fintoc_holder_id.trim(),
        number: form.fintoc_account_number.trim(),
        type: form.fintoc_account_type,
        institution_id: form.fintoc_institution_id.trim(),
      };
    }
    const fintocPayload = {
      ...basePayload,
      checkout_base_url: null,
      metadata: fintocMetadata,
    };

    if (existingAccount) {
      return fintocPayload;
    }

    return {
      provider: form.provider,
      ...fintocPayload,
    };
  }

  if (form.provider === 'webpay') {
    const metadata: Record<string, unknown> = {
      environment: form.webpay_environment,
      commerce_code: form.webpay_commerce_code.trim(),
    };
    const nextApiKey = form.webpay_api_key.trim();
    if (nextApiKey) {
      metadata.api_key = nextApiKey;
    }

    const webpayPayload = {
      ...basePayload,
      public_identifier: form.webpay_commerce_code.trim() || basePayload.public_identifier,
      checkout_base_url: null,
      metadata,
    };

    if (existingAccount) {
      return webpayPayload;
    }

    return {
      provider: form.provider,
      ...webpayPayload,
    };
  }

  const genericPayload = {
    ...basePayload,
    metadata: {
      public_identifier: form.public_identifier.trim() || null,
    },
  };

  if (existingAccount) {
    return genericPayload;
  }

  return {
    provider: form.provider,
    ...genericPayload,
  };
}

function buildAccountFormFromAccount(account: PaymentProviderAccount): AccountForm {
  const metadata = account.metadata as Record<string, unknown>;
  const fintocRecipientAccount = getFintocRecipientAccount(metadata);
  return {
    provider: account.provider,
    account_label: account.account_label ?? '',
    public_identifier: account.public_identifier ?? '',
    checkout_base_url: account.checkout_base_url ?? '',
    tuu_account_id: typeof metadata.account_id === 'string'
      ? metadata.account_id
      : account.public_identifier ?? '',
    tuu_secret_key: '',
    tuu_environment: metadata.environment === 'production' ? 'production' : 'integration',
    fintoc_secret_key: '',
    fintoc_holder_id: typeof fintocRecipientAccount.holder_id === 'string' ? fintocRecipientAccount.holder_id : '',
    fintoc_account_number: typeof fintocRecipientAccount.number === 'string' ? fintocRecipientAccount.number : '',
    fintoc_account_type: fintocRecipientAccount.type === 'sight_account' ? 'sight_account' : 'checking_account',
    fintoc_institution_id: typeof fintocRecipientAccount.institution_id === 'string' ? fintocRecipientAccount.institution_id : '',
    webpay_environment: metadata.environment === 'production' ? 'production' : 'integration',
    webpay_commerce_code: typeof metadata.commerce_code === 'string'
      ? metadata.commerce_code
      : account.public_identifier ?? '',
    webpay_api_key: '',
    status: account.status,
    is_default: account.is_default,
  };
}

function getPaymentProviderLabel(provider: PaymentProviderAccount['provider']) {
  if (provider === 'fintoc') return 'Fintoc';
  if (provider === 'tuu') return 'TUU';
  if (provider === 'webpay') return 'Webpay';
  if (provider === 'mercadopago') return 'MercadoPago';
  if (provider === 'stripe') return 'Stripe';
  return 'Manual';
}

// ─── Team / Staff ─────────────────────────────────────────────────────────────

type StaffRole = 'admin' | 'reception' | 'trainer' | 'marketing';

interface StaffMember {
  id: string;
  full_name: string;
  email: string;
  role: string;
  is_active: boolean;
}

interface InviteForm {
  email: string;
  first_name: string;
  last_name: string;
  role: StaffRole;
}

interface PendingInvitation {
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  role_label: string;
  invited_by: string;
  invited_at: string;
  expires_in_hours: number;
}

type InviteRequest = InviteForm & {
  replace_pending?: boolean;
};

type StaffMenuDirection = 'up' | 'down';

const STAFF_ROLES: { value: StaffRole; label: string; description: string; modules: string[] }[] = [
  {
    value: 'admin',
    label: 'Administrador',
    description: 'Acceso completo excepto configuración de propietario',
    modules: ['Dashboard', 'Clases', 'Clientes', 'Planes', 'Check-in', 'Programas', 'Marketing', 'Reportes', 'POS', 'Inventario', 'Gastos', 'Feedback', 'Configuración'],
  },
  {
    value: 'reception',
    label: 'Recepción',
    description: 'Atención al cliente, check-in y caja',
    modules: ['Clases', 'Clientes', 'Check-in', 'POS', 'Feedback'],
  },
  {
    value: 'trainer',
    label: 'Entrenador',
    description: 'Gestión de clases y programas de entrenamiento',
    modules: ['Clases', 'Clientes', 'Programas'],
  },
  {
    value: 'marketing',
    label: 'Marketing',
    description: 'Campañas, notificaciones y reportes',
    modules: ['Marketing', 'Reportes'],
  },
];

const ROLE_BADGE_COLORS: Record<string, string> = {
  owner: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  admin: 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
  reception: 'bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
  trainer: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  marketing: 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
};

const ROLE_LABEL: Record<string, string> = {
  owner: 'Propietario', admin: 'Administrador', reception: 'Recepción',
  trainer: 'Entrenador', marketing: 'Marketing',
};

const emptyInviteForm: InviteForm = {
  email: '', first_name: '', last_name: '', role: 'reception',
};


export default function SettingsPage() {
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const canManageSettings = currentUser?.role === 'owner' || currentUser?.role === 'admin';
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [accountForm, setAccountForm] = useState<AccountForm>(emptyAccount);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState<PaymentProviderAccount | null>(null);
  const [accountToDelete, setAccountToDelete] = useState<PaymentProviderAccount | null>(null);
  const isEditingAccount = Boolean(editingAccount);

  // ── Branch state ─────────────────────────────────────────────────────────
  const [branchForm, setBranchForm] = useState<BranchForm>(emptyBranch);
  const [showBranchModal, setShowBranchModal] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const isEditingBranch = Boolean(editingBranch);

  // ── Team state ────────────────────────────────────────────────────────────
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteForm, setInviteForm] = useState<InviteForm>(emptyInviteForm);
  const [selectedRoleInfo, setSelectedRoleInfo] = useState(STAFF_ROLES[1]);
  const [inviteToReplace, setInviteToReplace] = useState<PendingInvitation | null>(null);
  const [openStaffMenuId, setOpenStaffMenuId] = useState<string | null>(null);
  const [staffMenuDirection, setStaffMenuDirection] = useState<StaffMenuDirection>('down');
  const [staffToDeactivate, setStaffToDeactivate] = useState<StaffMember | null>(null);
  const [staffToDelete, setStaffToDelete] = useState<StaffMember | null>(null);

  const { data: settings, isLoading, isError } = useQuery<TenantSettings>({
    queryKey: ['tenant-settings'],
    enabled: canManageSettings,
    queryFn: async () => {
      const response = await settingsApi.get();
      return response.data;
    },
  });

  const { data: paymentAccounts = [] } = useQuery<PaymentProviderAccount[]>({
    queryKey: ['payment-provider-accounts'],
    enabled: canManageSettings,
    queryFn: async () => {
      const response = await paymentProviderApi.list();
      return response.data;
    },
  });

  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: async () => {
      const response = await branchesApi.list();
      return response.data;
    },
  });

  const { data: staffList = [] } = useQuery<StaffMember[]>({
    queryKey: ['staff-team'],
    enabled: canManageSettings,
    queryFn: async () => (await staffApi.list()).data,
  });

  const { data: pendingInvitations = [] } = useQuery<PendingInvitation[]>({
    queryKey: ['staff-invitations'],
    enabled: canManageSettings,
    queryFn: async () => (await staffApi.listInvitations()).data,
  });

  const inviteMutation = useMutation({
    mutationFn: (data: InviteRequest) => staffApi.invite(data),
    onSuccess: (_response, variables) => {
      toast.success(
        variables.replace_pending
          ? `Nueva invitación enviada a ${variables.email}. La anterior fue invalidada.`
          : `Invitación enviada a ${variables.email}`,
      );
      setShowInviteModal(false);
      setInviteForm(emptyInviteForm);
      setSelectedRoleInfo(STAFF_ROLES[1]);
      setInviteToReplace(null);
      queryClient.invalidateQueries({ queryKey: ['staff-invitations'] });
    },
    onError: (error: any, variables) => {
      const detail = getApiError(error, 'No se pudo enviar la invitación');
      const hasPendingConflict = error?.response?.status === 409 && detail === 'Ya existe una invitación pendiente para ese correo.';
      if (hasPendingConflict && !variables.replace_pending) {
        const matchingInvitation = pendingInvitations.find(
          (inv) => inv.email.toLowerCase() === variables.email.trim().toLowerCase(),
        );
        if (matchingInvitation) {
          setInviteToReplace(matchingInvitation);
          return;
        }
      }
      toast.error(detail);
    },
  });

  const cancelInvitationMutation = useMutation({
    mutationFn: (email: string) => staffApi.cancelInvitation(email),
    onSuccess: () => {
      toast.success('Invitación cancelada');
      queryClient.invalidateQueries({ queryKey: ['staff-invitations'] });
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No se pudo cancelar la invitación'));
    },
  });

  const updateStaffMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { role?: string; is_active?: boolean } }) =>
      staffApi.update(id, data),
    onSuccess: () => {
      toast.success('Miembro actualizado');
      queryClient.invalidateQueries({ queryKey: ['staff-team'] });
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No se pudo actualizar el miembro'));
    },
  });

  const deactivateStaffMutation = useMutation({
    mutationFn: (id: string) => staffApi.deactivate(id),
    onSuccess: () => {
      toast.success('Miembro desactivado');
      setStaffToDeactivate(null);
      queryClient.invalidateQueries({ queryKey: ['staff-team'] });
      queryClient.invalidateQueries({ queryKey: ['staff'] });
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No se pudo desactivar el miembro'));
    },
  });

  const hardDeleteStaffMutation = useMutation({
    mutationFn: (id: string) => staffApi.hardDelete(id),
    onSuccess: () => {
      toast.success('Cuenta eliminada definitivamente');
      setStaffToDelete(null);
      queryClient.invalidateQueries({ queryKey: ['staff-team'] });
      queryClient.invalidateQueries({ queryKey: ['staff'] });
      queryClient.invalidateQueries({ queryKey: ['classes'] });
      queryClient.invalidateQueries({ queryKey: ['classes-calendar'] });
      queryClient.invalidateQueries({ queryKey: ['programs'] });
      queryClient.invalidateQueries({ queryKey: ['support-interactions'] });
      queryClient.invalidateQueries({ queryKey: ['support-staff'] });
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No se pudo eliminar la cuenta'));
    },
  });

  const normalizedInviteEmail = inviteForm.email.trim().toLowerCase();
  const existingPendingInvitation = normalizedInviteEmail
    ? pendingInvitations.find((inv) => inv.email.toLowerCase() === normalizedInviteEmail) ?? null
    : null;

  const submitInvite = (replacePending = false) => {
    inviteMutation.mutate({
      ...inviteForm,
      email: inviteForm.email.trim(),
      replace_pending: replacePending,
    });
  };

  const handleInviteSubmit = () => {
    if (existingPendingInvitation) {
      setInviteToReplace(existingPendingInvitation);
      return;
    }
    submitInvite();
  };

  const closeInviteModal = () => {
    if (inviteMutation.isPending) return;
    setShowInviteModal(false);
    setInviteToReplace(null);
  };

  const toggleStaffMenu = (memberId: string, event: ReactMouseEvent<HTMLButtonElement>) => {
    if (openStaffMenuId === memberId) {
      setOpenStaffMenuId(null);
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const estimatedMenuHeight = STAFF_ROLES.length * 44 + 84;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const nextDirection: StaffMenuDirection = (
      spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow
    ) ? 'up' : 'down';

    setStaffMenuDirection(nextDirection);
    setOpenStaffMenuId(memberId);
  };

  useEffect(() => {
    if (settings) {
      const { branding: _branding, ...rest } = settings;
      setForm(rest);
    }
  }, [settings]);

  useEffect(() => {
    if (!openStaffMenuId) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest('[data-staff-menu-root="true"]')) return;
      setOpenStaffMenuId(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenStaffMenuId(null);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [openStaffMenuId]);

  const settingsMutation = useMutation({
    mutationFn: async () => {
      if (!form) return;
      const { slug: _slug, ...payload } = form;
      const nextPrimaryColor = normalizeHexColor(payload.primary_color);
      const nextSecondaryColor = normalizeHexColor(payload.secondary_color);
      const response = await settingsApi.update({
        ...payload,
        primary_color: payload.primary_color?.trim() ? (nextPrimaryColor ?? payload.primary_color) : DEFAULT_PRIMARY_COLOR,
        secondary_color: payload.secondary_color?.trim() ? (nextSecondaryColor ?? payload.secondary_color) : DEFAULT_SECONDARY_COLOR,
      });
      return response.data;
    },
    onSuccess: () => {
      toast.success('Configuracion guardada');
      queryClient.invalidateQueries({ queryKey: ['tenant-settings'] });
      queryClient.invalidateQueries({ queryKey: ['tenant-public-profile'] });
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No se pudo guardar la configuración'));
    },
  });

  const closeAccountModal = () => {
    setShowAccountModal(false);
    setEditingAccount(null);
    setAccountForm(emptyAccount);
  };

  const openCreateAccountModal = () => {
    setEditingAccount(null);
    setAccountForm(emptyAccount);
    setShowAccountModal(true);
  };

  const openEditAccountModal = (account: PaymentProviderAccount) => {
    setEditingAccount(account);
    setAccountForm(buildAccountFormFromAccount(account));
    setShowAccountModal(true);
  };

  const accountMutation = useMutation({
    mutationFn: async () => {
      const payload = buildPaymentAccountPayload(accountForm, editingAccount);
      const response = editingAccount
        ? await paymentProviderApi.update(editingAccount.id, payload)
        : await paymentProviderApi.create(payload);
      return response.data;
    },
    onSuccess: () => {
      toast.success(editingAccount ? 'Cuenta de pago actualizada' : 'Cuenta de pago guardada');
      closeAccountModal();
      queryClient.invalidateQueries({ queryKey: ['payment-provider-accounts'] });
    },
    onError: (error: any) => {
      toast.error(getApiError(error, editingAccount ? 'No se pudo actualizar la cuenta de pago' : 'No se pudo guardar la cuenta de pago'));
    },
  });

  const deleteAccountMutation = useMutation({
    mutationFn: async (account: PaymentProviderAccount) => {
      await paymentProviderApi.delete(account.id);
    },
    onSuccess: (_, account) => {
      toast.success(`Cuenta ${getPaymentProviderLabel(account.provider)} eliminada`);
      if (editingAccount?.id === account.id) {
        closeAccountModal();
      }
      setAccountToDelete(null);
      queryClient.invalidateQueries({ queryKey: ['payment-provider-accounts'] });
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No se pudo eliminar la cuenta de pago'));
    },
  });

  // ── Branch helpers ───────────────────────────────────────────────────────
  const closeBranchModal = () => {
    setShowBranchModal(false);
    setEditingBranch(null);
    setBranchForm(emptyBranch);
  };

  const openCreateBranchModal = () => {
    setEditingBranch(null);
    setBranchForm(emptyBranch);
    setShowBranchModal(true);
  };

  const openEditBranchModal = (branch: Branch) => {
    setEditingBranch(branch);
    setBranchForm({
      name: branch.name,
      address: branch.address ?? '',
      city: branch.city ?? '',
      phone: branch.phone ?? '',
      email: branch.email ?? '',
      opening_time: branch.opening_time ? branch.opening_time.slice(0, 5) : '',
      closing_time: branch.closing_time ? branch.closing_time.slice(0, 5) : '',
      capacity: branch.capacity != null ? String(branch.capacity) : '',
    });
    setShowBranchModal(true);
  };

  const buildBranchPayload = () => ({
    name: branchForm.name.trim(),
    address: branchForm.address.trim() || null,
    city: branchForm.city.trim() || null,
    phone: branchForm.phone.trim() || null,
    email: branchForm.email.trim() || null,
    opening_time: branchForm.opening_time || null,
    closing_time: branchForm.closing_time || null,
    capacity: branchForm.capacity ? Number(branchForm.capacity) : null,
  });

  const branchMutation = useMutation({
    mutationFn: async () => {
      const payload = buildBranchPayload();
      const response = editingBranch
        ? await branchesApi.update(editingBranch.id, payload)
        : await branchesApi.create(payload);
      return response.data;
    },
    onSuccess: () => {
      toast.success(editingBranch ? 'Sucursal actualizada' : 'Sucursal creada');
      closeBranchModal();
      queryClient.invalidateQueries({ queryKey: ['branches'] });
    },
    onError: (error: any) => {
      toast.error(getApiError(error, editingBranch ? 'No se pudo actualizar la sucursal' : 'No se pudo crear la sucursal'));
    },
  });

  const toggleBranchMutation = useMutation({
    mutationFn: async (branch: Branch) =>
      branchesApi.update(branch.id, { is_active: !branch.is_active }),
    onSuccess: (_, branch) => {
      toast.success(branch.is_active ? 'Sucursal desactivada' : 'Sucursal reactivada');
      queryClient.invalidateQueries({ queryKey: ['branches'] });
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No se pudo cambiar el estado de la sucursal'));
    },
  });

  if (isLoading || !form) {
    return <div className="shimmer h-[420px] rounded-3xl" />;
  }

  const normalizedCustomDomain = normalizeCustomDomain(form.custom_domain);
  const storefrontUrl = buildTenantStorefrontUrl(form.slug, form.custom_domain);
  const primaryPreview = normalizeHexColor(form.primary_color, DEFAULT_PRIMARY_COLOR) ?? DEFAULT_PRIMARY_COLOR;
  const secondaryPreview = normalizeHexColor(form.secondary_color, DEFAULT_SECONDARY_COLOR) ?? DEFAULT_SECONDARY_COLOR;

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-6">
      <motion.div variants={fadeInUp} className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Configuración</h1>
          <p className="mt-1 text-sm text-surface-500">Branding, tienda online y medios de pago conectados a la cuenta real</p>
        </div>
        <button type="button" className="btn-primary" onClick={() => settingsMutation.mutate()} disabled={settingsMutation.isPending}>
          {settingsMutation.isPending ? 'Guardando...' : 'Guardar cambios'}
        </button>
      </motion.div>

      {isError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-600 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
          No pudimos cargar la configuración de la cuenta.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <motion.div variants={fadeInUp} className="rounded-3xl border border-surface-200/50 bg-white p-6 dark:border-surface-800/50 dark:bg-surface-900">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-500 dark:bg-brand-950/40"><Store size={20} /></div>
              <div>
                <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Datos del gimnasio</h2>
                <p className="text-sm text-surface-500">Estos datos alimentan la tienda online pública y la app</p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <input className="input" value={form.gym_name} onChange={(event) => setForm((current) => current ? { ...current, gym_name: event.target.value } : current)} placeholder="Nombre del gimnasio" />
              <input className="input" value={form.email} onChange={(event) => setForm((current) => current ? { ...current, email: event.target.value } : current)} placeholder="Email" />
              <input className="input" value={form.phone ?? ''} onChange={(event) => setForm((current) => current ? { ...current, phone: event.target.value } : current)} placeholder="Teléfono" />
              <input className="input" value={form.city ?? ''} onChange={(event) => setForm((current) => current ? { ...current, city: event.target.value } : current)} placeholder="Ciudad" />
              <input className="input sm:col-span-2" value={form.address ?? ''} onChange={(event) => setForm((current) => current ? { ...current, address: event.target.value } : current)} placeholder="Dirección" />
            </div>
          </motion.div>

          {/* ── Sucursales ─────────────────────────────────────────── */}
          <motion.div variants={fadeInUp} className="rounded-3xl border border-surface-200/50 bg-white p-6 dark:border-surface-800/50 dark:bg-surface-900">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-500 dark:bg-brand-950/40"><MapPin size={20} /></div>
                <div>
                  <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Sucursales</h2>
                  <p className="text-sm text-surface-500">
                    {branches.filter(b => b.is_active).length} activa{branches.filter(b => b.is_active).length !== 1 ? 's' : ''}
                    {branches.length > branches.filter(b => b.is_active).length ? ` · ${branches.length - branches.filter(b => b.is_active).length} inactiva${branches.length - branches.filter(b => b.is_active).length !== 1 ? 's' : ''}` : ''}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="btn-secondary inline-flex items-center gap-2"
                onClick={openCreateBranchModal}
              >
                <Plus size={15} />
                Agregar sede
              </button>
            </div>

            <div className="mb-4 rounded-2xl border border-sky-200/70 bg-sky-50/60 px-4 py-3 text-xs text-sky-700 dark:border-sky-900/40 dark:bg-sky-950/20 dark:text-sky-300">
              <p><strong>Clientes:</strong> pertenecen al gimnasio completo, no a una sede específica.</p>
              <p className="mt-0.5"><strong>Clases:</strong> cada clase puede asignarse a una sede desde el módulo de clases.</p>
            </div>

            <div className="space-y-3">
              {branches.length ? branches.map((branch) => (
                <div
                  key={branch.id}
                  className={`rounded-2xl border px-4 py-4 transition-opacity ${branch.is_active ? 'border-surface-200/60 dark:border-surface-800/60' : 'border-surface-200/40 bg-surface-50/60 opacity-60 dark:border-surface-800/40 dark:bg-surface-950/30'}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-surface-900 dark:text-white">{branch.name}</p>
                        <span className={`badge ${branch.is_active ? 'badge-success' : 'badge-neutral'}`}>
                          {branch.is_active ? 'Activa' : 'Inactiva'}
                        </span>
                      </div>

                      {(branch.city || branch.address) ? (
                        <p className="mt-1 flex items-center gap-1 text-sm text-surface-500">
                          <MapPin size={12} className="shrink-0" />
                          {[branch.city, branch.address].filter(Boolean).join(' · ')}
                        </p>
                      ) : null}

                      {(branch.phone || branch.email) ? (
                        <p className="mt-0.5 text-xs text-surface-400">
                          {[branch.phone, branch.email].filter(Boolean).join(' · ')}
                        </p>
                      ) : null}

                      {(branch.opening_time || branch.closing_time || branch.capacity) ? (
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-surface-400">
                          <Clock size={11} className="shrink-0" />
                          {branch.opening_time && branch.closing_time
                            ? `${branch.opening_time.slice(0, 5)} – ${branch.closing_time.slice(0, 5)}`
                            : branch.opening_time
                              ? `Abre ${branch.opening_time.slice(0, 5)}`
                              : branch.closing_time
                                ? `Cierra ${branch.closing_time.slice(0, 5)}`
                                : null}
                          {branch.capacity ? ` · Aforo ${branch.capacity}` : null}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded-xl border border-surface-200 px-3 py-2 text-xs font-medium text-surface-600 transition-colors hover:border-surface-300 hover:bg-surface-50 hover:text-surface-900 dark:border-surface-800 dark:text-surface-300 dark:hover:border-surface-700 dark:hover:bg-surface-800/60 dark:hover:text-white"
                        onClick={() => openEditBranchModal(branch)}
                      >
                        <Pencil size={13} />
                        Editar
                      </button>
                      <button
                        type="button"
                        className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${branch.is_active
                          ? 'border-amber-200 text-amber-700 hover:border-amber-300 hover:bg-amber-50 dark:border-amber-900/40 dark:text-amber-400 dark:hover:bg-amber-950/20'
                          : 'border-emerald-200 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50 dark:border-emerald-900/40 dark:text-emerald-400 dark:hover:bg-emerald-950/20'
                        }`}
                        disabled={toggleBranchMutation.isPending}
                        onClick={() => toggleBranchMutation.mutate(branch)}
                      >
                        {branch.is_active ? 'Desactivar' : 'Reactivar'}
                      </button>
                    </div>
                  </div>
                </div>
              )) : (
                <div className="rounded-2xl border border-dashed border-surface-300 px-4 py-8 text-center text-sm text-surface-500 dark:border-surface-700">
                  No hay sedes configuradas todavía. Agrega la primera para organizar tus clases.
                </div>
              )}
            </div>
          </motion.div>

          <motion.div variants={fadeInUp} className="rounded-3xl border border-surface-200/50 bg-white p-6 dark:border-surface-800/50 dark:bg-surface-900">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-500 dark:bg-brand-950/40"><Palette size={20} /></div>
              <div>
                <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Branding y tienda online</h2>
                <p className="text-sm text-surface-500">Color, logo y texto comercial para tu página pública</p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Color principal</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={primaryPreview}
                    onChange={(event) => setForm((current) => current ? { ...current, primary_color: event.target.value } : current)}
                    className="h-10 w-12 cursor-pointer rounded-xl border border-surface-200 bg-white p-1 dark:border-surface-700 dark:bg-surface-900"
                  />
                  <input
                    className="input flex-1"
                    value={form.primary_color ?? ''}
                    onChange={(event) => setForm((current) => current ? { ...current, primary_color: event.target.value } : current)}
                    placeholder={DEFAULT_PRIMARY_COLOR}
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Color secundario</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={secondaryPreview}
                    onChange={(event) => setForm((current) => current ? { ...current, secondary_color: event.target.value } : current)}
                    className="h-10 w-12 cursor-pointer rounded-xl border border-surface-200 bg-white p-1 dark:border-surface-700 dark:bg-surface-900"
                  />
                  <input
                    className="input flex-1"
                    value={form.secondary_color ?? ''}
                    onChange={(event) => setForm((current) => current ? { ...current, secondary_color: event.target.value } : current)}
                    placeholder={DEFAULT_SECONDARY_COLOR}
                  />
                </div>
              </div>

              <div className="sm:col-span-2 rounded-2xl border border-surface-200/70 bg-surface-50/80 p-4 dark:border-surface-800/70 dark:bg-surface-950/30">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-surface-500">Preview de marca</p>
                <div className="mt-3 flex items-center gap-4">
                  <div
                    className="h-16 w-16 rounded-2xl shadow-lg shadow-surface-900/10"
                    style={{ backgroundImage: `linear-gradient(135deg, ${primaryPreview}, ${secondaryPreview})` }}
                  />
                  <div className="min-w-0">
                    <p className="text-base font-semibold text-surface-900 dark:text-white">{form.gym_name}</p>
                    <p className="mt-1 text-sm text-surface-500">
                      Estos dos colores se aplican en la tienda online y en la app de miembros.
                    </p>
                  </div>
                </div>
              </div>

              <div className="sm:col-span-2">
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Logo del gimnasio</label>
                <LogoUploader
                  currentUrl={form.logo_url}
                  onUploaded={(url) => setForm((current) => current ? { ...current, logo_url: url } : current)}
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Dominio personalizado</label>
                <input className="input" value={form.custom_domain ?? ''} onChange={(event) => setForm((current) => current ? { ...current, custom_domain: event.target.value } : current)} placeholder="midominio.cl (opcional)" />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Teléfono de soporte</label>
                <input className="input" value={form.support_phone ?? ''} onChange={(event) => setForm((current) => current ? { ...current, support_phone: event.target.value } : current)} placeholder="+56 9 1234 5678" />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Título de la tienda online</label>
                <input className="input" value={form.marketplace_headline ?? ''} onChange={(event) => setForm((current) => current ? { ...current, marketplace_headline: event.target.value } : current)} placeholder="Ej: El mejor gimnasio de Santiago" />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Descripción pública</label>
                <textarea className="input min-h-28 resize-y" value={form.marketplace_description ?? ''} onChange={(event) => setForm((current) => current ? { ...current, marketplace_description: event.target.value } : current)} placeholder="Describe tu gimnasio: instalaciones, horarios, especialidades..." />
              </div>
            </div>

            {/* Storefront URL — uses tenant.slug, not custom_domain */}
            <div
              className="mt-5 rounded-2xl border px-4 py-3"
              style={{
                borderColor: `${primaryPreview}33`,
                backgroundImage: `linear-gradient(135deg, ${primaryPreview}12, ${secondaryPreview}14)`,
              }}
            >
              <div className="flex items-center gap-3">
                <Globe size={16} className="shrink-0" style={{ color: primaryPreview }} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-surface-700 dark:text-surface-300">URL de tu página pública</p>
                  <p className="mt-0.5 truncate font-mono text-sm" style={{ color: primaryPreview }}>
                    {storefrontUrl}
                  </p>
                </div>
                <a
                  href={storefrontUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary shrink-0 text-sm"
                >
                  Ver
                </a>
              </div>
              <p className="mt-2 text-xs text-surface-500">
                {normalizedCustomDomain
                  ? 'Tu dominio personalizado será la URL principal de la tienda online en la raíz del dominio y se valida contra conflictos con otras cuentas.'
                  : 'Mientras no configures un dominio personalizado, este enlace público seguirá usando la ruta /store/:slug de la cuenta.'}
              </p>
            </div>
          </motion.div>

          <motion.div variants={fadeInUp} className="rounded-3xl border border-surface-200/50 bg-white p-6 dark:border-surface-800/50 dark:bg-surface-900">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-500 dark:bg-brand-950/40"><Shield size={20} /></div>
              <div>
                <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Automatización y seguridad</h2>
                <p className="text-sm text-surface-500">Reglas de la cuenta para comunicación y acceso</p>
              </div>
            </div>

            <div className="space-y-3">
              {/* Recordatorios por email */}
              <div className="flex items-start justify-between gap-4 rounded-2xl border border-surface-200 px-4 py-4 dark:border-surface-800">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-500 dark:bg-sky-950/40">
                    <Bell size={16} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-surface-900 dark:text-white">Recordatorios por email</p>
                    <p className="mt-0.5 text-xs text-surface-500">Envía recordatorios automáticos cuando una membresía esté por vencer.</p>
                    <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-600 dark:bg-amber-950/30 dark:text-amber-400">
                      Automatización activa próximamente
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.reminder_emails}
                  onClick={() => setForm((current) => current ? { ...current, reminder_emails: !current.reminder_emails } : current)}
                  className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 ${form.reminder_emails ? 'bg-brand-500' : 'bg-surface-200 dark:bg-surface-700'}`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition-transform ${form.reminder_emails ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>

              {/* Recordatorios por WhatsApp */}
              <div className="flex items-start justify-between gap-4 rounded-2xl border border-surface-200 px-4 py-4 dark:border-surface-800">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-500 dark:bg-emerald-950/40">
                    <Bell size={16} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-surface-900 dark:text-white">Recordatorios por WhatsApp</p>
                    <p className="mt-0.5 text-xs text-surface-500">Notifica a tus clientes por WhatsApp sobre vencimientos y clases reservadas.</p>
                    <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-surface-100 px-2 py-0.5 text-xs font-medium text-surface-500 dark:bg-surface-800 dark:text-surface-400">
                      Requiere integración WhatsApp — Próximamente
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.reminder_whatsapp}
                  onClick={() => setForm((current) => current ? { ...current, reminder_whatsapp: !current.reminder_whatsapp } : current)}
                  className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 ${form.reminder_whatsapp ? 'bg-brand-500' : 'bg-surface-200 dark:bg-surface-700'}`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition-transform ${form.reminder_whatsapp ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>

              {/* Staff puede editar planes */}
              <div className="flex items-start justify-between gap-4 rounded-2xl border border-surface-200 px-4 py-4 dark:border-surface-800">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-500 dark:bg-violet-950/40">
                    <Users size={16} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-surface-900 dark:text-white">Staff puede editar planes</p>
                    <p className="mt-0.5 text-xs text-surface-500">Permite que entrenadores y recepcionistas creen o modifiquen planes de membresía.</p>
                    <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400">
                      <ShieldCheck size={11} /> Aplicado en el sistema
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.staff_can_edit_plans}
                  onClick={() => setForm((current) => current ? { ...current, staff_can_edit_plans: !current.staff_can_edit_plans } : current)}
                  className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 ${form.staff_can_edit_plans ? 'bg-brand-500' : 'bg-surface-200 dark:bg-surface-700'}`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition-transform ${form.staff_can_edit_plans ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>

              {/* 2FA obligatorio */}
              <div className="flex items-start justify-between gap-4 rounded-2xl border border-surface-200 px-4 py-4 dark:border-surface-800">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-500 dark:bg-rose-950/40">
                    <Lock size={16} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-surface-900 dark:text-white">2FA obligatorio</p>
                    <p className="mt-0.5 text-xs text-surface-500">Exige verificación en dos pasos para todos los usuarios del staff al iniciar sesión.</p>
                    <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-surface-100 px-2 py-0.5 text-xs font-medium text-surface-500 dark:bg-surface-800 dark:text-surface-400">
                      Cumplimiento guardado — Aplicación en login próximamente
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.two_factor_required}
                  onClick={() => setForm((current) => current ? { ...current, two_factor_required: !current.two_factor_required } : current)}
                  className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 ${form.two_factor_required ? 'bg-brand-500' : 'bg-surface-200 dark:bg-surface-700'}`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition-transform ${form.two_factor_required ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>

              {/* Pago público */}
              <div className={`flex items-start justify-between gap-4 rounded-2xl border px-4 py-4 ${form.public_checkout_enabled && !paymentAccounts.some(a => a.status === 'connected') ? 'border-amber-200 bg-amber-50/40 dark:border-amber-900/40 dark:bg-amber-950/10' : 'border-surface-200 dark:border-surface-800'}`}>
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-500 dark:bg-brand-950/40">
                    <CreditCard size={16} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-surface-900 dark:text-white">Habilitar pago público</p>
                    <p className="mt-0.5 text-xs text-surface-500">Permite que clientes paguen directamente desde la tienda online sin intermediarios.</p>
                    {form.public_checkout_enabled && !paymentAccounts.some(a => a.status === 'connected') ? (
                      <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                        Sin cuenta de pago conectada — configura una abajo
                      </span>
                    ) : (
                      <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400">
                        <ShieldCheck size={11} /> Completamente funcional
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.public_checkout_enabled}
                  onClick={() => setForm((current) => current ? { ...current, public_checkout_enabled: !current.public_checkout_enabled } : current)}
                  className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 ${form.public_checkout_enabled ? 'bg-brand-500' : 'bg-surface-200 dark:bg-surface-700'}`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition-transform ${form.public_checkout_enabled ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
            </div>
          </motion.div>
        </div>

        <div className="space-y-6">
          <motion.div variants={fadeInUp} className="rounded-3xl border border-surface-200/50 bg-white p-6 dark:border-surface-800/50 dark:bg-surface-900">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-500 dark:bg-brand-950/40"><CreditCard size={20} /></div>
                <div>
                  <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Medios de pago</h2>
                  <p className="text-sm text-surface-500">Cuentas conectadas para vender planes propios</p>
                </div>
              </div>
              <button type="button" className="btn-secondary" onClick={openCreateAccountModal}>Agregar</button>
            </div>

            <div className="space-y-3">
              {paymentAccounts.length ? paymentAccounts.map((account) => (
                <div key={account.id} className="rounded-2xl border border-surface-200/60 px-4 py-4 dark:border-surface-800/60">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-surface-900 dark:text-white">{getPaymentProviderLabel(account.provider)}</p>
                      <p className="text-sm text-surface-500">{account.account_label || 'Sin etiqueta'}</p>
                    </div>
                    <span className={`badge ${account.status === 'connected' ? 'badge-success' : account.status === 'pending' ? 'badge-warning' : 'badge-neutral'}`}>
                      {account.status}
                    </span>
                  </div>
                  <div className="mt-3 space-y-1 text-xs text-surface-500">
                    {account.provider === 'webpay' ? (
                      <>
                        <p>ID público: {account.public_identifier || 'No definido'}</p>
                        <p>Ambiente: {String(account.metadata.environment || 'integration')}</p>
                        <p>API key: {account.metadata.api_key_configured ? 'Configurada' : 'Pendiente'}</p>
                      </>
                    ) : null}
                    {account.provider === 'fintoc' ? (
                      <>
                        <p>API key: {account.metadata.secret_key_configured ? 'Configurada' : 'Pendiente'}</p>
                        {getFintocRecipientAccount(account.metadata).holder_id ? (
                          <>
                            <p>RUT titular: {String(getFintocRecipientAccount(account.metadata).holder_id)}</p>
                            <p>Cuenta destino: {String(getFintocRecipientAccount(account.metadata).number || 'No definida')}</p>
                            <p>Tipo: {getFintocAccountTypeLabel(String(getFintocRecipientAccount(account.metadata).type || 'checking_account'))}</p>
                            <p>Banco: {String(getFintocRecipientAccount(account.metadata).institution_id || 'No definido')}</p>
                          </>
                        ) : (
                          <p className="italic">Cobros activados — cuenta preset por Fintoc</p>
                        )}
                      </>
                    ) : null}
                    {account.provider === 'tuu' ? (
                      <>
                        <p>Account ID: {String(account.metadata.account_id || account.public_identifier || 'No definido')}</p>
                        <p>Ambiente: {String(account.metadata.environment || 'integration')}</p>
                        <p>Secret key: {account.metadata.secret_key_configured ? 'Configurada' : 'Pendiente'}</p>
                      </>
                    ) : null}
                    {account.provider !== 'webpay' && account.provider !== 'fintoc' && account.provider !== 'tuu' ? (
                      <>
                        <p>ID público: {account.public_identifier || 'No definido'}</p>
                        <p>Checkout base: {account.checkout_base_url || 'No definido'}</p>
                      </>
                    ) : null}
                    <p>{account.is_default ? 'Cuenta predeterminada de la cuenta' : 'Cuenta secundaria'}</p>
                  </div>
                  <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-surface-200/70 pt-3 dark:border-surface-800/70">
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 rounded-xl border border-surface-200 px-3 py-2 text-sm font-medium text-surface-600 transition-colors hover:border-surface-300 hover:bg-surface-50 hover:text-surface-900 dark:border-surface-800 dark:text-surface-300 dark:hover:border-surface-700 dark:hover:bg-surface-800/60 dark:hover:text-white"
                      onClick={() => openEditAccountModal(account)}
                    >
                      <Pencil size={15} />
                      Editar
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 rounded-xl border border-rose-200 px-3 py-2 text-sm font-medium text-rose-600 transition-colors hover:border-rose-300 hover:bg-rose-50 dark:border-rose-900/30 dark:text-rose-300 dark:hover:border-rose-800/40 dark:hover:bg-rose-950/20"
                      onClick={() => setAccountToDelete(account)}
                    >
                      <Trash2 size={15} />
                      Eliminar
                    </button>
                  </div>
                </div>
              )) : (
                <div className="rounded-2xl border border-dashed border-surface-300 px-4 py-8 text-center text-sm text-surface-500 dark:border-surface-700">
                  Aún no hay cuentas de pago configuradas.
                </div>
              )}
            </div>
          </motion.div>

          <motion.div variants={fadeInUp} className="rounded-3xl border border-surface-200/50 bg-white p-6 dark:border-surface-800/50 dark:bg-surface-900">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-500 dark:bg-brand-950/40"><Globe size={20} /></div>
              <div>
                <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Canal público</h2>
                <p className="text-sm text-surface-500">Datos listos para la tienda online y enlaces compartibles</p>
              </div>
            </div>
            <div className="space-y-3 text-sm">
              <div className="rounded-xl bg-surface-50 px-3 py-2 dark:bg-surface-950/40">
                <p className="text-xs text-surface-400">URL de la tienda online</p>
                <p className="mt-0.5 break-all font-mono font-medium text-brand-600 dark:text-brand-400">{storefrontUrl}</p>
              </div>
              <div className="space-y-2 text-surface-500">
                <p>Dominio personalizado: {normalizedCustomDomain ?? 'Sin configurar'}</p>
                <p>Pago público: {form.public_checkout_enabled ? 'Habilitado' : 'Deshabilitado'}</p>
                <p>Soporte: {form.support_email || form.support_phone || 'Sin definir'}</p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* ── Equipo ──────────────────────────────────────────────────── */}
      {(currentUser?.role === 'owner' || currentUser?.role === 'admin') ? (
        <motion.div variants={fadeInUp} className="rounded-3xl border border-surface-200/50 bg-white p-6 dark:border-surface-800/50 dark:bg-surface-900">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-500 dark:bg-brand-950/40">
                <Users size={20} />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Equipo</h2>
                <p className="text-sm text-surface-500">Gestiona el acceso de tu equipo al panel de administración</p>
              </div>
            </div>
            <button
              type="button"
              className="btn-primary flex items-center gap-2"
              onClick={() => { setInviteForm(emptyInviteForm); setSelectedRoleInfo(STAFF_ROLES[1]); setShowInviteModal(true); }}
            >
              <UserPlus size={16} />
              <span className="hidden sm:inline">Invitar miembro</span>
            </button>
          </div>

          {/* Active members */}
          {staffList.length === 0 && pendingInvitations.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-surface-200 py-10 text-center dark:border-surface-700">
              <Users size={32} className="mx-auto mb-3 text-surface-300 dark:text-surface-600" />
              <p className="text-sm text-surface-500">Aún no hay miembros del equipo.</p>
              <p className="mt-1 text-xs text-surface-400">Invita a tu primer colaborador con el botón de arriba.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {staffList.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-surface-400">Miembros activos</p>
                  <div className="divide-y divide-surface-100 dark:divide-surface-800">
                    {staffList.map((member) => (
                      <div key={member.id} className="flex items-center justify-between gap-4 py-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-100 text-sm font-semibold text-surface-600 dark:bg-surface-800 dark:text-surface-300">
                            {member.full_name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-surface-900 dark:text-white">
                              {member.full_name}
                              {!member.is_active && (
                                <span className="ml-2 text-xs text-surface-400">(inactivo)</span>
                              )}
                            </p>
                            <p className="truncate text-xs text-surface-400">{member.email}</p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ROLE_BADGE_COLORS[member.role] ?? 'bg-surface-100 text-surface-600'}`}>
                            {ROLE_LABEL[member.role] ?? member.role}
                          </span>
                          {member.role !== 'owner' && member.id !== currentUser?.id && (
                            <div className="relative" data-staff-menu-root="true">
                              <button
                                type="button"
                                onClick={(event) => toggleStaffMenu(member.id, event)}
                                aria-expanded={openStaffMenuId === member.id}
                                className="flex items-center gap-1 rounded-lg border border-surface-200 px-2 py-1.5 text-xs text-surface-500 hover:bg-surface-50 dark:border-surface-700 dark:hover:bg-surface-800"
                              >
                                <UserCog size={13} />
                                <ChevronDown size={11} />
                              </button>
                              <div
                                className={`absolute right-0 z-20 min-w-[160px] overflow-hidden rounded-xl border border-surface-200 bg-white py-1 shadow-lg dark:border-surface-700 dark:bg-surface-900 ${
                                  openStaffMenuId === member.id ? 'block' : 'hidden'
                                } ${
                                  staffMenuDirection === 'up'
                                    ? 'bottom-full mb-1 origin-bottom-right'
                                    : 'top-full mt-1 origin-top-right'
                                }`}
                              >
                                {STAFF_ROLES.map((r) => (
                                  <button
                                    key={r.value}
                                    type="button"
                                    disabled={updateStaffMutation.isPending}
                                    onClick={() => {
                                      setOpenStaffMenuId(null);
                                      updateStaffMutation.mutate({ id: member.id, data: { role: r.value } });
                                    }}
                                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-50 dark:hover:bg-surface-800 ${member.role === r.value ? 'font-semibold text-brand-600 dark:text-brand-400' : 'text-surface-700 dark:text-surface-300'}`}
                                  >
                                    {r.label}
                                  </button>
                                ))}
                                <div className="my-1 border-t border-surface-100 dark:border-surface-800" />
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenStaffMenuId(null);
                                    setStaffToDeactivate(member);
                                  }}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/20"
                                >
                                  <UserMinus size={13} />
                                  Desactivar acceso
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenStaffMenuId(null);
                                    setStaffToDelete(member);
                                  }}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/20"
                                >
                                  <Trash2 size={13} />
                                  Eliminar cuenta
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Pending invitations */}
              {pendingInvitations.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-surface-400">
                    Invitaciones pendientes
                  </p>
                  <div className="divide-y divide-surface-100 dark:divide-surface-800">
                    {pendingInvitations.map((inv) => (
                      <div key={inv.email} className="flex items-center justify-between gap-4 py-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-sm font-semibold text-amber-600 dark:bg-amber-950/40 dark:text-amber-300">
                            <Mail size={15} />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-surface-900 dark:text-white">
                              {inv.first_name} {inv.last_name}
                            </p>
                            <p className="truncate text-xs text-surface-400">
                              {inv.email} · vence en {inv.expires_in_hours}h
                            </p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                            Pendiente
                          </span>
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ROLE_BADGE_COLORS[inv.role] ?? 'bg-surface-100 text-surface-600'}`}>
                            {inv.role_label}
                          </span>
                          <button
                            type="button"
                            disabled={cancelInvitationMutation.isPending}
                            onClick={() => cancelInvitationMutation.mutate(inv.email)}
                            className="flex items-center gap-1 rounded-lg border border-rose-200 px-2 py-1.5 text-xs text-rose-500 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-800 dark:hover:bg-rose-950/20"
                            title="Cancelar invitación"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </motion.div>
      ) : null}

      {/* ── Invite modal ─────────────────────────────────────────────── */}
      <Modal
        open={showInviteModal}
        title="Invitar miembro del equipo"
        description="El invitado recibirá un correo para activar su cuenta y crear su contraseña."
        onClose={closeInviteModal}
      >
        <form
          className="space-y-5"
          onSubmit={(e) => { e.preventDefault(); handleInviteSubmit(); }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-surface-600 dark:text-surface-400">
                Nombre <span className="text-rose-500">*</span>
              </label>
              <input
                className="input"
                required
                value={inviteForm.first_name}
                onChange={(e) => setInviteForm((f) => ({ ...f, first_name: e.target.value }))}
                placeholder="Juan"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-surface-600 dark:text-surface-400">
                Apellido <span className="text-rose-500">*</span>
              </label>
              <input
                className="input"
                required
                value={inviteForm.last_name}
                onChange={(e) => setInviteForm((f) => ({ ...f, last_name: e.target.value }))}
                placeholder="García"
              />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-surface-600 dark:text-surface-400">
              Correo electrónico <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
              <input
                className="input pl-9"
                type="email"
                required
                value={inviteForm.email}
                onChange={(e) => setInviteForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="colaborador@gimnasio.cl"
              />
            </div>
          </div>
          <div>
            <label className="mb-2 block text-xs font-medium text-surface-600 dark:text-surface-400">
              Rol <span className="text-rose-500">*</span>
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              {STAFF_ROLES.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => { setInviteForm((f) => ({ ...f, role: r.value })); setSelectedRoleInfo(r); }}
                  className={`rounded-2xl border p-3 text-left transition-colors ${
                    inviteForm.role === r.value
                      ? 'border-brand-400 bg-brand-50 dark:border-brand-600 dark:bg-brand-950/20'
                      : 'border-surface-200 hover:border-surface-300 dark:border-surface-700'
                  }`}
                >
                  <p className={`text-sm font-semibold ${inviteForm.role === r.value ? 'text-brand-700 dark:text-brand-300' : 'text-surface-800 dark:text-surface-200'}`}>
                    {r.label}
                  </p>
                  <p className="mt-0.5 text-xs text-surface-400">{r.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Access preview */}
          <div className="rounded-2xl border border-surface-200 bg-surface-50 px-4 py-3 dark:border-surface-700 dark:bg-surface-800/40">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-surface-500">
              Módulos con acceso — {selectedRoleInfo.label}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {selectedRoleInfo.modules.map((mod) => (
                <span key={mod} className="rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">
                  {mod}
                </span>
              ))}
            </div>
          </div>

          {existingPendingInvitation ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
              Ya existe una invitación pendiente para este correo. Puedes crear una nueva invitación para invalidar el enlace anterior.
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn-secondary" onClick={closeInviteModal} disabled={inviteMutation.isPending}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary flex items-center gap-2" disabled={inviteMutation.isPending}>
              {inviteMutation.isPending ? (
                <>Enviando...</>
              ) : (
                <><Mail size={15} /> {existingPendingInvitation ? 'Crear nueva invitación' : 'Enviar invitación'}</>
              )}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!inviteToReplace}
        title="Crear nueva invitación"
        description="La invitación pendiente dejará de funcionar y se enviará un nuevo correo."
        onClose={() => { if (!inviteMutation.isPending) setInviteToReplace(null); }}
      >
        {inviteToReplace ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-surface-200 bg-surface-50 px-4 py-3 dark:border-surface-700 dark:bg-surface-800/40">
              <p className="font-semibold text-surface-900 dark:text-white">
                {inviteToReplace.first_name} {inviteToReplace.last_name}
              </p>
              <p className="text-sm text-surface-500">{inviteToReplace.email}</p>
              <p className="mt-2 text-sm text-surface-500">
                La invitación actual vence en {inviteToReplace.expires_in_hours}h.
              </p>
            </div>

            <p className="text-sm text-surface-600 dark:text-surface-300">
              Se invalidará el enlace anterior y se enviará una nueva invitación con los datos actuales del formulario.
            </p>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setInviteToReplace(null)}
                disabled={inviteMutation.isPending}
              >
                Mantener invitación actual
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => submitInvite(true)}
                disabled={inviteMutation.isPending}
              >
                {inviteMutation.isPending ? 'Enviando...' : 'Invalidar y reenviar'}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* ── Deactivate confirmation ───────────────────────────────────── */}
      <Modal
        open={!!staffToDeactivate}
        title="Desactivar acceso"
        description="El miembro ya no podrá iniciar sesión en el panel."
        onClose={() => { if (!deactivateStaffMutation.isPending) setStaffToDeactivate(null); }}
      >
        {staffToDeactivate ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-surface-200 bg-surface-50 px-4 py-3 dark:border-surface-700 dark:bg-surface-800/40">
              <p className="font-semibold text-surface-900 dark:text-white">{staffToDeactivate.full_name}</p>
              <p className="text-sm text-surface-500">{staffToDeactivate.email}</p>
              <span className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${ROLE_BADGE_COLORS[staffToDeactivate.role] ?? ''}`}>
                {ROLE_LABEL[staffToDeactivate.role] ?? staffToDeactivate.role}
              </span>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="btn-secondary" onClick={() => setStaffToDeactivate(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn-danger"
                disabled={deactivateStaffMutation.isPending}
                onClick={() => deactivateStaffMutation.mutate(staffToDeactivate.id)}
              >
                {deactivateStaffMutation.isPending ? 'Desactivando...' : 'Desactivar acceso'}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={!!staffToDelete}
        title="Eliminar cuenta del equipo"
        description="La cuenta se borrará definitivamente y el correo quedará disponible para reutilizarlo."
        onClose={() => { if (!hardDeleteStaffMutation.isPending) setStaffToDelete(null); }}
      >
        {staffToDelete ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-200">
              <p className="font-semibold">Esta acción es irreversible.</p>
              <p className="mt-1">
                Se eliminará el acceso, se liberará el correo y las referencias operativas históricas quedarán desvinculadas de esta cuenta.
              </p>
            </div>
            <div className="rounded-2xl border border-surface-200 bg-surface-50 px-4 py-3 dark:border-surface-700 dark:bg-surface-800/40">
              <p className="font-semibold text-surface-900 dark:text-white">{staffToDelete.full_name}</p>
              <p className="text-sm text-surface-500">{staffToDelete.email}</p>
              <span className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${ROLE_BADGE_COLORS[staffToDelete.role] ?? ''}`}>
                {ROLE_LABEL[staffToDelete.role] ?? staffToDelete.role}
              </span>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setStaffToDelete(null)}
                disabled={hardDeleteStaffMutation.isPending}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-danger"
                disabled={hardDeleteStaffMutation.isPending}
                onClick={() => hardDeleteStaffMutation.mutate(staffToDelete.id)}
              >
                {hardDeleteStaffMutation.isPending ? 'Eliminando...' : 'Eliminar cuenta'}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* ── Branch modal ──────────────────────────────────────────── */}
      <Modal
        open={showBranchModal}
        title={isEditingBranch ? 'Editar sucursal' : 'Nueva sucursal'}
        description={isEditingBranch
          ? 'Actualiza los datos de esta sede.'
          : 'Agrega una nueva sede al gimnasio. Podrás asignar clases a esta sede desde el módulo de clases.'}
        onClose={() => {
          if (!branchMutation.isPending) closeBranchModal();
        }}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            branchMutation.mutate();
          }}
        >
          <div>
            <label className="mb-1.5 block text-xs font-medium text-surface-600 dark:text-surface-400">
              Nombre de la sede <span className="text-rose-500">*</span>
            </label>
            <input
              className="input"
              required
              value={branchForm.name}
              onChange={(e) => setBranchForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Ej: Sucursal Centro, Sede Providencia…"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-surface-600 dark:text-surface-400">Ciudad</label>
              <input
                className="input"
                value={branchForm.city}
                onChange={(e) => setBranchForm((f) => ({ ...f, city: e.target.value }))}
                placeholder="Santiago"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-surface-600 dark:text-surface-400">Teléfono</label>
              <input
                className="input"
                value={branchForm.phone}
                onChange={(e) => setBranchForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="+56 9 1234 5678"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-surface-600 dark:text-surface-400">Dirección</label>
            <input
              className="input"
              value={branchForm.address}
              onChange={(e) => setBranchForm((f) => ({ ...f, address: e.target.value }))}
              placeholder="Av. Principal 123, Piso 2"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-surface-600 dark:text-surface-400">Email de contacto</label>
            <input
              className="input"
              type="email"
              value={branchForm.email}
              onChange={(e) => setBranchForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="sede@migimnasio.cl"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-surface-600 dark:text-surface-400">Apertura</label>
              <input
                className="input"
                type="time"
                value={branchForm.opening_time}
                onChange={(e) => setBranchForm((f) => ({ ...f, opening_time: e.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-surface-600 dark:text-surface-400">Cierre</label>
              <input
                className="input"
                type="time"
                value={branchForm.closing_time}
                onChange={(e) => setBranchForm((f) => ({ ...f, closing_time: e.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-surface-600 dark:text-surface-400">Aforo máximo</label>
              <input
                className="input"
                type="number"
                min="1"
                value={branchForm.capacity}
                onChange={(e) => setBranchForm((f) => ({ ...f, capacity: e.target.value }))}
                placeholder="100"
              />
            </div>
          </div>

          <div className="rounded-2xl border border-surface-200 bg-surface-50/60 px-4 py-3 text-xs text-surface-500 dark:border-surface-800 dark:bg-surface-950/30">
            Las clases se asignan a cada sede desde el módulo de clases. Los clientes del gimnasio pueden reservar en cualquier sede.
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={closeBranchModal}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={branchMutation.isPending}>
              {branchMutation.isPending
                ? (isEditingBranch ? 'Guardando...' : 'Creando...')
                : (isEditingBranch ? 'Guardar cambios' : 'Crear sede')}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={showAccountModal}
        title={isEditingAccount ? 'Editar cuenta de pago' : 'Nueva cuenta de pago'}
        description={isEditingAccount
          ? 'Actualiza la configuración de la cuenta que ya usa el gimnasio para cobrar.'
          : 'Conecta la cuenta que usara el gimnasio para vender sus propios planes.'}
        onClose={() => {
          if (!accountMutation.isPending) {
            closeAccountModal();
          }
        }}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            accountMutation.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <select
              className="input"
              value={accountForm.provider}
              disabled={isEditingAccount}
              onChange={(event) => setAccountForm((current) => ({ ...current, provider: event.target.value as AccountForm['provider'] }))}
            >
              <option value="fintoc">Fintoc (transferencia bancaria)</option>
              <option value="tuu">TUU Pago Online</option>
              <option value="webpay">Webpay</option>
              <option value="mercadopago">MercadoPago</option>
              <option value="stripe">Stripe</option>
              <option value="manual">Manual</option>
            </select>
            <select className="input" value={accountForm.status} onChange={(event) => setAccountForm((current) => ({ ...current, status: event.target.value as AccountForm['status'] }))}>
              <option value="pending">pending</option>
              <option value="connected">connected</option>
              <option value="disabled">disabled</option>
            </select>
          </div>
          {isEditingAccount ? (
            <div className="rounded-2xl border border-surface-200 bg-surface-50 px-4 py-3 text-sm text-surface-600 dark:border-surface-800 dark:bg-surface-950/40 dark:text-surface-300">
              El proveedor no se puede cambiar sobre una cuenta existente. Si necesitas cambiarlo, edita sus datos o elimina la cuenta y crea una nueva.
            </div>
          ) : null}
          <input className="input" value={accountForm.account_label} onChange={(event) => setAccountForm((current) => ({ ...current, account_label: event.target.value }))} placeholder="Etiqueta comercial" />
          {accountForm.provider === 'webpay' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <input
                className="input"
                value={accountForm.webpay_commerce_code}
                onChange={(event) => setAccountForm((current) => ({ ...current, webpay_commerce_code: event.target.value }))}
                placeholder="Commerce code"
              />
              <select
                className="input"
                value={accountForm.webpay_environment}
                onChange={(event) => setAccountForm((current) => ({ ...current, webpay_environment: event.target.value as AccountForm['webpay_environment'] }))}
              >
                <option value="integration">integration</option>
                <option value="production">production</option>
              </select>
              <input
                className="input sm:col-span-2"
                type="password"
                value={accountForm.webpay_api_key}
                onChange={(event) => setAccountForm((current) => ({ ...current, webpay_api_key: event.target.value }))}
                placeholder="API key secreta"
              />
            </div>
          ) : accountForm.provider === 'tuu' ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-surface-600 dark:text-surface-400">
                    Account ID de TUU <span className="text-rose-500">*</span>
                  </label>
                  <input
                    className="input font-mono text-sm"
                    value={accountForm.tuu_account_id}
                    onChange={(event) => setAccountForm((current) => ({ ...current, tuu_account_id: event.target.value }))}
                    placeholder="62224230"
                    required={accountForm.status === 'connected'}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-surface-600 dark:text-surface-400">Ambiente</label>
                  <select
                    className="input"
                    value={accountForm.tuu_environment}
                    onChange={(event) => setAccountForm((current) => ({ ...current, tuu_environment: event.target.value as AccountForm['tuu_environment'] }))}
                  >
                    <option value="integration">integration</option>
                    <option value="production">production</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-surface-600 dark:text-surface-400">
                  Secret key de TUU <span className="text-rose-500">*</span>
                  <span className="ml-1 text-surface-400">(entregada por TUU al habilitar Pago Online)</span>
                </label>
                <input
                  className="input font-mono text-sm"
                  type="password"
                  value={accountForm.tuu_secret_key}
                  onChange={(event) => setAccountForm((current) => ({ ...current, tuu_secret_key: event.target.value }))}
                  placeholder="Secret key"
                  required={accountForm.status === 'connected'}
                />
              </div>
              <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-700 dark:border-sky-900/40 dark:bg-sky-950/20 dark:text-sky-300">
                TUU usa un checkout firmado por Nexo y callback server-to-server para confirmar el pago del cliente antes de activar la membresía.
              </div>
            </div>
          ) : accountForm.provider === 'fintoc' ? (
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-surface-600 dark:text-surface-400">
                  API Key secreta de Fintoc <span className="text-rose-500">*</span>
                  <span className="ml-1 text-surface-400">(dashboard Fintoc → API Keys)</span>
                </label>
                <input
                  className="input font-mono text-sm"
                  type="password"
                  value={accountForm.fintoc_secret_key}
                  onChange={(event) => setAccountForm((current) => ({ ...current, fintoc_secret_key: event.target.value }))}
                  placeholder="sk_live_..."
                  required={accountForm.status === 'connected'}
                />
              </div>
              <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-700 dark:border-sky-900/40 dark:bg-sky-950/20 dark:text-sky-300">
                Fintoc con "Cobros" activado gestiona la cuenta destino automáticamente. Solo necesitas la API key.
              </div>
            </div>
          ) : (
            <>
              <input className="input" value={accountForm.public_identifier} onChange={(event) => setAccountForm((current) => ({ ...current, public_identifier: event.target.value }))} placeholder="Identificador público" />
              <input className="input" value={accountForm.checkout_base_url} onChange={(event) => setAccountForm((current) => ({ ...current, checkout_base_url: event.target.value }))} placeholder="https://checkout..." />
            </>
          )}
          {isEditingAccount && accountForm.provider === 'webpay' && (editingAccount?.metadata.api_key_configured) ? (
            <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-700 dark:border-sky-900/40 dark:bg-sky-950/20 dark:text-sky-300">
              Deja la API key en blanco si quieres conservar la credencial actual.
            </div>
          ) : null}
          {isEditingAccount && accountForm.provider === 'tuu' && (editingAccount?.metadata.secret_key_configured) ? (
            <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-700 dark:border-sky-900/40 dark:bg-sky-950/20 dark:text-sky-300">
              Deja la secret key en blanco si quieres conservar la credencial actual de TUU.
            </div>
          ) : null}
          <label className="flex items-center gap-3 rounded-2xl border border-surface-200 px-4 py-3 dark:border-surface-800">
            <input type="checkbox" checked={accountForm.is_default} onChange={(event) => setAccountForm((current) => ({ ...current, is_default: event.target.checked }))} />
            <span className="text-sm text-surface-700 dark:text-surface-300">Usar como cuenta default</span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={closeAccountModal}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={accountMutation.isPending}>
              {accountMutation.isPending
                ? (isEditingAccount ? 'Guardando cambios...' : 'Guardando...')
                : (isEditingAccount ? 'Guardar cambios' : 'Guardar cuenta')}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!accountToDelete}
        title="Eliminar cuenta de pago"
        description="Esta acción quita la cuenta de pago de la configuración del gimnasio."
        onClose={() => {
          if (!deleteAccountMutation.isPending) {
            setAccountToDelete(null);
          }
        }}
      >
        {accountToDelete ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
              <p className="font-semibold">Se eliminará {getPaymentProviderLabel(accountToDelete.provider)}</p>
              <p className="mt-1">
                {accountToDelete.account_label || 'Sin etiqueta'} · {accountToDelete.public_identifier || 'Sin identificador público'}
              </p>
            </div>
            <p className="text-sm text-surface-500">
              Si era la cuenta predeterminada y quedan otras disponibles, el sistema elegirá automáticamente una de reemplazo.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setAccountToDelete(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn-danger"
                disabled={deleteAccountMutation.isPending}
                onClick={() => deleteAccountMutation.mutate(accountToDelete)}
              >
                {deleteAccountMutation.isPending ? 'Eliminando...' : 'Eliminar cuenta'}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </motion.div>
  );
}
