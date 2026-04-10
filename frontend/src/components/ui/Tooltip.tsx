import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/utils';

type TooltipSide = 'top' | 'bottom';

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: TooltipSide;
  disabled?: boolean;
  className?: string;
}

type TooltipPosition = {
  top: number;
  left: number;
  side: TooltipSide;
  ready: boolean;
};

export default function Tooltip({
  content,
  children,
  side = 'top',
  disabled = false,
  className,
}: TooltipProps) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition>({
    top: 0,
    left: 0,
    side,
    ready: false,
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (disabled && open) {
      setOpen(false);
    }
  }, [disabled, open]);

  useLayoutEffect(() => {
    if (!open || disabled || !triggerRef.current || !tooltipRef.current) {
      return undefined;
    }

    const margin = 8;
    const gap = 10;

    const updatePosition = () => {
      if (!triggerRef.current || !tooltipRef.current) {
        return;
      }

      const triggerRect = triggerRef.current.getBoundingClientRect();
      const tooltipRect = tooltipRef.current.getBoundingClientRect();

      let resolvedSide = side;

      if (side === 'top' && triggerRect.top < tooltipRect.height + gap + margin) {
        resolvedSide = 'bottom';
      } else if (side === 'bottom' && window.innerHeight - triggerRect.bottom < tooltipRect.height + gap + margin) {
        resolvedSide = 'top';
      }

      const top = resolvedSide === 'top'
        ? triggerRect.top - tooltipRect.height - gap
        : triggerRect.bottom + gap;
      const left = Math.min(
        Math.max(triggerRect.left + (triggerRect.width - tooltipRect.width) / 2, margin),
        window.innerWidth - tooltipRect.width - margin,
      );

      setPosition({
        top: Math.max(margin, top),
        left,
        side: resolvedSide,
        ready: true,
      });
    };

    updatePosition();

    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, side, disabled, content]);

  if (!content) {
    return <>{children}</>;
  }

  const tooltip = mounted && open && !disabled ? createPortal(
    <div
      ref={tooltipRef}
      role="tooltip"
      className={cn(
        'pointer-events-none fixed z-[70] max-w-xs rounded-xl bg-surface-950 px-3 py-2 text-xs font-medium text-white shadow-2xl ring-1 ring-white/10 transition-opacity duration-150 dark:bg-white dark:text-surface-900 dark:ring-surface-200',
        position.ready ? 'opacity-100' : 'opacity-0',
      )}
      style={{ top: position.top, left: position.left }}
    >
      {content}
      <span
        className={cn(
          'absolute left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 bg-surface-950 dark:bg-white',
          position.side === 'top' ? 'bottom-[-4px]' : 'top-[-4px]',
        )}
      />
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <span
        ref={triggerRef}
        className={cn('inline-flex', className)}
        onMouseEnter={() => !disabled && setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocusCapture={() => !disabled && setOpen(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setOpen(false);
          }
        }}
      >
        {children}
      </span>
      {tooltip}
    </>
  );
}
