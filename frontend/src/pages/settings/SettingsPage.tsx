import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { CreditCard, Globe, Palette, Shield, Store } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { paymentProviderApi, settingsApi } from '@/services/api';
import { fadeInUp, staggerContainer } from '@/utils/animations';
import type { PaymentProviderAccount, TenantSettings } from '@/types';

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
      const response = await settingsApi.update(form ?? {});
      return response.data;
    },
    onSuccess: () => {
      toast.success('Configuracion guardada');
      queryClient.invalidateQueries({ queryKey: ['tenant-settings'] });
      queryClient.invalidateQueries({ queryKey: ['tenant-public-profile'] });
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.detail || 'No se pudo guardar la configuracion');
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
      toast.error(error?.response?.data?.detail || 'No se pudo guardar la cuenta de pago');
    },
  });

  if (isLoading || !form) {
    return <div className="shimmer h-[420px] rounded-3xl" />;
  }

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-6">
      <motion.div variants={fadeInUp} className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Configuracion</h1>
          <p className="mt-1 text-sm text-surface-500">Branding, storefront y medios de pago conectados al tenant real</p>
        </div>
        <button type="button" className="btn-primary" onClick={() => settingsMutation.mutate()} disabled={settingsMutation.isPending}>
          {settingsMutation.isPending ? 'Guardando...' : 'Guardar cambios'}
        </button>
      </motion.div>

      {isError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-600 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
          No pudimos cargar la configuracion del tenant.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <motion.div variants={fadeInUp} className="rounded-3xl border border-surface-200/50 bg-white p-6 dark:border-surface-800/50 dark:bg-surface-900">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-500 dark:bg-brand-950/40"><Store size={20} /></div>
              <div>
                <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Datos del gimnasio</h2>
                <p className="text-sm text-surface-500">Estos datos alimentan el storefront publico y la app</p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <input className="input" value={form.gym_name} onChange={(event) => setForm((current) => current ? { ...current, gym_name: event.target.value } : current)} placeholder="Nombre del gimnasio" />
              <input className="input" value={form.email} onChange={(event) => setForm((current) => current ? { ...current, email: event.target.value } : current)} placeholder="Email" />
              <input className="input" value={form.phone ?? ''} onChange={(event) => setForm((current) => current ? { ...current, phone: event.target.value } : current)} placeholder="Telefono" />
              <input className="input" value={form.city ?? ''} onChange={(event) => setForm((current) => current ? { ...current, city: event.target.value } : current)} placeholder="Ciudad" />
              <input className="input sm:col-span-2" value={form.address ?? ''} onChange={(event) => setForm((current) => current ? { ...current, address: event.target.value } : current)} placeholder="Direccion" />
            </div>
          </motion.div>

          <motion.div variants={fadeInUp} className="rounded-3xl border border-surface-200/50 bg-white p-6 dark:border-surface-800/50 dark:bg-surface-900">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-500 dark:bg-brand-950/40"><Palette size={20} /></div>
              <div>
                <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Branding y storefront</h2>
                <p className="text-sm text-surface-500">Color, logo y copy comercial para la venta online del gym</p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <input className="input" value={form.primary_color ?? ''} onChange={(event) => setForm((current) => current ? { ...current, primary_color: event.target.value } : current)} placeholder="#06b6d4" />
              <input className="input" value={form.logo_url ?? ''} onChange={(event) => setForm((current) => current ? { ...current, logo_url: event.target.value } : current)} placeholder="https://..." />
              <input className="input" value={form.custom_domain ?? ''} onChange={(event) => setForm((current) => current ? { ...current, custom_domain: event.target.value } : current)} placeholder="midominio.cl" />
              <input className="input" value={form.support_phone ?? ''} onChange={(event) => setForm((current) => current ? { ...current, support_phone: event.target.value } : current)} placeholder="Telefono soporte" />
              <input className="input sm:col-span-2" value={form.marketplace_headline ?? ''} onChange={(event) => setForm((current) => current ? { ...current, marketplace_headline: event.target.value } : current)} placeholder="Titular comercial del storefront" />
              <textarea className="input sm:col-span-2 min-h-28 resize-y" value={form.marketplace_description ?? ''} onChange={(event) => setForm((current) => current ? { ...current, marketplace_description: event.target.value } : current)} placeholder="Descripcion publica del gimnasio" />
            </div>
          </motion.div>

          <motion.div variants={fadeInUp} className="rounded-3xl border border-surface-200/50 bg-white p-6 dark:border-surface-800/50 dark:bg-surface-900">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-500 dark:bg-brand-950/40"><Shield size={20} /></div>
              <div>
                <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Automatizacion y seguridad</h2>
                <p className="text-sm text-surface-500">Reglas del tenant para comunicacion y acceso</p>
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
                <span className="text-sm text-surface-700 dark:text-surface-300">Habilitar checkout publico del gimnasio</span>
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
                    <p>ID publico: {account.public_identifier || 'No definido'}</p>
                    <p>Checkout base: {account.checkout_base_url || 'No definido'}</p>
                    <p>{account.is_default ? 'Cuenta default del tenant' : 'Cuenta secundaria'}</p>
                  </div>
                </div>
              )) : (
                <div className="rounded-2xl border border-dashed border-surface-300 px-4 py-8 text-center text-sm text-surface-500 dark:border-surface-700">
                  Aun no hay cuentas de pago configuradas.
                </div>
              )}
            </div>
          </motion.div>

          <motion.div variants={fadeInUp} className="rounded-3xl border border-surface-200/50 bg-white p-6 dark:border-surface-800/50 dark:bg-surface-900">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-500 dark:bg-brand-950/40"><Globe size={20} /></div>
              <div>
                <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Canal publico</h2>
                <p className="text-sm text-surface-500">Datos listos para storefront y links compartibles</p>
              </div>
            </div>
            <div className="space-y-3 text-sm text-surface-500">
              <p>Headline: {form.marketplace_headline || 'Sin definir'}</p>
              <p>Support email: {form.support_email || 'Sin definir'}</p>
              <p>API key publica: <span className="font-mono">{form.public_api_key || 'Sin definir'}</span></p>
              <p>Checkout publico: {form.public_checkout_enabled ? 'Habilitado' : 'Deshabilitado'}</p>
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
              <option value="webpay">Webpay</option>
              <option value="mercadopago">MercadoPago</option>
              <option value="manual">Manual</option>
              <option value="stripe">Stripe</option>
            </select>
            <select className="input" value={accountForm.status} onChange={(event) => setAccountForm((current) => ({ ...current, status: event.target.value as AccountForm['status'] }))}>
              <option value="pending">pending</option>
              <option value="connected">connected</option>
              <option value="disabled">disabled</option>
            </select>
          </div>
          <input className="input" value={accountForm.account_label} onChange={(event) => setAccountForm((current) => ({ ...current, account_label: event.target.value }))} placeholder="Etiqueta comercial" />
          <input className="input" value={accountForm.public_identifier} onChange={(event) => setAccountForm((current) => ({ ...current, public_identifier: event.target.value }))} placeholder="Identificador publico" />
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
