import { NavLink, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  Building2,
  CreditCard,
  Tag,
  CalendarCheck2,
  Lightbulb,
  Activity,
  Mail,
  ScrollText,
  Settings,
  ChevronLeft,
  LogOut,
} from 'lucide-react';
import NexoBrand, { NEXO_BRAND_SLOGAN } from '@/components/branding/NexoBrand';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/utils';

interface NavItem {
  label: string;
  path: string;
  icon: React.ReactNode;
  badge?: number | string;
  soon?: boolean;
}

interface NavGroup {
  key: string;
  label: string;
  items: NavItem[];
}

const PRIMARY: NavItem = {
  label: 'Dashboard',
  path: '/platform/dashboard',
  icon: <LayoutDashboard size={16} />,
};

const GROUPS: NavGroup[] = [
  {
    key: 'comercial',
    label: 'Comercial',
    items: [
      { label: 'Leads', path: '/platform/leads', icon: <CalendarCheck2 size={16} /> },
      { label: 'Promo Codes', path: '/platform/promo-codes', icon: <Tag size={16} /> },
    ],
  },
  {
    key: 'cuentas',
    label: 'Cuentas',
    items: [
      { label: 'Tenants', path: '/platform/tenants', icon: <Building2 size={16} /> },
      { label: 'Planes', path: '/platform/plans', icon: <CreditCard size={16} /> },
    ],
  },
  {
    key: 'producto',
    label: 'Producto',
    items: [
      { label: 'Feedback', path: '/platform/feedback', icon: <Lightbulb size={16} /> },
      { label: 'Email templates', path: '/platform/email-templates', icon: <Mail size={16} /> },
      { label: 'Health', path: '/platform/health', icon: <Activity size={16} />, soon: true },
    ],
  },
  {
    key: 'ops',
    label: 'Ops',
    items: [
      { label: 'Audit log', path: '/platform/audit', icon: <ScrollText size={16} /> },
      { label: 'Settings', path: '/platform/settings', icon: <Settings size={16} />, soon: true },
    ],
  },
];

interface Props {
  isOpen: boolean;
  onToggle: () => void;
}

function ItemLink({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  if (item.soon) {
    return (
      <button
        type="button"
        disabled
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-surface-500 dark:text-surface-500 cursor-not-allowed"
      >
        <span className="flex-shrink-0 opacity-60">{item.icon}</span>
        <span className="truncate flex-1 text-left">{item.label}</span>
        <span className="rounded-full border border-surface-300/60 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-surface-400 dark:border-surface-700 dark:text-surface-500">
          Soon
        </span>
      </button>
    );
  }
  return (
    <NavLink
      to={item.path}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors',
          isActive
            ? 'bg-brand-500/15 text-brand-200 dark:text-brand-200 font-medium'
            : 'text-surface-300 hover:bg-white/5 hover:text-white',
        )
      }
    >
      {({ isActive }) => (
        <>
          <span className={cn('flex-shrink-0', isActive ? 'text-brand-400' : 'text-surface-400')}>
            {item.icon}
          </span>
          <span className="truncate flex-1 text-left">{item.label}</span>
          {item.badge !== undefined && (
            <span
              className={cn(
                'rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums',
                isActive
                  ? 'bg-brand-500/30 text-brand-100'
                  : 'bg-surface-700/60 text-surface-300',
              )}
            >
              {item.badge}
            </span>
          )}
          {isActive && (
            <motion.div
              layoutId="platform-sidebar-indicator"
              className="absolute left-0 h-5 w-0.5 rounded-r-full bg-brand-400"
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            />
          )}
        </>
      )}
    </NavLink>
  );
}

export default function PlatformSidebar({ isOpen, onToggle }: Props) {
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const userName = [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() || user?.email || 'Superadmin';
  const initials = [user?.first_name?.[0], user?.last_name?.[0]].filter(Boolean).join('').toUpperCase() || 'S';

  const handleNavigate = () => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) onToggle();
  };

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onToggle}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          />
        )}
      </AnimatePresence>

      <motion.aside
        initial={false}
        animate={{ x: isOpen ? 0 : -260 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[240px] flex-col',
          'bg-surface-950 border-r border-surface-800/70',
          'lg:static lg:translate-x-0',
        )}
      >
        {/* Brand */}
        <div className="flex items-center justify-between border-b border-surface-800/50 px-4 py-3.5">
          <NavLink to="/platform/dashboard" className="flex min-w-0 items-center gap-2.5">
            <NexoBrand
              iconSize={28}
              iconClassName="shadow-md shadow-brand-500/30"
              titleClassName="text-[13px] tracking-tight text-white"
              accentClassName="text-brand-400"
              subtitle="● PLATFORM ADMIN"
              subtitleClassName="font-semibold tracking-[0.18em] text-[9px] text-emerald-400"
            />
          </NavLink>
          <button
            onClick={onToggle}
            className="rounded-md p-1 text-surface-400 hover:bg-surface-800/60 hover:text-white lg:hidden"
            aria-label="Cerrar"
          >
            <ChevronLeft size={16} />
          </button>
        </div>

        {/* Nav */}
        <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 py-3">
          <div className="space-y-0.5 mb-3">
            <ItemLink item={PRIMARY} onNavigate={handleNavigate} />
          </div>

          <div className="space-y-3">
            {GROUPS.map((group) => (
              <div key={group.key}>
                <p className="px-2.5 mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-surface-500">
                  {group.label}
                </p>
                <div className="space-y-0.5 relative">
                  {group.items.map((item) => (
                    <ItemLink key={item.path} item={item} onNavigate={handleNavigate} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Slogan footer */}
          <p className="mt-6 px-2.5 text-[10px] uppercase tracking-[0.16em] text-surface-600">
            {NEXO_BRAND_SLOGAN}
          </p>
        </nav>

        {/* User card */}
        <div className="border-t border-surface-800/60 p-2.5">
          <div className="flex items-center gap-2.5 rounded-lg bg-surface-900/60 px-2.5 py-2 border border-surface-800/60">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-brand-500 to-brand-700 text-[11px] font-bold text-white shadow-md">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-white leading-tight">{userName}</p>
              <p className="text-[10px] uppercase tracking-wider text-brand-400 leading-tight mt-0.5">
                Superadmin
              </p>
            </div>
            <button
              onClick={() => {
                logout();
                window.location.href = '/login';
              }}
              className="rounded-md p-1.5 text-surface-400 hover:bg-surface-800 hover:text-rose-300"
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
            >
              <LogOut size={14} />
            </button>
          </div>
          <p className="mt-1.5 px-1 text-[10px] text-surface-600 truncate">
            {location.pathname}
          </p>
        </div>
      </motion.aside>
    </>
  );
}
