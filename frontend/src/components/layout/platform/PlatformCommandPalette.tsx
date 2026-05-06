import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Building2,
  CalendarCheck2,
  CornerDownLeft,
  CreditCard,
  ExternalLink,
  Keyboard,
  LayoutDashboard,
  Lightbulb,
  RefreshCcw,
  Search,
  Tag,
} from 'lucide-react';
import { billingApi } from '@/services/api';
import type { AdminTenantBilling, PaginatedResponse } from '@/types';
import { cn } from '@/utils';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface PaletteItem {
  id: string;
  section: 'Acciones' | 'Navegar' | 'Tenants' | 'Ayuda';
  label: string;
  hint?: string;
  icon: React.ReactNode;
  shortcut?: string;
  onSelect: () => void;
}

const NAV_ITEMS: { label: string; path: string; icon: React.ReactNode; shortcut: string }[] = [
  { label: 'Dashboard', path: '/platform/dashboard', icon: <LayoutDashboard size={14} />, shortcut: 'g d' },
  { label: 'Tenants', path: '/platform/tenants', icon: <Building2 size={14} />, shortcut: 'g t' },
  { label: 'Leads', path: '/platform/leads', icon: <CalendarCheck2 size={14} />, shortcut: 'g l' },
  { label: 'Planes', path: '/platform/plans', icon: <CreditCard size={14} />, shortcut: 'g p' },
  { label: 'Promo Codes', path: '/platform/promo-codes', icon: <Tag size={14} />, shortcut: 'g c' },
  { label: 'Feedback', path: '/platform/feedback', icon: <Lightbulb size={14} />, shortcut: 'g f' },
  { label: 'Email templates', path: '/platform/email-templates', icon: <CreditCard size={14} />, shortcut: 'g e' },
  { label: 'Audit log', path: '/platform/audit', icon: <CreditCard size={14} />, shortcut: 'g a' },
];

const HELP_LINES: { keys: string; label: string }[] = [
  { keys: '⌘K · /', label: 'Abrir command palette' },
  { keys: 'g d', label: 'Ir al dashboard' },
  { keys: 'g t', label: 'Ir a tenants' },
  { keys: 'g l', label: 'Ir a leads' },
  { keys: 'g p', label: 'Ir a planes' },
  { keys: 'g c', label: 'Ir a promo codes' },
  { keys: 'g f', label: 'Ir a feedback' },
  { keys: '?', label: 'Mostrar ayuda' },
  { keys: 'Esc', label: 'Cerrar palette' },
];

export default function PlatformCommandPalette({ open, onClose }: Props) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Tenants list — fetched lazily once palette opens (cached by react-query)
  const tenantsQuery = useQuery<PaginatedResponse<AdminTenantBilling>>({
    queryKey: ['platform-tenants'],
    queryFn: async () => (await billingApi.listAdminTenants({ page: 1, per_page: 100 })).data,
    enabled: open,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
      // Defer focus so the modal is in the DOM
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const tenants = tenantsQuery.data?.items ?? [];

  const items = useMemo<PaletteItem[]>(() => {
    const q = query.trim().toLowerCase();
    const result: PaletteItem[] = [];

    // Actions
    if (!q || 'actualizar lista refresh'.includes(q)) {
      result.push({
        id: 'action:refresh',
        section: 'Acciones',
        label: 'Refrescar lista de tenants',
        icon: <RefreshCcw size={14} />,
        onSelect: () => {
          tenantsQuery.refetch();
          onClose();
        },
      });
    }
    if (!q || 'volver tenant app vista'.includes(q)) {
      result.push({
        id: 'action:tenant-app',
        section: 'Acciones',
        label: 'Abrir vista tenant',
        hint: '/dashboard',
        icon: <ExternalLink size={14} />,
        onSelect: () => {
          window.location.href = '/dashboard';
        },
      });
    }

    // Navigation
    NAV_ITEMS.forEach((nav) => {
      if (!q || nav.label.toLowerCase().includes(q)) {
        result.push({
          id: `nav:${nav.path}`,
          section: 'Navegar',
          label: nav.label,
          hint: nav.path,
          icon: nav.icon,
          shortcut: nav.shortcut,
          onSelect: () => {
            navigate(nav.path);
            onClose();
          },
        });
      }
    });

    // Tenants — only show when query present, top 8
    if (q.length >= 1) {
      const matching = tenants
        .filter((t) => {
          const haystack = [t.tenant_name, t.tenant_slug, t.owner_email, t.owner_name, t.plan_name]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          return haystack.includes(q);
        })
        .slice(0, 8);

      matching.forEach((t) => {
        result.push({
          id: `tenant:${t.tenant_id}`,
          section: 'Tenants',
          label: t.tenant_name,
          hint: `${t.tenant_slug} · ${t.status}`,
          icon: <Building2 size={14} />,
          onSelect: () => {
            navigate(`/platform/tenants?id=${t.tenant_id}`);
            onClose();
          },
        });
      });
    }

    // Help — last
    if (!q || 'ayuda atajos help shortcuts'.includes(q)) {
      result.push({
        id: 'help:keyboard',
        section: 'Ayuda',
        label: 'Atajos de teclado',
        icon: <Keyboard size={14} />,
        onSelect: () => {
          // no-op; help is rendered in panel
        },
      });
    }

    return result;
  }, [query, tenants, navigate, onClose, tenantsQuery]);

  // Reset active index when items change
  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  // Group items by section while preserving order
  const grouped = useMemo(() => {
    const order: PaletteItem['section'][] = ['Acciones', 'Navegar', 'Tenants', 'Ayuda'];
    const map = new Map<string, PaletteItem[]>();
    items.forEach((item) => {
      const arr = map.get(item.section) ?? [];
      arr.push(item);
      map.set(item.section, arr);
    });
    return order
      .filter((section) => map.has(section))
      .map((section) => ({ section, entries: map.get(section)! }));
  }, [items]);

  // Keyboard nav
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, items.length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      }
      if (e.key === 'Enter') {
        const item = items[activeIdx];
        if (item) {
          e.preventDefault();
          item.onSelect();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, items, activeIdx, onClose]);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const node = listRef.current.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  if (!open) return null;

  const showHelp = items[activeIdx]?.id === 'help:keyboard';

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 px-4 pt-[10vh] backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -8 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl overflow-hidden rounded-xl border border-surface-700 bg-surface-900 shadow-2xl"
          >
            {/* Search input */}
            <div className="flex items-center gap-2 border-b border-surface-800 px-4 py-3">
              <Search size={15} className="text-surface-400" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar acción, sección o tenant…"
                className="flex-1 bg-transparent text-sm text-white placeholder:text-surface-500 focus:outline-none"
                autoComplete="off"
                spellCheck={false}
              />
              <span className="rounded border border-surface-700 px-1.5 py-0.5 text-[10px] font-mono text-surface-400">
                Esc
              </span>
            </div>

            {/* List */}
            <div ref={listRef} className="max-h-[60vh] overflow-y-auto py-1">
              {showHelp ? (
                <div className="px-3 py-3">
                  <p className="px-1 mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-surface-500">
                    Atajos disponibles
                  </p>
                  <ul className="divide-y divide-surface-800/70">
                    {HELP_LINES.map((line) => (
                      <li key={line.keys} className="flex items-center justify-between px-1 py-2 text-xs">
                        <span className="text-surface-300">{line.label}</span>
                        <kbd className="rounded border border-surface-700 bg-surface-800/50 px-1.5 py-0.5 font-mono text-[10px] text-surface-300">
                          {line.keys}
                        </kbd>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : grouped.length === 0 ? (
                <div className="px-4 py-12 text-center text-sm text-surface-500">
                  Sin resultados para “{query}”
                </div>
              ) : (
                <div>
                  {grouped.map((group) => (
                    <div key={group.section} className="py-1">
                      <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-surface-500">
                        {group.section}
                      </p>
                      {group.entries.map((item) => {
                        const idx = items.findIndex((it) => it.id === item.id);
                        const isActive = idx === activeIdx;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            data-idx={idx}
                            onMouseEnter={() => setActiveIdx(idx)}
                            onClick={item.onSelect}
                            className={cn(
                              'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors',
                              isActive
                                ? 'bg-brand-500/15 text-brand-100'
                                : 'text-surface-300 hover:bg-surface-800/60',
                            )}
                          >
                            <span className={cn(
                              'flex-shrink-0',
                              isActive ? 'text-brand-300' : 'text-surface-400',
                            )}>
                              {item.icon}
                            </span>
                            <span className="flex-1 truncate">{item.label}</span>
                            {item.hint && (
                              <span className="truncate text-[11px] text-surface-500">{item.hint}</span>
                            )}
                            {item.shortcut && (
                              <kbd className="ml-2 rounded border border-surface-700 bg-surface-800/50 px-1.5 py-0.5 font-mono text-[10px] text-surface-400">
                                {item.shortcut}
                              </kbd>
                            )}
                            {isActive && (
                              <CornerDownLeft size={12} className="text-brand-400" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer hints */}
            <div className="flex items-center justify-between gap-2 border-t border-surface-800 px-3 py-2 text-[10px] text-surface-500">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1">
                  <kbd className="rounded border border-surface-700 px-1 font-mono">↑↓</kbd>
                  navegar
                </span>
                <span className="inline-flex items-center gap-1">
                  <kbd className="rounded border border-surface-700 px-1 font-mono">↵</kbd>
                  seleccionar
                </span>
                <span className="inline-flex items-center gap-1">
                  <kbd className="rounded border border-surface-700 px-1 font-mono">?</kbd>
                  ayuda
                </span>
              </div>
              <span className="text-surface-600">
                {items.length} resultado{items.length === 1 ? '' : 's'}
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
