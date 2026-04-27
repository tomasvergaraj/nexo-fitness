import { useEffect } from 'react';
import { useThemeStore } from '@/stores/themeStore';
import { normalizeHexColor, hexToRgbString, DEFAULT_PRIMARY_COLOR, DEFAULT_SECONDARY_COLOR } from '@/utils';

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
    return () => {
      root.style.removeProperty('--gym-brand');
      root.style.removeProperty('--gym-brand-rgb');
      root.style.removeProperty('--gym-brand-2');
    };
  }, [primaryColor, secondaryColor]);

  return (
    <div className={`sf-root min-h-screen antialiased ${isDark ? 'dark' : ''}`}>
      {children}
    </div>
  );
}
