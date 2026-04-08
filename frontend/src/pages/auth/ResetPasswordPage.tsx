import { useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Zap, Eye, EyeOff, Loader2, CheckCircle } from 'lucide-react';
import { authApi } from '@/services/api';
import { cn } from '@/utils';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const passwordsMatch = password === confirm;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordsMatch) {
      setError('Las contraseñas no coinciden');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
      setTimeout(() => navigate('/login'), 3000);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'El enlace es inválido o ha expirado.');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-950">
        <div className="text-center text-surface-400">
          <p className="mb-4">Enlace inválido.</p>
          <Link to="/forgot-password" className="text-brand-400 hover:text-brand-300">
            Solicitar nuevo enlace
          </Link>
        </div>
      </div>
    );
  }

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
        className="relative w-full max-w-md px-6"
      >
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-400 to-brand-600
                          flex items-center justify-center shadow-lg shadow-brand-500/30">
            <Zap size={20} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold font-display text-white">
            Nexo<span className="text-brand-400">Fitness</span>
          </h1>
        </div>

        <div className="bg-white/5 backdrop-blur-2xl border border-white/10 rounded-3xl p-8 shadow-2xl">
          {done ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center"
            >
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/30
                              flex items-center justify-center mx-auto mb-4">
                <CheckCircle size={28} className="text-emerald-400" />
              </div>
              <h2 className="text-xl font-bold text-white mb-2">Contraseña actualizada</h2>
              <p className="text-surface-400 text-sm">
                Redirigiendo al inicio de sesión...
              </p>
            </motion.div>
          ) : (
            <>
              <h2 className="text-2xl font-bold font-display text-white mb-1">
                Nueva contraseña
              </h2>
              <p className="text-surface-400 text-sm mb-8">
                Elige una contraseña segura de al menos 8 caracteres.
              </p>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-surface-300 mb-2">
                    Nueva contraseña
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full px-4 py-3 pr-12 rounded-xl bg-white/5 border border-white/10
                                 text-white placeholder:text-surface-500
                                 focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500/50
                                 transition-all duration-200"
                      placeholder="Mínimo 8 caracteres"
                      minLength={8}
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
                      'focus:outline-none focus:ring-2 transition-all duration-200',
                      confirm && !passwordsMatch
                        ? 'border-red-500/40 focus:ring-red-500/30'
                        : 'border-white/10 focus:ring-brand-500/50 focus:border-brand-500/50'
                    )}
                    placeholder="Repite la contraseña"
                    required
                  />
                  {confirm && !passwordsMatch && (
                    <p className="text-red-400 text-xs mt-1">Las contraseñas no coinciden</p>
                  )}
                </div>

                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm"
                  >
                    {error}
                  </motion.div>
                )}

                <button
                  type="submit"
                  disabled={loading || !passwordsMatch}
                  className={cn(
                    'w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-semibold',
                    'bg-gradient-to-r from-brand-500 to-brand-600 text-white',
                    'shadow-xl shadow-brand-500/25 hover:shadow-brand-500/40',
                    'transition-all duration-300',
                    (loading || !passwordsMatch) && 'opacity-60 cursor-not-allowed'
                  )}
                >
                  {loading ? <Loader2 size={20} className="animate-spin" /> : 'Cambiar contraseña'}
                </button>
              </form>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
