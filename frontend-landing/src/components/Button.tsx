import type { CSSProperties } from 'react';

interface ButtonProps {
  href: string;
  children: React.ReactNode;
  className?: string;
  style?: CSSProperties;
  variant?: 'primary' | 'secondary';
  size?: 'sm' | 'md' | 'lg';
}

export default function Button({
  href,
  children,
  className = '',
  style,
  variant = 'primary',
  size = 'md',
}: ButtonProps) {
  const sizeClass = size === 'lg' ? 'btn-lg' : size === 'sm' ? 'btn-sm' : '';
  const variantClass = variant === 'primary' ? 'btn-primary' : 'btn-secondary';
  return (
    <a href={href} className={`btn ${variantClass} ${sizeClass} ${className}`.trim()} style={style}>
      {children}
    </a>
  );
}
