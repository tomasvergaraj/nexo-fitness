import { useDeferredValue, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { UserCheck, Search, QrCode, Clock, CheckCircle2, Zap } from 'lucide-react';
import { checkinsApi, clientsApi, dashboardApi } from '@/services/api';
import { staggerContainer, fadeInUp } from '@/utils/animations';
import { cn, getInitials, formatRelative } from '@/utils';
import type { DashboardMetrics, PaginatedResponse, User } from '@/types';

type RecentCheckin = {
  id: string;
  name: string;
  checkedInAt: string;
};

export default function CheckInPage() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [checkedIn, setCheckedIn] = useState<string | null>(null);
  const [recentCheckins, setRecentCheckins] = useState<RecentCheckin[]>([]);
  const deferredSearch = useDeferredValue(searchQuery);

  const { data: metrics } = useQuery<DashboardMetrics>({
    queryKey: ['dashboard-metrics'],
    queryFn: async () => {
      const response = await dashboardApi.getMetrics();
      return response.data;
    },
  });

  const { data: candidates, isLoading } = useQuery<PaginatedResponse<User>>({
    queryKey: ['clients-checkin-search', deferredSearch],
    queryFn: async () => {
      const response = await clientsApi.list({
        per_page: 8,
        ...(deferredSearch ? { search: deferredSearch } : {}),
        status: 'active',
      });
      return response.data;
    },
  });

  const createCheckin = useMutation({
    mutationFn: async ({ user }: { user: User }) => {
      const response = await checkinsApi.create({
        user_id: user.id,
        check_type: 'manual',
      });
      return { response: response.data, user };
    },
    onSuccess: ({ response, user }) => {
      const name = `${user.first_name} ${user.last_name}`;
      setCheckedIn(name);
      setRecentCheckins((current) => [
        { id: response.id, name, checkedInAt: response.checked_in_at },
        ...current,
      ].slice(0, 6));
      setSearchQuery('');
      queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] });
      toast.success(`Check-in registrado para ${name}`);
      window.setTimeout(() => setCheckedIn(null), 3000);
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.detail || 'No se pudo registrar el check-in');
    },
  });

  const clientResults = candidates?.items ?? [];
  const quickStats = useMemo(
    () => [
      { label: 'Check-ins hoy', value: String(metrics?.checkins_today ?? recentCheckins.length), icon: UserCheck, color: 'brand' },
      { label: 'Clientes activos', value: String(metrics?.active_members ?? 0), icon: Clock, color: 'amber' },
      { label: 'Reservas hoy', value: String(metrics?.reservations_today ?? 0), icon: CheckCircle2, color: 'emerald' },
    ],
    [metrics?.active_members, metrics?.checkins_today, metrics?.reservations_today, recentCheckins.length],
  );

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-6">
      <motion.div variants={fadeInUp}>
        <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Check-in</h1>
        <p className="mt-1 text-sm text-surface-500">Busca un cliente real y registra su ingreso al gimnasio</p>
      </motion.div>

      <motion.div
        variants={fadeInUp}
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 p-6 text-white shadow-xl shadow-brand-500/20"
      >
        <div className="absolute right-0 top-0 h-64 w-64 translate-x-1/2 -translate-y-1/2 rounded-full bg-white/5 blur-3xl" />
        <div className="relative">
          <div className="mb-4 flex items-center gap-3">
            <motion.div animate={{ rotate: [0, 5, -5, 0] }} transition={{ duration: 2, repeat: Infinity }}>
              <Zap size={24} />
            </motion.div>
            <h2 className="text-xl font-bold font-display">Check-in rápido</h2>
          </div>
          <div className="relative max-w-lg">
            <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/50" />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Nombre, email o teléfono del cliente..."
              className="w-full rounded-xl border border-white/20 bg-white/10 py-4 pl-12 pr-4 text-lg text-white placeholder:text-white/40 transition-all duration-200 focus:bg-white/15 focus:outline-none focus:ring-2 focus:ring-white/30"
              autoFocus
            />
          </div>
          <div className="mt-3 flex items-center gap-4 text-sm text-white/60">
            <button
              type="button"
              onClick={() => toast('El escaneo QR todavía no está integrado')}
              className="flex items-center gap-1.5 transition-colors hover:text-white/90"
            >
              <QrCode size={14} /> Escanear QR
            </button>
            <span>·</span>
            <span>{metrics?.checkins_today ?? recentCheckins.length} check-ins hoy</span>
          </div>
        </div>
      </motion.div>

      <AnimatePresence>
        {checkedIn ? (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="fixed right-4 top-4 z-50 flex items-center gap-3 rounded-2xl bg-emerald-500 px-5 py-4 text-white shadow-2xl shadow-emerald-500/30"
          >
            <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 0.5 }}>
              <CheckCircle2 size={24} />
            </motion.div>
            <div>
              <p className="font-bold">Check-in exitoso</p>
              <p className="text-sm text-emerald-100">{checkedIn}</p>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <motion.div
          variants={fadeInUp}
          className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900"
        >
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold text-surface-900 dark:text-white">Resultados para check-in</h3>
            {isLoading ? <span className="text-xs text-surface-400">Buscando...</span> : null}
          </div>

          <div className="space-y-2">
            {clientResults.map((client, index) => (
              <motion.div
                key={client.id}
                initial={{ opacity: 0, x: -15 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15 + index * 0.05 }}
                className="flex items-center gap-3 rounded-xl border border-surface-100 p-3 transition-colors duration-150 hover:bg-surface-50 dark:border-surface-800 dark:hover:bg-surface-800/50"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-xs font-bold text-white">
                  {getInitials(client.first_name, client.last_name)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-surface-900 dark:text-white">
                    {client.first_name} {client.last_name}
                  </p>
                  <p className="truncate text-xs text-surface-500">{client.email}</p>
                </div>
                <button
                  type="button"
                  onClick={() => createCheckin.mutate({ user: client })}
                  disabled={createCheckin.isPending}
                  className="btn-primary px-3 py-2 text-sm"
                >
                  Ingresar
                </button>
              </motion.div>
            ))}

            {!isLoading && !clientResults.length ? (
              <div className="rounded-xl border border-dashed border-surface-300 px-4 py-8 text-center dark:border-surface-700">
                <p className="font-medium text-surface-700 dark:text-surface-200">No encontramos clientes</p>
                <p className="mt-1 text-sm text-surface-500">Prueba con otro nombre, email o teléfono.</p>
              </div>
            ) : null}
          </div>
        </motion.div>

        <div className="space-y-4">
          <motion.div
            variants={fadeInUp}
            className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900"
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-semibold text-surface-900 dark:text-white">Check-ins recientes</h3>
              <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 2, repeat: Infinity }} className="h-2 w-2 rounded-full bg-emerald-500" />
            </div>
            <div className="space-y-2">
              {recentCheckins.length ? recentCheckins.map((entry, index) => (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.06 }}
                  className="flex items-center gap-3 rounded-xl p-3 transition-colors duration-150 hover:bg-surface-50 dark:hover:bg-surface-800/50"
                >
                  <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-xs font-bold text-white')}>
                    {getInitials(entry.name.split(' ')[0], entry.name.split(' ').slice(-1)[0])}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-surface-900 dark:text-white">{entry.name}</p>
                    <p className="text-xs text-surface-500">Acceso general</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-surface-400">{formatRelative(entry.checkedInAt)}</p>
                    <CheckCircle2 size={14} className="ml-auto mt-0.5 text-emerald-500" />
                  </div>
                </motion.div>
              )) : (
                <div className="rounded-xl border border-dashed border-surface-300 px-4 py-8 text-center dark:border-surface-700">
                  <p className="font-medium text-surface-700 dark:text-surface-200">Aún no hay check-ins en esta sesión</p>
                  <p className="mt-1 text-sm text-surface-500">Usa el buscador superior para registrar el primero.</p>
                </div>
              )}
            </div>
          </motion.div>

          {quickStats.map((stat, index) => (
            <motion.div
              key={stat.label}
              variants={fadeInUp}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 + index * 0.08 }}
              className="flex items-center gap-4 rounded-2xl border border-surface-200/50 bg-white p-4 dark:border-surface-800/50 dark:bg-surface-900"
            >
              <div className={cn(
                'flex h-12 w-12 items-center justify-center rounded-xl',
                stat.color === 'brand' ? 'bg-brand-50 dark:bg-brand-950/40' :
                stat.color === 'amber' ? 'bg-amber-50 dark:bg-amber-950/40' :
                'bg-emerald-50 dark:bg-emerald-950/40',
              )}>
                <stat.icon
                  size={22}
                  className={cn(
                    stat.color === 'brand' ? 'text-brand-500' :
                    stat.color === 'amber' ? 'text-amber-500' : 'text-emerald-500',
                  )}
                />
              </div>
              <div>
                <p className="text-sm text-surface-500">{stat.label}</p>
                <p className="text-xl font-bold font-display text-surface-900 dark:text-white">{stat.value}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
