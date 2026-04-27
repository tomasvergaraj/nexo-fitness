import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  ArrowLeft, ArrowRight, Check, ChevronDown, Eye, EyeOff,
  Loader2, Mail, ShieldCheck,
} from 'lucide-react';
import { NexoBrandIcon } from '@/components/branding/NexoBrand';
import Modal from '@/components/ui/Modal';
import { authApi, billingApi } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import type { SaaSPlan } from '@/types';
import { cn } from '@/utils';
import { buildAppUrl, getCurrentHostKind } from '@/utils/hosts';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 50);
}

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function intervalLabel(interval: SaaSPlan['billing_interval']): string {
  if (interval === 'year') return 'año';
  if (interval === 'quarter') return 'trimestre';
  if (interval === 'semi_annual') return 'semestre';
  return 'mes';
}

// ─── Step indicator ───────────────────────────────────────────────────────────

const STEP_LABELS = ['Plan', 'Correo', 'Datos'] as const;

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="mb-8 flex items-start justify-center">
      {STEP_LABELS.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        const active = n === current;
        return (
          <div key={label} className="flex items-center">
            <div className="flex flex-col items-center gap-1.5">
              <div className={cn(
                'flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-bold transition-all duration-300',
                done
                  ? 'border-brand-500 bg-brand-500 text-white'
                  : active
                  ? 'border-brand-400 bg-brand-500/15 text-brand-300'
                  : 'border-white/15 bg-transparent text-surface-600',
              )}>
                {done ? <Check size={13} /> : n}
              </div>
              <span className={cn(
                'text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors duration-300',
                active ? 'text-brand-300' : done ? 'text-surface-400' : 'text-surface-600',
              )}>
                {label}
              </span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div className={cn(
                'mx-3 mb-5 h-px w-12 shrink-0 transition-colors duration-500',
                done ? 'bg-brand-500' : 'bg-white/12',
              )} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Plan option card ─────────────────────────────────────────────────────────

function PlanOptionCard({
  plan,
  selected,
  onSelect,
}: {
  plan: SaaSPlan;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'relative w-full rounded-2xl border p-5 text-left transition-all duration-200',
        selected
          ? 'border-brand-400 bg-brand-500/15 shadow-lg shadow-brand-500/10'
          : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/[0.08]',
      )}
    >
      {plan.highlighted && (
        <span className="absolute -top-2.5 left-4 rounded-full bg-brand-500 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow">
          Recomendado
        </span>
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-white">{plan.name}</p>
          {plan.description && (
            <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-surface-400">{plan.description}</p>
          )}
        </div>
        <div className={cn(
          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all',
          selected ? 'border-brand-400 bg-brand-500' : 'border-white/25',
        )}>
          {selected && <Check size={11} className="text-white" />}
        </div>
      </div>

      <div className="mt-4 flex items-end justify-between gap-4">
        <div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-bold text-white">
              {formatMoney(Number(plan.price), plan.currency)}
            </span>
            {plan.discount_pct && Number(plan.discount_pct) > 0 && (
              <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                -{plan.discount_pct}%
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-surface-500">
            neto · por {intervalLabel(plan.billing_interval)}
          </p>
          {Number(plan.tax_rate) > 0 && (
            <p className="mt-0.5 text-xs text-surface-500">
              + IVA {formatMoney(Number(plan.tax_amount), plan.currency)}
              {' → '}
              <span className="text-surface-400">Total {formatMoney(Number(plan.total_price), plan.currency)}</span>
            </p>
          )}
        </div>
        {plan.trial_days > 0 && (
          <div className="shrink-0 rounded-xl bg-emerald-500/15 px-3 py-2 text-center">
            <p className="text-xs font-bold text-emerald-300">{plan.trial_days} días</p>
            <p className="text-[10px] text-emerald-500">gratis</p>
          </div>
        )}
      </div>
    </button>
  );
}

// ─── Form field ───────────────────────────────────────────────────────────────

function Field({
  label,
  children,
  hint,
  required: isRequired,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-surface-300">
        {label}
        {isRequired && <span className="ml-1 text-brand-400">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-surface-500">{hint}</p>}
    </div>
  );
}

// ─── Password input ───────────────────────────────────────────────────────────

function PasswordInput({
  value,
  onChange,
  placeholder,
  className,
  required: isRequired,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  required?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? '••••••••'}
        required={isRequired}
        className={cn('input bg-white/5 pr-10 text-white', className)}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-surface-500 hover:text-surface-300"
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

// ─── Slide animation variants ─────────────────────────────────────────────────

const slideVariants = {
  enter: (dir: number) => ({ x: dir * 36, opacity: 0 }),
  center: {
    x: 0,
    opacity: 1,
    transition: { duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
  exit: (dir: number) => ({
    x: dir * -36,
    opacity: 0,
    transition: { duration: 0.2, ease: 'easeIn' as const },
  }),
};

// ─── Initial form state ───────────────────────────────────────────────────────

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
  owner_password_confirm: '',
};

type VerifyStep = 'email' | 'code' | 'done';

// ─── Page component ───────────────────────────────────────────────────────────

export default function RegisterPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);
  const hostKind = getCurrentHostKind();

  // Wizard
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [direction, setDirection] = useState<number>(1);

  // Form
  const [form, setForm] = useState(initialForm);
  const [slugEdited, setSlugEdited] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Plans
  const [plans, setPlans] = useState<SaaSPlan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<string>('');
  const [plansLoading, setPlansLoading] = useState(true);

  // Submit
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Legal modals
  const [legalModal, setLegalModal] = useState<'terms' | 'privacy' | null>(null);

  // Email verification
  const [verifyStep, setVerifyStep] = useState<VerifyStep>('email');
  const [verifyEmail, setVerifyEmail] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [verifyLoading, setVerifyLoading] = useState(false);
  const codeInputRef = useRef<HTMLInputElement>(null);
  const gymNameRef = useRef<HTMLInputElement>(null);

  const updateField = (key: keyof typeof initialForm, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  useEffect(() => {
    if (hostKind === 'admin') {
      window.location.replace(buildAppUrl('/register'));
    }
  }, [hostKind]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await billingApi.listPublicPlans();
        if (!active) return;
        const nextPlans = res.data as SaaSPlan[];
        setPlans(nextPlans);
        if (nextPlans.length > 0) {
          const highlighted = nextPlans.find((p) => p.highlighted) ?? nextPlans[0];
          setSelectedPlan(highlighted.key);
          setForm((f) => ({ ...f, license_type: highlighted.license_type }));
        }
      } catch {
        if (active) toast.error('No pudimos cargar los planes. Intenta recargar la página.');
      } finally {
        if (active) setPlansLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  // Auto-generate slug from gym_name while user hasn't manually edited it
  useEffect(() => {
    if (!slugEdited) {
      updateField('slug', generateSlug(form.gym_name));
    }
  }, [form.gym_name, slugEdited]);

  const activePlan = plans.find((p) => p.key === selectedPlan);
  const passwordMismatch = form.owner_password_confirm.length > 0
    && form.owner_password !== form.owner_password_confirm;

  const goTo = (next: 1 | 2 | 3) => {
    setDirection(next > step ? 1 : -1);
    setStep(next);
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifyEmail) return;
    setVerifyLoading(true);
    setError('');
    try {
      const res = await authApi.sendEmailVerification(verifyEmail);
      const data = res.data as { exists?: boolean };
      if (data.exists) {
        toast('Este correo ya tiene una cuenta.', { icon: '⚠️' });
        navigate(`/login?email=${encodeURIComponent(verifyEmail)}`);
        return;
      }
      updateField('owner_email', verifyEmail);
      updateField('email', verifyEmail);
      setVerifyStep('code');
      setTimeout(() => codeInputRef.current?.focus(), 100);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || 'No se pudo enviar el código. Inténtalo de nuevo.');
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleConfirmCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (verifyCode.length !== 6) return;
    setVerifyLoading(true);
    setError('');
    try {
      const res = await authApi.confirmEmailVerification(verifyEmail, verifyCode);
      const data = res.data as { verified_token: string };
      setVerifyToken(data.verified_token);
      setVerifyStep('done');
      toast.success('Correo verificado.');
      goTo(3);
      setTimeout(() => gymNameRef.current?.focus(), 350);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || 'Código incorrecto. Inténtalo de nuevo.');
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activePlan) { setError('No hay plan seleccionado.'); return; }
    if (form.owner_password !== form.owner_password_confirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { owner_password_confirm: _x, ...payload } = form;
      const res = await billingApi.signup({
        ...payload,
        license_type: activePlan.license_type,
        plan_key: activePlan.key,
        verification_token: verifyToken || undefined,
      });
      const data = res.data;
      setAuth(data.user, data.access_token, data.refresh_token);
      if (data.next_action === 'redirect_to_checkout' && data.checkout_url) {
        window.location.href = data.checkout_url;
        return;
      }
      toast.success(data.message || '¡Cuenta creada!');
      navigate('/dashboard');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || 'No se pudo registrar el gimnasio.');
    } finally {
      setLoading(false);
    }
  };

  if (hostKind === 'admin') return null;

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-surface-950">
      {/* Background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-br from-surface-950 via-surface-900 to-brand-950/40" />
        <div className="absolute left-1/4 top-1/4 h-96 w-96 rounded-full bg-brand-500/8 blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/3 h-64 w-64 rounded-full bg-violet-500/6 blur-[100px]" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen max-w-lg flex-col px-4 pb-16 pt-8 sm:px-6 sm:pt-10">
        {/* Brand + login link */}
        <div className="mb-10 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <NexoBrandIcon size={36} className="shadow-lg shadow-brand-500/25" />
            <span className="text-base font-bold tracking-tight text-white">NexoFitness</span>
          </div>
          <Link
            to="/login"
            className="text-sm text-surface-500 transition-colors hover:text-surface-200"
          >
            ¿Ya tienes cuenta?{' '}
            <span className="font-medium text-brand-400 hover:text-brand-300">Inicia sesión</span>
          </Link>
        </div>

        {/* Step indicator */}
        <StepIndicator current={step} />

        {/* Step content */}
        <div className="flex-1">
          <AnimatePresence mode="wait" custom={direction}>

            {/* ── Step 1: Plan selection ─────────────────────────────── */}
            {step === 1 && (
              <motion.div
                key="step-1"
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                className="space-y-3"
              >
                <div className="mb-6">
                  <h1 className="text-2xl font-bold text-white">Elige tu plan</h1>
                  <p className="mt-1.5 text-sm text-surface-400">
                    {activePlan?.trial_days
                      ? `${activePlan.trial_days} días gratis incluidos · sin tarjeta requerida.`
                      : plans.find((p) => p.trial_days > 0)
                        ? 'Algunos planes incluyen período de prueba gratuito.'
                        : 'Puedes cambiar de plan en cualquier momento desde tu panel.'}
                  </p>
                </div>

                {plansLoading ? (
                  <div className="flex items-center justify-center py-20 text-surface-500">
                    <Loader2 size={24} className="animate-spin" />
                  </div>
                ) : plans.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 py-14 text-center text-sm text-surface-500">
                    No hay planes disponibles en este momento.
                  </div>
                ) : (
                  plans.map((plan) => (
                    <PlanOptionCard
                      key={plan.key}
                      plan={plan}
                      selected={plan.key === selectedPlan}
                      onSelect={() => {
                        setSelectedPlan(plan.key);
                        updateField('license_type', plan.license_type);
                      }}
                    />
                  ))
                )}

                <button
                  type="button"
                  onClick={() => activePlan && goTo(2)}
                  disabled={!activePlan || plansLoading}
                  className={cn(
                    'mt-2 flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-3.5 font-semibold text-white shadow-xl transition-all',
                    activePlan && !plansLoading
                      ? 'bg-gradient-to-r from-brand-500 to-brand-600 shadow-brand-500/20 hover:from-brand-400 hover:to-brand-500'
                      : 'cursor-not-allowed bg-surface-800 text-surface-500',
                  )}
                >
                  Continuar
                  <ArrowRight size={16} />
                </button>
              </motion.div>
            )}

            {/* ── Step 2: Email verification ─────────────────────────── */}
            {step === 2 && (
              <motion.div
                key="step-2"
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                className="space-y-4"
              >
                <div className="rounded-[2rem] border border-white/10 bg-white/5 p-7 shadow-2xl backdrop-blur-2xl">

                  {/* Already verified — user came back from step 3 */}
                  {verifyStep === 'done' ? (
                    <div className="space-y-5 text-center">
                      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/20">
                        <Check size={28} className="text-emerald-400" />
                      </div>
                      <div>
                        <h2 className="text-xl font-bold text-white">Correo verificado</h2>
                        <p className="mt-1.5 text-sm text-surface-400">{verifyEmail}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => goTo(3)}
                        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-brand-500 to-brand-600 px-6 py-3.5 font-semibold text-white shadow-xl shadow-brand-500/20"
                      >
                        Continuar <ArrowRight size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setVerifyStep('email');
                          setVerifyCode('');
                          setVerifyToken('');
                          setError('');
                        }}
                        className="w-full text-sm text-surface-500 transition-colors hover:text-surface-300"
                      >
                        Cambiar correo
                      </button>
                    </div>

                  ) : verifyStep === 'email' ? (
                    /* Email input */
                    <form onSubmit={handleSendCode} className="space-y-5">
                      <div className="flex flex-col items-center gap-3 text-center">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500/20">
                          <Mail size={24} className="text-brand-300" />
                        </div>
                        <div>
                          <h2 className="text-xl font-bold text-white">Verifica tu correo</h2>
                          <p className="mt-1.5 text-sm text-surface-400">
                            Te enviamos un código de 6 dígitos para confirmar que eres tú.
                          </p>
                        </div>
                      </div>

                      <Field label="Correo del propietario" required>
                        <input
                          type="email"
                          className="input bg-white/5 text-white"
                          value={verifyEmail}
                          onChange={(e) => setVerifyEmail(e.target.value)}
                          placeholder="tu@gimnasio.com"
                          required
                          autoFocus
                        />
                      </Field>

                      {error && (
                        <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
                          {error}
                        </p>
                      )}

                      <button
                        type="submit"
                        disabled={verifyLoading || !verifyEmail}
                        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-brand-500 to-brand-600 px-6 py-3.5 font-semibold text-white shadow-xl shadow-brand-500/20 disabled:opacity-70"
                      >
                        {verifyLoading ? (
                          <Loader2 size={18} className="animate-spin" />
                        ) : (
                          <>Enviar código <ArrowRight size={16} /></>
                        )}
                      </button>
                    </form>

                  ) : (
                    /* OTP input */
                    <form onSubmit={handleConfirmCode} className="space-y-5">
                      <div className="flex flex-col items-center gap-3 text-center">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500/20">
                          <ShieldCheck size={24} className="text-brand-300" />
                        </div>
                        <div>
                          <h2 className="text-xl font-bold text-white">Ingresa el código</h2>
                          <p className="mt-1.5 text-sm text-surface-400">
                            Enviamos un código a{' '}
                            <span className="font-medium text-surface-300">{verifyEmail}</span>.
                            {' '}Tienes 10 minutos para usarlo.
                          </p>
                        </div>
                      </div>

                      <input
                        ref={codeInputRef}
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        value={verifyCode}
                        onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="······"
                        required
                        className="input w-full bg-white/5 text-center text-3xl font-mono tracking-[0.4em] text-white"
                      />

                      {error && (
                        <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
                          {error}
                        </p>
                      )}

                      <button
                        type="submit"
                        disabled={verifyLoading || verifyCode.length !== 6}
                        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-brand-500 to-brand-600 px-6 py-3.5 font-semibold text-white shadow-xl shadow-brand-500/20 disabled:opacity-70"
                      >
                        {verifyLoading ? (
                          <Loader2 size={18} className="animate-spin" />
                        ) : (
                          <>Verificar <Check size={16} /></>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => { setVerifyStep('email'); setVerifyCode(''); setError(''); }}
                        className="w-full text-sm text-surface-500 transition-colors hover:text-surface-300"
                      >
                        Cambiar correo o reenviar código
                      </button>
                    </form>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => goTo(1)}
                  className="flex items-center gap-1.5 text-sm text-surface-600 transition-colors hover:text-surface-400"
                >
                  <ArrowLeft size={14} />
                  Volver a elegir plan
                </button>
              </motion.div>
            )}

            {/* ── Step 3: Gym + owner data ───────────────────────────── */}
            {step === 3 && (
              <motion.div
                key="step-3"
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
              >
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur-2xl sm:p-7">
                    <h2 className="mb-5 text-xl font-bold text-white">Datos del gimnasio</h2>

                    <div className="space-y-4">
                      {/* Gym name */}
                      <Field label="Nombre del gimnasio" required>
                        <input
                          ref={gymNameRef}
                          className="input bg-white/5 text-white"
                          value={form.gym_name}
                          onChange={(e) => updateField('gym_name', e.target.value)}
                          placeholder="CrossFit Norte"
                          required
                        />
                      </Field>

                      {/* Owner name */}
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Tu nombre" required>
                          <input
                            className="input bg-white/5 text-white"
                            value={form.owner_first_name}
                            onChange={(e) => updateField('owner_first_name', e.target.value)}
                            placeholder="Juan"
                            required
                          />
                        </Field>
                        <Field label="Apellido" required>
                          <input
                            className="input bg-white/5 text-white"
                            value={form.owner_last_name}
                            onChange={(e) => updateField('owner_last_name', e.target.value)}
                            placeholder="Pérez"
                            required
                          />
                        </Field>
                      </div>

                      {/* Email — verified, readonly */}
                      <Field label="Tu correo">
                        <div className="relative">
                          <input
                            type="email"
                            className="input bg-white/5 pr-28 text-white opacity-60"
                            value={form.owner_email}
                            readOnly
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 rounded-full bg-emerald-500/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-300">
                            <Check size={10} /> Verificado
                          </span>
                        </div>
                      </Field>

                      {/* Password */}
                      <Field label="Contraseña" required hint="Mínimo 8 caracteres.">
                        <PasswordInput
                          value={form.owner_password}
                          onChange={(v) => updateField('owner_password', v)}
                          required
                        />
                      </Field>

                      {/* Confirm password */}
                      <Field label="Confirmar contraseña" required>
                        <PasswordInput
                          value={form.owner_password_confirm}
                          onChange={(v) => updateField('owner_password_confirm', v)}
                          className={passwordMismatch ? 'border-red-400/60 focus:border-red-400' : ''}
                        />
                        {passwordMismatch && (
                          <p className="mt-1.5 text-xs text-red-400">Las contraseñas no coinciden.</p>
                        )}
                      </Field>

                      {/* Advanced / regional config */}
                      <div>
                        <button
                          type="button"
                          onClick={() => setShowAdvanced((s) => !s)}
                          className="flex w-full items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 text-left text-sm text-surface-400 transition-colors hover:text-surface-200"
                        >
                          <ChevronDown
                            size={15}
                            className={cn('shrink-0 transition-transform duration-200', showAdvanced && 'rotate-180')}
                          />
                          <span className="flex-1">Configuración regional</span>
                          <span className="text-xs text-surface-600">
                            {form.city} · {form.currency} · {form.country}
                          </span>
                        </button>

                        <AnimatePresence initial={false}>
                          {showAdvanced && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2, ease: 'easeInOut' }}
                              className="overflow-hidden"
                            >
                              <div className="space-y-3 rounded-b-xl border border-t-0 border-white/8 bg-white/[0.02] px-4 pb-4 pt-3">
                                <Field
                                  label="Slug de la cuenta"
                                  hint="Identificador interno. Se genera automáticamente desde el nombre."
                                >
                                  <input
                                    className="input bg-white/5 font-mono text-sm text-white"
                                    value={form.slug}
                                    onChange={(e) => {
                                      setSlugEdited(true);
                                      updateField('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                                    }}
                                    placeholder="mi-gimnasio"
                                  />
                                </Field>
                                <Field label="Email del gimnasio" hint="Por defecto igual al tuyo.">
                                  <input
                                    type="email"
                                    className="input bg-white/5 text-white"
                                    value={form.email}
                                    onChange={(e) => updateField('email', e.target.value)}
                                  />
                                </Field>
                                <div className="grid grid-cols-2 gap-3">
                                  <Field label="Ciudad">
                                    <input className="input bg-white/5 text-white" value={form.city} onChange={(e) => updateField('city', e.target.value)} />
                                  </Field>
                                  <Field label="País">
                                    <input className="input bg-white/5 text-white" value={form.country} onChange={(e) => updateField('country', e.target.value)} />
                                  </Field>
                                  <Field label="Zona horaria">
                                    <input className="input bg-white/5 text-sm text-white" value={form.timezone} onChange={(e) => updateField('timezone', e.target.value)} />
                                  </Field>
                                  <Field label="Moneda">
                                    <input className="input bg-white/5 text-white" value={form.currency} onChange={(e) => updateField('currency', e.target.value)} />
                                  </Field>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  </div>

                  {/* Plan summary pill */}
                  {activePlan && (
                    <div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/5 px-5 py-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-surface-500">Plan seleccionado</p>
                        <p className="mt-0.5 truncate font-semibold text-white">{activePlan.name}</p>
                        {activePlan.trial_days > 0 ? (
                          <p className="mt-0.5 text-xs text-emerald-400">
                            {activePlan.trial_days} días gratis · sin cobro hasta renovar
                          </p>
                        ) : activePlan.checkout_enabled ? (
                          <p className="mt-0.5 text-xs text-amber-400">Pago requerido al crear la cuenta</p>
                        ) : (
                          <p className="mt-0.5 text-xs text-surface-500">Activación manual por el equipo</p>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-bold text-white">
                          {formatMoney(Number(activePlan.price), activePlan.currency)}
                          <span className="ml-1 text-xs font-normal text-surface-500">neto/{intervalLabel(activePlan.billing_interval)}</span>
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => goTo(1)}
                        className="shrink-0 rounded-xl border border-white/10 px-3 py-1.5 text-xs text-surface-400 transition-colors hover:border-white/20 hover:text-surface-200"
                      >
                        Cambiar
                      </button>
                    </div>
                  )}

                  {/* Error */}
                  {error && (
                    <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                      {error}
                    </p>
                  )}

                  {/* Submit */}
                  <button
                    type="submit"
                    disabled={loading || !activePlan || passwordMismatch}
                    className={cn(
                      'flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-4 font-semibold text-white shadow-xl transition-all',
                      loading || !activePlan || passwordMismatch
                        ? 'cursor-not-allowed bg-surface-700 opacity-60'
                        : 'bg-gradient-to-r from-brand-500 to-brand-600 shadow-brand-500/20 hover:from-brand-400 hover:to-brand-500',
                    )}
                  >
                    {loading ? (
                      <Loader2 size={20} className="animate-spin" />
                    ) : (
                      <>
                        {activePlan && activePlan.trial_days > 0
                          ? `Crear cuenta · ${activePlan.trial_days} días gratis`
                          : activePlan?.checkout_enabled
                            ? 'Crear cuenta e ir a pagar'
                            : 'Crear cuenta'}
                        <ArrowRight size={18} />
                      </>
                    )}
                  </button>

                  <p className="text-center text-xs text-surface-600">
                    Al registrarte aceptas los{' '}
                    <button
                      type="button"
                      onClick={() => setLegalModal('terms')}
                      className="text-surface-400 underline hover:text-surface-200"
                    >
                      Términos y Condiciones
                    </button>
                    {' '}y la{' '}
                    <button
                      type="button"
                      onClick={() => setLegalModal('privacy')}
                      className="text-surface-400 underline hover:text-surface-200"
                    >
                      Política de Privacidad
                    </button>.
                  </p>

                  <button
                    type="button"
                    onClick={() => goTo(2)}
                    className="flex items-center gap-1.5 text-sm text-surface-600 transition-colors hover:text-surface-400"
                  >
                    <ArrowLeft size={14} />
                    Volver
                  </button>
                </form>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </div>

      {/* Legal modals */}
      <Modal
        open={legalModal === 'terms'}
        title="Términos y Condiciones"
        onClose={() => setLegalModal(null)}
        size="lg"
      >
        <iframe src="/terms" className="h-[60vh] w-full rounded-lg border-0" title="Términos y Condiciones" />
      </Modal>
      <Modal
        open={legalModal === 'privacy'}
        title="Política de Privacidad"
        onClose={() => setLegalModal(null)}
        size="lg"
      >
        <iframe src="/privacy" className="h-[60vh] w-full rounded-lg border-0" title="Política de Privacidad" />
      </Modal>
    </div>
  );
}
