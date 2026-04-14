/**
 * Checklist de primeros pasos para nuevos owners.
 * Se muestra en el dashboard hasta que todos los pasos estén completados
 * o el usuario lo descarte manualmente (se guarda en localStorage).
 */

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Circle, ChevronDown, ChevronUp, X, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { branchesApi, plansApi, clientsApi, classesApi } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/utils';

const LEGACY_DISMISSED_KEY = 'nexo:onboarding:dismissed';

function dismissedKeyForUser(userId?: string) {
  return userId ? `${LEGACY_DISMISSED_KEY}:${userId}` : LEGACY_DISMISSED_KEY;
}

interface Step {
  id: string;
  label: string;
  description: string;
  path: string;
  cta: string;
  done: boolean;
  loading: boolean;
}

function useDismissed(userId?: string) {
  const storageKey = dismissedKeyForUser(userId);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      // Cleanup del flag global antiguo para no ocultar el checklist a cuentas nuevas.
      localStorage.removeItem(LEGACY_DISMISSED_KEY);
      setDismissed(localStorage.getItem(storageKey) === 'true');
    } catch {
      setDismissed(false);
    }
  }, [storageKey]);

  const dismiss = () => {
    try {
      localStorage.setItem(storageKey, 'true');
    } catch { /* noop */ }
    setDismissed(true);
  };

  return { dismissed, dismiss };
}

export default function OnboardingChecklist() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const { dismissed, dismiss } = useDismissed(user?.id);
  const [expanded, setExpanded] = useState(true);
  const shouldShow = user?.role === 'owner' && !dismissed;

  // Consultas ligeras para detectar si cada paso ya fue hecho
  const branchesQ = useQuery({
    queryKey: ['onboarding-branches'],
    queryFn: async () => (await branchesApi.list()).data,
    staleTime: 60_000,
    enabled: shouldShow,
  });

  const plansQ = useQuery({
    queryKey: ['onboarding-plans'],
    queryFn: async () => (await plansApi.list({ per_page: 1 })).data,
    staleTime: 60_000,
    enabled: shouldShow,
  });

  const clientsQ = useQuery({
    queryKey: ['onboarding-clients'],
    queryFn: async () => (await clientsApi.list({ per_page: 1 })).data,
    staleTime: 60_000,
    enabled: shouldShow,
  });

  const classesQ = useQuery({
    queryKey: ['onboarding-classes'],
    queryFn: async () => (await classesApi.list({ per_page: 1 })).data,
    staleTime: 60_000,
    enabled: shouldShow,
  });

  const hasBranch = (branchesQ.data?.length ?? 0) > 0;
  const hasPlan = (plansQ.data?.items?.length ?? plansQ.data?.length ?? 0) > 0;
  const hasClient = (clientsQ.data?.items?.length ?? clientsQ.data?.length ?? 0) > 0;
  const hasClass = (classesQ.data?.items?.length ?? classesQ.data?.length ?? 0) > 0;

  const steps: Step[] = [
    {
      id: 'branch',
      label: 'Configura tu sucursal',
      description: 'Agrega el nombre, dirección y horarios de tu gimnasio.',
      path: '/settings',
      cta: 'Ir a Configuración',
      done: hasBranch,
      loading: branchesQ.isLoading,
    },
    {
      id: 'plan',
      label: 'Crea tu primer plan de membresía',
      description: 'Define los planes que ofrecerás (mensual, anual, etc.).',
      path: '/plans',
      cta: 'Crear plan',
      done: hasPlan,
      loading: plansQ.isLoading,
    },
    {
      id: 'client',
      label: 'Agrega tu primer cliente',
      description: 'Registra un miembro manualmente o invítalo a registrarse.',
      path: '/clients',
      cta: 'Agregar cliente',
      done: hasClient,
      loading: clientsQ.isLoading,
    },
    {
      id: 'class',
      label: 'Programa tu primera clase',
      description: 'Crea una clase para que tus miembros puedan reservar.',
      path: '/classes',
      cta: 'Crear clase',
      done: hasClass,
      loading: classesQ.isLoading,
    },
  ];

  const completedCount = steps.filter((s) => s.done).length;
  const allDone = completedCount === steps.length;
  const progress = Math.round((completedCount / steps.length) * 100);

  // Auto-dismiss cuando todo está completo (con delay para que el usuario vea el 100%)
  useEffect(() => {
    if (allDone && !dismissed) {
      const timer = setTimeout(dismiss, 3000);
      return () => clearTimeout(timer);
    }
  }, [allDone, dismissed]);

  if (!shouldShow) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="rounded-2xl border border-surface-200/60 bg-white shadow-sm dark:border-surface-800/60 dark:bg-surface-900"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-600">
            <Zap size={16} className="text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-surface-900 dark:text-white">
              {allDone ? '¡Setup completado!' : 'Primeros pasos'}
            </p>
            <p className="text-xs text-surface-500">
              {allDone
                ? 'Tu gimnasio está listo para operar.'
                : `${completedCount} de ${steps.length} pasos completados`}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* Barra de progreso */}
          <div className="hidden w-24 sm:block">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-100 dark:bg-surface-800">
              <motion.div
                className={cn(
                  'h-full rounded-full',
                  allDone ? 'bg-emerald-500' : 'bg-brand-500',
                )}
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.4 }}
              />
            </div>
            <p className="mt-1 text-right text-[10px] text-surface-400">{progress}%</p>
          </div>

          <button
            type="button"
            aria-label={expanded ? 'Colapsar' : 'Expandir'}
            onClick={() => setExpanded((v) => !v)}
            className="rounded-lg p-1.5 text-surface-400 hover:bg-surface-100 hover:text-surface-600 dark:hover:bg-surface-800 dark:hover:text-surface-300"
          >
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          <button
            type="button"
            aria-label="Descartar"
            onClick={dismiss}
            className="rounded-lg p-1.5 text-surface-400 hover:bg-surface-100 hover:text-surface-600 dark:hover:bg-surface-800 dark:hover:text-surface-300"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Steps */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            key="steps"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="divide-y divide-surface-100 border-t border-surface-100 dark:divide-surface-800 dark:border-surface-800">
              {steps.map((step) => (
                <div
                  key={step.id}
                  className={cn(
                    'flex items-center gap-4 px-5 py-3.5 transition-colors',
                    step.done ? 'opacity-60' : '',
                  )}
                >
                  {/* Icono */}
                  <div className="shrink-0">
                    {step.loading ? (
                      <div className="h-5 w-5 animate-pulse rounded-full bg-surface-200 dark:bg-surface-700" />
                    ) : step.done ? (
                      <CheckCircle2 size={20} className="text-emerald-500" />
                    ) : (
                      <Circle size={20} className="text-surface-300 dark:text-surface-600" />
                    )}
                  </div>

                  {/* Texto */}
                  <div className="min-w-0 flex-1">
                    <p className={cn(
                      'text-sm font-medium',
                      step.done
                        ? 'text-surface-400 line-through dark:text-surface-500'
                        : 'text-surface-800 dark:text-white',
                    )}>
                      {step.label}
                    </p>
                    {!step.done && (
                      <p className="text-xs text-surface-500">{step.description}</p>
                    )}
                  </div>

                  {/* CTA */}
                  {!step.done && !step.loading && (
                    <button
                      type="button"
                      onClick={() => navigate(step.path)}
                      className="shrink-0 rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-100 dark:border-brand-900/40 dark:bg-brand-950/30 dark:text-brand-300 dark:hover:bg-brand-950/50"
                    >
                      {step.cta}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
