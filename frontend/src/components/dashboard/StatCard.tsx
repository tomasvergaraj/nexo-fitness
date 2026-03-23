import { motion, useMotionValue, useTransform, animate } from 'framer-motion';
import { useEffect, useRef } from 'react';
import { cn } from '@/utils';
import type { LucideIcon } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: number | string;
  icon: LucideIcon;
  trend?: { value: number; label: string };
  color?: 'brand' | 'emerald' | 'amber' | 'rose' | 'violet' | 'blue';
  format?: 'number' | 'currency' | 'percent';
  delay?: number;
}

const colorMap = {
  brand: {
    bg: 'bg-brand-50 dark:bg-brand-950/40',
    icon: 'text-brand-500',
    shadow: 'shadow-brand-500/10',
    gradient: 'from-brand-400 to-brand-600',
  },
  emerald: {
    bg: 'bg-emerald-50 dark:bg-emerald-950/40',
    icon: 'text-emerald-500',
    shadow: 'shadow-emerald-500/10',
    gradient: 'from-emerald-400 to-emerald-600',
  },
  amber: {
    bg: 'bg-amber-50 dark:bg-amber-950/40',
    icon: 'text-amber-500',
    shadow: 'shadow-amber-500/10',
    gradient: 'from-amber-400 to-amber-600',
  },
  rose: {
    bg: 'bg-rose-50 dark:bg-rose-950/40',
    icon: 'text-rose-500',
    shadow: 'shadow-rose-500/10',
    gradient: 'from-rose-400 to-rose-600',
  },
  violet: {
    bg: 'bg-violet-50 dark:bg-violet-950/40',
    icon: 'text-violet-500',
    shadow: 'shadow-violet-500/10',
    gradient: 'from-violet-400 to-violet-600',
  },
  blue: {
    bg: 'bg-blue-50 dark:bg-blue-950/40',
    icon: 'text-blue-500',
    shadow: 'shadow-blue-500/10',
    gradient: 'from-blue-400 to-blue-600',
  },
};

function AnimatedNumber({ value, format }: { value: number; format?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const motionValue = useMotionValue(0);
  const rounded = useTransform(motionValue, (v) => {
    if (format === 'currency') {
      return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', minimumFractionDigits: 0 }).format(Math.round(v));
    }
    if (format === 'percent') return `${v.toFixed(1)}%`;
    return Math.round(v).toLocaleString('es-CL');
  });

  useEffect(() => {
    const controls = animate(motionValue, value, {
      duration: 1.2,
      ease: [0.25, 0.46, 0.45, 0.94],
    });
    return controls.stop;
  }, [value, motionValue]);

  useEffect(() => {
    const unsubscribe = rounded.on('change', (v) => {
      if (ref.current) ref.current.textContent = v;
    });
    return unsubscribe;
  }, [rounded]);

  return <span ref={ref}>0</span>;
}

export default function StatCard({ label, value, icon: Icon, trend, color = 'brand', format = 'number', delay = 0 }: StatCardProps) {
  const colors = colorMap[color];
  const numericValue = typeof value === 'string' ? parseFloat(value) : value;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay, duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
      whileHover={{ y: -4, transition: { duration: 0.2 } }}
      className={cn(
        'relative p-5 rounded-2xl overflow-hidden',
        'bg-white dark:bg-surface-900',
        'border border-surface-200/50 dark:border-surface-800/50',
        'shadow-sm hover:shadow-lg transition-shadow duration-300',
        `hover:${colors.shadow}`
      )}
    >
      {/* Subtle background gradient */}
      <div className={cn(
        'absolute top-0 right-0 w-32 h-32 rounded-full opacity-[0.04] blur-2xl',
        `bg-gradient-to-br ${colors.gradient}`
      )} />

      <div className="relative flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-sm font-medium text-surface-500 dark:text-surface-400">{label}</p>
          <p className="text-2xl font-bold font-display text-surface-900 dark:text-white">
            {!isNaN(numericValue) ? (
              <AnimatedNumber value={numericValue} format={format} />
            ) : (
              value
            )}
          </p>
          {trend && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: delay + 0.3 }}
              className="flex items-center gap-1.5"
            >
              <span className={cn(
                'text-xs font-semibold',
                trend.value >= 0 ? 'text-emerald-500' : 'text-red-500'
              )}>
                {trend.value >= 0 ? '↑' : '↓'} {Math.abs(trend.value)}%
              </span>
              <span className="text-xs text-surface-400">{trend.label}</span>
            </motion.div>
          )}
        </div>

        <motion.div
          initial={{ scale: 0, rotate: -20 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ delay: delay + 0.2, type: 'spring', stiffness: 300, damping: 20 }}
          className={cn('p-2.5 rounded-xl', colors.bg)}
        >
          <Icon size={22} className={colors.icon} />
        </motion.div>
      </div>
    </motion.div>
  );
}
