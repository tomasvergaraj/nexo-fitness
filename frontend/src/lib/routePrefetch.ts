// Prefetch de chunks de ruta para colapsar la cascada de carga.
//
// Las rutas autenticadas son `React.lazy` (ver router.tsx): su chunk solo se baja
// cuando el usuario navega, y recién después de que el bundle principal se
// descargó y parseó. En un hard reload sobre una página pesada (ej. Reportes, que
// arrastra recharts) eso es una espera en serie. Aquí calentamos esos chunks:
//
//  - en idle, justo después de que el shell pinta (las páginas más comunes/pesadas)
//  - al primer indicio de intención (hover/touch sobre un link del sidebar)
//
// Los `import()` usan EXACTAMENTE el mismo specifier que router.tsx, así que Vite
// reutiliza el mismo chunk — esto no crea bundles nuevos ni duplica código.

type Importer = () => Promise<unknown>;

// Keyed por el `path` de cada item del sidebar (ver Sidebar.tsx).
const ROUTE_IMPORTERS: Record<string, Importer> = {
  '/dashboard': () => import('@/pages/dashboard/DashboardPage'),
  '/classes': () => import('@/pages/classes/ClassesPage'),
  '/clients': () => import('@/pages/clients/ClientsPage'),
  '/checkin': () => import('@/pages/checkin/CheckInPage'),
  '/reception/checkin': () => import('@/pages/checkin/ReceptionCheckInPage'),
  '/programs': () => import('@/pages/programs/ProgramsPage'),
  '/support': () => import('@/pages/support/SupportPage'),
  '/plans': () => import('@/pages/plans/PlansPage'),
  '/pos': () => import('@/pages/pos/POSPage'),
  '/promo-codes': () => import('@/pages/promo/PromoCodesPage'),
  '/gift-cards': () => import('@/pages/giftcards/GiftCardsPage'),
  '/marketing': () => import('@/pages/marketing/MarketingPage'),
  '/inventory': () => import('@/pages/inventory/InventoryPage'),
  '/expenses': () => import('@/pages/expenses/ExpensesPage'),
  '/reports': () => import('@/pages/reports/ReportsPage'),
  '/retention': () => import('@/pages/retention/RetentionPage'),
  '/audit': () => import('@/pages/audit/AuditPage'),
  '/settings': () => import('@/pages/settings/SettingsPage'),
};

// Páginas que conviene calentar apenas el shell está libre: las más visitadas y
// las más pesadas (Reportes carga recharts, el chunk de feature más grande).
const IDLE_WARM_ROUTES = ['/dashboard', '/clients', '/reports', '/pos'];

const prefetched = new Set<string>();

/** Dispara el import del chunk de `path` una sola vez. Falla en silencio. */
export function prefetchRoute(path: string): void {
  if (prefetched.has(path)) return;
  const importer = ROUTE_IMPORTERS[path];
  if (!importer) return;
  prefetched.add(path);
  void importer().catch(() => {
    // Red caída / chunk movido tras un deploy: que lo reintente la navegación real.
    prefetched.delete(path);
  });
}

/** Calienta en idle las rutas comunes/pesadas, sin competir con el render inicial. */
export function prefetchIdleRoutes(): void {
  const warm = () => IDLE_WARM_ROUTES.forEach(prefetchRoute);
  const ric = (window as typeof window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  }).requestIdleCallback;
  if (ric) {
    ric(warm, { timeout: 4000 });
  } else {
    window.setTimeout(warm, 1500);
  }
}
