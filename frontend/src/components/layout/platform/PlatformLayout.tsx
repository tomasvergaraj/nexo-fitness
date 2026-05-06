import { useEffect, useRef, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import PlatformSidebar from './PlatformSidebar';
import PlatformTopbar from './PlatformTopbar';
import PlatformCommandPalette from './PlatformCommandPalette';
import { usePlatformShortcuts } from './usePlatformShortcuts';
import { useThemeStore } from '@/stores/themeStore';

export default function PlatformLayout() {
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true,
  );
  const wasDesktopRef = useRef(typeof window !== 'undefined' ? window.innerWidth >= 1024 : true);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Force dark while inside platform shell so existing `dark:` styles render
  // correctly. Restore the user's stored preference when leaving.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const wasDark = document.documentElement.classList.contains('dark');
    document.documentElement.classList.add('dark');
    return () => {
      const stored = useThemeStore.getState().isDark;
      if (stored) {
        document.documentElement.classList.add('dark');
      } else if (!wasDark) {
        document.documentElement.classList.remove('dark');
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => {
      const isDesktop = window.innerWidth >= 1024;
      if (isDesktop !== wasDesktopRef.current) {
        setSidebarOpen(isDesktop);
        wasDesktopRef.current = isDesktop;
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  usePlatformShortcuts({
    onCommandOpen: () => setPaletteOpen(true),
    onNavigate: (path) => navigate(path),
    onHelp: () => setPaletteOpen(true),
  });

  return (
    <div className="flex h-screen overflow-hidden bg-surface-950 text-surface-100">
      <PlatformSidebar isOpen={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <PlatformTopbar
          onMenuToggle={() => setSidebarOpen(!sidebarOpen)}
          onCommandOpen={() => setPaletteOpen(true)}
        />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1500px] px-4 py-5 lg:px-6 lg:py-6">
            <Outlet />
          </div>
        </main>
      </div>

      <PlatformCommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
