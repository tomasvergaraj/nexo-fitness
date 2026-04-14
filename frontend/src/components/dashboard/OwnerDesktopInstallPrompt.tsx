import { AnimatePresence, motion } from 'framer-motion';
import { Download, MonitorSmartphone, X } from 'lucide-react';
import type { InstallCopy } from '@/hooks/useOwnerDesktopInstallPrompt';

interface OwnerDesktopInstallPromptProps {
  open: boolean;
  installCopy: InstallCopy;
  canPromptInstall: boolean;
  onDismiss: () => void;
  onInstall: () => void;
}

export default function OwnerDesktopInstallPrompt({
  open,
  installCopy,
  canPromptInstall,
  onDismiss,
  onInstall,
}: OwnerDesktopInstallPromptProps) {
  if (!open) {
    return null;
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.98 }}
          transition={{ duration: 0.18 }}
          className="pointer-events-none fixed bottom-4 right-4 z-40 w-[min(360px,calc(100vw-2rem))]"
        >
          <div className="pointer-events-auto rounded-2xl border border-surface-200/70 bg-white/95 p-4 shadow-xl shadow-surface-900/10 backdrop-blur dark:border-surface-700/70 dark:bg-surface-900/95 dark:shadow-black/20">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-500/10 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                <MonitorSmartphone size={18} />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-surface-900 dark:text-white">
                      {installCopy.title}
                    </p>
                    <p className="mt-1 text-sm leading-5 text-surface-600 dark:text-surface-300">
                      {installCopy.body}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={onDismiss}
                    className="rounded-lg p-1 text-surface-400 transition-colors hover:bg-surface-100 hover:text-surface-600 dark:hover:bg-surface-800 dark:hover:text-surface-200"
                    aria-label="Cerrar sugerencia"
                  >
                    <X size={16} />
                  </button>
                </div>

                <p className="mt-2 text-xs text-surface-500 dark:text-surface-400">
                  {installCopy.hint}
                </p>

                <div className="mt-3 flex items-center gap-2">
                  {canPromptInstall ? (
                    <button
                      type="button"
                      onClick={onInstall}
                      className="btn-primary !px-3.5 !py-2 text-sm"
                    >
                      <Download size={14} />
                      Instalar
                    </button>
                  ) : null}

                  <button
                    type="button"
                    onClick={onDismiss}
                    className="btn-ghost !px-2.5 !py-2 text-sm"
                  >
                    Ahora no
                  </button>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
