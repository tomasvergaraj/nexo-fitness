import { useEffect } from 'react';
import { useThemeStore } from '@/stores/themeStore';
import {
  normalizeHexColor,
  hexToRgbString,
  readableInk,
  ensureReadable,
  relativeLuminance,
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_SECONDARY_COLOR,
} from '@/utils';

interface Props {
  primaryColor?: string | null;
  secondaryColor?: string | null;
  children: React.ReactNode;
}

export default function StorefrontLayout({ primaryColor, secondaryColor, children }: Props) {
  const { isDark } = useThemeStore();

  useEffect(() => {
    const brand = normalizeHexColor(primaryColor, DEFAULT_PRIMARY_COLOR) ?? DEFAULT_PRIMARY_COLOR;
    const brand2 = normalizeHexColor(secondaryColor, DEFAULT_SECONDARY_COLOR) ?? DEFAULT_SECONDARY_COLOR;
    const root = document.documentElement;
    root.style.setProperty('--gym-brand', brand);
    root.style.setProperty('--gym-brand-rgb', hexToRgbString(brand));
    root.style.setProperty('--gym-brand-2', brand2);
    // Texto legible SOBRE rellenos de marca (botones/badges): peor caso = el stop más claro del gradiente.
    const lighterStop = relativeLuminance(brand) >= relativeLuminance(brand2) ? brand : brand2;
    root.style.setProperty('--gym-brand-fg', readableInk(lighterStop));
    // Marca COMO texto sobre el fondo de la página: ajusta luminancia para cumplir 4.5:1.
    const pageBg = isDark ? '#070f14' : '#f0fafe';
    root.style.setProperty('--gym-brand-ink', ensureReadable(brand, pageBg));
    return () => {
      root.style.removeProperty('--gym-brand');
      root.style.removeProperty('--gym-brand-rgb');
      root.style.removeProperty('--gym-brand-2');
      root.style.removeProperty('--gym-brand-fg');
      root.style.removeProperty('--gym-brand-ink');
    };
  }, [primaryColor, secondaryColor, isDark]);

  return (
    <div className={`sf-root min-h-screen antialiased ${isDark ? 'dark' : ''}`}>
      {children}
    </div>
  );
}
