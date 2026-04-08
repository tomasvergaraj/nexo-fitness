import { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Eye, EyeOff, Zap, ArrowRight, Loader2 } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { authApi, billingApi } from '@/services/api';
import { cn } from '@/utils';

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setAuth, user, accessToken } = useAuthStore((s) => ({ setAuth: s.setAuth, user: s.user, accessToken: s.accessToken }));
  const billingState = searchParams.get('billing');
  const purchaseState = searchParams.get('purchase');
  const initialEmail = searchParams.get('email') ?? '';
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Si el usuario ya tiene sesión activa y vuelve de un pago exitoso,
  // verificar acceso y redirigir al dashboard sin pedir credenciales.
  useEffect(() => {
    if (billingState === 'success' && user && accessToken) {
      setLoading(true);
      billingApi.getStatus()
        .then(({ data }) => {
          if (data.allow_access) {
            const path = user.role === 'client' ? '/member'
              : user.role === 'superadmin' ? '/platform/tenants'
              : '/dashboard';
            navigate(path, { replace: true });
          }
        })
        .catch(() => {/* quedar en login para que vuelva a entrar */})
        .finally(() => setLoading(false));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const billingMessage = useMemo(() => {
    if (billingState === 'success') {
      return {
        tone: 'emerald',
        text: 'Pago confirmado. Redirigiendo a tu cuenta...',
      };
    }
    if (billingState === 'cancelled') {
      return {
        tone: 'amber',
        text: 'El checkout fue cancelado. Puedes intentarlo otra vez cuando quieras.',
      };
    }
    return null;
  }, [billingState]);

  const purchaseMessage = useMemo(() => {
    if (purchaseState === 'success') {
      return {
        tone: 'emerald',
        text: 'Compra recibida correctamente. Inicia sesion con tu correo para continuar.',
      };
    }
    if (purchaseState === 'cancelled') {
      return {
        tone: 'amber',
        text: 'La compra no se completo o fue rechazada. Puedes iniciar sesion e intentarlo otra vez.',
      };
    }
    return null;
  }, [purchaseState]);

  const resolvePostLoginPath = (role: string) => {
    if (role === 'client') return '/member';
    return role === 'superadmin' ? '/platform/tenants' : '/dashboard';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { data } = await authApi.login(email, password);

      // Siempre guardar auth — el login siempre retorna tokens válidos
      setAuth(data.user, data.access_token, data.refresh_token);

      // Si hay acción de billing requerida → siempre ir a BillingWallPage primero
      if (data.next_action) {
        const params = new URLSearchParams({ status: data.billing_status ?? 'expired' });
        navigate(`/billing/expired?${params.toString()}`, { replace: true });
        return;
      }

      navigate(resolvePostLoginPath(data.user.role));
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  };


  return (
    <div className="min-h-screen flex relative overflow-hidden bg-surface-950">
      {/* Animated background */}
      <div className="absolute inset-0">
        {/* Gradient mesh */}
        <div className="absolute inset-0 bg-gradient-to-br from-surface-950 via-surface-900 to-brand-950" />

        {/* Animated orbs */}
        <motion.div
          animate={{ x: [0, 100, -50, 0], y: [0, -80, 60, 0], scale: [1, 1.2, 0.9, 1] }}
          transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
          className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full
                     bg-brand-500/10 blur-[100px]"
        />
        <motion.div
          animate={{ x: [0, -80, 60, 0], y: [0, 100, -50, 0], scale: [1, 0.9, 1.1, 1] }}
          transition={{ duration: 25, repeat: Infinity, ease: 'linear' }}
          className="absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full
                     bg-violet-500/10 blur-[100px]"
        />
        <motion.div
          animate={{ x: [0, 60, -100, 0], y: [0, -50, 80, 0] }}
          transition={{ duration: 30, repeat: Infinity, ease: 'linear' }}
          className="absolute top-1/2 right-1/3 w-64 h-64 rounded-full
                     bg-emerald-500/8 blur-[80px]"
        />

        {/* Grid pattern */}
        <div className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px),
                              linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)`,
            backgroundSize: '60px 60px',
          }}
        />

        {/* Floating particles */}
        {Array.from({ length: 6 }).map((_, i) => (
          <motion.div
            key={i}
            animate={{
              y: [0, -30, 0],
              opacity: [0.2, 0.5, 0.2],
            }}
            transition={{
              duration: 4 + i * 1.5,
              repeat: Infinity,
              delay: i * 0.8,
              ease: 'easeInOut',
            }}
            className="absolute w-1 h-1 rounded-full bg-brand-400"
            style={{
              left: `${15 + i * 15}%`,
              top: `${20 + (i % 3) * 25}%`,
            }}
          />
        ))}
      </div>

      {/* Left panel - branding (desktop) */}
      <div className="hidden lg:flex lg:w-1/2 relative items-center justify-center p-12">
        <motion.div
          initial={{ opacity: 0, x: -40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="max-w-lg"
        >
          <motion.div
            initial={{ scale: 0, rotate: -20 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ delay: 0.3, type: 'spring', stiffness: 200, damping: 15 }}
            className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600
                       flex items-center justify-center mb-8 shadow-2xl shadow-brand-500/30"
          >
            <Zap size={32} className="text-white" />
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="text-5xl font-extrabold font-display text-white leading-tight mb-4"
          >
            Nexo<span className="text-brand-400">Fitness</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="text-xl text-surface-400 leading-relaxed mb-8"
          >
            La plataforma SaaS más completa para gestionar tu gimnasio.
            Clases, reservas, pagos, marketing y más — todo en un solo lugar.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7 }}
            className="flex gap-6"
          >
            {[
              { num: '500+', label: 'Gimnasios' },
              { num: '50k+', label: 'Miembros' },
              { num: '99.9%', label: 'Uptime' },
            ].map((stat, i) => (
              <div key={i}>
                <p className="text-2xl font-bold font-display text-white">{stat.num}</p>
                <p className="text-sm text-surface-500">{stat.label}</p>
              </div>
            ))}
          </motion.div>
        </motion.div>
      </div>

      {/* Right panel - login form */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12 relative">
        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="w-full max-w-md"
        >
          {/* Mobile brand */}
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-400 to-brand-600
                            flex items-center justify-center shadow-lg shadow-brand-500/30">
              <Zap size={20} className="text-white" />
            </div>
            <h1 className="text-2xl font-bold font-display text-white">
              Nexo<span className="text-brand-400">Fitness</span>
            </h1>
          </div>

          <div className="bg-white/5 backdrop-blur-2xl border border-white/10 rounded-3xl p-8 shadow-2xl">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
            >
              <h2 className="text-2xl font-bold font-display text-white mb-1">
                Bienvenido
              </h2>
              <p className="text-surface-400 text-sm mb-8">Ingresa a tu cuenta para continuar</p>
            </motion.div>

            {purchaseMessage && (
              <div
                className={cn(
                  'mb-5 rounded-xl border px-4 py-3 text-sm',
                  purchaseMessage.tone === 'emerald'
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                )}
              >
                {purchaseMessage.text}
              </div>
            )}

            {billingMessage && (
              <div
                className={cn(
                  'mb-5 rounded-xl border px-4 py-3 text-sm',
                  billingMessage.tone === 'emerald'
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                )}
              >
                {billingMessage.text}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 }}
              >
                <label className="block text-sm font-medium text-surface-300 mb-2">Correo electrónico</label>
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
              </motion.div>

              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.5 }}
              >
                <label className="block text-sm font-medium text-surface-300 mb-2">Contraseña</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-3 pr-12 rounded-xl bg-white/5 border border-white/10
                               text-white placeholder:text-surface-500
                               focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500/50
                               transition-all duration-200"
                    placeholder="••••••••"
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
              </motion.div>

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm"
                >
                  {error}
                </motion.div>
              )}

              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" className="w-4 h-4 rounded border-white/20 bg-white/5 text-brand-500
                                                    focus:ring-brand-500/50 focus:ring-offset-0" />
                  <span className="text-sm text-surface-400">Recordarme</span>
                </label>
                <Link
                  to="/forgot-password"
                  className="text-sm text-brand-400 hover:text-brand-300 transition-colors"
                >
                  ¿Olvidaste tu contraseña?
                </Link>
              </div>

              <motion.button
                type="submit"
                disabled={loading}
                whileHover={{ scale: loading ? 1 : 1.01 }}
                whileTap={{ scale: loading ? 1 : 0.98 }}
                className={cn(
                  'w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-semibold',
                  'bg-gradient-to-r from-brand-500 to-brand-600 text-white',
                  'shadow-xl shadow-brand-500/25 hover:shadow-brand-500/40',
                  'transition-all duration-300',
                  loading && 'opacity-80 cursor-not-allowed'
                )}
              >
                {loading ? (
                  <Loader2 size={20} className="animate-spin" />
                ) : (
                  <>
                    Iniciar Sesión
                    <ArrowRight size={18} />
                  </>
                )}
              </motion.button>
            </form>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.8 }}
              className="mt-6 text-center"
            >
              <p className="text-sm text-surface-500">
                ¿No tienes cuenta?{' '}
                <a href="/register" className="text-brand-400 hover:text-brand-300 font-medium transition-colors">
                  Registra tu gimnasio
                </a>
              </p>
            </motion.div>
          </div>

          {/* Demo credentials */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1 }}
            className="mt-4 p-3 rounded-xl bg-brand-500/10 border border-brand-500/20 text-center"
          >
            <p className="text-xs text-brand-300">
              Demo: <span className="font-mono">owner@nexogym.cl</span> / <span className="font-mono">Owner123!</span>
            </p>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
