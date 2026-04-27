import { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Eye, EyeOff, ArrowRight, Loader2 } from 'lucide-react';
import NexoBrand, { NEXO_BRAND_VALUE_PROP } from '@/components/branding/NexoBrand';
import { useAuthStore } from '@/stores/authStore';
import { authApi, billingApi } from '@/services/api';
import { cn, getDefaultRouteForRole } from '@/utils';
import { buildAdminUrl, buildAppUrl, getCurrentHostKind } from '@/utils/hosts';

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
  const [showCreatorInfo, setShowCreatorInfo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const hostKind = useMemo(() => getCurrentHostKind(), []);

  // Si el usuario ya tiene sesión activa y vuelve de un pago exitoso,
  // verificar acceso y redirigir al dashboard sin pedir credenciales.
  useEffect(() => {
    if (billingState === 'success' && user && accessToken) {
      setLoading(true);
      billingApi.getStatus()
        .then(({ data }) => {
          if (data.allow_access) {
            const path = getDefaultRouteForRole(user.role);
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
        text: 'El pago no se completó. Puedes intentarlo otra vez cuando quieras.',
      };
    }
    return null;
  }, [billingState]);

  const purchaseMessage = useMemo(() => {
    if (purchaseState === 'success') {
      return {
        tone: 'emerald',
        text: 'Compra recibida correctamente. Inicia sesión con tu correo para continuar.',
      };
    }
    if (purchaseState === 'cancelled') {
      return {
        tone: 'amber',
        text: 'La compra no se completó o fue rechazada. Puedes iniciar sesión e intentarlo otra vez.',
      };
    }
    return null;
  }, [purchaseState]);

  const hostMessage = useMemo(() => {
    const requestedHost = searchParams.get('host');
    if (hostKind === 'admin') {
      return {
        tone: 'sky',
        text: 'Este acceso está reservado para superadministración de la plataforma SaaS.',
      };
    }
    if (requestedHost === 'app') {
      return {
        tone: 'sky',
        text: 'Tu cuenta vive en app.nexofitness.cl. Ingresa ahí para seguir con tu panel o app de miembro.',
      };
    }
    if (requestedHost === 'admin') {
      return {
        tone: 'sky',
        text: 'Tu cuenta superadmin vive en admin.nexofitness.cl. Inicia sesión ahí para continuar.',
      };
    }
    return null;
  }, [hostKind, searchParams]);

  const resolvePostLoginPath = (role: string) => {
    return getDefaultRouteForRole(role as Parameters<typeof getDefaultRouteForRole>[0]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { data } = await authApi.login(email, password);
      const resolvedEmail = data.user.email || email;

      if (hostKind === 'admin' && data.user.role !== 'superadmin') {
        const params = new URLSearchParams({ email: resolvedEmail, host: 'app' });
        window.location.assign(buildAppUrl(`/login?${params.toString()}`));
        return;
      }

      if (hostKind === 'app' && data.user.role === 'superadmin') {
        const params = new URLSearchParams({ email: resolvedEmail, host: 'admin' });
        window.location.assign(buildAdminUrl(`/login?${params.toString()}`));
        return;
      }

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
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="mb-4"
          >
            <NexoBrand
              iconSize={64}
              iconClassName="shadow-2xl shadow-brand-500/30"
              titleClassName="text-5xl font-extrabold leading-tight"
              accentClassName="text-brand-400"
            />
          </motion.div>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="text-xl text-surface-400 leading-relaxed mb-8"
          >
            {NEXO_BRAND_VALUE_PROP}
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
              { num: '99.9%', label: 'Disponibilidad' },
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
      <div className="relative flex-1 items-center justify-center p-4 pb-24 sm:flex sm:p-6 sm:pb-24 lg:p-12 lg:pb-24">
        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="w-full max-w-md"
        >
          {/* Mobile brand */}
          <div className="mb-6 px-1 pt-3 sm:mb-8 sm:pt-0 lg:hidden">
            <NexoBrand
              iconSize={40}
              iconClassName="shadow-lg shadow-brand-500/25"
              titleClassName="text-2xl leading-none"
              accentClassName="text-brand-400"
              subtitle="Accede a tu cuenta desde cualquier dispositivo."
              subtitleClassName="mt-1 normal-case tracking-normal text-sm text-surface-400"
            />
          </div>

          <div className="rounded-[1.75rem] border border-white/10 bg-white/5 p-5 shadow-2xl backdrop-blur-2xl sm:rounded-3xl sm:p-8">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="mb-6 space-y-2 sm:mb-8"
            >
              <h2 className="text-2xl font-bold font-display leading-tight text-white">
                {hostKind === 'admin' ? 'Acceso superadmin' : 'Bienvenido/a'}
              </h2>
              <p className="max-w-sm text-sm leading-6 text-surface-400">
                {hostKind === 'admin'
                  ? 'Entra aquí para administrar cuentas SaaS, planes y leads de plataforma.'
                  : 'Ingresa a tu cuenta para continuar.'}
              </p>
            </motion.div>

            {purchaseMessage || billingMessage || hostMessage ? (
              <div className="mb-5 space-y-3 sm:mb-6">
                {hostMessage && (
                  <div
                    className={cn(
                      'rounded-xl border px-4 py-3 text-sm leading-6',
                      'border-sky-500/30 bg-sky-500/10 text-sky-200'
                    )}
                  >
                    {hostMessage.text}
                  </div>
                )}
                {purchaseMessage && (
                  <div
                    className={cn(
                      'rounded-xl border px-4 py-3 text-sm leading-6',
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
                      'rounded-xl border px-4 py-3 text-sm leading-6',
                      billingMessage.tone === 'emerald'
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                        : 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                    )}
                  >
                    {billingMessage.text}
                  </div>
                )}
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 }}
              >
                <label className="mb-2 block text-sm font-medium text-surface-300">Correo electrónico</label>
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
                <label className="mb-2 block text-sm font-medium text-surface-300">Contraseña</label>
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
                  className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm leading-6 text-red-400"
                >
                  {error}
                </motion.div>
              )}

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
                  'flex w-full items-center justify-center gap-2 rounded-xl py-3.5 font-semibold',
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
              className="mt-6 border-t border-white/10 pt-5 text-center sm:mt-7"
            >
              <p className="text-sm leading-6 text-surface-500">
                {hostKind === 'admin' ? '¿Necesitas crear una cuenta de gimnasio?' : '¿No tienes cuenta?'}
              </p>
              <p className="mt-1 text-sm leading-6">
                <a href={buildAppUrl('/register')} className="font-medium text-brand-400 transition-colors hover:text-brand-300">
                  {hostKind === 'admin' ? 'Hazlo desde app.nexofitness.cl' : 'Registra tu gimnasio'}
                </a>
              </p>
            </motion.div>
          </div>
        </motion.div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-5 z-20 flex justify-center px-4">
        <div className="pointer-events-auto relative flex flex-col items-center">
          <AnimatePresence>
            {showCreatorInfo ? (
              <motion.div
                initial={{ opacity: 0, y: 12, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.97 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="mb-3 w-[min(92vw,22rem)] origin-bottom rounded-3xl border border-white/10 bg-surface-950/88 px-5 py-4 text-center shadow-2xl shadow-black/35 backdrop-blur-2xl"
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-surface-500">
                  Desarrollado por
                </p>
                <p className="mt-2 text-sm font-semibold text-surface-100">
                  <a
                    href="https://nexosoftware.cl/"
                    target="_blank"
                    rel="noreferrer"
                    className="transition-colors hover:text-brand-300"
                  >
                    Nexo Software SpA
                  </a>
                </p>
                <div className="mt-3 space-y-1.5 text-sm text-surface-300">
                  <p>
                    <a href="mailto:contacto@nexofitness.cl" className="transition-colors hover:text-brand-300">
                      contacto@nexofitness.cl
                    </a>
                  </p>
                  <p>
                    <a href="https://wa.me/56981964119" target="_blank" rel="noreferrer" className="transition-colors hover:text-brand-300">
                      WhatsApp +56 981 964 119
                    </a>
                  </p>
                </div>
                <p className="mt-4 text-[11px] uppercase tracking-[0.16em] text-surface-500">
                  Todos los derechos reservados
                </p>
              </motion.div>
            ) : null}
          </AnimatePresence>

          <motion.button
            type="button"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.95 }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowCreatorInfo((current) => !current)}
            className="rounded-full border border-white/12 bg-white/[0.06] px-5 py-2.5 text-sm font-semibold tracking-[0.06em] text-surface-200 shadow-lg shadow-black/20 backdrop-blur-xl transition-colors hover:border-white/20 hover:bg-white/[0.1]"
            aria-expanded={showCreatorInfo}
          >
            Desarrollado por Nexo Software SpA
          </motion.button>
        </div>
      </div>
    </div>
  );
}
