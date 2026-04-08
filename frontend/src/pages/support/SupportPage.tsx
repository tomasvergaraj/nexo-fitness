import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { CheckCircle2, Mail, MessageCircle, Phone, Plus } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { supportApi } from '@/services/api';
import { fadeInUp, staggerContainer } from '@/utils/animations';
import type { PaginatedResponse, SupportInteraction } from '@/types';
import { getApiError } from '@/utils';

type InteractionForm = {
  id?: string;
  channel: SupportInteraction['channel'];
  subject: string;
  notes: string;
  user_id: string;
  handled_by: string;
  resolved: boolean;
};

const emptyForm: InteractionForm = {
  channel: 'whatsapp',
  subject: '',
  notes: '',
  user_id: '',
  handled_by: '',
  resolved: false,
};

function toForm(interaction?: SupportInteraction): InteractionForm {
  if (!interaction) return emptyForm;
  return {
    id: interaction.id,
    channel: interaction.channel,
    subject: interaction.subject ?? '',
    notes: interaction.notes ?? '',
    user_id: interaction.user_id ?? '',
    handled_by: interaction.handled_by ?? '',
    resolved: interaction.resolved,
  };
}

export default function SupportPage() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<InteractionForm>(emptyForm);

  const { data, isLoading, isError } = useQuery<PaginatedResponse<SupportInteraction>>({
    queryKey: ['support-interactions'],
    queryFn: async () => {
      const response = await supportApi.list({ page: 1, per_page: 50 });
      return response.data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        channel: form.channel,
        subject: form.subject,
        notes: form.notes || null,
        user_id: form.user_id || null,
        handled_by: form.handled_by || null,
        resolved: form.resolved,
      };

      if (form.id) {
        const response = await supportApi.update(form.id, payload);
        return response.data;
      }

      const response = await supportApi.create(payload);
      return response.data;
    },
    onSuccess: () => {
      toast.success(form.id ? 'Interaccion actualizada' : 'Interaccion creada');
      setShowModal(false);
      setForm(emptyForm);
      queryClient.invalidateQueries({ queryKey: ['support-interactions'] });
    },
    onError: (error: any) => {
      toast.error(getApiError(error, 'No se pudo guardar la interaccion'));
    },
  });

  const interactions = data?.items ?? [];
  const pending = interactions.filter((item) => !item.resolved).length;

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-6">
      <motion.div variants={fadeInUp} className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Soporte</h1>
          <p className="mt-1 text-sm text-surface-500">Interacciones persistentes por tenant con responsables y estado</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setForm(emptyForm);
            setShowModal(true);
          }}
          className="btn-primary"
        >
          <Plus size={16} />
          Nueva interaccion
        </button>
      </motion.div>

      {isError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-600 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
          No pudimos cargar las interacciones de soporte.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
          <div className="flex items-center gap-3"><MessageCircle size={18} className="text-emerald-500" /><span className="text-sm text-surface-500">WhatsApp</span></div>
          <p className="mt-3 text-3xl font-bold font-display text-surface-900 dark:text-white">{interactions.filter((item) => item.channel === 'whatsapp').length}</p>
        </div>
        <div className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
          <div className="flex items-center gap-3"><Mail size={18} className="text-brand-500" /><span className="text-sm text-surface-500">Email</span></div>
          <p className="mt-3 text-3xl font-bold font-display text-surface-900 dark:text-white">{interactions.filter((item) => item.channel === 'email').length}</p>
        </div>
        <div className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
          <div className="flex items-center gap-3"><Phone size={18} className="text-violet-500" /><span className="text-sm text-surface-500">Telefono</span></div>
          <p className="mt-3 text-3xl font-bold font-display text-surface-900 dark:text-white">{interactions.filter((item) => item.channel === 'phone').length}</p>
        </div>
        <div className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900">
          <div className="flex items-center gap-3"><CheckCircle2 size={18} className="text-amber-500" /><span className="text-sm text-surface-500">Pendientes</span></div>
          <p className="mt-3 text-3xl font-bold font-display text-surface-900 dark:text-white">{pending}</p>
        </div>
      </div>

      <div className="space-y-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, index) => <div key={index} className="shimmer h-24 rounded-3xl" />)
        ) : interactions.map((interaction) => (
          <motion.button
            key={interaction.id}
            type="button"
            variants={fadeInUp}
            onClick={() => {
              setForm(toForm(interaction));
              setShowModal(true);
            }}
            className="w-full rounded-3xl border border-surface-200/50 bg-white p-5 text-left transition-all hover:-translate-y-1 hover:shadow-xl dark:border-surface-800/50 dark:bg-surface-900"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-surface-900 dark:text-white">{interaction.subject || 'Sin asunto'}</h2>
                  <span className={`badge ${interaction.resolved ? 'badge-success' : 'badge-warning'}`}>
                    {interaction.resolved ? 'Resuelto' : 'Pendiente'}
                  </span>
                </div>
                <p className="mt-2 text-sm text-surface-500">{interaction.notes || 'Sin notas todavia.'}</p>
                <div className="mt-3 flex flex-wrap gap-3 text-xs text-surface-500">
                  <span>Canal: {interaction.channel}</span>
                  <span>Cliente: {interaction.client_name || 'Sin cliente vinculado'}</span>
                  <span>Responsable: {interaction.handler_name || 'Sin asignar'}</span>
                </div>
              </div>
            </div>
          </motion.button>
        ))}
      </div>

      <Modal
        open={showModal}
        title={form.id ? 'Editar interaccion' : 'Nueva interaccion'}
        description="Puedes registrar responsable, notas y estado sin depender de datos locales."
        onClose={() => {
          if (!saveMutation.isPending) {
            setShowModal(false);
          }
        }}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            saveMutation.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Canal</label>
              <select className="input" value={form.channel} onChange={(event) => setForm((current) => ({ ...current, channel: event.target.value as SupportInteraction['channel'] }))}>
                <option value="whatsapp">WhatsApp</option>
                <option value="email">Email</option>
                <option value="phone">Telefono</option>
                <option value="in_person">Presencial</option>
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Asunto</label>
              <input className="input" value={form.subject} onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))} required />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Client ID</label>
              <input className="input" value={form.user_id} onChange={(event) => setForm((current) => ({ ...current, user_id: event.target.value }))} placeholder="UUID del cliente" />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Handled by</label>
              <input className="input" value={form.handled_by} onChange={(event) => setForm((current) => ({ ...current, handled_by: event.target.value }))} placeholder="UUID del responsable" />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Notas</label>
            <textarea className="input min-h-32 resize-y" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
          </div>

          <label className="flex items-center gap-3 rounded-2xl border border-surface-200 px-4 py-3 dark:border-surface-800">
            <input type="checkbox" checked={form.resolved} onChange={(event) => setForm((current) => ({ ...current, resolved: event.target.checked }))} />
            <span className="text-sm text-surface-700 dark:text-surface-300">Marcar como resuelto</span>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Guardando...' : form.id ? 'Guardar cambios' : 'Crear interaccion'}
            </button>
          </div>
        </form>
      </Modal>
    </motion.div>
  );
}
