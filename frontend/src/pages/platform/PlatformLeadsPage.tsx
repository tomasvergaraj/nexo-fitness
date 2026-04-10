import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { CheckCircle2, Filter, PhoneCall } from 'lucide-react';
import { platformApi } from '@/services/api';
import { fadeInUp, staggerContainer } from '@/utils/animations';
import { formatDateTime } from '@/utils';
import type { PaginatedResponse, PlatformLead } from '@/types';

export default function PlatformLeadsPage() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery<PaginatedResponse<PlatformLead>>({
    queryKey: ['platform-leads'],
    queryFn: async () => {
      const response = await platformApi.listLeads({ page: 1, per_page: 100 });
      return response.data;
    },
  });

  const updateLead = useMutation({
    mutationFn: async ({ leadId, status }: { leadId: string; status: PlatformLead['status'] }) => {
      const response = await platformApi.updateLead(leadId, { status });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-leads'] });
    },
  });

  const leads = data?.items ?? [];
  const summary = useMemo(() => ({
    total: leads.length,
    new: leads.filter((lead) => lead.status === 'new').length,
    qualified: leads.filter((lead) => lead.status === 'qualified').length,
    won: leads.filter((lead) => lead.status === 'won').length,
  }), [leads]);

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-6">
      <motion.div variants={fadeInUp}>
        <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Leads comerciales</h1>
        <p className="mt-1 text-sm text-surface-500">Embudo inicial para dueños de gimnasios y demos agendadas</p>
      </motion.div>

      {isError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-600 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
          No pudimos cargar los leads de plataforma.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900"><p className="text-sm text-surface-500">Total</p><p className="mt-2 text-3xl font-bold font-display text-surface-900 dark:text-white">{summary.total}</p></div>
        <div className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900"><p className="text-sm text-surface-500">Nuevos</p><p className="mt-2 text-3xl font-bold font-display text-surface-900 dark:text-white">{summary.new}</p></div>
        <div className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900"><p className="text-sm text-surface-500">Calificados</p><p className="mt-2 text-3xl font-bold font-display text-surface-900 dark:text-white">{summary.qualified}</p></div>
        <div className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900"><p className="text-sm text-surface-500">Ganados</p><p className="mt-2 text-3xl font-bold font-display text-surface-900 dark:text-white">{summary.won}</p></div>
      </div>

      <div className="space-y-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, index) => <div key={index} className="shimmer h-28 rounded-3xl" />)
        ) : leads.map((lead) => (
          <motion.div key={lead.id} variants={fadeInUp} className="rounded-3xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-surface-900 dark:text-white">{lead.gym_name}</h2>
                  <span className={`badge ${lead.status === 'won' ? 'badge-success' : lead.status === 'qualified' ? 'badge-info' : lead.status === 'contacted' ? 'badge-warning' : lead.status === 'lost' ? 'badge-danger' : 'badge-neutral'}`}>
                    {lead.status}
                  </span>
                  <span className="badge badge-neutral">{lead.request_type}</span>
                </div>
                <div className="mt-3 grid gap-2 text-sm text-surface-500 sm:grid-cols-2">
                  <p><span className="font-medium text-surface-700 dark:text-surface-300">Propietario:</span> {lead.owner_name}</p>
                  <p><span className="font-medium text-surface-700 dark:text-surface-300">Email:</span> {lead.email}</p>
                  <p><span className="font-medium text-surface-700 dark:text-surface-300">Teléfono:</span> {lead.phone || 'Sin teléfono'}</p>
                  <p><span className="font-medium text-surface-700 dark:text-surface-300">Origen:</span> {lead.source}</p>
                </div>
                <p className="mt-3 text-sm text-surface-500">{lead.notes || 'Sin notas comerciales todavía.'}</p>
                <p className="mt-2 text-xs text-surface-400">Creado: {formatDateTime(lead.created_at)}</p>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <button type="button" className="btn-secondary text-sm" onClick={() => updateLead.mutate({ leadId: lead.id, status: 'contacted' })}>
                  <PhoneCall size={15} /> Llamar
                </button>
                <button type="button" className="btn-secondary text-sm" onClick={() => updateLead.mutate({ leadId: lead.id, status: 'qualified' })}>
                  <Filter size={15} /> Calificar
                </button>
                <button type="button" className="btn-primary text-sm" onClick={() => updateLead.mutate({ leadId: lead.id, status: 'won' })}>
                  <CheckCircle2 size={15} /> Ganar
                </button>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
