import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/utils';

interface TableScrollProps {
  children: ReactNode;
  className?: string;
  /** Hint visible only on small screens, dismisses on first scroll. Default true. */
  hint?: boolean;
}

/**
 * Wraps a wide table with horizontal scroll plus a right-edge fade and
 * a "swipe →" hint badge on mobile. Hint hides after the user scrolls.
 */
export default function TableScroll({ children, className, hint = true }: TableScrollProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [hasOverflow, setHasOverflow] = useState(false);
  const [showHint, setShowHint] = useState(hint);
  const [atEnd, setAtEnd] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const check = () => {
      setHasOverflow(el.scrollWidth > el.clientWidth + 2);
      setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    el.addEventListener('scroll', () => {
      check();
      if (el.scrollLeft > 8) setShowHint(false);
    });
    return () => ro.disconnect();
  }, []);

  return (
    <div className={cn('relative', className)}>
      <div ref={ref} className="overflow-x-auto">
        {children}
      </div>
      {hasOverflow && !atEnd ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-white to-transparent dark:from-surface-900"
        />
      ) : null}
      {hint && showHint && hasOverflow ? (
        <span className="pointer-events-none absolute right-2 top-2 inline-flex items-center gap-0.5 rounded-full bg-surface-900/80 px-2 py-0.5 text-[10px] font-medium text-white shadow-sm sm:hidden">
          desliza <ChevronRight size={10} />
        </span>
      ) : null}
    </div>
  );
}
