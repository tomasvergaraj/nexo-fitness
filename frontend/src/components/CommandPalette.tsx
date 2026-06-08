import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { create } from 'zustand';
import {
  Search,
  LayoutDashboard,
  CalendarDays,
  Users,
  Tag,
  Megaphone,
  BarChart3,
  Wallet,
  Boxes,
  Receipt,
  Settings as SettingsIcon,
  CheckSquare,
  ClipboardList,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/utils';

interface CommandAction {
  id: string;
  label: string;
  description?: string;
  icon?: LucideIcon;
  keywords?: string[];
  onSelect: () => void;
  group?: string;
}

interface PaletteState {
  open: boolean;
  extra: CommandAction[];
  setOpen: (open: boolean) => void;
  toggle: () => void;
  registerActions: (actions: CommandAction[]) => () => void;
}

export const useCommandPalette = create<PaletteState>((set, get) => ({
  open: false,
  extra: [],
  setOpen: (open) => set({ open }),
  toggle: () => set({ open: !get().open }),
  registerActions: (actions) => {
    set({ extra: [...get().extra, ...actions] });
    return () => {
      set({ extra: get().extra.filter((a) => !actions.find((x) => x.id === a.id)) });
    };
  },
}));

const NAV_ACTIONS = (navigate: (path: string) => void): CommandAction[] => [
  { id: 'nav-dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'Navegar', onSelect: () => navigate('/dashboard') },
  { id: 'nav-classes', label: 'Clases', icon: CalendarDays, group: 'Navegar', onSelect: () => navigate('/classes') },
  { id: 'nav-programs', label: 'Programas', icon: ClipboardList, group: 'Navegar', onSelect: () => navigate('/programs') },
  { id: 'nav-clients', label: 'Clientes', icon: Users, group: 'Navegar', onSelect: () => navigate('/clients') },
  { id: 'nav-checkin', label: 'Check-in', icon: CheckSquare, group: 'Navegar', onSelect: () => navigate('/checkin') },
  { id: 'nav-plans', label: 'Planes', icon: Tag, group: 'Navegar', onSelect: () => navigate('/plans') },
  { id: 'nav-marketing', label: 'Marketing', icon: Megaphone, group: 'Navegar', onSelect: () => navigate('/marketing') },
  { id: 'nav-reports', label: 'Reportes', icon: BarChart3, group: 'Navegar', onSelect: () => navigate('/reports') },
  { id: 'nav-pos', label: 'POS', icon: Wallet, group: 'Navegar', onSelect: () => navigate('/pos') },
  { id: 'nav-inventory', label: 'Inventario', icon: Boxes, group: 'Navegar', onSelect: () => navigate('/inventory') },
  { id: 'nav-expenses', label: 'Gastos', icon: Receipt, group: 'Navegar', onSelect: () => navigate('/expenses') },
  { id: 'nav-settings', label: 'Configuración', icon: SettingsIcon, group: 'Navegar', onSelect: () => navigate('/settings') },
];

export default function CommandPalette() {
  const open = useCommandPalette((s) => s.open);
  const setOpen = useCommandPalette((s) => s.setOpen);
  const toggle = useCommandPalette((s) => s.toggle);
  const extra = useCommandPalette((s) => s.extra);
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const actions = useMemo<CommandAction[]>(() => {
    return [...NAV_ACTIONS((path) => navigate(path)), ...extra];
  }, [extra, navigate]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((a) => {
      const hay = [a.label, a.description ?? '', ...(a.keywords ?? [])].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [query, actions]);

  const grouped = useMemo(() => {
    const map = new Map<string, CommandAction[]>();
    filtered.forEach((a) => {
      const g = a.group ?? 'Acciones';
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(a);
    });
    return Array.from(map.entries());
  }, [filtered]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const isCmdK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      if (isCmdK) {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggle]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    const id = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const action = filtered[activeIndex];
        if (action) {
          action.onSelect();
          setOpen(false);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, filtered, activeIndex, setOpen]);

  if (typeof document === 'undefined') return null;

  let runningIndex = -1;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-start justify-center bg-surface-950/60 p-4 pt-[15vh] backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="w-full max-w-xl overflow-hidden rounded-2xl border border-surface-200 bg-white shadow-2xl dark:border-surface-800 dark:bg-surface-950"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-center gap-3 border-b border-surface-200 px-4 py-3 dark:border-surface-800">
              <Search size={18} className="text-surface-400" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar acciones, páginas..."
                className="flex-1 bg-transparent text-sm text-surface-900 outline-none placeholder:text-surface-400 dark:text-white"
              />
              <kbd className="hidden rounded border border-surface-200 px-1.5 py-0.5 text-[10px] font-medium text-surface-500 dark:border-surface-700 dark:text-surface-400 sm:inline">
                Esc
              </kbd>
            </div>
            <div className="max-h-[60vh] overflow-y-auto py-2">
              {filtered.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-surface-500 dark:text-surface-400">
                  Sin resultados para "{query}".
                </div>
              ) : (
                grouped.map(([group, items]) => (
                  <div key={group} className="py-1">
                    <div className="px-3 pt-1 text-[10px] font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
                      {group}
                    </div>
                    <div>
                      {items.map((a) => {
                        runningIndex += 1;
                        const isActive = runningIndex === activeIndex;
                        const Icon = a.icon;
                        return (
                          <button
                            key={a.id}
                            type="button"
                            onMouseEnter={() => setActiveIndex(runningIndex)}
                            onClick={() => {
                              a.onSelect();
                              setOpen(false);
                            }}
                            className={cn(
                              'flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors',
                              isActive
                                ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-200'
                                : 'text-surface-700 hover:bg-surface-100 dark:text-surface-200 dark:hover:bg-surface-900',
                            )}
                          >
                            {Icon ? <Icon size={16} className="shrink-0" /> : null}
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium">{a.label}</div>
                              {a.description ? (
                                <div className="truncate text-xs text-surface-500 dark:text-surface-400">
                                  {a.description}
                                </div>
                              ) : null}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="flex items-center justify-between border-t border-surface-200 bg-surface-50 px-4 py-2 text-[11px] text-surface-500 dark:border-surface-800 dark:bg-surface-950/50 dark:text-surface-400">
              <span>
                <kbd className="rounded border border-surface-200 px-1 dark:border-surface-700">↑↓</kbd> navegar
                <span className="mx-2">·</span>
                <kbd className="rounded border border-surface-200 px-1 dark:border-surface-700">↵</kbd> abrir
              </span>
              <span>
                <kbd className="rounded border border-surface-200 px-1 dark:border-surface-700">⌘K</kbd> abrir/cerrar
              </span>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
