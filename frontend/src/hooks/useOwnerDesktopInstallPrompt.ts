import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import type { User } from '@/types';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

export type InstallMode = 'hidden' | 'prompt' | 'chromium' | 'safari';

export interface InstallCopy {
  title: string;
  body: string;
  hint: string;
}

interface OwnerDesktopInstallPromptState {
  installMode: InstallMode;
  installCopy: InstallCopy;
  isSuggestionOpen: boolean;
  canShowInstallEntry: boolean;
  canPromptInstall: boolean;
  shortcutTooltip: string;
  dismissSuggestion: () => void;
  showSuggestion: () => void;
  requestInstall: () => Promise<void>;
}

const DISMISS_DAYS = 14;
const OPEN_DELAY_MS = 1600;
const STORAGE_PREFIX = 'nexo:owner-desktop-install-prompt';
const FORCED_RESET_EMAILS: Record<string, string> = {
  'test@email.com': '2026-04-14-1',
};

function getStorageKey(userId?: string) {
  return userId ? `${STORAGE_PREFIX}:${userId}` : STORAGE_PREFIX;
}

function getForcedResetVersion(email?: string) {
  return email ? FORCED_RESET_EMAILS[email.trim().toLowerCase()] : undefined;
}

function getForcedResetMarkerKey(email: string, version: string) {
  return `${STORAGE_PREFIX}:forced-reset:${email.trim().toLowerCase()}:${version}`;
}

function readDismissedUntil(storageKey: string) {
  if (typeof window === 'undefined') {
    return 0;
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return 0;
    }
    const parsed = JSON.parse(raw) as { dismissedUntil?: number };
    return typeof parsed.dismissedUntil === 'number' ? parsed.dismissedUntil : 0;
  } catch {
    return 0;
  }
}

function writeDismissedUntil(storageKey: string, dismissedUntil: number) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify({ dismissedUntil }));
  } catch {
    // noop
  }
}

function isLikelyDesktopDevice() {
  if (typeof navigator === 'undefined') {
    return false;
  }

  const userAgent = navigator.userAgent.toLowerCase();
  return !/android|iphone|ipad|ipod|mobile/.test(userAgent);
}

function detectInstallMode(canPromptInstall: boolean): InstallMode {
  if (!isLikelyDesktopDevice() || typeof navigator === 'undefined') {
    return 'hidden';
  }

  if (canPromptInstall) {
    return 'prompt';
  }

  const userAgent = navigator.userAgent.toLowerCase();
  const isSafari = /safari/.test(userAgent) && !/chrome|chromium|crios|edg|opr|android/.test(userAgent);
  const isChromium = /edg|chrome|chromium|brave|opr/.test(userAgent);

  if (isSafari) {
    return 'safari';
  }
  if (isChromium) {
    return 'chromium';
  }
  return 'hidden';
}

function isStandaloneMode() {
  if (typeof window === 'undefined') {
    return false;
  }

  const iosStandalone = Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  return window.matchMedia('(display-mode: standalone)').matches || iosStandalone;
}

function getInstallCopy(mode: InstallMode): InstallCopy {
  if (mode === 'prompt') {
    return {
      title: 'Instala la app de escritorio',
      body: 'Abre el panel del owner más rápido, en su propia ventana.',
      hint: 'Toma unos segundos.',
    };
  }

  if (mode === 'safari') {
    return {
      title: 'Guarda Nexo como app',
      body: 'En Safari usa Archivo > Agregar al Dock para tener acceso rápido.',
      hint: 'Después podrás abrirlo desde el dock o escritorio.',
    };
  }

  return {
    title: 'Guarda Nexo como app',
    body: 'Desde el menú del navegador puedes usar Instalar app para entrar más rápido.',
    hint: 'Quedará disponible en tu escritorio o barra de tareas.',
  };
}

function getShortcutTooltip(mode: InstallMode) {
  if (mode === 'prompt') {
    return 'Instalar app de escritorio';
  }
  if (mode === 'safari') {
    return 'Ver cómo agregar Nexo al Dock';
  }
  return 'Ver cómo instalar la app';
}

export function useOwnerDesktopInstallPrompt(user?: User | null): OwnerDesktopInstallPromptState {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isSuggestionOpen, setIsSuggestionOpen] = useState(false);
  const [pendingInstall, setPendingInstall] = useState(false);

  const storageKey = useMemo(() => getStorageKey(user?.id), [user?.id]);
  const forcedResetVersion = useMemo(() => getForcedResetVersion(user?.email), [user?.email]);
  const installMode = useMemo(() => detectInstallMode(Boolean(deferredPrompt)), [deferredPrompt]);
  const installCopy = useMemo(() => getInstallCopy(installMode), [installMode]);
  const shortcutTooltip = useMemo(() => getShortcutTooltip(installMode), [installMode]);
  const canShowInstallEntry = user?.role === 'owner' && !isStandalone && installMode !== 'hidden';
  const canPromptInstall = installMode === 'prompt';

  useEffect(() => {
    if (typeof window === 'undefined' || !user?.email || !forcedResetVersion) {
      return;
    }

    const markerKey = getForcedResetMarkerKey(user.email, forcedResetVersion);

    try {
      if (window.localStorage.getItem(markerKey) === 'true') {
        return;
      }

      window.localStorage.removeItem(storageKey);
      window.localStorage.setItem(markerKey, 'true');
    } catch {
      // noop
    }
  }, [forcedResetVersion, storageKey, user?.email]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const media = window.matchMedia('(display-mode: standalone)');
    const syncStandalone = () => {
      setIsStandalone(isStandaloneMode());
    };

    syncStandalone();

    const handlePrompt = (event: Event) => {
      if (!isLikelyDesktopDevice()) {
        return;
      }
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const handleInstalled = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
      setIsSuggestionOpen(false);
      setPendingInstall(false);
      toast.success('Nexo Fitness quedó instalado en este equipo.');
    };

    media.addEventListener('change', syncStandalone);
    window.addEventListener('beforeinstallprompt', handlePrompt);
    window.addEventListener('appinstalled', handleInstalled);

    return () => {
      media.removeEventListener('change', syncStandalone);
      window.removeEventListener('beforeinstallprompt', handlePrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  useEffect(() => {
    if (!canShowInstallEntry || pendingInstall) {
      setIsSuggestionOpen(false);
      return undefined;
    }

    const dismissedUntil = readDismissedUntil(storageKey);
    if (dismissedUntil > Date.now()) {
      setIsSuggestionOpen(false);
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setIsSuggestionOpen(true);
    }, OPEN_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [canShowInstallEntry, pendingInstall, storageKey]);

  const dismissSuggestion = () => {
    const dismissedUntil = Date.now() + DISMISS_DAYS * 24 * 60 * 60 * 1000;
    writeDismissedUntil(storageKey, dismissedUntil);
    setIsSuggestionOpen(false);
  };

  const showSuggestion = () => {
    if (!canShowInstallEntry) {
      return;
    }
    setIsSuggestionOpen(true);
  };

  const requestInstall = async () => {
    if (!canShowInstallEntry) {
      return;
    }

    if (!deferredPrompt || installMode !== 'prompt') {
      showSuggestion();
      return;
    }

    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice.catch(() => null);
    setDeferredPrompt(null);

    if (choice?.outcome === 'accepted') {
      setIsSuggestionOpen(false);
      setPendingInstall(true);
      return;
    }

    setPendingInstall(false);
    dismissSuggestion();
  };

  return {
    installMode,
    installCopy,
    isSuggestionOpen,
    canShowInstallEntry,
    canPromptInstall,
    shortcutTooltip,
    dismissSuggestion,
    showSuggestion,
    requestInstall,
  };
}
