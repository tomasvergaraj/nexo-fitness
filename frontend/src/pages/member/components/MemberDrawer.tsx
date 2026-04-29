import { motion, AnimatePresence } from 'framer-motion';
import {
  Bell,
  CalendarDays,
  ChevronDown,
  CreditCard,
  Download,
  Dumbbell,
  Home,
  LifeBuoy,
  LogOut,
  Moon,
  RefreshCcw,
  Sun,
  Ticket,
  TrendingUp,
  UserRound,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { cn, formatMembershipStatusLabel, formatRelative } from '@/utils';
import { membershipStatusColor } from '@/utils';
import { useMemberContext } from '../MemberContext';

const DRAWER_TABS = [
  { id: 'home' as const, icon: Home, label: 'Inicio' },
  { id: 'agenda' as const, icon: CalendarDays, label: 'Agenda' },
  { id: 'progress' as const, icon: TrendingUp, label: 'Progreso' },
  { id: 'programs' as const, icon: Dumbbell, label: 'Programas' },
  { id: 'support' as const, icon: LifeBuoy, label: 'Soporte' },
  { id: 'plans' as const, icon: Ticket, label: 'Planes' },
  { id: 'payments' as const, icon: CreditCard, label: 'Pagos' },
  { id: 'notifications' as const, icon: Bell, label: 'Bandeja' },
  { id: 'profile' as const, icon: UserRound, label: 'Perfil' },
] as const;

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function MemberDrawer({ isOpen, onClose }: Props) {
  const {
    activeTab,
    navigateTo,
    accentColor,
    secondaryColor,
    brandGradient,
    isDark,
    toggleTheme,
    tenantDisplayName,
    ownerLogoUrl,
    memberFullName,
    wallet,
    isStandalone,
    isSyncing,
    webPushSupported,
    webPushConfigured,
    activeWebPushSubscription,
    navBadgeByTab,
    lastSyncedAt,
    withAlpha,
    syncMemberData,
    enableWebPush,
    installApp,
    logoutMember,
    registerPushSubscriptionMutation,
  } = useMemberContext();

  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['nav']));

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleTabClick = (id: typeof DRAWER_TABS[number]['id']) => {
    navigateTo(id);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex" onClick={onClose}>
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
          />

          {/* Panel */}
          <motion.div
            className="relative flex h-full w-[300px] max-w-[85vw] flex-col overflow-hidden bg-white shadow-2xl dark:bg-surface-950"
            style={{ paddingTop: 'env(safe-area-inset-top)' }}
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-1 w-full shrink-0" style={{ backgroundImage: brandGradient }} />

            {/* User card */}
            <div className="flex shrink-0 items-center gap-3 border-b border-surface-100 px-5 py-4 dark:border-white/10">
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl text-lg font-bold text-white shadow-sm"
                style={{ background: `linear-gradient(135deg, ${accentColor}, ${secondaryColor})` }}
              >
                {ownerLogoUrl ? (
                  <img src={ownerLogoUrl} alt={tenantDisplayName} className="h-full w-full object-cover" />
                ) : (
                  tenantDisplayName.charAt(0).toUpperCase()
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-surface-900 dark:text-white">
                  {memberFullName}
                </p>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {wallet?.membership_status && (
                    <span className={cn('badge', membershipStatusColor(wallet.membership_status))}>
                      {formatMembershipStatusLabel(wallet.membership_status)}
                    </span>
                  )}
                </div>
              </div>
              <motion.button
                type="button"
                onClick={onClose}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-surface-500 hover:bg-surface-100 dark:text-surface-400 dark:hover:bg-white/10"
                whileTap={{ scale: 0.9 }}
              >
                <X size={18} />
              </motion.button>
            </div>

            {/* Scrollable nav */}
            <div className="flex-1 overflow-y-auto py-2">
              {/* Navegación */}
              <div>
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-5 py-2.5 text-[11px] font-semibold uppercase tracking-widest text-surface-400 dark:text-surface-500"
                  onClick={() => toggleSection('nav')}
                >
                  Navegación
                  <ChevronDown
                    size={13}
                    className={cn(
                      'transition-transform duration-200',
                      expandedSections.has('nav') && 'rotate-180',
                    )}
                  />
                </button>
                <AnimatePresence initial={false}>
                  {expandedSections.has('nav') && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
                      style={{ overflow: 'hidden' }}
                    >
                      {DRAWER_TABS.map((tab) => {
                        const Icon = tab.icon;
                        const isActive = tab.id === activeTab;
                        const badge = navBadgeByTab[tab.id];
                        return (
                          <motion.button
                            key={tab.id}
                            type="button"
                            onClick={() => handleTabClick(tab.id)}
                            className={cn(
                              'flex w-full items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors',
                              isActive
                                ? 'text-surface-900 dark:text-white'
                                : 'text-surface-600 hover:text-surface-900 dark:text-surface-400 dark:hover:text-white',
                            )}
                            style={
                              isActive
                                ? {
                                    background: `linear-gradient(90deg, ${withAlpha(accentColor, isDark ? 0.18 : 0.1)}, transparent)`,
                                  }
                                : undefined
                            }
                            whileTap={{ scale: 0.98 }}
                          >
                            <span
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-all"
                              style={
                                isActive
                                  ? {
                                      background: `linear-gradient(135deg, ${accentColor}, ${secondaryColor})`,
                                      color: 'white',
                                    }
                                  : undefined
                              }
                            >
                              <Icon size={16} />
                            </span>
                            <span className="flex-1 text-left">{tab.label}</span>
                            {badge ? (
                              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-400 px-1 text-[10px] font-bold text-surface-950">
                                {badge}
                              </span>
                            ) : null}
                          </motion.button>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Ajustes */}
              <div className="mt-1 border-t border-surface-100 pt-1 dark:border-white/10">
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-5 py-2.5 text-[11px] font-semibold uppercase tracking-widest text-surface-400 dark:text-surface-500"
                  onClick={() => toggleSection('settings')}
                >
                  Ajustes
                  <ChevronDown
                    size={13}
                    className={cn(
                      'transition-transform duration-200',
                      expandedSections.has('settings') && 'rotate-180',
                    )}
                  />
                </button>
                <AnimatePresence initial={false}>
                  {expandedSections.has('settings') && (
                    <motion.div
                      className="space-y-0.5 px-3"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
                      style={{ overflow: 'hidden' }}
                    >
                      <button
                        type="button"
                        onClick={toggleTheme}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-surface-700 transition-colors hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-white/10"
                      >
                        {isDark ? <Sun size={16} /> : <Moon size={16} />}
                        {isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void installApp();
                          onClose();
                        }}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-surface-700 transition-colors hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-white/10"
                      >
                        <Download size={16} />
                        {isStandalone ? 'App instalada' : 'Instalar app'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void enableWebPush()}
                        disabled={
                          !webPushSupported ||
                          !webPushConfigured ||
                          registerPushSubscriptionMutation.isPending
                        }
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-surface-700 transition-colors hover:bg-surface-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-surface-300 dark:hover:bg-white/10"
                      >
                        <Bell size={16} />
                        {!webPushSupported
                          ? 'Avisos no disponibles'
                          : !webPushConfigured
                            ? 'Avisos próximamente'
                            : activeWebPushSubscription
                              ? 'Avisos activos'
                              : 'Activar avisos'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void syncMemberData()}
                        disabled={isSyncing}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-surface-700 transition-colors hover:bg-surface-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-surface-300 dark:hover:bg-white/10"
                      >
                        <RefreshCcw size={16} className={cn(isSyncing && 'animate-spin')} />
                        Actualizar datos
                        {lastSyncedAt ? (
                          <span className="ml-auto text-[10px] text-surface-400">
                            {formatRelative(lastSyncedAt.toISOString())}
                          </span>
                        ) : null}
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Logout */}
            <div
              className="shrink-0 border-t border-surface-100 p-4 dark:border-white/10"
              style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
            >
              <motion.button
                type="button"
                onClick={() => void logoutMember()}
                className="flex w-full items-center gap-3 rounded-2xl border border-surface-200 bg-surface-50 px-4 py-3 text-sm font-medium text-rose-600 transition-colors hover:border-rose-200 hover:bg-rose-50 dark:border-white/10 dark:bg-white/[0.03] dark:text-rose-400 dark:hover:border-rose-400/30 dark:hover:bg-rose-500/10"
                whileTap={{ scale: 0.98 }}
              >
                <LogOut size={16} />
                Cerrar sesión
              </motion.button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
