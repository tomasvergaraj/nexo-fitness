import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  side?: 'right' | 'left';
}

export default function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 520,
  side = 'right',
}: DrawerProps) {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (typeof document === 'undefined') return null;

  const initialX = side === 'right' ? width : -width;
  const positionClass = side === 'right' ? 'right-0' : 'left-0';

  const content = (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="drawer-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-surface-950/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.aside
            key="drawer-panel"
            initial={{ x: initialX }}
            animate={{ x: 0 }}
            exit={{ x: initialX }}
            transition={{ type: 'tween', ease: [0.32, 0.72, 0, 1], duration: 0.28 }}
            style={{ width: `min(${width}px, 100vw)` }}
            className={`fixed top-0 ${positionClass} z-50 flex h-full flex-col border-l border-surface-200 bg-white shadow-2xl dark:border-surface-800 dark:bg-surface-950`}
            role="dialog"
            aria-modal="true"
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-surface-200 px-5 py-4 dark:border-surface-800">
              <div className="min-w-0">
                {title ? (
                  <h2 className="truncate text-lg font-bold font-display text-surface-900 dark:text-white">
                    {title}
                  </h2>
                ) : null}
                {description ? (
                  <div className="mt-1 text-sm text-surface-500 dark:text-surface-400">
                    {description}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl p-2 text-surface-400 transition-colors hover:bg-surface-100 hover:text-surface-700 dark:hover:bg-surface-800 dark:hover:text-surface-200"
                aria-label="Cerrar"
              >
                <X size={18} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
            {footer ? (
              <div className="shrink-0 border-t border-surface-200 px-5 py-3 dark:border-surface-800">
                {footer}
              </div>
            ) : null}
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );

  return createPortal(content, document.body);
}
