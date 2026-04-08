import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ThemeState {
  isDark: boolean;
  toggle: () => void;
  setDark: (dark: boolean) => void;
}

const LIGHT_THEME_COLOR = '#f8fafc';
const DARK_THEME_COLOR = '#04141a';

const syncBrowserTheme = (dark: boolean) => {
  if (typeof document === 'undefined') {
    return;
  }

  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  themeColorMeta?.setAttribute('content', dark ? DARK_THEME_COLOR : LIGHT_THEME_COLOR);

  const appleStatusMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  appleStatusMeta?.setAttribute('content', dark ? 'black-translucent' : 'default');
};

const applyThemeClass = (dark: boolean) => {
  if (typeof document === 'undefined') {
    return;
  }

  document.documentElement.classList.toggle('dark', dark);
  syncBrowserTheme(dark);
};

const getStoredDarkPreference = () => {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    const stored = window.localStorage.getItem('nexo-theme');
    if (!stored) {
      return false;
    }

    const parsed = JSON.parse(stored) as { state?: { isDark?: boolean } };
    return Boolean(parsed.state?.isDark);
  } catch {
    return false;
  }
};

const initialIsDark = getStoredDarkPreference();
applyThemeClass(initialIsDark);

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      isDark: initialIsDark,
      toggle: () => {
        const next = !get().isDark;
        applyThemeClass(next);
        set({ isDark: next });
      },
      setDark: (dark: boolean) => {
        applyThemeClass(dark);
        set({ isDark: dark });
      },
    }),
    { name: 'nexo-theme' }
  )
);
