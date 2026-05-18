import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/utils';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  secondaryAction?: ReactNode;
  className?: string;
  variant?: 'card' | 'inline';
}

export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  className,
  variant = 'card',
}: EmptyStateProps) {
  const wrapperClass =
    variant === 'card'
      ? 'rounded-2xl border border-dashed border-surface-300/70 bg-white/60 px-6 py-10 dark:border-surface-700/70 dark:bg-surface-900/30'
      : 'px-4 py-8';

  return (
    <div className={cn('flex flex-col items-center justify-center text-center', wrapperClass, className)}>
      {Icon ? (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-300">
          <Icon size={22} />
        </div>
      ) : null}
      <h3 className="text-base font-semibold text-surface-900 dark:text-white">{title}</h3>
      {description ? (
        <div className="mt-1 max-w-md text-sm text-surface-500 dark:text-surface-400">{description}</div>
      ) : null}
      {action || secondaryAction ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}
