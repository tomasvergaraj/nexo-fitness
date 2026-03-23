import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Menu, Search, Bell, Moon, Sun, LogOut, User, ChevronDown, ArrowUpRight, CheckCircle2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useThemeStore } from '@/stores/themeStore';
import { cn } from '@/utils';

interface TopbarProps {
  onMenuToggle: () => void;
}

const notifications = [
  {
    id: 'payments',
    title: 'Pagos pendientes por revisar',
    description: 'Hay membresias con cobro pendiente.',
    path: '/reports',
  },
  {
    id: 'checkins',
    title: 'El modulo de check-in esta listo',
    description: 'Puedes registrar ingresos manuales.',
    path: '/checkin',
  },
  {
    id: 'support',
    title: 'Soporte tiene interacciones abiertas',
    description: 'Revisa tickets recientes del equipo.',
    path: '/support',
  },
];

export default function Topbar({ onMenuToggle }: TopbarProps) {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { isDark, toggle: toggleTheme } = useThemeStore();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const notificationsList = user?.role === 'superadmin'
    ? [
        {
          id: 'tenants',
          title: 'Revisa el pipeline SaaS',
          description: 'Monitorea trials, activaciones y tenants con riesgo.',
          path: '/platform/tenants',
        },
      ]
    : notifications;

  const handleLogout = () => {
    logout();
    navigate('/login');
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
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full"
          />
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
                className="absolute right-16 top-14 z-50 w-[320px] overflow-hidden rounded-2xl border border-surface-200 bg-white shadow-xl dark:border-surface-700 dark:bg-surface-800"
              >
                <div className="border-b border-surface-100 px-4 py-3 dark:border-surface-700">
                  <p className="text-sm font-semibold text-surface-900 dark:text-white">Notificaciones</p>
                  <p className="text-xs text-surface-500">Acciones rapidas del sistema</p>
                </div>
                <div className="p-2">
                  {notificationsList.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setShowNotifications(false);
                        navigate(item.path);
                      }}
                      className="w-full rounded-xl px-3 py-3 text-left transition-colors hover:bg-surface-50 dark:hover:bg-surface-700"
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-500 dark:bg-brand-950/40">
                          <CheckCircle2 size={16} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-surface-900 dark:text-white">{item.title}</p>
                          <p className="mt-0.5 text-xs text-surface-500">{item.description}</p>
                        </div>
                        <ArrowUpRight size={14} className="mt-1 text-surface-400" />
                      </div>
                    </button>
                  ))}
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
              {user ? `${user.first_name[0]}${user.last_name[0]}` : '?'}
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
                      {user?.first_name} {user?.last_name}
                    </p>
                    <p className="text-xs text-surface-500 truncate">{user?.email}</p>
                  </div>
                  <div className="p-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setShowUserMenu(false);
                        navigate('/settings');
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
    </header>
  );
}
