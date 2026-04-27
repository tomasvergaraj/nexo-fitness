import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, CalendarDays, Users, CreditCard,
  Megaphone, BarChart3, Settings, Dumbbell, UserCheck, HelpCircle,
  ChevronLeft, ChevronRight, ShieldCheck, WalletCards, CalendarCheck2, Tag,
  ShoppingCart, Package, TrendingDown, Lightbulb, Receipt,
} from 'lucide-react';
import NexoBrand, { NEXO_BRAND_SLOGAN } from '@/components/branding/NexoBrand';
import { canAccessDashboard, cn, getDefaultRouteForRole } from '@/utils';
import { useAuthStore } from '@/stores/authStore';
import type { UserRole } from '@/types';

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

interface NavItemDef {
  label: string;
  path: string;
  icon: React.ReactNode;
  roles?: UserRole[];
}

interface NavGroupDef {
  key: string;
  label: string;
  items: NavItemDef[];
}

function resolveNavPath(path: string, role?: UserRole | null) {
  if (path === '/checkin' && role === 'reception') return '/reception/checkin';
  return path;
}

function isPathActive(path: string, pathname: string, role?: UserRole | null) {
  const resolved = resolveNavPath(path, role);
  return (
    pathname === resolved
    || (resolved === '/reception/checkin' && pathname === '/checkin' && role === 'reception')
  );
}

// ─── Navigation data ───────────────────────────────────────────

const pinnedTopItems: NavItemDef[] = [
  { label: 'Panel', path: '/dashboard', icon: <LayoutDashboard size={18} />, roles: ['owner', 'admin'] },
];

const tenantNavGroups: NavGroupDef[] = [
  {
    key: 'operacion',
    label: 'Operación',
    items: [
      { label: 'Clases', path: '/classes', icon: <CalendarDays size={16} />, roles: ['owner', 'admin', 'reception', 'trainer'] },
      { label: 'Clientes', path: '/clients', icon: <Users size={16} />, roles: ['owner', 'admin', 'reception', 'trainer'] },
      { label: 'Check-in', path: '/checkin', icon: <UserCheck size={16} />, roles: ['owner', 'admin', 'reception'] },
      { label: 'Programas', path: '/programs', icon: <Dumbbell size={16} />, roles: ['owner', 'admin', 'trainer'] },
      { label: 'Soporte', path: '/support', icon: <HelpCircle size={16} />, roles: ['owner', 'admin', 'reception'] },
    ],
  },
  {
    key: 'comercial',
    label: 'Comercial',
    items: [
      { label: 'Planes', path: '/plans', icon: <CreditCard size={16} />, roles: ['owner', 'admin'] },
      { label: 'Caja POS', path: '/pos', icon: <ShoppingCart size={16} />, roles: ['owner', 'admin', 'reception'] },
      { label: 'Códigos Promo', path: '/promo-codes', icon: <Tag size={16} />, roles: ['owner', 'admin'] },
      { label: 'Marketing', path: '/marketing', icon: <Megaphone size={16} />, roles: ['owner', 'admin', 'marketing'] },
    ],
  },
  {
    key: 'finanzas',
    label: 'Finanzas',
    items: [
      { label: 'Inventario', path: '/inventory', icon: <Package size={16} />, roles: ['owner', 'admin'] },
      { label: 'Gastos', path: '/expenses', icon: <TrendingDown size={16} />, roles: ['owner', 'admin'] },
      { label: 'Reportes', path: '/reports', icon: <BarChart3 size={16} />, roles: ['owner', 'admin'] },
    ],
  },
];

const pinnedBottomItems: NavItemDef[] = [
  { label: 'Configuración', path: '/settings', icon: <Settings size={18} />, roles: ['owner', 'admin'] },
];

const superadminNavItems: NavItemDef[] = [
  { label: 'Cuentas SaaS', path: '/platform/tenants', icon: <ShieldCheck size={18} />, roles: ['superadmin'] },
  { label: 'Planes SaaS', path: '/platform/plans', icon: <WalletCards size={18} />, roles: ['superadmin'] },
  { label: 'Promo Codes SaaS', path: '/platform/promo-codes', icon: <Tag size={18} />, roles: ['superadmin'] },
  { label: 'Oportunidades', path: '/platform/leads', icon: <CalendarCheck2 size={18} />, roles: ['superadmin'] },
  { label: 'Feedback', path: '/platform/feedback', icon: <Lightbulb size={18} />, roles: ['superadmin'] },
];

// ─── Sub-components ────────────────────────────────────────────

function PinnedNavItem({
  item,
  userRole,
  pathname,
  onClick,
  isDashboardFallback,
}: {
  item: NavItemDef;
  userRole?: UserRole | null;
  pathname: string;
  onClick: () => void;
  isDashboardFallback?: boolean;
}) {
  const resolvedPath = resolveNavPath(item.path, userRole);
  const isActive = isPathActive(item.path, pathname, userRole) || isDashboardFallback;

  return (
    <NavLink
      to={resolvedPath}
      className={() => cn('sidebar-item group', isActive && 'active')}
      onClick={onClick}
    >
      <span className="flex-shrink-0 transition-transform duration-200 group-hover:scale-110">
        {item.icon}
      </span>
      <span className="truncate">{item.label}</span>
      {isActive && (
        <motion.div
          layoutId="sidebar-indicator"
          className="ml-auto h-1.5 w-1.5 rounded-full bg-brand-500"
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        />
      )}
    </NavLink>
  );
}

function NavGroup({
  group,
  userRole,
  pathname,
  isOpen,
  onToggle,
  onNavigate,
}: {
  group: NavGroupDef;
  userRole?: UserRole | null;
  pathname: string;
  isOpen: boolean;
  onToggle: () => void;
  onNavigate: () => void;
}) {
  const visibleItems = group.items.filter(
    (item) => !item.roles || (userRole && item.roles.includes(userRole)),
  );
  if (visibleItems.length === 0) return null;

  const hasActive = visibleItems.some((item) => isPathActive(item.path, pathname, userRole));

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[11px] font-bold uppercase tracking-[0.2em] transition-colors',
          hasActive
            ? 'text-brand-600 dark:text-brand-400'
            : 'text-surface-400 hover:text-surface-600 dark:text-surface-500 dark:hover:text-surface-300',
        )}
      >
        <span className="flex-1 text-left">{group.label}</span>
        <ChevronRight
          size={12}
          className={cn('shrink-0 transition-transform duration-200', isOpen && 'rotate-90')}
        />
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="space-y-0.5 pb-2 pl-2 pt-0.5">
              {visibleItems.map((item) => {
                const resolvedPath = resolveNavPath(item.path, userRole);
                const isActive = isPathActive(item.path, pathname, userRole);
                return (
                  <NavLink
                    key={item.path}
                    to={resolvedPath}
                    className={() => cn(
                      'flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-all duration-150',
                      isActive
                        ? 'bg-brand-50 font-semibold text-brand-700 dark:bg-brand-950/30 dark:text-brand-300'
                        : 'text-surface-600 hover:bg-surface-50 hover:text-surface-900 dark:text-surface-400 dark:hover:bg-surface-800/50 dark:hover:text-surface-200',
                    )}
                    onClick={onNavigate}
                  >
                    <span className={cn(
                      'flex-shrink-0',
                      isActive ? 'text-brand-500' : 'text-surface-400 dark:text-surface-500',
                    )}>
                      {item.icon}
                    </span>
                    <span className="truncate">{item.label}</span>
                    {isActive && (
                      <motion.div
                        layoutId="sidebar-indicator"
                        className="ml-auto h-1.5 w-1.5 rounded-full bg-brand-500"
                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                      />
                    )}
                  </NavLink>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────

function getInitialOpenGroups(pathname: string, role?: UserRole | null): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  tenantNavGroups.forEach((group) => {
    result[group.key] = group.items.some((item) => isPathActive(item.path, pathname, role));
  });
  return result;
}

export default function Sidebar({ isOpen, onToggle }: SidebarProps) {
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const userRole = user?.role;
  const homePath = getDefaultRouteForRole(userRole);
  const userDisplayName = [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() || user?.email || 'Usuario';
  const userInitials = [user?.first_name?.[0], user?.last_name?.[0]].filter(Boolean).join('').toUpperCase() || '?';

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(
    () => getInitialOpenGroups(location.pathname, userRole),
  );

  // Auto-open group when navigating to one of its items
  useEffect(() => {
    tenantNavGroups.forEach((group) => {
      if (group.items.some((item) => isPathActive(item.path, location.pathname, userRole))) {
        setOpenGroups((prev) => (prev[group.key] ? prev : { ...prev, [group.key]: true }));
      }
    });
  }, [location.pathname, userRole]);

  const toggleGroup = (key: string) => {
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleNavigate = () => {
    if (window.innerWidth < 1024) onToggle();
  };

  const isSuperadmin = userRole === 'superadmin';
  const isDashboardRouteActive = location.pathname === '/dashboard' && !canAccessDashboard(userRole);

  const visiblePinnedTop = pinnedTopItems.filter(
    (item) => !item.roles || (userRole && item.roles.includes(userRole)),
  );
  const visiblePinnedBottom = pinnedBottomItems.filter(
    (item) => !item.roles || (userRole && item.roles.includes(userRole)),
  );
  const showSubscription = userRole === 'owner';
  const showFeedback = userRole === 'owner' || userRole === 'admin' || userRole === 'reception';

  return (
    <>
      {/* Mobile overlay */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onToggle}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <motion.aside
        initial={false}
        animate={{ x: isOpen ? 0 : -280 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className={cn(
          'fixed left-0 top-0 bottom-0 w-[260px] z-50',
          'bg-white/95 dark:bg-surface-900/95 backdrop-blur-2xl',
          'border-r border-surface-200/60 dark:border-surface-800/60',
          'flex flex-col',
          'lg:translate-x-0 lg:static lg:z-auto',
        )}
      >
        {/* Brand */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-100 dark:border-surface-800/50">
          <NavLink to={homePath} className="flex items-center gap-2.5 group">
            <NexoBrand
              iconSize={34}
              iconClassName="shadow-lg shadow-brand-500/25"
              titleClassName="text-base tracking-tight text-surface-900 dark:text-white"
              accentClassName="text-brand-500"
              subtitle={NEXO_BRAND_SLOGAN}
              subtitleClassName="font-medium tracking-widest text-[10px] text-surface-400 dark:text-surface-500"
            />
          </NavLink>
          <button onClick={onToggle} className="lg:hidden p-1 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800">
            <ChevronLeft size={18} className="text-surface-500" />
          </button>
        </div>

        {/* Navigation — scrollable */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 space-y-0.5">

          {/* Superadmin flat list */}
          {isSuperadmin && (
            <nav className="space-y-0.5">
              {superadminNavItems.map((item) => (
                <PinnedNavItem
                  key={item.path}
                  item={item}
                  userRole={userRole}
                  pathname={location.pathname}
                  onClick={handleNavigate}
                />
              ))}
            </nav>
          )}

          {/* Tenant navigation */}
          {!isSuperadmin && (
            <>
              {/* Pinned top: Panel */}
              {visiblePinnedTop.length > 0 && (
                <nav className="space-y-0.5 pb-2">
                  {visiblePinnedTop.map((item) => (
                    <PinnedNavItem
                      key={item.path}
                      item={item}
                      userRole={userRole}
                      pathname={location.pathname}
                      onClick={handleNavigate}
                      isDashboardFallback={item.path === '/dashboard' && isDashboardRouteActive}
                    />
                  ))}
                </nav>
              )}

              {/* Collapsible groups */}
              <div className="space-y-0.5">
                {tenantNavGroups.map((group) => (
                  <NavGroup
                    key={group.key}
                    group={group}
                    userRole={userRole}
                    pathname={location.pathname}
                    isOpen={!!openGroups[group.key]}
                    onToggle={() => toggleGroup(group.key)}
                    onNavigate={handleNavigate}
                  />
                ))}
              </div>

              {/* Pinned bottom: Soporte + Configuración */}
              {visiblePinnedBottom.length > 0 && (
                <nav className="space-y-0.5 border-t border-surface-100 pt-2 dark:border-surface-800/50 mt-1">
                  {visiblePinnedBottom.map((item) => (
                    <PinnedNavItem
                      key={item.path}
                      item={item}
                      userRole={userRole}
                      pathname={location.pathname}
                      onClick={handleNavigate}
                    />
                  ))}
                </nav>
              )}
            </>
          )}
        </div>

        {/* Fixed bottom: Mi Suscripción + Feedback — always visible, outside scroll */}
        {!isSuperadmin && (showSubscription || showFeedback) && (
          <div className="border-t border-surface-100 px-3 pb-1 pt-2 dark:border-surface-800/50">
            {showSubscription && (() => {
              const isSubActive = location.pathname === '/subscription';
              return (
                <NavLink
                  to="/subscription"
                  className={() => cn(
                    'flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition-all duration-150',
                    isSubActive
                      ? 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300'
                      : 'text-surface-600 hover:bg-violet-50/60 hover:text-violet-700 dark:text-surface-400 dark:hover:bg-violet-950/20 dark:hover:text-violet-300',
                  )}
                  onClick={handleNavigate}
                >
                  <Receipt
                    size={18}
                    className={isSubActive ? 'text-violet-600 dark:text-violet-400' : 'text-surface-400 dark:text-surface-500'}
                  />
                  <span className="truncate">Mi Suscripción</span>
                  {isSubActive && (
                    <span className="ml-auto h-1.5 w-1.5 rounded-full bg-violet-500 shadow-[0_0_0_4px_rgba(139,92,246,0.12)]" />
                  )}
                </NavLink>
              );
            })()}

            {showFeedback && (() => {
              const isFbActive = location.pathname === '/feedback';
              return (
                <NavLink
                  to="/feedback"
                  className={() => cn('sidebar-item-feedback group', isFbActive && 'active')}
                  onClick={handleNavigate}
                >
                  <span className="flex-shrink-0 transition-transform duration-200 group-hover:scale-110">
                    <Lightbulb size={18} />
                  </span>
                  <span className="truncate">Feedback</span>
                  {isFbActive && (
                    <span className="ml-auto h-1.5 w-1.5 rounded-full bg-rose-500 shadow-[0_0_0_4px_rgba(244,63,94,0.12)]" />
                  )}
                </NavLink>
              );
            })()}
          </div>
        )}

        {/* User card */}
        {user && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mx-3 mb-4 mt-2 rounded-xl border border-brand-200/30 bg-gradient-to-r from-brand-50 to-brand-100/50 p-3 dark:border-brand-800/20 dark:from-brand-950/40 dark:to-brand-900/20"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 text-xs font-bold text-white shadow-md">
                {userInitials}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-surface-900 dark:text-white">
                  {userDisplayName}
                </p>
                <p className="text-xs capitalize text-brand-600 dark:text-brand-400">{user.role}</p>
              </div>
            </div>
          </motion.div>
        )}
      </motion.aside>
    </>
  );
}
