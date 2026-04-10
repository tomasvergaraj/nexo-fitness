import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { CreditCard, Globe, Palette, Shield, Store } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import LogoUploader from '@/components/ui/LogoUploader';
import { paymentProviderApi, settingsApi } from '@/services/api';
import { fadeInUp, staggerContainer } from '@/utils/animations';
import type { PaymentProviderAccount, TenantSettings } from '@/types';
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
  status: PaymentProviderAccount['status'];
  is_default: boolean;
};

const emptyAccount: AccountForm = {
  provider: 'webpay',
  account_label: '',
  public_identifier: '',
  checkout_base_url: '',
  status: 'pending',
  is_default: true,
};

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [accountForm, setAccountForm] = useState<AccountForm>(emptyAccount);
  const [showAccountModal, setShowAccountModal] = useState(false);

  const { data: settings, isLoading, isError } = useQuery<TenantSettings>({
    queryKey: ['tenant-settings'],
    queryFn: async () => {
      const response = await settingsApi.get();
      return response.data;
    },
  });

  const { data: paymentAccounts = [] } = useQuery<PaymentProviderAccount[]>({
    queryKey: ['payment-provider-accounts'],
    queryFn: async () => {
      const response = await paymentProviderApi.list();
      return response.data;
    },
  });

  useEffect(() => {
    if (settings) {
      const { branding: _branding, ...rest } = settings;
      setForm(rest);
    }
  }, [settings]);

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

  const accountMutation = useMutation({
    mutationFn: async () => {
      const response = await paymentProviderApi.create({
        ...accountForm,
        metadata: {
          public_identifier: accountForm.public_identifier,
        },
      });
      return response.data;
    },
    onSuccess: () => {
      toast.success('Cuenta de pago guardada');
      setShowAccountModal(false);
      setAccountForm(emptyAccount);
      queryClient.invalidateQueries({ queryKey: ['payment-provider-accounts'] });
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No se pudo guardar la cuenta de pago'));
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

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-3 rounded-2xl border border-surface-200 px-4 py-3 dark:border-surface-800">
                <input type="checkbox" checked={form.reminder_emails} onChange={(event) => setForm((current) => current ? { ...current, reminder_emails: event.target.checked } : current)} />
                <span className="text-sm text-surface-700 dark:text-surface-300">Recordatorios por email</span>
              </label>
              <label className="flex items-center gap-3 rounded-2xl border border-surface-200 px-4 py-3 dark:border-surface-800">
                <input type="checkbox" checked={form.reminder_whatsapp} onChange={(event) => setForm((current) => current ? { ...current, reminder_whatsapp: event.target.checked } : current)} />
                <span className="text-sm text-surface-700 dark:text-surface-300">Recordatorios por WhatsApp</span>
              </label>
              <label className="flex items-center gap-3 rounded-2xl border border-surface-200 px-4 py-3 dark:border-surface-800">
                <input type="checkbox" checked={form.staff_can_edit_plans} onChange={(event) => setForm((current) => current ? { ...current, staff_can_edit_plans: event.target.checked } : current)} />
                <span className="text-sm text-surface-700 dark:text-surface-300">Staff puede editar planes</span>
              </label>
              <label className="flex items-center gap-3 rounded-2xl border border-surface-200 px-4 py-3 dark:border-surface-800">
                <input type="checkbox" checked={form.two_factor_required} onChange={(event) => setForm((current) => current ? { ...current, two_factor_required: event.target.checked } : current)} />
                <span className="text-sm text-surface-700 dark:text-surface-300">2FA obligatorio</span>
              </label>
              <label className="flex items-center gap-3 rounded-2xl border border-surface-200 px-4 py-3 dark:border-surface-800 sm:col-span-2">
                <input type="checkbox" checked={form.public_checkout_enabled} onChange={(event) => setForm((current) => current ? { ...current, public_checkout_enabled: event.target.checked } : current)} />
                <span className="text-sm text-surface-700 dark:text-surface-300">Habilitar pago público del gimnasio</span>
              </label>
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
              <button type="button" className="btn-secondary" onClick={() => setShowAccountModal(true)}>Agregar</button>
            </div>

            <div className="space-y-3">
              {paymentAccounts.length ? paymentAccounts.map((account) => (
                <div key={account.id} className="rounded-2xl border border-surface-200/60 px-4 py-4 dark:border-surface-800/60">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold capitalize text-surface-900 dark:text-white">{account.provider}</p>
                      <p className="text-sm text-surface-500">{account.account_label || 'Sin etiqueta'}</p>
                    </div>
                    <span className={`badge ${account.status === 'connected' ? 'badge-success' : account.status === 'pending' ? 'badge-warning' : 'badge-neutral'}`}>
                      {account.status}
                    </span>
                  </div>
                  <div className="mt-3 space-y-1 text-xs text-surface-500">
                    <p>ID público: {account.public_identifier || 'No definido'}</p>
                    <p>Checkout base: {account.checkout_base_url || 'No definido'}</p>
                    <p>{account.is_default ? 'Cuenta predeterminada de la cuenta' : 'Cuenta secundaria'}</p>
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

      <Modal
        open={showAccountModal}
        title="Nueva cuenta de pago"
        description="Conecta la cuenta que usara el gimnasio para vender sus propios planes."
        onClose={() => {
          if (!accountMutation.isPending) {
            setShowAccountModal(false);
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
            <select className="input" value={accountForm.provider} onChange={(event) => setAccountForm((current) => ({ ...current, provider: event.target.value as AccountForm['provider'] }))}>
              <option value="fintoc">Fintoc (transferencia bancaria)</option>
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
          <input className="input" value={accountForm.account_label} onChange={(event) => setAccountForm((current) => ({ ...current, account_label: event.target.value }))} placeholder="Etiqueta comercial" />
          <input className="input" value={accountForm.public_identifier} onChange={(event) => setAccountForm((current) => ({ ...current, public_identifier: event.target.value }))} placeholder="Identificador público" />
          <input className="input" value={accountForm.checkout_base_url} onChange={(event) => setAccountForm((current) => ({ ...current, checkout_base_url: event.target.value }))} placeholder="https://checkout..." />
          <label className="flex items-center gap-3 rounded-2xl border border-surface-200 px-4 py-3 dark:border-surface-800">
            <input type="checkbox" checked={accountForm.is_default} onChange={(event) => setAccountForm((current) => ({ ...current, is_default: event.target.checked }))} />
            <span className="text-sm text-surface-700 dark:text-surface-300">Usar como cuenta default</span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setShowAccountModal(false)}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={accountMutation.isPending}>
              {accountMutation.isPending ? 'Guardando...' : 'Guardar cuenta'}
            </button>
          </div>
        </form>
      </Modal>
    </motion.div>
  );
}
