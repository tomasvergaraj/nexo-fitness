import { useNavigate } from 'react-router-dom';
import { Menu, Search, Bell, Command, ExternalLink } from 'lucide-react';
import { cn } from '@/utils';

interface Props {
  onMenuToggle: () => void;
  onCommandOpen?: () => void;
}

// Platform shell is intentionally dark-only (Linear/Stripe admin pattern).
// Theme toggle lives in the tenant app topbar; superadmin keeps a fixed
// editorial palette to keep auditing surfaces high-contrast.
export default function PlatformTopbar({ onMenuToggle, onCommandOpen }: Props) {
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-surface-800/50 bg-surface-950/85 px-4 backdrop-blur-xl">
      <button
        onClick={onMenuToggle}
        className="rounded-md p-1.5 text-surface-400 hover:bg-surface-800/60 hover:text-white lg:hidden"
        aria-label="Abrir menú"
      >
        <Menu size={18} />
      </button>

      {/* Global search */}
      <button
        type="button"
        onClick={() => onCommandOpen?.()}
        className={cn(
          'group flex flex-1 max-w-md items-center gap-2 rounded-lg border border-surface-800 bg-surface-900/60 px-3 py-1.5',
          'text-sm text-surface-500 hover:border-surface-700 hover:bg-surface-900 transition-colors',
        )}
      >
        <Search size={14} className="text-surface-500 group-hover:text-surface-300" />
        <span className="flex-1 text-left">Buscar tenant, lead, pago…</span>
        <span className="hidden items-center gap-1 rounded border border-surface-700 px-1.5 py-0.5 text-[10px] font-mono text-surface-400 sm:inline-flex">
          <Command size={10} /> K
        </span>
      </button>

      <div className="flex-1" />

      {/* Quick actions */}
      <a
        href="/dashboard"
        className="hidden items-center gap-1.5 rounded-md border border-surface-800 px-2.5 py-1.5 text-xs font-medium text-surface-300 hover:border-surface-700 hover:bg-surface-900 hover:text-white transition-colors md:inline-flex"
        title="Ir al panel de tenant"
      >
        Vista tenant
        <ExternalLink size={12} />
      </a>

      <button
        onClick={() => navigate('/platform/feedback')}
        className="relative rounded-md p-1.5 text-surface-400 hover:bg-surface-800/60 hover:text-white"
        aria-label="Notificaciones"
        title="Notificaciones"
      >
        <Bell size={16} />
        <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-rose-400 ring-2 ring-surface-950" />
      </button>
    </header>
  );
}
