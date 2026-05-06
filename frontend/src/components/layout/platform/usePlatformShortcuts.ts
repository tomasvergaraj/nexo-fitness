import { useEffect, useRef } from 'react';

type Handler = () => void;

interface ShortcutOptions {
  onCommandOpen: Handler;
  onNavigate: (path: string) => void;
  onHelp?: Handler;
}

const NAV_BINDINGS: Record<string, string> = {
  d: '/platform/dashboard',
  t: '/platform/tenants',
  l: '/platform/leads',
  p: '/platform/plans',
  c: '/platform/promo-codes',
  f: '/platform/feedback',
  e: '/platform/email-templates',
  a: '/platform/audit',
};

const SEQUENCE_TIMEOUT_MS = 1200;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

export function usePlatformShortcuts({ onCommandOpen, onNavigate, onHelp }: ShortcutOptions) {
  const seqRef = useRef<{ key: string; ts: number } | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;

      // ⌘K — open palette (works even from inputs)
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onCommandOpen();
        return;
      }

      // Skip other shortcuts when typing in form fields
      if (isTypingTarget(e.target)) return;

      // ? — help
      if (!meta && e.key === '?' && onHelp) {
        e.preventDefault();
        onHelp();
        return;
      }

      // / — focus palette search (just opens palette here)
      if (!meta && e.key === '/') {
        e.preventDefault();
        onCommandOpen();
        return;
      }

      // g + letter — navigate
      const key = e.key.toLowerCase();
      const now = Date.now();
      const previous = seqRef.current;

      if (previous && previous.key === 'g' && now - previous.ts < SEQUENCE_TIMEOUT_MS) {
        const target = NAV_BINDINGS[key];
        if (target) {
          e.preventDefault();
          onNavigate(target);
          seqRef.current = null;
          return;
        }
        seqRef.current = null;
      }

      if (key === 'g' && !meta && !e.shiftKey && !e.altKey) {
        seqRef.current = { key: 'g', ts: now };
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCommandOpen, onNavigate, onHelp]);
}
