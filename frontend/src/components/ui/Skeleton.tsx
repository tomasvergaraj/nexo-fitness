import { cn } from '@/utils';

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-surface-200/70 dark:bg-surface-800/60',
        className,
      )}
    />
  );
}

interface SkeletonCardProps {
  className?: string;
  lines?: number;
}

export function SkeletonCard({ className, lines = 3 }: SkeletonCardProps) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-surface-200/70 bg-white/70 p-5 shadow-sm dark:border-surface-800/70 dark:bg-surface-900/40',
        className,
      )}
    >
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="mt-3 h-8 w-1/2" />
      <div className="mt-4 space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className={cn('h-3', i === lines - 1 ? 'w-2/3' : 'w-full')} />
        ))}
      </div>
    </div>
  );
}

interface SkeletonStatProps {
  className?: string;
}

export function SkeletonStat({ className }: SkeletonStatProps) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-surface-200/70 bg-white/70 p-5 shadow-sm dark:border-surface-800/70 dark:bg-surface-900/40',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-9 rounded-xl" />
      </div>
      <Skeleton className="mt-4 h-7 w-32" />
      <Skeleton className="mt-2 h-3 w-20" />
    </div>
  );
}

interface SkeletonTableProps {
  rows?: number;
  columns?: number;
  className?: string;
}

export function SkeletonTable({ rows = 6, columns = 4, className }: SkeletonTableProps) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl border border-surface-200/70 bg-white/70 dark:border-surface-800/70 dark:bg-surface-900/40',
        className,
      )}
    >
      <div className="border-b border-surface-200/70 bg-surface-50/70 px-4 py-3 dark:border-surface-800/70 dark:bg-surface-950/30">
        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton key={i} className="h-3 w-2/3" />
          ))}
        </div>
      </div>
      <div className="divide-y divide-surface-200/70 dark:divide-surface-800/70">
        {Array.from({ length: rows }).map((_, r) => (
          <div
            key={r}
            className="grid gap-4 px-4 py-4"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: columns }).map((_, c) => (
              <Skeleton key={c} className={cn('h-3', c === 0 ? 'w-3/4' : 'w-1/2')} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

interface SkeletonListProps {
  rows?: number;
  className?: string;
  withAvatar?: boolean;
}

export function SkeletonList({ rows = 5, className, withAvatar = true }: SkeletonListProps) {
  return (
    <div className={cn('space-y-3', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-2xl border border-surface-200/70 bg-white/70 px-4 py-3 dark:border-surface-800/70 dark:bg-surface-900/40"
        >
          {withAvatar ? <Skeleton className="h-10 w-10 shrink-0 rounded-full" /> : null}
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
          <Skeleton className="h-6 w-16 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  );
}
