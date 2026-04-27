import type { CSSProperties } from 'react';

interface GlowButtonProps {
  href: string;
  children: React.ReactNode;
  className?: string;
  style?: CSSProperties;
  variant?: 'primary' | 'secondary';
  size?: 'sm' | 'md' | 'lg';
}

export default function GlowButton({
  href,
  children,
  className = '',
  style,
  variant = 'primary',
  size = 'md',
}: GlowButtonProps) {
  const sizeClass = size === 'lg' ? 'btn-lg' : size === 'sm' ? 'btn-sm' : '';
  const variantClass = variant === 'primary' ? 'btn-primary glow-btn' : 'btn-secondary';
  return (
    <a href={href} className={`btn ${variantClass} ${sizeClass} ${className}`.trim()} style={style}>
      {children}
    </a>
  );
}
