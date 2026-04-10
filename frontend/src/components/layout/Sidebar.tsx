import { NavLink, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, CalendarDays, Users, CreditCard,
  Megaphone, BarChart3, Settings, Dumbbell, UserCheck, HelpCircle,
  ChevronLeft, ShieldCheck, WalletCards, CalendarCheck2, Tag,
} from 'lucide-react';
import NexoBrand from '@/components/branding/NexoBrand';
import { cn } from '@/utils';
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

const tenantNavItems: NavItemDef[] = [
  { label: 'Panel', path: '/dashboard', icon: <LayoutDashboard size={20} /> },
  { label: 'Clases', path: '/classes', icon: <CalendarDays size={20} />, roles: ['owner', 'admin', 'reception', 'trainer'] },
  { label: 'Clientes', path: '/clients', icon: <Users size={20} />, roles: ['owner', 'admin', 'reception', 'trainer'] },
  { label: 'Planes', path: '/plans', icon: <CreditCard size={20} />, roles: ['owner', 'admin'] },
  { label: 'Códigos Promo', path: '/promo-codes', icon: <Tag size={20} />, roles: ['owner', 'admin'] },
  { label: 'Check-in', path: '/checkin', icon: <UserCheck size={20} />, roles: ['owner', 'admin', 'reception'] },
  { label: 'Programas', path: '/programs', icon: <Dumbbell size={20} />, roles: ['owner', 'admin', 'trainer'] },
  { label: 'Marketing', path: '/marketing', icon: <Megaphone size={20} />, roles: ['owner', 'admin', 'marketing'] },
  { label: 'Reportes', path: '/reports', icon: <BarChart3 size={20} />, roles: ['owner', 'admin'] },
  { label: 'Soporte', path: '/support', icon: <HelpCircle size={20} />, roles: ['owner', 'admin', 'reception'] },
  { label: 'Configuración', path: '/settings', icon: <Settings size={20} />, roles: ['owner', 'admin'] },
];

const superadminNavItems: NavItemDef[] = [
  { label: 'Cuentas SaaS', path: '/platform/tenants', icon: <ShieldCheck size={20} />, roles: ['superadmin'] },
  { label: 'Planes SaaS', path: '/platform/plans', icon: <WalletCards size={20} />, roles: ['superadmin'] },
  { label: 'Oportunidades', path: '/platform/leads', icon: <CalendarCheck2 size={20} />, roles: ['superadmin'] },
];

export default function Sidebar({ isOpen, onToggle }: SidebarProps) {
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const userRole = user?.role;
  const homePath = userRole === 'superadmin' ? '/platform/tenants' : '/dashboard';

  const filteredItems = (userRole === 'superadmin' ? superadminNavItems : tenantNavItems).filter(
    (item) => !item.roles || (userRole && item.roles.includes(userRole))
  );

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
          'fixed left-0 top-0 bottom-0 w-[270px] z-50',
          'bg-white/95 dark:bg-surface-900/95 backdrop-blur-2xl',
          'border-r border-surface-200/60 dark:border-surface-800/60',
          'flex flex-col',
          'lg:translate-x-0 lg:static lg:z-auto'
        )}
      >
        {/* Brand Header */}
        <div className="flex items-center justify-between px-5 py-5 border-b border-surface-100 dark:border-surface-800/50">
          <NavLink to={homePath} className="flex items-center gap-2.5 group">
            <NexoBrand
              iconSize={36}
              iconClassName="shadow-lg shadow-brand-500/25"
              titleClassName="text-base tracking-tight text-surface-900 dark:text-white"
              accentClassName="text-brand-500"
              subtitle="Plataforma SaaS"
              subtitleClassName="font-medium tracking-widest text-[10px] text-surface-400 dark:text-surface-500"
            />
          </NavLink>
          <button onClick={onToggle} className="lg:hidden p-1 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800">
            <ChevronLeft size={18} className="text-surface-500" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {filteredItems.map((item, index) => (
            <motion.div
              key={item.path}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.04, duration: 0.3 }}
            >
              <NavLink
                to={item.path}
                className={({ isActive }) => cn('sidebar-item group', isActive && 'active')}
                onClick={() => {
                  if (window.innerWidth < 1024) onToggle();
                }}
              >
                <span className="flex-shrink-0 transition-transform duration-200 group-hover:scale-110">
                  {item.icon}
                </span>
                <span className="truncate">{item.label}</span>
                {location.pathname === item.path && (
                  <motion.div
                    layoutId="sidebar-indicator"
                    className="ml-auto w-1.5 h-1.5 rounded-full bg-brand-500"
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  />
                )}
              </NavLink>
            </motion.div>
          ))}
        </nav>

        {/* User card */}
        {user && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="mx-3 mb-4 p-3 rounded-xl bg-gradient-to-r from-brand-50 to-brand-100/50
                       dark:from-brand-950/40 dark:to-brand-900/20
                       border border-brand-200/30 dark:border-brand-800/20"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-400 to-brand-600
                              flex items-center justify-center text-white text-xs font-bold shadow-md">
                {user.first_name[0]}{user.last_name[0]}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-surface-900 dark:text-white truncate">
                  {user.first_name} {user.last_name}
                </p>
                <p className="text-xs text-brand-600 dark:text-brand-400 capitalize">{user.role}</p>
              </div>
            </div>
          </motion.div>
        )}
      </motion.aside>
    </>
  );
}
