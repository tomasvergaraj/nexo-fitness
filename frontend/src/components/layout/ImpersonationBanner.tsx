import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LogOut, ShieldAlert } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { getImpersonationClaims, stopImpersonation } from '@/utils/impersonation';

export default function ImpersonationBanner() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [busy, setBusy] = useState(false);
  const claims = getImpersonationClaims(accessToken);

  // Refresh on storage events (cross-tab safety)
  useEffect(() => {
    if (!claims.active) return undefined;
    const handler = () => {
      // No-op trigger: re-render via state
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [claims.active]);

  if (!claims.active) return null;

  const onStop = () => {
    if (busy) return;
    if (!window.confirm('¿Salir del modo impersonación y volver a tu sesión de superadmin?')) return;
    setBusy(true);
    const restored = stopImpersonation();
    setBusy(false);
    if (restored) {
      window.location.href = '/platform/dashboard';
    } else {
      window.location.href = '/login';
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: 'auto', opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="overflow-hidden shrink-0"
      >
        <div className="flex w-full items-center justify-between gap-3 bg-rose-600 px-4 py-2 text-sm font-medium text-white">
          <div className="flex min-w-0 items-center gap-2">
            <ShieldAlert size={15} className="shrink-0" />
            <span className="truncate">
              <strong>Impersonación activa</strong>
              {claims.byEmail ? ` · iniciada por ${claims.byEmail}` : ''}
              <span className="ml-1 hidden text-rose-100 sm:inline">— toda acción queda en el audit log.</span>
            </span>
          </div>
          <button
            type="button"
            onClick={onStop}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
          >
            <LogOut size={12} /> Salir
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
