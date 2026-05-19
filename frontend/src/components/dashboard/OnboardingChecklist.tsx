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
import { dashboardApi } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/utils';

const LEGACY_DISMISSED_KEY = 'nexo:onboarding:dismissed';

function dismissedKeyForUser(userId?: string) {
  return userId ? `${LEGACY_DISMISSED_KEY}:${userId}` : LEGACY_DISMISSED_KEY;
}

interface ChecklistItem {
  key: string;
  label: string;
  description: string;
  done: boolean;
  action_url: string;
}

interface ChecklistResponse {
  items: ChecklistItem[];
  completed_count: number;
  total: number;
  all_done: boolean;
}

function useDismissed(userId?: string) {
  const storageKey = dismissedKeyForUser(userId);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
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
  const shouldShow = (user?.role === 'owner' || user?.role === 'admin') && !dismissed;

  const { data, isLoading } = useQuery<ChecklistResponse>({
    queryKey: ['onboarding-checklist'],
    queryFn: async () => (await dashboardApi.getOnboardingChecklist()).data,
    staleTime: 60_000,
    enabled: shouldShow,
  });

  const items = data?.items ?? [];
  const completedCount = data?.completed_count ?? 0;
  const total = data?.total ?? items.length;
  const allDone = data?.all_done ?? false;
  const progress = total > 0 ? Math.round((completedCount / total) * 100) : 0;

  useEffect(() => {
    if (allDone && !dismissed) {
      const timer = setTimeout(dismiss, 3000);
      return () => clearTimeout(timer);
    }
  }, [allDone, dismissed]);

  if (!shouldShow) return null;
  if (!isLoading && items.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="rounded-2xl border border-surface-200/60 bg-white shadow-sm dark:border-surface-800/60 dark:bg-surface-900"
    >
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
                : `${completedCount} de ${total} pasos completados`}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
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
              {isLoading ? (
                <div className="px-5 py-6 text-center text-xs text-surface-400">Cargando…</div>
              ) : items.map((step) => (
                <div
                  key={step.key}
                  className={cn(
                    'flex items-center gap-4 px-5 py-3.5 transition-colors',
                    step.done ? 'opacity-60' : '',
                  )}
                >
                  <div className="shrink-0">
                    {step.done ? (
                      <CheckCircle2 size={20} className="text-emerald-500" />
                    ) : (
                      <Circle size={20} className="text-surface-300 dark:text-surface-600" />
                    )}
                  </div>

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

                  {!step.done && (
                    <button
                      type="button"
                      onClick={() => navigate(step.action_url)}
                      className="shrink-0 rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-100 dark:border-brand-900/40 dark:bg-brand-950/30 dark:text-brand-300 dark:hover:bg-brand-950/50"
                    >
                      Ir →
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
