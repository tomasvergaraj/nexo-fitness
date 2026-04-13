import { cn } from '@/utils';

const SYSTEM_ICON_URL = '/icon.png?v=20260409-2';
export const NEXO_BRAND_SLOGAN = 'Impulsa tu negocio fitness';
export const NEXO_BRAND_VALUE_PROP = 'Vende más planes, automatiza tu operación y fideliza a tus miembros desde un solo lugar.';

type NexoBrandIconProps = {
  size?: number;
  className?: string;
  alt?: string;
};

type NexoBrandProps = {
  className?: string;
  iconClassName?: string;
  iconSize?: number;
  titleClassName?: string;
  accentClassName?: string;
  subtitle?: string;
  subtitleClassName?: string;
  align?: 'left' | 'center';
};

export function NexoBrandIcon({
  size = 40,
  className,
  alt = 'Nexo Fitness',
}: NexoBrandIconProps) {
  return (
    <img
      src={SYSTEM_ICON_URL}
      alt={alt}
      width={size}
      height={size}
      className={cn(
        'shrink-0 rounded-[22%] object-cover transition-transform duration-300 ease-out will-change-transform',
        'group-hover:-translate-y-0.5 group-hover:rotate-[2deg] group-hover:scale-[1.04]',
        className,
      )}
    />
  );
}

export default function NexoBrand({
  className,
  iconClassName,
  iconSize = 40,
  titleClassName,
  accentClassName,
  subtitle,
  subtitleClassName,
  align = 'left',
}: NexoBrandProps) {
  const centered = align === 'center';

  return (
    <div className={cn('flex items-center gap-3', centered ? 'justify-center text-center' : 'justify-start text-left', className)}>
      <NexoBrandIcon
        size={iconSize}
        className={cn('shadow-[0_18px_40px_-18px_rgba(34,211,238,0.55)]', iconClassName)}
      />
      <div className="min-w-0">
        <div className={cn('font-display font-bold tracking-tight text-white transition-transform duration-300 ease-out group-hover:translate-x-0.5', titleClassName)}>
          Nexo<span className={cn('text-brand-400', accentClassName)}>Fitness</span>
        </div>
        {subtitle ? (
          <p className={cn('mt-1 text-xs uppercase tracking-[0.24em] text-surface-400 transition-opacity duration-300 ease-out group-hover:opacity-100', subtitleClassName)}>
            {subtitle}
          </p>
        ) : null}
      </div>
    </div>
  );
}
