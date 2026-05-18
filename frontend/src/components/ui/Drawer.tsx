import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';

type DrawerSide = 'right' | 'left' | 'bottom';
type DrawerSize = 'sm' | 'md' | 'lg' | 'xl';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  size?: DrawerSize;
  side?: DrawerSide;
  bodyClassName?: string;
}

const SIZE_PX: Record<DrawerSize, number> = {
  sm: 380,
  md: 520,
  lg: 720,
  xl: 960,
};

export default function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width,
  size = 'md',
  side = 'right',
  bodyClassName,
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

  const isBottom = side === 'bottom';
  const px = width ?? SIZE_PX[size];

  let panelStyle: Record<string, string> = {};
  let positionClass = '';
  let initial: Record<string, number> = {};
  let animate: Record<string, number> = {};
  let exit: Record<string, number> = {};
  let radiusClass = '';
  let borderSideClass = '';

  if (isBottom) {
    panelStyle = { width: '100%', maxHeight: '90vh' };
    positionClass = 'left-0 right-0 bottom-0';
    initial = { y: 600 };
    animate = { y: 0 };
    exit = { y: 600 };
    radiusClass = 'rounded-t-3xl';
    borderSideClass = 'border-t';
  } else {
    panelStyle = { width: `min(${px}px, 100vw)` };
    positionClass = side === 'right' ? 'right-0 top-0 h-full' : 'left-0 top-0 h-full';
    const initialX = side === 'right' ? px : -px;
    initial = { x: initialX };
    animate = { x: 0 };
    exit = { x: initialX };
    borderSideClass = side === 'right' ? 'border-l' : 'border-r';
  }

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
            initial={initial}
            animate={animate}
            exit={exit}
            transition={{ type: 'tween', ease: [0.32, 0.72, 0, 1], duration: 0.28 }}
            style={panelStyle}
            className={`fixed ${positionClass} z-50 flex flex-col ${borderSideClass} border-surface-200 bg-white shadow-2xl dark:border-surface-800 dark:bg-surface-950 ${radiusClass}`}
            role="dialog"
            aria-modal="true"
          >
            {isBottom ? (
              <div className="flex justify-center pt-2">
                <span className="h-1 w-10 rounded-full bg-surface-300 dark:bg-surface-700" aria-hidden />
              </div>
            ) : null}
            {title || description ? (
              <div className="flex shrink-0 items-start justify-between gap-3 border-b border-surface-200 px-5 py-4 dark:border-surface-800">
                <div className="min-w-0">
                  {title ? (
                    <h2 className="truncate text-lg font-bold font-display text-surface-900 dark:text-white">
                      {title}
                    </h2>
                  ) : null}
                  {description ? (
                    <div className="mt-1 text-sm text-surface-500 dark:text-surface-400">{description}</div>
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
            ) : null}
            <div className={`min-h-0 flex-1 overflow-y-auto px-5 py-5 ${bodyClassName ?? ''}`}>{children}</div>
            {footer ? (
              <div className="shrink-0 border-t border-surface-200 px-5 py-3 dark:border-surface-800">{footer}</div>
            ) : null}
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );

  return createPortal(content, document.body);
}
