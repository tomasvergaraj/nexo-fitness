import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, ChevronLeft } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { formatDurationLabel, formatCurrency } from '@/utils';
import type { TenantPublicProfile } from '@/types';
import type { useCheckout } from '../hooks/useCheckout';
import StepEmail from './StepEmail';
import StepCustomerData from './StepCustomerData';
import StepSummary from './StepSummary';
import { useParams } from 'react-router-dom';

type CheckoutHook = ReturnType<typeof useCheckout>;

interface Props {
  profile: TenantPublicProfile;
  checkout: CheckoutHook;
}

const STEPS = [
  { key: 'email', label: 'Tu correo' },
  { key: 'data', label: 'Tus datos' },
  { key: 'summary', label: 'Pago' },
] as const;

const stepIndex = (step: string) => STEPS.findIndex(s => s.key === step);

export default function CheckoutDrawer({ profile, checkout }: Props) {
  const { slug = '' } = useParams<{ slug: string }>();
  const { state, close, set } = checkout;

  const plan = profile.featured_plans.find(p => p.id === state.planId);
  const currentIndex = stepIndex(state.step);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  // Prevent body scroll when open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const canGoBack = currentIndex > 0;
  const goBack = () => {
    if (state.step === 'data') set({ step: 'email', error: '' });
    else if (state.step === 'summary') set({ step: 'data', error: '' });
  };

  return (
    <>
      {/* Backdrop */}
      <motion.div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={close}
      />

      {/* Panel — right drawer on md+, bottom sheet on mobile */}
      <motion.div
        className="sf-drawer fixed z-50 flex flex-col
          bottom-0 left-0 right-0 max-h-[92dvh] rounded-t-3xl
          md:top-0 md:bottom-0 md:left-auto md:right-0 md:w-[440px] md:max-h-none md:rounded-none md:rounded-l-3xl"
        initial={{ y: '100%', x: 0 }}
        animate={{ y: 0, x: 0 }}
        exit={{ y: '100%' }}
        // Desktop: slide from right
        style={{ '--drawer-mobile': '1' } as React.CSSProperties}
        transition={{ type: 'spring', stiffness: 300, damping: 35 }}
      >
        {/* Drag handle (mobile) */}
        <div className="md:hidden flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full sf-drag-handle" />
        </div>

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 flex-shrink-0 sf-drawer-header">
          {canGoBack ? (
            <button onClick={goBack} className="sf-icon-btn p-1.5 rounded-xl">
              <ChevronLeft className="w-5 h-5" />
            </button>
          ) : (
            <div className="w-8" />
          )}

          {/* Plan summary pill */}
          {plan && (
            <div className="flex-1 text-center">
              <p className="sf-text-strong font-bold text-sm leading-tight">{plan.name}</p>
              <p className="sf-text-muted text-xs">
                {formatCurrency(plan.price, plan.currency)} · {formatDurationLabel(plan.duration_type, plan.duration_days)}
              </p>
            </div>
          )}

          <button onClick={close} className="sf-icon-btn p-1.5 rounded-xl">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress bar */}
        <div className="px-5 pb-3 flex-shrink-0">
          <div className="flex gap-1.5">
            {STEPS.map((s, i) => (
              <div
                key={s.key}
                className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                  i <= currentIndex ? 'sf-progress-active' : 'sf-progress-inactive'
                }`}
              />
            ))}
          </div>
          <div className="flex justify-between mt-1.5">
            {STEPS.map((s, i) => (
              <span
                key={s.key}
                className={`text-xs transition-colors ${i === currentIndex ? 'sf-text-strong font-semibold' : 'sf-text-subtle'}`}
              >
                {s.label}
              </span>
            ))}
          </div>
        </div>

        {/* Step content */}
        <div className="flex-1 overflow-y-auto px-5 pb-8 pt-2">
          <AnimatePresence mode="wait">
            {state.step === 'email' && (
              <StepEmail key="email" checkout={checkout} />
            )}
            {state.step === 'data' && (
              <StepCustomerData key="data" checkout={checkout} />
            )}
            {state.step === 'summary' && (
              <StepSummary key="summary" checkout={checkout} plan={plan} slug={slug} />
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </>
  );
}
