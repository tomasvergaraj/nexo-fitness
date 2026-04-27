import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Eye, EyeOff, Loader2, CheckCircle, AlertCircle, ShieldCheck } from 'lucide-react';
import NexoBrand from '@/components/branding/NexoBrand';
import { invitationApi } from '@/services/api';
import { cn } from '@/utils';

const ROLE_MODULES: Record<string, string[]> = {
  admin: ['Dashboard', 'Clases', 'Clientes', 'Planes', 'Check-in', 'Programas', 'Marketing', 'Reportes', 'POS', 'Inventario', 'Gastos', 'Configuración'],
  reception: ['Clases', 'Clientes', 'Check-in', 'POS'],
  trainer: ['Clases', 'Clientes', 'Programas'],
  marketing: ['Marketing', 'Reportes'],
};

interface InvitationInfo {
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  role_label: string;
  gym_name: string;
  invited_by: string;
}

function PasswordStrengthBar({ password }: { password: string }) {
  const checks = [
    { label: 'Mínimo 8 caracteres', ok: password.length >= 8 },
    { label: 'Al menos una mayúscula', ok: /[A-Z]/.test(password) },
    { label: 'Al menos un número', ok: /\d/.test(password) },
  ];
  const score = checks.filter((c) => c.ok).length;
  const colors = ['bg-red-500', 'bg-amber-500', 'bg-emerald-500'];

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors duration-300',
              i < score ? colors[score - 1] : 'bg-white/10',
            )}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5">
        {checks.map((c) => (
          <span key={c.label} className={cn('text-xs', c.ok ? 'text-emerald-400' : 'text-surface-500')}>
            {c.ok ? '✓' : '·'} {c.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function AcceptInvitationPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') ?? '';

  const [info, setInfo] = useState<InvitationInfo | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loadingInfo, setLoadingInfo] = useState(true);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const passwordsMatch = confirm === '' || password === confirm;
  const passwordValid = password.length >= 8 && /[A-Z]/.test(password) && /\d/.test(password);

  useEffect(() => {
    if (!token) {
      setLoadError('Enlace de invitación inválido.');
      setLoadingInfo(false);
      return;
    }
    invitationApi.getInfo(token)
      .then((res) => setInfo(res.data))
      .catch((err) => setLoadError(err?.response?.data?.detail || 'Invitación inválida o vencida.'))
      .finally(() => setLoadingInfo(false));
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordsMatch || !passwordValid) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await invitationApi.accept(token, password);
      setDone(true);
      setTimeout(() => navigate('/login'), 3500);
    } catch (err: any) {
      setSubmitError(err?.response?.data?.detail || 'No se pudo activar la cuenta. Intenta de nuevo.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-surface-950">
      <div className="absolute inset-0 bg-gradient-to-br from-surface-950 via-surface-900 to-brand-950" />
      <motion.div
        animate={{ x: [0, 60, -40, 0], y: [0, -50, 40, 0] }}
        transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
        className="absolute top-1/3 left-1/4 w-96 h-96 rounded-full bg-brand-500/10 blur-[100px]"
      />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative w-full max-w-md px-6 py-10"
      >
        <div className="mb-8">
          <NexoBrand
            iconSize={40}
            iconClassName="shadow-lg shadow-brand-500/25"
            titleClassName="text-2xl"
            accentClassName="text-brand-400"
          />
        </div>

        <div className="bg-white/5 backdrop-blur-2xl border border-white/10 rounded-3xl p-8 shadow-2xl">
          {/* Loading */}
          {loadingInfo ? (
            <div className="flex flex-col items-center py-8 gap-3">
              <Loader2 size={32} className="animate-spin text-brand-400" />
              <p className="text-surface-400 text-sm">Verificando invitación...</p>
            </div>
          ) : loadError ? (
            /* Error state */
            <div className="text-center py-4">
              <div className="w-16 h-16 rounded-full bg-red-500/20 border border-red-500/30 flex items-center justify-center mx-auto mb-4">
                <AlertCircle size={28} className="text-red-400" />
              </div>
              <h2 className="text-xl font-bold text-white mb-2">Invitación no válida</h2>
              <p className="text-surface-400 text-sm mb-6">{loadError}</p>
              <Link to="/login" className="text-brand-400 hover:text-brand-300 text-sm">
                Ir al inicio de sesión
              </Link>
            </div>
          ) : done ? (
            /* Success state */
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center"
            >
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4">
                <CheckCircle size={28} className="text-emerald-400" />
              </div>
              <h2 className="text-xl font-bold text-white mb-2">¡Cuenta activada!</h2>
              <p className="text-surface-400 text-sm">
                Ya puedes ingresar a <strong className="text-white">{info?.gym_name}</strong>.
                Redirigiendo al inicio de sesión...
              </p>
            </motion.div>
          ) : (
            /* Form */
            <>
              {/* Invitation context */}
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-1">
                  <ShieldCheck size={18} className="text-brand-400" />
                  <span className="text-xs font-semibold uppercase tracking-widest text-brand-400">
                    Invitación al equipo
                  </span>
                </div>
                <h2 className="text-2xl font-bold font-display text-white">
                  Hola, {info?.first_name}
                </h2>
                <p className="text-surface-400 text-sm mt-1">
                  <strong className="text-surface-300">{info?.invited_by}</strong> te invitó a unirte como{' '}
                  <span className="text-brand-300 font-medium">{info?.role_label}</span> en{' '}
                  <strong className="text-surface-300">{info?.gym_name}</strong>.
                </p>
              </div>

              {/* Access preview */}
              <div className="mb-6 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="text-xs font-semibold text-surface-400 mb-2 uppercase tracking-wider">
                  Módulos con acceso
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {(ROLE_MODULES[info?.role ?? ''] ?? []).map((mod) => (
                    <span
                      key={mod}
                      className="px-2.5 py-0.5 rounded-full bg-brand-500/15 border border-brand-500/25 text-brand-300 text-xs font-medium"
                    >
                      {mod}
                    </span>
                  ))}
                </div>
              </div>

              {/* Password form */}
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-surface-300 mb-2">
                    Correo
                  </label>
                  <input
                    value={info?.email ?? ''}
                    disabled
                    className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-surface-400 text-sm cursor-not-allowed"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-surface-300 mb-2">
                    Crea tu contraseña
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full px-4 py-3 pr-12 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500/50 transition-all"
                      placeholder="Mínimo 8 caracteres"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-surface-400 hover:text-surface-300"
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  {password && <PasswordStrengthBar password={password} />}
                </div>

                <div>
                  <label className="block text-sm font-medium text-surface-300 mb-2">
                    Confirmar contraseña
                  </label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className={cn(
                      'w-full px-4 py-3 rounded-xl bg-white/5 border text-white placeholder:text-surface-500',
                      'focus:outline-none focus:ring-2 transition-all',
                      confirm && !passwordsMatch
                        ? 'border-red-500/40 focus:ring-red-500/30'
                        : 'border-white/10 focus:ring-brand-500/50 focus:border-brand-500/50',
                    )}
                    placeholder="Repite la contraseña"
                    required
                  />
                  {confirm && !passwordsMatch && (
                    <p className="text-red-400 text-xs mt-1">Las contraseñas no coinciden</p>
                  )}
                </div>

                {submitError && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm"
                  >
                    {submitError}
                  </motion.div>
                )}

                <button
                  type="submit"
                  disabled={submitting || !passwordsMatch || !passwordValid || !confirm}
                  className={cn(
                    'w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-semibold',
                    'bg-gradient-to-r from-brand-500 to-brand-600 text-white',
                    'shadow-xl shadow-brand-500/25 hover:shadow-brand-500/40 transition-all duration-300',
                    (submitting || !passwordsMatch || !passwordValid || !confirm) && 'opacity-60 cursor-not-allowed',
                  )}
                >
                  {submitting ? <Loader2 size={20} className="animate-spin" /> : 'Activar cuenta'}
                </button>
              </form>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
