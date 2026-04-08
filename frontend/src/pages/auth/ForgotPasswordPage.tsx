import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Zap, ArrowLeft, Loader2, Mail } from 'lucide-react';
import { authApi } from '@/services/api';
import { cn } from '@/utils';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await authApi.forgotPassword(email);
      setSent(true);
    } catch {
      setError('Ocurrió un error. Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-surface-950">
      <div className="absolute inset-0 bg-gradient-to-br from-surface-950 via-surface-900 to-brand-950" />
      <motion.div
        animate={{ x: [0, 80, -40, 0], y: [0, -60, 50, 0], scale: [1, 1.15, 0.92, 1] }}
        transition={{ duration: 22, repeat: Infinity, ease: 'linear' }}
        className="absolute top-1/4 left-1/3 w-96 h-96 rounded-full bg-brand-500/10 blur-[100px]"
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
          {sent ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center"
            >
              <div className="w-16 h-16 rounded-full bg-brand-500/20 border border-brand-500/30
                              flex items-center justify-center mx-auto mb-4">
                <Mail size={28} className="text-brand-400" />
              </div>
              <h2 className="text-xl font-bold text-white mb-2">Revisa tu correo</h2>
              <p className="text-surface-400 text-sm mb-6">
                Si <span className="text-white font-medium">{email}</span> está registrado,
                recibirás un enlace para restablecer tu contraseña en los próximos minutos.
              </p>
              <Link
                to="/login"
                className="text-sm text-brand-400 hover:text-brand-300 transition-colors flex items-center justify-center gap-2"
              >
                <ArrowLeft size={16} />
                Volver al inicio de sesión
              </Link>
            </motion.div>
          ) : (
            <>
              <h2 className="text-2xl font-bold font-display text-white mb-1">
                ¿Olvidaste tu contraseña?
              </h2>
              <p className="text-surface-400 text-sm mb-8">
                Ingresa tu correo y te enviaremos un enlace para restablecerla.
              </p>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-surface-300 mb-2">
                    Correo electrónico
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10
                               text-white placeholder:text-surface-500
                               focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500/50
                               transition-all duration-200"
                    placeholder="tu@email.com"
                    required
                  />
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
                  disabled={loading}
                  className={cn(
                    'w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-semibold',
                    'bg-gradient-to-r from-brand-500 to-brand-600 text-white',
                    'shadow-xl shadow-brand-500/25 hover:shadow-brand-500/40',
                    'transition-all duration-300',
                    loading && 'opacity-80 cursor-not-allowed'
                  )}
                >
                  {loading ? <Loader2 size={20} className="animate-spin" /> : 'Enviar enlace'}
                </button>
              </form>

              <div className="mt-6 text-center">
                <Link
                  to="/login"
                  className="text-sm text-surface-400 hover:text-surface-300 transition-colors
                             flex items-center justify-center gap-2"
                >
                  <ArrowLeft size={14} />
                  Volver al inicio de sesión
                </Link>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
