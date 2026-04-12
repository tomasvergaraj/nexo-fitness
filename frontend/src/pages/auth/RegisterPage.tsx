import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { ArrowLeft, ArrowRight, Check, Loader2, Mail, ShieldCheck } from 'lucide-react';
import { NexoBrandIcon } from '@/components/branding/NexoBrand';
import { authApi, billingApi } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import type { SaaSPlan } from '@/types';
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

// Verification step: 'email' → send code, 'code' → enter OTP, 'done' → verified
type VerifyStep = 'email' | 'code' | 'done';

export default function RegisterPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);
  const [form, setForm] = useState(initialForm);
  const [plans, setPlans] = useState<SaaSPlan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<SaaSPlan['key']>('monthly');
  const [plansLoading, setPlansLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Email verification state
  const [verifyStep, setVerifyStep] = useState<VerifyStep>('email');
  const [verifyEmail, setVerifyEmail] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [verifyLoading, setVerifyLoading] = useState(false);
  const codeInputRef = useRef<HTMLInputElement>(null);

  const updateField = (key: keyof typeof initialForm, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  useEffect(() => {
    let active = true;

    const loadPlans = async () => {
      try {
        const response = await billingApi.listPublicPlans();
        if (!active) {
          return;
        }

        const nextPlans = response.data as SaaSPlan[];
        setPlans(nextPlans);
        if (nextPlans.length > 0) {
          setSelectedPlan(nextPlans[0].key);
          setForm((current) => ({ ...current, license_type: nextPlans[0].license_type }));
        }
      } catch {
        if (active) {
          toast.error('No pudimos cargar los planes SaaS. Puedes intentar de nuevo en unos segundos.');
        }
      } finally {
        if (active) {
          setPlansLoading(false);
        }
      }
    };

    loadPlans();
    return () => {
      active = false;
    };
  }, []);

  const activePlan = plans.find((plan) => plan.key === selectedPlan);

  const formatPrice = (plan: SaaSPlan) =>
    new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: plan.currency,
      maximumFractionDigits: 0,
    }).format(plan.price);

  const handleSendCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!verifyEmail) return;
    setVerifyLoading(true);
    setError('');
    try {
      const res = await authApi.sendEmailVerification(verifyEmail);
      const data = res.data as { exists?: boolean; sent?: boolean };
      if (data.exists) {
        // Email already registered — redirect to login
        toast('Este correo ya tiene una cuenta. Inicia sesión.', { icon: '⚠️' });
        navigate(`/login?email=${encodeURIComponent(verifyEmail)}`);
        return;
      }
      // Pre-fill owner_email so the form is ready
      updateField('owner_email', verifyEmail);
      setVerifyStep('code');
      setTimeout(() => codeInputRef.current?.focus(), 100);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo enviar el código. Inténtalo de nuevo.');
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleConfirmCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!verifyCode) return;
    setVerifyLoading(true);
    setError('');
    try {
      const res = await authApi.confirmEmailVerification(verifyEmail, verifyCode);
      const data = res.data as { verified_token: string };
      setVerifyToken(data.verified_token);
      setVerifyStep('done');
      toast.success('Correo verificado. Completa el registro.');
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Código incorrecto. Inténtalo de nuevo.');
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!activePlan) {
      setError('Selecciona un plan para continuar');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await billingApi.signup({
        ...form,
        license_type: activePlan.license_type,
        plan_key: activePlan.key,
        verification_token: verifyToken || undefined,
      });
      const data = response.data;

      setAuth(data.user, data.access_token, data.refresh_token);

      // Fintoc y Stripe usan redirect_to_checkout — llevar al checkout hosted
      if (data.next_action === 'redirect_to_checkout' && data.checkout_url) {
        window.location.href = data.checkout_url;
        return;
      }

      toast.success(data.message || 'Cuenta creada con la prueba activa.');
      navigate('/dashboard');
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'No se pudo registrar el gimnasio');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-surface-950 px-4 py-8 sm:px-6 lg:px-10">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-5rem] top-[-4rem] h-72 w-72 rounded-full bg-brand-500/20 blur-3xl" />
        <div className="absolute bottom-[-7rem] right-[-4rem] h-80 w-80 rounded-full bg-amber-500/10 blur-3xl" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      </div>

      <div className="relative z-10 mx-auto max-w-7xl">
        <button
          type="button"
          onClick={() => navigate('/login')}
          className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-surface-300 transition-colors hover:bg-white/10"
        >
          <ArrowLeft size={16} />
          Volver al inicio de sesión
        </button>

        <div className="grid gap-8 xl:grid-cols-[0.92fr_1.08fr]">
          <motion.div
            initial={{ opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            className="space-y-6 xl:sticky xl:top-8 xl:self-start"
          >
            <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-brand-500 via-cyan-500 to-sky-700 p-8 text-white shadow-2xl shadow-brand-500/20">
              <div className="flex items-center justify-between gap-4">
                <div className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/80">
                  Registro SaaS
                </div>
                <NexoBrandIcon size={56} className="shadow-2xl shadow-surface-950/25" />
              </div>

              <h1 className="mt-8 max-w-lg text-4xl font-bold font-display leading-tight">
                Registra tu gimnasio con una estructura mucho más clara
              </h1>
              <p className="mt-4 max-w-xl text-sm leading-6 text-white/82">
                Primero eliges el plan, después completas los datos del gimnasio y del propietario. Todo queda listo para activar la prueba o pasar directo al pago online.
              </p>

              <div className="mt-8 grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
                {[
                  { label: 'Setup inicial', value: '5 min' },
                  { label: 'Propietario creado', value: 'Automático' },
                  { label: 'Prueba', value: `${activePlan?.trial_days ?? 14} días` },
                ].map((item) => (
                  <div key={item.label} className="rounded-2xl bg-white/12 px-4 py-4 backdrop-blur-sm">
                    <p className="text-xs uppercase tracking-[0.2em] text-white/55">{item.label}</p>
                    <p className="mt-2 text-lg font-semibold">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur-2xl">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-white">Plan SaaS</p>
                  <p className="mt-1 text-sm text-surface-400">Elige el paquete antes de completar el onboarding.</p>
                </div>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-surface-400">
                  {plansLoading ? 'Cargando' : activePlan?.checkout_enabled ? 'Pago online' : 'Prueba'}
                </span>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                {plans.map((plan) => {
                  const isSelected = plan.key === selectedPlan;
                  return (
                    <button
                      key={plan.key}
                      type="button"
                      onClick={() => {
                        setSelectedPlan(plan.key);
                        updateField('license_type', plan.license_type);
                      }}
                      className={cn(
                        'rounded-[1.5rem] border px-5 py-5 text-left transition-all',
                        isSelected
                          ? 'border-brand-400 bg-brand-500/15 shadow-lg shadow-brand-500/10'
                          : 'border-white/10 bg-black/10 hover:border-white/20 hover:bg-white/[0.07]',
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-white">{plan.name}</p>
                          <p className="mt-1 text-xs leading-5 text-surface-400">{plan.description}</p>
                        </div>
                        {plan.highlighted ? (
                          <span className="rounded-full bg-brand-500/20 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-100">
                            Recomendado
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-5 flex items-end justify-between gap-4">
                        <div>
                          <p className="text-3xl font-bold text-white">{formatPrice(plan)}</p>
                          <p className="mt-1 text-xs uppercase tracking-[0.18em] text-surface-500">
                            por {plan.billing_interval === 'year' ? 'año' : 'mes'}
                          </p>
                        </div>
                        <div className="text-right text-xs text-surface-400">
                          <p>{plan.trial_days} días de prueba</p>
                          <p>{plan.max_members} miembros</p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {activePlan ? (
              <div className="rounded-[2rem] border border-white/10 bg-black/20 p-6 shadow-2xl shadow-black/20 backdrop-blur-xl">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-white">Resumen de {activePlan.name}</p>
                    <p className="mt-1 max-w-lg text-sm leading-6 text-surface-400">
                      {activePlan.checkout_enabled
                        ? 'El propietario entra al panel y puede continuar el pago online de inmediato.'
                        : 'El gimnasio parte con una prueba activa y el cobro online quedará listo cuando completes la configuración.'}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-right">
                    <p className="text-xs uppercase tracking-[0.18em] text-surface-500">Total</p>
                    <p className="text-xl font-semibold text-white">{formatPrice(activePlan)}</p>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {activePlan.features.map((feature) => (
                    <div key={feature} className="flex items-center gap-2 rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-3 text-sm text-surface-300">
                      <Check size={16} className="shrink-0 text-brand-300" />
                      <span>{feature}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-surface-500">Capacidad</p>
                    <p className="mt-2 text-sm text-white">{activePlan.max_members} miembros y {activePlan.max_branches} sedes</p>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-surface-500">Activación</p>
                    <p className="mt-2 text-sm text-white">
                      {activePlan.checkout_enabled ? 'Pago online inmediato disponible' : 'Prueba primero, cobro después'}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
          </motion.div>

          {/* ── Step 0 & 1: Email verification ─────────────────────── */}
          {verifyStep !== 'done' ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-start justify-center pt-8"
            >
              <div className="w-full max-w-md space-y-6">
                <div className="rounded-[2rem] border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur-2xl">
                  <div className="flex flex-col items-center gap-3 text-center">
                    {verifyStep === 'email' ? (
                      <Mail size={36} className="text-brand-300" />
                    ) : (
                      <ShieldCheck size={36} className="text-brand-300" />
                    )}
                    <h2 className="text-2xl font-bold font-display text-white">
                      {verifyStep === 'email' ? 'Verifica tu correo' : 'Ingresa el código'}
                    </h2>
                    <p className="text-sm text-surface-400">
                      {verifyStep === 'email'
                        ? 'Escribe el correo del propietario. Te enviaremos un código de 6 dígitos para confirmarlo.'
                        : `Enviamos un código a ${verifyEmail}. Tienes 10 minutos para usarlo.`}
                    </p>
                  </div>

                  {verifyStep === 'email' ? (
                    <form onSubmit={handleSendCode} className="mt-6 space-y-4">
                      <div>
                        <label className="mb-2 block text-sm font-medium text-surface-300">Correo del propietario</label>
                        <input
                          type="email"
                          className="input bg-white/5 text-white"
                          value={verifyEmail}
                          onChange={(e) => setVerifyEmail(e.target.value)}
                          placeholder="propietario@ejemplo.com"
                          required
                          autoFocus
                        />
                      </div>
                      {error ? (
                        <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
                      ) : null}
                      <button
                        type="submit"
                        disabled={verifyLoading}
                        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-brand-500 to-brand-600 px-6 py-3 font-semibold text-white shadow-xl shadow-brand-500/25 disabled:cursor-not-allowed disabled:opacity-80"
                      >
                        {verifyLoading ? <Loader2 size={18} className="animate-spin" /> : <>Enviar código <ArrowRight size={16} /></>}
                      </button>
                    </form>
                  ) : (
                    <form onSubmit={handleConfirmCode} className="mt-6 space-y-4">
                      <div>
                        <label className="mb-2 block text-sm font-medium text-surface-300">Código de 6 dígitos</label>
                        <input
                          ref={codeInputRef}
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]{6}"
                          maxLength={6}
                          className="input bg-white/5 text-center text-2xl font-mono tracking-[0.4em] text-white"
                          value={verifyCode}
                          onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          placeholder="······"
                          required
                        />
                      </div>
                      {error ? (
                        <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
                      ) : null}
                      <button
                        type="submit"
                        disabled={verifyLoading || verifyCode.length !== 6}
                        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-brand-500 to-brand-600 px-6 py-3 font-semibold text-white shadow-xl shadow-brand-500/25 disabled:cursor-not-allowed disabled:opacity-80"
                      >
                        {verifyLoading ? <Loader2 size={18} className="animate-spin" /> : <>Verificar <Check size={16} /></>}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setVerifyStep('email'); setVerifyCode(''); setError(''); }}
                        className="w-full text-center text-sm text-surface-400 hover:text-surface-200"
                      >
                        Cambiar correo o reenviar código
                      </button>
                    </form>
                  )}
                </div>
              </div>
            </motion.div>
          ) : (
          <motion.form
            onSubmit={handleSubmit}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="rounded-[2rem] border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur-2xl">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-3xl font-bold font-display text-white">Alta del gimnasio</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-surface-400">
                    Completa los datos operativos en un bloque y los del propietario en otro. Así el formulario respira mejor y cada paso se entiende de inmediato.
                  </p>
                </div>
                <div className="grid gap-2 text-right text-xs text-surface-400">
                  <span className="rounded-full border border-white/10 bg-black/10 px-3 py-1 uppercase tracking-[0.18em]">
                    {activePlan?.trial_days ?? 14} días de prueba
                  </span>
                  <span className="rounded-full border border-white/10 bg-black/10 px-3 py-1 uppercase tracking-[0.18em]">
                    {activePlan?.checkout_enabled ? 'Cobro online listo' : 'Cobro online opcional'}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid gap-6 2xl:grid-cols-[1.05fr_0.95fr]">
              <section className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur-2xl">
                <div className="mb-6 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-brand-300">Gimnasio</p>
                    <h3 className="mt-2 text-2xl font-bold font-display text-white">Datos del negocio</h3>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/10 px-3 py-2 text-xs text-surface-400">
                    Cuenta + sucursal principal
                  </div>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="mb-2 block text-sm font-medium text-surface-300">Nombre del gimnasio</label>
                    <input className="input bg-white/5 text-white" value={form.gym_name} onChange={(event) => updateField('gym_name', event.target.value)} required />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-2 block text-sm font-medium text-surface-300">Slug</label>
                    <input className="input bg-white/5 text-white" value={form.slug} onChange={(event) => updateField('slug', event.target.value.toLowerCase().replace(/\s+/g, '-'))} required />
                    <p className="mt-2 text-xs text-surface-500">Se usa en la URL interna de la cuenta. Conviene corto, claro y sin espacios.</p>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-2 block text-sm font-medium text-surface-300">Email del gimnasio</label>
                    <input type="email" className="input bg-white/5 text-white" value={form.email} onChange={(event) => updateField('email', event.target.value)} required />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-surface-300">Ciudad</label>
                    <input className="input bg-white/5 text-white" value={form.city} onChange={(event) => updateField('city', event.target.value)} />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-surface-300">País</label>
                    <input className="input bg-white/5 text-white" value={form.country} onChange={(event) => updateField('country', event.target.value)} />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-surface-300">Zona horaria</label>
                    <input className="input bg-white/5 text-white" value={form.timezone} onChange={(event) => updateField('timezone', event.target.value)} />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-surface-300">Moneda</label>
                    <input className="input bg-white/5 text-white" value={form.currency} onChange={(event) => updateField('currency', event.target.value)} />
                  </div>
                </div>
              </section>

              <section className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur-2xl">
                <div className="mb-6 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-300">Propietario</p>
                    <h3 className="mt-2 text-2xl font-bold font-display text-white">Cuenta principal</h3>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/10 px-3 py-2 text-xs text-surface-400">
                    Acceso inicial del cliente
                  </div>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-surface-300">Nombre del propietario</label>
                    <input className="input bg-white/5 text-white" value={form.owner_first_name} onChange={(event) => updateField('owner_first_name', event.target.value)} required />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-surface-300">Apellido del propietario</label>
                    <input className="input bg-white/5 text-white" value={form.owner_last_name} onChange={(event) => updateField('owner_last_name', event.target.value)} required />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-2 block text-sm font-medium text-surface-300">
                      Email del propietario
                      {verifyStep === 'done' ? (
                        <span className="ml-2 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-brand-300">
                          <Check size={12} /> Verificado
                        </span>
                      ) : null}
                    </label>
                    <input
                      type="email"
                      className="input bg-white/5 text-white read-only:opacity-70"
                      value={form.owner_email}
                      onChange={(event) => updateField('owner_email', event.target.value)}
                      readOnly={verifyStep === 'done'}
                      required
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-2 block text-sm font-medium text-surface-300">Contraseña del propietario</label>
                    <input type="password" className="input bg-white/5 text-white" value={form.owner_password} onChange={(event) => updateField('owner_password', event.target.value)} required />
                    <p className="mt-2 text-xs text-surface-500">Este usuario queda listo para entrar al panel apenas se cree la cuenta.</p>
                  </div>
                </div>

                <div className="mt-6 rounded-[1.5rem] border border-white/10 bg-black/10 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-surface-500">Lo que ocurre al enviar</p>
                  <div className="mt-3 space-y-3 text-sm text-surface-300">
                    <div className="flex items-center gap-2">
                      <Check size={16} className="text-brand-300" />
                      <span>Se crea la cuenta y la sede principal.</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Check size={16} className="text-brand-300" />
                      <span>Se genera el propietario con acceso inmediato.</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Check size={16} className="text-brand-300" />
                      <span>Se activa la prueba o el pago online según el plan elegido.</span>
                    </div>
                  </div>
                </div>
              </section>
            </div>

            {error ? (
              <div className="rounded-[1.5rem] border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            ) : null}

            <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur-2xl">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">Listo para crear el gimnasio</p>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-surface-400">
                    El registro deja al propietario autenticado y lo redirige al panel o al pago, según la configuración del plan.
                  </p>
                </div>

                <motion.button
                  type="submit"
                  disabled={loading || plansLoading || !activePlan}
                  whileHover={{ scale: loading || plansLoading || !activePlan ? 1 : 1.01 }}
                  whileTap={{ scale: loading || plansLoading || !activePlan ? 1 : 0.98 }}
                  className={cn(
                    'flex min-w-[280px] items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-brand-500 to-brand-600 px-6 py-4 font-semibold text-white shadow-xl shadow-brand-500/25',
                    (loading || plansLoading || !activePlan) && 'cursor-not-allowed opacity-80',
                  )}
                >
                  {loading || plansLoading ? (
                    <Loader2 size={20} className="animate-spin" />
                  ) : (
                    <>
                      {activePlan?.checkout_enabled ? 'Crear gimnasio e ir a pagar' : 'Crear gimnasio y activar prueba'}
                      <ArrowRight size={18} />
                    </>
                  )}
                </motion.button>

                <p className="mt-3 text-center text-xs text-surface-400">
                  Al registrarte, aceptas nuestros{' '}
                  <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline hover:text-surface-600">
                    Términos y Condiciones
                  </a>{' '}
                  y nuestra{' '}
                  <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-surface-600">
                    Política de Privacidad
                  </a>
                  .
                </p>
              </div>
            </div>
          </motion.form>
          )}
        </div>
      </div>
    </div>
  );
}
