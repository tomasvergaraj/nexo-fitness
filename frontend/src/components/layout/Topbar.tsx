import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Menu, Search, Bell, Moon, Sun, LogOut, User, ChevronDown, ArrowUpRight, CheckCircle2, Inbox, Download,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ProfileSettingsModal from '@/components/profile/ProfileSettingsModal';
import Tooltip from '@/components/ui/Tooltip';
import { notificationsApi } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { useThemeStore } from '@/stores/themeStore';
import type { AppNotification } from '@/types';
import { cn, formatRelative } from '@/utils';
import { getNotificationActionLabel, resolveNotificationDestination } from '@/utils/notificationActions';

interface TopbarProps {
  onMenuToggle: () => void;
  showInstallShortcut?: boolean;
  installShortcutTooltip?: string;
  onInstallShortcut?: () => void;
}

export default function Topbar({
  onMenuToggle,
  showInstallShortcut = false,
  installShortcutTooltip = 'Instalar app',
  onInstallShortcut,
}: TopbarProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, logout } = useAuthStore();
  const { isDark, toggle: toggleTheme } = useThemeStore();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const userDisplayName = [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() || user?.email || 'Usuario';
  const userInitials = [user?.first_name?.[0], user?.last_name?.[0]].filter(Boolean).join('').toUpperCase() || '?';

  const { data: notifications = [], isLoading: isLoadingNotifications } = useQuery<AppNotification[]>({
    queryKey: ['topbar-notifications', user?.id],
    enabled: Boolean(user?.id && user.role !== 'superadmin'),
    staleTime: 30_000,
    queryFn: async () => (await notificationsApi.list({ limit: 6 })).data,
  });

  const notificationMutation = useMutation({
    mutationFn: async ({
      notificationId,
      payload,
    }: {
      notificationId: string;
      payload: Record<string, unknown>;
    }) => notificationsApi.update(notificationId, payload),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['topbar-notifications', user?.id] });
      await queryClient.invalidateQueries({ queryKey: ['member-notifications'] });
    },
  });

  const unreadNotifications = notifications.filter((item) => !item.is_read).length;

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const openNotification = async (notification: AppNotification) => {
    const destination = resolveNotificationDestination(notification.action_url, user?.role);

    try {
      await notificationMutation.mutateAsync({
        notificationId: notification.id,
        payload: {
          is_read: true,
          mark_opened: true,
          mark_clicked: destination.kind !== 'none',
        },
      });
    } catch {
      // Keep navigation resilient even if the read-state update fails.
    }

    setShowNotifications(false);

    if (destination.kind === 'external') {
      window.open(destination.href, '_blank', 'noopener,noreferrer');
      return;
    }
    if (destination.kind === 'internal') {
      navigate(destination.href);
    }
  };

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between h-16 px-4 lg:px-6
                        bg-white/80 dark:bg-surface-900/80 backdrop-blur-xl
                        border-b border-surface-200/50 dark:border-surface-800/50">
      {/* Left: Menu + Search */}
      <div className="flex items-center gap-3">
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={onMenuToggle}
          className="lg:hidden p-2 rounded-xl hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
        >
          <Menu size={20} className="text-surface-600 dark:text-surface-400" />
        </motion.button>

        {/* Search bar */}
        <div className="hidden sm:flex items-center">
          <AnimatePresence mode="wait">
            {showSearch ? (
              <motion.div
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 280, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: 'easeInOut' }}
                className="overflow-hidden"
              >
                <div className="relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                  <input
                    autoFocus
                    type="text"
                    placeholder="Buscar clientes, clases..."
                    className="input pl-9 pr-4 py-2 text-sm !rounded-full bg-surface-50 dark:bg-surface-800/50"
                    onBlur={() => setShowSearch(false)}
                  />
                </div>
              </motion.div>
            ) : (
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setShowSearch(true)}
                className="p-2.5 rounded-full bg-surface-50 dark:bg-surface-800/50
                           hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
              >
                <Search size={16} className="text-surface-500" />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        {showInstallShortcut ? (
          <Tooltip content={installShortcutTooltip}>
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={onInstallShortcut}
              className="inline-flex items-center gap-2 rounded-full border border-brand-200/70 bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-100 dark:border-brand-900/50 dark:bg-brand-950/30 dark:text-brand-300 dark:hover:bg-brand-950/50"
            >
              <Download size={15} />
              <span className="hidden sm:inline">Instalar app</span>
            </motion.button>
          </Tooltip>
        ) : null}

        {/* Theme toggle */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.9, rotate: 180 }}
          onClick={toggleTheme}
          className="p-2.5 rounded-full hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
        >
          <AnimatePresence mode="wait">
            {isDark ? (
              <motion.div key="sun" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }}>
                <Sun size={18} className="text-amber-500" />
              </motion.div>
            ) : (
              <motion.div key="moon" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }}>
                <Moon size={18} className="text-surface-600" />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.button>

        {/* Notifications */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => {
            setShowNotifications((current) => !current);
            setShowUserMenu(false);
          }}
          className="relative p-2.5 rounded-full hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
        >
          <Bell size={18} className="text-surface-600 dark:text-surface-400" />
          {unreadNotifications > 0 ? (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white"
            >
              {unreadNotifications > 9 ? '9+' : unreadNotifications}
            </motion.span>
          ) : null}
        </motion.button>

        <AnimatePresence>
          {showNotifications && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-40"
                onClick={() => setShowNotifications(false)}
              />
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="absolute right-16 top-14 z-50 w-[340px] overflow-hidden rounded-2xl border border-surface-200 bg-white shadow-xl dark:border-surface-700 dark:bg-surface-800"
              >
                <div className="border-b border-surface-100 px-4 py-3 dark:border-surface-700">
                  <p className="text-sm font-semibold text-surface-900 dark:text-white">Notificaciones</p>
                  <p className="text-xs text-surface-500">
                    {user?.role === 'superadmin'
                      ? 'Las alertas del panel se muestran por tenant.'
                      : unreadNotifications > 0
                        ? `${unreadNotifications} pendiente${unreadNotifications === 1 ? '' : 's'} por revisar`
                        : 'Actividad reciente y acciones pendientes'}
                  </p>
                </div>
                <div className="max-h-[420px] overflow-y-auto p-2">
                  {isLoadingNotifications ? (
                    <div className="px-3 py-8 text-center text-sm text-surface-500">
                      Cargando notificaciones...
                    </div>
                  ) : user?.role === 'superadmin' ? (
                    <div className="px-3 py-8 text-center">
                      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-2xl bg-surface-100 text-surface-400 dark:bg-surface-700/60">
                        <Inbox size={18} />
                      </div>
                      <p className="mt-3 text-sm font-medium text-surface-900 dark:text-white">Sin notificaciones globales</p>
                      <p className="mt-1 text-xs text-surface-500">
                        Cuando necesites revisar actividad SaaS, usa los módulos de tenants, planes o leads.
                      </p>
                    </div>
                  ) : notifications.length === 0 ? (
                    <div className="px-3 py-8 text-center">
                      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-2xl bg-surface-100 text-surface-400 dark:bg-surface-700/60">
                        <Inbox size={18} />
                      </div>
                      <p className="mt-3 text-sm font-medium text-surface-900 dark:text-white">Sin avisos para esta cuenta</p>
                      <p className="mt-1 text-xs text-surface-500">
                        Cuando tengas novedades o acciones pendientes, aparecerán aquí.
                      </p>
                    </div>
                  ) : (
                    notifications.map((item) => {
                      const destination = resolveNotificationDestination(item.action_url, user?.role);
                      const actionLabel = getNotificationActionLabel(item.action_url, user?.role);

                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => void openNotification(item)}
                          className="w-full rounded-xl px-3 py-3 text-left transition-colors hover:bg-surface-50 dark:hover:bg-surface-700"
                        >
                          <div className="flex items-start gap-3">
                            <div className={cn(
                              'mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg',
                              item.is_read
                                ? 'bg-surface-100 text-surface-500 dark:bg-surface-700/70 dark:text-surface-300'
                                : 'bg-brand-50 text-brand-500 dark:bg-brand-950/40'
                            )}>
                              <CheckCircle2 size={16} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-3">
                                <p className="truncate text-sm font-medium text-surface-900 dark:text-white">{item.title}</p>
                                <span className="shrink-0 text-[11px] text-surface-400">
                                  {formatRelative(item.created_at)}
                                </span>
                              </div>
                              <p className="mt-1 line-clamp-2 text-xs text-surface-500">
                                {item.message || 'Aviso del sistema sin mensaje adicional.'}
                              </p>
                              <div className="mt-2 flex items-center gap-2">
                                <span className={cn(
                                  'inline-flex items-center rounded-full px-2 py-1 text-[11px] font-medium',
                                  destination.kind === 'none'
                                    ? 'bg-surface-100 text-surface-500 dark:bg-surface-700/70 dark:text-surface-300'
                                    : 'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300'
                                )}>
                                  {actionLabel}
                                </span>
                                {!item.is_read ? <span className="text-[11px] font-medium text-brand-500">Nuevo</span> : null}
                              </div>
                            </div>
                            {destination.kind !== 'none' ? <ArrowUpRight size={14} className="mt-1 text-surface-400" /> : null}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* User menu */}
        <div className="relative">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              setShowUserMenu((current) => !current);
              setShowNotifications(false);
            }}
            className="flex items-center gap-2.5 pl-2 pr-3 py-1.5 rounded-full
                       hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-400 to-brand-600
                            flex items-center justify-center text-white text-xs font-bold
                            shadow-md shadow-brand-500/20">
              {userInitials}
            </div>
            <span className="hidden md:block text-sm font-medium text-surface-700 dark:text-surface-300">
              {user?.first_name}
            </span>
            <ChevronDown size={14} className={cn(
              'text-surface-400 transition-transform duration-200',
              showUserMenu && 'rotate-180'
            )} />
          </motion.button>

          <AnimatePresence>
            {showUserMenu && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-40"
                  onClick={() => setShowUserMenu(false)}
                />
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-full mt-2 w-56 z-50
                             bg-white dark:bg-surface-800 rounded-xl shadow-xl
                             border border-surface-200 dark:border-surface-700
                             overflow-hidden"
                >
                  <div className="p-3 border-b border-surface-100 dark:border-surface-700">
                    <p className="text-sm font-semibold text-surface-900 dark:text-white">
                      {userDisplayName}
                    </p>
                    <p className="text-xs text-surface-500 truncate">{user?.email}</p>
                  </div>
                  <div className="p-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setShowUserMenu(false);
                        setShowProfileModal(true);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg
                                 text-surface-600 dark:text-surface-400
                                 hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors"
                    >
                      <User size={16} /> Mi Perfil
                    </button>
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg
                                 text-red-600 dark:text-red-400
                                 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
                    >
                      <LogOut size={16} /> Cerrar Sesión
                    </button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>

      <ProfileSettingsModal
        open={showProfileModal}
        onClose={() => setShowProfileModal(false)}
      />
    </header>
  );
}
