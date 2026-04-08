import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { billingApi } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';

interface BillingStatus {
  status: string;
  allow_access: boolean;
  days_remaining: number | null;
  checkout_url: string | null;
  widget_token: string | null;
  checkout_provider: string | null;
}

function TrialBanner({ billing, onDismiss }: { billing: BillingStatus; onDismiss: () => void }) {
  const days = billing.days_remaining ?? 0;
  const urgent = days <= 2;

  const handleActivate = () => {
    if (billing.checkout_url) {
      window.location.href = billing.checkout_url;
    }
  };

  return (
    <div
      className={`w-full px-4 py-2.5 flex items-center justify-between gap-3 text-sm font-medium ${
        urgent
          ? 'bg-red-600 text-white'
          : 'bg-amber-500 text-amber-950'
      }`}
    >
      <span>
        {urgent
          ? `Tu período de prueba vence en ${days === 0 ? 'menos de 1 día' : `${days} día${days !== 1 ? 's' : ''}`}. Activa tu suscripción para no perder el acceso.`
          : `Tu período de prueba vence en ${days} día${days !== 1 ? 's' : ''}.`}
      </span>
      <div className="flex items-center gap-2 shrink-0">
        {billing.checkout_url && (
          <button
            onClick={handleActivate}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
              urgent
                ? 'bg-white text-red-700 hover:bg-red-50'
                : 'bg-amber-900/20 hover:bg-amber-900/30 text-amber-950'
            }`}
          >
            Activar suscripción
          </button>
        )}
        <button
          onClick={onDismiss}
          aria-label="Cerrar"
          className="opacity-70 hover:opacity-100 transition-opacity text-lg leading-none"
        >
          ×
        </button>
      </div>
    </div>
  );
}

export default function AppLayout() {
  // Abierto por defecto solo en pantallas grandes (≥1024px).
  // En móvil/tablet empieza cerrado para no tapar el contenido.
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    // Solo verificar para roles de gimnasio (no superadmin ni clientes)
    if (!user || user.role === 'superadmin' || user.role === 'client') return;

    billingApi.getStatus()
      .then(({ data }) => {
        setBilling(data);
        // Si el acceso está denegado y no estamos ya en la billing wall → redirigir
        if (!data.allow_access && !window.location.pathname.startsWith('/billing/')) {
          const params = new URLSearchParams();
          params.set('status', data.status);
          navigate(`/billing/expired?${params.toString()}`, { replace: true });
        }
      })
      .catch(() => {
        // Silencioso — el interceptor de axios manejará 403 si llega a una API real
      });
  }, [user, navigate]);

  const showTrialBanner =
    !bannerDismissed &&
    billing?.allow_access === true &&
    billing?.status === 'trial' &&
    billing?.days_remaining !== null &&
    billing.days_remaining <= 7;

  return (
    <div className="flex h-screen overflow-hidden bg-surface-50 dark:bg-surface-950">
      <Sidebar isOpen={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Topbar onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />

        <AnimatePresence>
          {showTrialBanner && (
            <motion.div
              key="trial-banner"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden shrink-0"
            >
              <TrialBanner billing={billing!} onDismiss={() => setBannerDismissed(true)} />
            </motion.div>
          )}
        </AnimatePresence>

        <motion.main
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex-1 overflow-y-auto"
        >
          <div className="max-w-[1600px] mx-auto px-4 lg:px-6 py-6">
            <Outlet />
          </div>
        </motion.main>
      </div>
    </div>
  );
}
