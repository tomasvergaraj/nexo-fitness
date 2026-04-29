import { motion } from 'framer-motion';
import { Bell, CalendarDays, Home, LifeBuoy, Menu, TrendingUp } from 'lucide-react';
import { useMemberContext } from '../MemberContext';

const PRIMARY_TABS = [
  { id: 'home' as const, icon: Home, label: 'Inicio' },
  { id: 'agenda' as const, icon: CalendarDays, label: 'Agenda' },
  { id: 'progress' as const, icon: TrendingUp, label: 'Progreso' },
  { id: 'support' as const, icon: LifeBuoy, label: 'Soporte' },
  { id: 'notifications' as const, icon: Bell, label: 'Bandeja' },
] as const;

const DRAWER_TAB_IDS = ['programs', 'plans', 'payments', 'profile'];

interface Props {
  onOpenDrawer: () => void;
}

export default function MemberBottomNav({ onOpenDrawer }: Props) {
  const { activeTab, navigateTo, accentColor, secondaryColor, navBadgeByTab } = useMemberContext();

  const isDrawerTabActive = DRAWER_TAB_IDS.includes(activeTab);

  return (
    <nav
      className="shrink-0 border-t border-surface-100 bg-white/95 backdrop-blur-md dark:border-white/10 dark:bg-surface-950/95"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex">
        {PRIMARY_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.id === activeTab;
          const badge = navBadgeByTab[tab.id];

          return (
            <motion.button
              key={tab.id}
              type="button"
              onClick={() => navigateTo(tab.id)}
              className="relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors"
              style={{ color: isActive ? accentColor : undefined }}
              whileTap={{ scale: 0.88, transition: { type: 'spring', stiffness: 500, damping: 28 } }}
            >
              {isActive && (
                <motion.span
                  layoutId="bottom-nav-pill"
                  className="absolute inset-x-3 top-0 h-0.5 rounded-full"
                  style={{ background: `linear-gradient(90deg, ${accentColor}, ${secondaryColor})` }}
                  transition={{ type: 'spring', stiffness: 380, damping: 36 }}
                />
              )}
              <span className="relative flex h-6 w-6 items-center justify-center">
                <Icon
                  size={20}
                  className={isActive ? 'text-current' : 'text-surface-400 dark:text-surface-500'}
                />
                {badge ? (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-400 px-0.5 text-[9px] font-bold text-surface-950">
                    {badge}
                  </span>
                ) : null}
              </span>
              <span className={isActive ? 'text-current' : 'text-surface-400 dark:text-surface-500'}>
                {tab.label}
              </span>
            </motion.button>
          );
        })}

        {/* Más — opens drawer */}
        <motion.button
          type="button"
          onClick={onOpenDrawer}
          className="relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors"
          style={{ color: isDrawerTabActive ? accentColor : undefined }}
          whileTap={{ scale: 0.88, transition: { type: 'spring', stiffness: 500, damping: 28 } }}
        >
          {isDrawerTabActive && (
            <motion.span
              layoutId="bottom-nav-pill"
              className="absolute inset-x-3 top-0 h-0.5 rounded-full"
              style={{ background: `linear-gradient(90deg, ${accentColor}, ${secondaryColor})` }}
              transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            />
          )}
          <span className="flex h-6 w-6 items-center justify-center">
            <Menu
              size={20}
              className={isDrawerTabActive ? 'text-current' : 'text-surface-400 dark:text-surface-500'}
            />
          </span>
          <span className={isDrawerTabActive ? 'text-current' : 'text-surface-400 dark:text-surface-500'}>
            Más
          </span>
        </motion.button>
      </div>
    </nav>
  );
}
