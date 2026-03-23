import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { ArrowLeft, ArrowRight, Loader2, Zap } from 'lucide-react';
import { authApi } from '@/services/api';
import { cn } from '@/utils';

const initialForm = {
  gym_name: '',
  slug: '',
  email: '',
  city: 'Santiago',
  country: 'Chile',
  timezone: 'America/Santiago',
  currency: 'CLP',
  license_type: 'monthly',
  owner_first_name: '',
  owner_last_name: '',
  owner_email: '',
  owner_password: '',
};

export default function RegisterPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const updateField = (key: keyof typeof initialForm, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      await authApi.registerGym(form);
      toast.success('Gimnasio registrado. Ya puedes iniciar sesion.');
      navigate('/login');
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo registrar el gimnasio');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-950 px-6 py-10">
      <div className="mx-auto max-w-5xl">
        <button
          type="button"
          onClick={() => navigate('/login')}
          className="mb-6 inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-sm text-surface-300 transition-colors hover:bg-white/5"
        >
          <ArrowLeft size={16} />
          Volver al login
        </button>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <motion.div
            initial={{ opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            className="rounded-3xl bg-gradient-to-br from-brand-500 to-brand-700 p-8 text-white shadow-2xl shadow-brand-500/20"
          >
            <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15">
              <Zap size={26} />
            </div>
            <h1 className="text-4xl font-bold font-display">Registra tu gimnasio</h1>
            <p className="mt-4 max-w-xl text-sm text-white/80">
              Crea una instancia nueva de NexoFitness para administrar clases, clientes, pagos y operacion diaria.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {[
                { label: 'Setup inicial', value: '5 min' },
                { label: 'Owner creado', value: 'Automatico' },
                { label: 'Pais base', value: 'Chile' },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl bg-white/10 px-4 py-4 backdrop-blur-sm">
                  <p className="text-xs uppercase tracking-[0.2em] text-white/55">{item.label}</p>
                  <p className="mt-2 text-lg font-semibold">{item.value}</p>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur-2xl"
          >
            <h2 className="text-2xl font-bold font-display text-white">Onboarding</h2>
            <p className="mt-1 text-sm text-surface-400">Completa los datos basicos del gimnasio y su cuenta owner.</p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-surface-300">Nombre del gimnasio</label>
                  <input className="input bg-white/5 text-white" value={form.gym_name} onChange={(event) => updateField('gym_name', event.target.value)} required />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-surface-300">Slug</label>
                  <input className="input bg-white/5 text-white" value={form.slug} onChange={(event) => updateField('slug', event.target.value.toLowerCase().replace(/\s+/g, '-'))} required />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-surface-300">Email del gimnasio</label>
                  <input type="email" className="input bg-white/5 text-white" value={form.email} onChange={(event) => updateField('email', event.target.value)} required />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-surface-300">Ciudad</label>
                  <input className="input bg-white/5 text-white" value={form.city} onChange={(event) => updateField('city', event.target.value)} />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label className="mb-2 block text-sm font-medium text-surface-300">Pais</label>
                  <input className="input bg-white/5 text-white" value={form.country} onChange={(event) => updateField('country', event.target.value)} />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-surface-300">Zona horaria</label>
                  <input className="input bg-white/5 text-white" value={form.timezone} onChange={(event) => updateField('timezone', event.target.value)} />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-surface-300">Licencia</label>
                  <select className="input bg-white/5 text-white" value={form.license_type} onChange={(event) => updateField('license_type', event.target.value)}>
                    <option value="monthly">Mensual</option>
                    <option value="annual">Anual</option>
                    <option value="perpetual">Perpetua</option>
                  </select>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-surface-300">Nombre owner</label>
                  <input className="input bg-white/5 text-white" value={form.owner_first_name} onChange={(event) => updateField('owner_first_name', event.target.value)} required />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-surface-300">Apellido owner</label>
                  <input className="input bg-white/5 text-white" value={form.owner_last_name} onChange={(event) => updateField('owner_last_name', event.target.value)} required />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-surface-300">Email owner</label>
                  <input type="email" className="input bg-white/5 text-white" value={form.owner_email} onChange={(event) => updateField('owner_email', event.target.value)} required />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-surface-300">Contrasena owner</label>
                  <input type="password" className="input bg-white/5 text-white" value={form.owner_password} onChange={(event) => updateField('owner_password', event.target.value)} required />
                </div>
              </div>

              {error ? (
                <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  {error}
                </div>
              ) : null}

              <motion.button
                type="submit"
                disabled={loading}
                whileHover={{ scale: loading ? 1 : 1.01 }}
                whileTap={{ scale: loading ? 1 : 0.98 }}
                className={cn(
                  'flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-brand-600 py-3.5 font-semibold text-white shadow-xl shadow-brand-500/25',
                  loading && 'cursor-not-allowed opacity-80',
                )}
              >
                {loading ? (
                  <Loader2 size={20} className="animate-spin" />
                ) : (
                  <>
                    Crear gimnasio
                    <ArrowRight size={18} />
                  </>
                )}
              </motion.button>
            </form>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
