import { useEffect } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useThemeStore } from '@/stores/themeStore';
import {
  normalizeHexColor,
  hexToRgbString,
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
  const { isDark, toggle } = useThemeStore();

  useEffect(() => {
    const brand = normalizeHexColor(primaryColor, DEFAULT_PRIMARY_COLOR) ?? DEFAULT_PRIMARY_COLOR;
    const brand2 = normalizeHexColor(secondaryColor, DEFAULT_SECONDARY_COLOR) ?? DEFAULT_SECONDARY_COLOR;
    const root = document.documentElement;
    root.style.setProperty('--gym-brand', brand);
    root.style.setProperty('--gym-brand-rgb', hexToRgbString(brand));
    root.style.setProperty('--gym-brand-2', brand2);
    // Texto SOBRE rellenos de marca (botones/badges): el relleno es un gradiente
    // brand→brand2. Evaluamos el promedio y sesgamos a blanco (lo esperado en un CTA
    // de color), saltando a tinta oscura solo en marcas genuinamente claras
    // (amarillo/lima) donde el blanco sería ilegible.
    const fillLum = (relativeLuminance(brand) + relativeLuminance(brand2)) / 2;
    root.style.setProperty('--gym-brand-fg', fillLum > 0.55 ? '#0a1f2b' : '#ffffff');
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
      <button
        type="button"
        onClick={toggle}
        aria-label={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
        className="sf-theme-toggle fixed top-4 right-4 z-[60] flex h-11 w-11 items-center justify-center rounded-full"
      >
        {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
      </button>
      {children}
    </div>
  );
}
