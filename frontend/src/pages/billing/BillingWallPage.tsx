import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Zap, Clock, Ban, XCircle, Loader2, ArrowRight, LogOut, Mail,
  Check, Users, GitBranch,
} from 'lucide-react';
import NexoBrand from '@/components/branding/NexoBrand';
import toast from 'react-hot-toast';
import { billingApi } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/utils';

interface BillingStatus {
  status: string;
  allow_access: boolean;
  detail: string | null;
  days_remaining: number | null;
  trial_ends_at: string | null;
  license_expires_at: string | null;
  checkout_url: string | null;
  plan_name: string;
}

interface SaaSPlan {
  key: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  billing_interval: string;
  trial_days: number;
  max_members: number;
  max_branches: number;
  features: string[];
  highlighted: boolean;
  checkout_enabled: boolean;
}

const STATUS_CONFIG: Record<string, {
  title: string;
  description: string;
  Icon: typeof Clock;
  orbColor: string;
  accentFrom: string;
  accentTo: string;
  accentShadow: string;
}> = {
  expired: {
    title: 'Tu suscripción ha vencido',
    description: 'Elige un plan para recuperar el acceso a NexoFitness.',
    Icon: Clock,
    orbColor: 'bg-amber-500/10',
    accentFrom: 'from-amber-400',
    accentTo: 'to-amber-600',
    accentShadow: 'shadow-amber-500/30',
  },
  trial: {
    title: 'Tu período de prueba terminó',
    description: 'Activa tu suscripción para seguir gestionando tu gimnasio.',
    Icon: Zap,
    orbColor: 'bg-brand-500/10',
    accentFrom: 'from-brand-400',
    accentTo: 'to-brand-600',
    accentShadow: 'shadow-brand-500/30',
  },
  suspended: {
    title: 'Cuenta suspendida',
    description: 'Tu cuenta fue suspendida. Reactiva tu plan o contacta a soporte.',
    Icon: Ban,
    orbColor: 'bg-red-500/10',
    accentFrom: 'from-red-400',
    accentTo: 'to-red-600',
    accentShadow: 'shadow-red-500/30',
  },
  cancelled: {
    title: 'Suscripción cancelada',
    description: 'Elige un plan para reactivar tu cuenta.',
    Icon: XCircle,
    orbColor: 'bg-surface-400/10',
    accentFrom: 'from-surface-400',
    accentTo: 'to-surface-600',
    accentShadow: 'shadow-surface-500/30',
  },
};

function formatPrice(price: number, currency: string, interval: string) {
  const fmt = new Intl.NumberFormat('es-CL', { style: 'currency', currency, maximumFractionDigits: 0 });
  const intervalLabel = interval === 'year' ? '/año' : '/mes';
  return `${fmt.format(price)}${intervalLabel}`;
}

export default function BillingWallPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { logout, user } = useAuthStore();

  const statusParam = searchParams.get('status') || 'expired';
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [plans, setPlans] = useState<SaaSPlan[]>([]);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    Promise.all([
      billingApi.getStatus().then(({ data }) => data).catch(() => ({
        status: statusParam,
        allow_access: false,
        detail: null,
        days_remaining: null,
        trial_ends_at: null,
        license_expires_at: null,
        checkout_url: null,
        plan_name: '',
      })),
      billingApi.listPublicPlans().then(({ data }) => data).catch(() => []),
    ]).then(([billingData, plansData]) => {
      setBilling(billingData);
      const checkoutPlans = (plansData as SaaSPlan[]).filter((p) => p.checkout_enabled);
      setPlans(checkoutPlans);
      // Pre-seleccionar el plan actual si existe entre los disponibles
      const currentKey = checkoutPlans.find(
        (p) => p.name.toLowerCase() === billingData.plan_name?.toLowerCase()
      )?.key ?? checkoutPlans.find((p) => p.highlighted)?.key ?? checkoutPlans[0]?.key ?? null;
      setSelectedPlan(currentKey);
    }).finally(() => setLoadingStatus(false));
  }, [statusParam]);

  useEffect(() => {
    if (billing?.allow_access) {
      navigate('/dashboard', { replace: true });
    }
  }, [billing, navigate]);

  const handleReactivate = async () => {
    if (!selectedPlan) return;
    setRedirecting(true);
    try {
      // Si ya tenemos la URL directa para el plan actual, usarla
      if (billing?.checkout_url && selectedPlan === plans.find(
        (p) => p.name.toLowerCase() === billing.plan_name?.toLowerCase()
      )?.key) {
        window.location.href = billing.checkout_url;
        return;
      }
      const { data } = await billingApi.reactivate(selectedPlan);
      if (data.checkout_url) {
        window.location.href = data.checkout_url;
      } else {
        setRedirecting(false);
        toast.error('No hay pago online disponible para este plan. Contacta a soporte.');
      }
    } catch {
      setRedirecting(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const effectiveStatus = billing?.status || statusParam;
  const config = STATUS_CONFIG[effectiveStatus] || STATUS_CONFIG.expired;
  const canReactivate = ['owner', 'admin'].includes(user?.role || '');
  const isSuspended = effectiveStatus === 'suspended' && plans.length === 0;
  const { Icon } = config;

  if (loadingStatus) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-950">
        <Loader2 className="w-8 h-8 text-brand-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-surface-950 px-6 py-10">
      {/* Background */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-br from-surface-950 via-surface-900 to-brand-950" />
        <motion.div
          animate={{ x: [0, 80, -40, 0], y: [0, -60, 50, 0], scale: [1, 1.2, 0.9, 1] }}
          transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
          className={cn('absolute top-1/4 left-1/4 w-96 h-96 rounded-full blur-[100px]', config.orbColor)}
        />
        <motion.div
          animate={{ x: [0, -60, 50, 0], y: [0, 80, -40, 0], scale: [1, 0.9, 1.1, 1] }}
          transition={{ duration: 25, repeat: Infinity, ease: 'linear' }}
          className="absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full bg-violet-500/8 blur-[100px]"
        />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px),
                              linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)`,
            backgroundSize: '60px 60px',
          }}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="w-full max-w-2xl relative"
      >
        {/* Logo */}
        <div className="mb-8">
          <NexoBrand
            className="justify-center"
            align="center"
            iconSize={40}
            iconClassName="shadow-lg shadow-brand-500/25"
            titleClassName="text-2xl"
            accentClassName="text-brand-400"
          />
        </div>

        <div className="bg-white/5 backdrop-blur-2xl border border-white/10 rounded-3xl p-8 shadow-2xl">
          {/* Header */}
          <div className="flex flex-col items-center text-center mb-8">
            <motion.div
              initial={{ scale: 0, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ delay: 0.2, type: 'spring', stiffness: 200, damping: 15 }}
              className={cn(
                'w-14 h-14 rounded-2xl bg-gradient-to-br flex items-center justify-center mb-4 shadow-2xl',
                config.accentFrom, config.accentTo, config.accentShadow,
              )}
            >
              <Icon size={28} className="text-white" />
            </motion.div>
            <h2 className="text-2xl font-bold font-display text-white mb-1">{config.title}</h2>
            <p className="text-surface-400 text-sm">{billing?.detail || config.description}</p>
          </div>

          {canReactivate && !isSuspended ? (
            <>
              {/* Plan selector */}
              {plans.length > 0 && (
                <div className="mb-6">
                  <p className="text-xs font-medium text-surface-500 uppercase tracking-wider mb-3">
                    Elige tu plan
                  </p>
                  <div className="grid gap-3">
                    <AnimatePresence>
                      {plans.map((plan, i) => {
                        const isSelected = selectedPlan === plan.key;
                        const isCurrent = plan.name.toLowerCase() === billing?.plan_name?.toLowerCase();
                        return (
                          <motion.button
                            key={plan.key}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.1 + i * 0.05 }}
                            onClick={() => setSelectedPlan(plan.key)}
                            className={cn(
                              'w-full text-left rounded-2xl border p-4 transition-all duration-200',
                              isSelected
                                ? 'border-brand-500/50 bg-brand-500/10 ring-1 ring-brand-500/30'
                                : 'border-white/10 bg-white/3 hover:bg-white/5 hover:border-white/20',
                            )}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className={cn(
                                    'font-semibold text-sm',
                                    isSelected ? 'text-white' : 'text-surface-200',
                                  )}>
                                    {plan.name}
                                  </span>
                                  {isCurrent && (
                                    <span className="px-2 py-0.5 rounded-full text-xs bg-brand-500/20 text-brand-300 border border-brand-500/20">
                                      Plan actual
                                    </span>
                                  )}
                                  {plan.highlighted && !isCurrent && (
                                    <span className="px-2 py-0.5 rounded-full text-xs bg-amber-500/20 text-amber-300 border border-amber-500/20">
                                      Recomendado
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-3 text-xs text-surface-500">
                                  <span className="flex items-center gap-1">
                                    <Users size={11} />
                                    {plan.max_members.toLocaleString()} miembros
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <GitBranch size={11} />
                                    {plan.max_branches} sucursal{plan.max_branches !== 1 ? 'es' : ''}
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center gap-3 shrink-0">
                                <span className={cn(
                                  'font-bold text-sm tabular-nums',
                                  isSelected ? 'text-brand-300' : 'text-surface-300',
                                )}>
                                  {formatPrice(plan.price, plan.currency, plan.billing_interval)}
                                </span>
                                <div className={cn(
                                  'w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all',
                                  isSelected
                                    ? 'border-brand-500 bg-brand-500'
                                    : 'border-white/20',
                                )}>
                                  {isSelected && <Check size={11} className="text-white" strokeWidth={3} />}
                                </div>
                              </div>
                            </div>
                          </motion.button>
                        );
                      })}
                    </AnimatePresence>
                  </div>
                </div>
              )}

              {/* CTA */}
              <motion.button
                onClick={handleReactivate}
                disabled={redirecting || !selectedPlan}
                whileHover={{ scale: redirecting ? 1 : 1.01 }}
                whileTap={{ scale: redirecting ? 1 : 0.98 }}
                className={cn(
                  'w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-semibold',
                  'bg-gradient-to-r from-brand-500 to-brand-600 text-white',
                  'shadow-xl shadow-brand-500/25 hover:shadow-brand-500/40',
                  'transition-all duration-300',
                  (redirecting || !selectedPlan) && 'opacity-70 cursor-not-allowed',
                )}
              >
                {redirecting ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <>
                    Continuar al pago
                    <ArrowRight size={16} />
                  </>
                )}
              </motion.button>
            </>
          ) : canReactivate && isSuspended ? (
            <a
              href="mailto:soporte@nexofitness.com"
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-semibold
                         bg-gradient-to-r from-red-500 to-red-600 text-white
                         shadow-xl shadow-red-500/25 hover:shadow-red-500/40 transition-all duration-300"
            >
              <Mail size={16} />
              Contactar soporte
            </a>
          ) : (
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-sm text-surface-400 text-center">
              Contacta al administrador de tu cuenta para renovar la suscripción.
            </div>
          )}

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 mt-3 py-2.5 px-4 rounded-xl
                       text-sm text-surface-500 hover:text-surface-200 hover:bg-white/5
                       transition-all duration-200"
          >
            <LogOut size={14} />
            Cerrar sesión
          </button>
        </div>

        <p className="text-center text-xs text-surface-600 mt-6">
          NexoFitness · Gestión de gimnasios
        </p>
      </motion.div>
    </div>
  );
}
