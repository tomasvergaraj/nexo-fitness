import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  Building2, Palette, Bell, Shield, CreditCard, Globe, Users,
} from 'lucide-react';
import { staggerContainer, fadeInUp } from '@/utils/animations';
import { cn } from '@/utils';

const storageKey = 'nexo-settings';

const settingSections = [
  { icon: Building2, label: 'Datos del gimnasio', description: 'Nombre, direccion, contacto y sucursales', active: true },
  { icon: Palette, label: 'Branding', description: 'Logo, colores y personalizacion visual', active: true },
  { icon: Users, label: 'Equipo', description: 'Gestiona usuarios, roles y permisos', active: true },
  { icon: Bell, label: 'Notificaciones', description: 'Alertas, recordatorios y emails automaticos', active: true },
  { icon: CreditCard, label: 'Facturacion', description: 'Plan SaaS, metodos de pago y facturas', active: true },
  { icon: Shield, label: 'Seguridad', description: 'Contrasena, 2FA y sesiones activas', active: true },
  { icon: Globe, label: 'Integraciones', description: 'WhatsApp, pasarelas de pago y API keys', active: true },
] as const;

type SectionLabel = (typeof settingSections)[number]['label'];

type SettingsForm = {
  gymName: string;
  email: string;
  phone: string;
  city: string;
  address: string;
  primaryColor: string;
  reminderEmails: boolean;
  reminderWhatsapp: boolean;
  staffCanEditPlans: boolean;
  twoFactorEnabled: boolean;
  billingEmail: string;
  publicApiKey: string;
};

const defaultForm: SettingsForm = {
  gymName: 'Nexo Gym Santiago',
  email: 'contacto@nexogym.cl',
  phone: '+56912345678',
  city: 'Santiago',
  address: 'Av. Providencia 1234',
  primaryColor: '#06b6d4',
  reminderEmails: true,
  reminderWhatsapp: true,
  staffCanEditPlans: false,
  twoFactorEnabled: false,
  billingEmail: 'facturacion@nexogym.cl',
  publicApiKey: 'nexo_live_01_a1b2c3d4',
};

function getSectionSummary(section: SectionLabel, form: SettingsForm) {
  switch (section) {
    case 'Datos del gimnasio':
      return `${form.gymName} en ${form.city}`;
    case 'Branding':
      return `Color principal ${form.primaryColor}`;
    case 'Equipo':
      return form.staffCanEditPlans ? 'El equipo puede editar planes' : 'Solo admin puede editar planes';
    case 'Notificaciones':
      return form.reminderEmails || form.reminderWhatsapp ? 'Recordatorios activos' : 'Sin recordatorios activos';
    case 'Facturacion':
      return `Facturas a ${form.billingEmail}`;
    case 'Seguridad':
      return form.twoFactorEnabled ? '2FA habilitado' : '2FA pendiente';
    case 'Integraciones':
      return `API publica ${form.publicApiKey.slice(0, 10)}...`;
    default:
      return '';
  }
}

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SectionLabel>('Datos del gimnasio');
  const [form, setForm] = useState<SettingsForm>(defaultForm);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as Partial<SettingsForm> & { savedAt?: string };
      setForm({ ...defaultForm, ...parsed });
      if (parsed.savedAt) {
        setSavedAt(parsed.savedAt);
      }
    } catch {
      window.localStorage.removeItem(storageKey);
    }
  }, []);

  const activeSummary = useMemo(
    () => getSectionSummary(activeSection, form),
    [activeSection, form],
  );

  const updateField = <K extends keyof SettingsForm,>(key: K, value: SettingsForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const saveSettings = () => {
    const timestamp = new Date().toISOString();
    window.localStorage.setItem(storageKey, JSON.stringify({ ...form, savedAt: timestamp }));
    setSavedAt(timestamp);
    toast.success('Configuracion guardada');
  };

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-6">
      <motion.div variants={fadeInUp} className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Configuracion</h1>
          <p className="mt-1 text-sm text-surface-500">Administra la configuracion del gimnasio con cambios persistentes en esta demo</p>
        </div>
        <div className="rounded-2xl border border-surface-200/60 bg-white px-4 py-3 text-sm dark:border-surface-800/60 dark:bg-surface-900">
          <p className="font-medium text-surface-900 dark:text-white">{activeSection}</p>
          <p className="text-surface-500">{activeSummary}</p>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {settingSections.map((section, index) => (
          <motion.button
            key={section.label}
            type="button"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.06 }}
            whileHover={{ y: -2, transition: { duration: 0.2 } }}
            onClick={() => setActiveSection(section.label)}
            className={cn(
              'flex items-center gap-4 rounded-2xl border p-5 text-left transition-all duration-300',
              'hover:shadow-lg',
              activeSection === section.label
                ? 'border-brand-300 bg-brand-50/70 shadow-lg shadow-brand-500/10 dark:border-brand-800 dark:bg-brand-950/20'
                : 'border-surface-200/50 bg-white dark:border-surface-800/50 dark:bg-surface-900',
            )}
          >
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-950/40">
              <section.icon size={22} className="text-brand-500" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-surface-900 dark:text-white">{section.label}</h3>
                {activeSection === section.label ? <span className="badge badge-info text-[10px]">Activa</span> : null}
              </div>
              <p className="mt-0.5 text-sm text-surface-500">{section.description}</p>
            </div>
          </motion.button>
        ))}
      </div>

      <motion.div
        variants={fadeInUp}
        className="rounded-2xl border border-surface-200/50 bg-white p-6 dark:border-surface-800/50 dark:bg-surface-900"
      >
        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-surface-900 dark:text-white">{activeSection}</h3>
            <p className="text-sm text-surface-500">Los cambios de este panel se mantienen mientras uses esta instalacion.</p>
          </div>
          {savedAt ? (
            <span className="text-xs text-surface-400">
              Guardado: {new Date(savedAt).toLocaleString('es-CL')}
            </span>
          ) : null}
        </div>

        {activeSection === 'Datos del gimnasio' ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-surface-600 dark:text-surface-400">Nombre</label>
              <input type="text" value={form.gymName} onChange={(event) => updateField('gymName', event.target.value)} className="input" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-surface-600 dark:text-surface-400">Email</label>
              <input type="email" value={form.email} onChange={(event) => updateField('email', event.target.value)} className="input" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-surface-600 dark:text-surface-400">Telefono</label>
              <input type="tel" value={form.phone} onChange={(event) => updateField('phone', event.target.value)} className="input" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-surface-600 dark:text-surface-400">Ciudad</label>
              <input type="text" value={form.city} onChange={(event) => updateField('city', event.target.value)} className="input" />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1.5 block text-sm font-medium text-surface-600 dark:text-surface-400">Direccion</label>
              <input type="text" value={form.address} onChange={(event) => updateField('address', event.target.value)} className="input" />
            </div>
          </div>
        ) : null}

        {activeSection === 'Branding' ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[160px_1fr]">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-surface-600 dark:text-surface-400">Color principal</label>
              <input type="color" value={form.primaryColor} onChange={(event) => updateField('primaryColor', event.target.value)} className="input h-14 p-2" />
            </div>
            <div className="rounded-2xl border border-surface-200/60 p-5 dark:border-surface-800/60">
              <p className="text-sm text-surface-500">Vista previa del branding</p>
              <div className="mt-3 flex items-center gap-4">
                <div className="h-14 w-14 rounded-2xl shadow-lg" style={{ backgroundColor: form.primaryColor }} />
                <div>
                  <p className="font-semibold text-surface-900 dark:text-white">{form.gymName}</p>
                  <p className="text-sm text-surface-500">Color activo {form.primaryColor}</p>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {activeSection === 'Equipo' ? (
          <div className="grid gap-3">
            <label className="flex items-center gap-3 rounded-2xl border border-surface-200 px-4 py-3 dark:border-surface-800">
              <input
                type="checkbox"
                checked={form.staffCanEditPlans}
                onChange={(event) => updateField('staffCanEditPlans', event.target.checked)}
              />
              <span className="text-sm text-surface-700 dark:text-surface-300">Permitir que el equipo edite planes</span>
            </label>
            <div className="rounded-2xl border border-dashed border-surface-300 px-4 py-4 text-sm text-surface-500 dark:border-surface-700">
              Estado actual: {form.staffCanEditPlans ? 'el equipo puede modificar planes desde la UI' : 'la edicion queda reservada a owner y admin'}.
            </div>
          </div>
        ) : null}

        {activeSection === 'Notificaciones' ? (
          <div className="grid gap-3">
            <label className="flex items-center gap-3 rounded-2xl border border-surface-200 px-4 py-3 dark:border-surface-800">
              <input
                type="checkbox"
                checked={form.reminderEmails}
                onChange={(event) => updateField('reminderEmails', event.target.checked)}
              />
              <span className="text-sm text-surface-700 dark:text-surface-300">Enviar recordatorios por email</span>
            </label>
            <label className="flex items-center gap-3 rounded-2xl border border-surface-200 px-4 py-3 dark:border-surface-800">
              <input
                type="checkbox"
                checked={form.reminderWhatsapp}
                onChange={(event) => updateField('reminderWhatsapp', event.target.checked)}
              />
              <span className="text-sm text-surface-700 dark:text-surface-300">Enviar recordatorios por WhatsApp</span>
            </label>
          </div>
        ) : null}

        {activeSection === 'Facturacion' ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-surface-600 dark:text-surface-400">Email de facturacion</label>
              <input type="email" value={form.billingEmail} onChange={(event) => updateField('billingEmail', event.target.value)} className="input" />
            </div>
            <div className="rounded-2xl border border-surface-200/60 px-4 py-4 text-sm text-surface-500 dark:border-surface-800/60">
              Plan actual: SaaS mensual. El equipo de caja puede seguir cobrando desde planes y reportes.
            </div>
          </div>
        ) : null}

        {activeSection === 'Seguridad' ? (
          <div className="grid gap-3">
            <label className="flex items-center gap-3 rounded-2xl border border-surface-200 px-4 py-3 dark:border-surface-800">
              <input
                type="checkbox"
                checked={form.twoFactorEnabled}
                onChange={(event) => updateField('twoFactorEnabled', event.target.checked)}
              />
              <span className="text-sm text-surface-700 dark:text-surface-300">Habilitar doble factor para administradores</span>
            </label>
            <div className="rounded-2xl border border-dashed border-surface-300 px-4 py-4 text-sm text-surface-500 dark:border-surface-700">
              {form.twoFactorEnabled ? 'La cuenta marcara 2FA como obligatorio en esta demo.' : '2FA aun no es obligatorio para administradores.'}
            </div>
          </div>
        ) : null}

        {activeSection === 'Integraciones' ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-surface-600 dark:text-surface-400">API publica</label>
              <input type="text" value={form.publicApiKey} onChange={(event) => updateField('publicApiKey', event.target.value)} className="input" />
            </div>
            <div className="rounded-2xl border border-surface-200/60 px-4 py-4 text-sm text-surface-500 dark:border-surface-800/60">
              Esta clave se usa como ejemplo visual para integraciones externas en la demo.
            </div>
          </div>
        ) : null}

        <div className="mt-5 flex justify-end">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={saveSettings}
            className="btn-primary text-sm"
          >
            Guardar cambios
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}
