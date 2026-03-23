import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  MessageCircle, Mail, Phone, Plus, CheckCircle2, AlertCircle,
} from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { staggerContainer, fadeInUp } from '@/utils/animations';
import { cn } from '@/utils';

type Interaction = {
  id: string;
  client: string;
  channel: 'whatsapp' | 'email' | 'phone';
  subject: string;
  resolved: boolean;
  date: string;
  handler: string | null;
};

const initialInteractions: Interaction[] = [
  { id: '1', client: 'Juan Perez', channel: 'whatsapp', subject: 'Consulta sobre plan Premium', resolved: true, date: 'Hace 2h', handler: 'Ana Silva' },
  { id: '2', client: 'Camila Torres', channel: 'email', subject: 'Problema con reserva cancelada', resolved: false, date: 'Hace 4h', handler: 'Maria Gonzalez' },
  { id: '3', client: 'Diego Lopez', channel: 'phone', subject: 'Solicitud de congelamiento', resolved: true, date: 'Ayer', handler: 'Ana Silva' },
  { id: '4', client: 'Sofia Martinez', channel: 'whatsapp', subject: 'Horarios de clases feriado', resolved: true, date: 'Ayer', handler: 'Ana Silva' },
  { id: '5', client: 'Andres Vargas', channel: 'email', subject: 'Solicitud de reembolso', resolved: false, date: 'Hace 2 dias', handler: null },
];

const channelIcon: Record<Interaction['channel'], typeof MessageCircle> = {
  whatsapp: MessageCircle,
  email: Mail,
  phone: Phone,
};

const channelColor: Record<Interaction['channel'], string> = {
  whatsapp: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-950/40',
  email: 'text-brand-500 bg-brand-50 dark:bg-brand-950/40',
  phone: 'text-violet-500 bg-violet-50 dark:bg-violet-950/40',
};

const emptyInteraction = {
  client: '',
  channel: 'whatsapp' as Interaction['channel'],
  subject: '',
  handler: '',
};

export default function SupportPage() {
  const [interactions, setInteractions] = useState<Interaction[]>(initialInteractions);
  const [showModal, setShowModal] = useState(false);
  const [selectedInteraction, setSelectedInteraction] = useState<Interaction | null>(null);
  const [form, setForm] = useState(emptyInteraction);

  const stats = useMemo(() => ({
    whatsapp: interactions.filter((item) => item.channel === 'whatsapp').length,
    email: interactions.filter((item) => item.channel === 'email').length,
    phone: interactions.filter((item) => item.channel === 'phone').length,
    pending: interactions.filter((item) => !item.resolved).length,
  }), [interactions]);

  const createInteraction = () => {
    if (!form.client.trim() || !form.subject.trim()) {
      toast.error('Completa cliente y asunto');
      return;
    }

    const nextInteraction: Interaction = {
      id: crypto.randomUUID(),
      client: form.client.trim(),
      channel: form.channel,
      subject: form.subject.trim(),
      resolved: false,
      date: 'Ahora',
      handler: form.handler.trim() || null,
    };

    setInteractions((current) => [nextInteraction, ...current]);
    setShowModal(false);
    setForm(emptyInteraction);
    toast.success('Interaccion creada');
  };

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-6">
      <motion.div variants={fadeInUp} className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Soporte</h1>
          <p className="mt-1 text-sm text-surface-500">Canales de atencion y registro operativo de interacciones</p>
        </div>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => setShowModal(true)}
          className="btn-primary text-sm"
        >
          <Plus size={16} /> Nueva interaccion
        </motion.button>
      </motion.div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { icon: MessageCircle, label: 'WhatsApp', value: '+56 9 1234 5678', color: 'emerald', pending: stats.pending, href: 'https://wa.me/56912345678' },
          { icon: Mail, label: 'Email', value: 'soporte@nexogym.cl', color: 'brand', pending: stats.email, href: 'mailto:soporte@nexogym.cl' },
          { icon: Phone, label: 'Telefono', value: '+56 2 2345 6789', color: 'violet', pending: stats.phone, href: 'tel:+56223456789' },
        ].map((channel, index) => (
          <motion.a
            key={channel.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.08 }}
            whileHover={{ y: -3 }}
            href={channel.href}
            target={channel.label === 'WhatsApp' ? '_blank' : undefined}
            rel={channel.label === 'WhatsApp' ? 'noreferrer' : undefined}
            className="rounded-2xl border border-surface-200/50 bg-white p-5 transition-all duration-300 hover:shadow-lg dark:border-surface-800/50 dark:bg-surface-900"
          >
            <div className={cn(
              'mb-3 flex h-11 w-11 items-center justify-center rounded-xl',
              channel.color === 'emerald' ? 'bg-emerald-50 dark:bg-emerald-950/40' :
              channel.color === 'brand' ? 'bg-brand-50 dark:bg-brand-950/40' :
              'bg-violet-50 dark:bg-violet-950/40',
            )}>
              <channel.icon size={20} className={cn(
                channel.color === 'emerald' ? 'text-emerald-500' :
                channel.color === 'brand' ? 'text-brand-500' : 'text-violet-500',
              )} />
            </div>
            <h3 className="font-semibold text-surface-900 dark:text-white">{channel.label}</h3>
            <p className="mt-0.5 text-sm text-surface-500">{channel.value}</p>
            <span className="badge badge-warning mt-2 text-[10px]">
              {channel.pending} gestion{channel.pending === 1 ? '' : 'es'}
            </span>
          </motion.a>
        ))}
      </div>

      <motion.div
        variants={fadeInUp}
        className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900"
      >
        <h3 className="mb-4 text-base font-semibold text-surface-900 dark:text-white">Interacciones recientes</h3>
        <div className="space-y-2">
          {interactions.map((item, index) => {
            const Icon = channelIcon[item.channel] || Mail;
            return (
              <motion.button
                key={item.id}
                type="button"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 + index * 0.06 }}
                onClick={() => setSelectedInteraction(item)}
                className="flex w-full items-center gap-4 rounded-xl p-3 text-left transition-colors duration-150 hover:bg-surface-50 dark:hover:bg-surface-800/50"
              >
                <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl', channelColor[item.channel])}>
                  <Icon size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-surface-900 dark:text-white">{item.subject}</p>
                  <p className="text-xs text-surface-500">{item.client} · {item.handler || 'Sin asignar'}</p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-3">
                  <span className="text-xs text-surface-400">{item.date}</span>
                  {item.resolved ? <CheckCircle2 size={16} className="text-emerald-500" /> : <AlertCircle size={16} className="text-amber-500" />}
                </div>
              </motion.button>
            );
          })}
        </div>
      </motion.div>

      <Modal
        open={showModal}
        title="Nueva interaccion"
        description="Agrega una gestion de soporte directamente en la interfaz."
        onClose={() => setShowModal(false)}
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Cliente</label>
              <input className="input" value={form.client} onChange={(event) => setForm((current) => ({ ...current, client: event.target.value }))} />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Responsable</label>
              <input className="input" value={form.handler} onChange={(event) => setForm((current) => ({ ...current, handler: event.target.value }))} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Canal</label>
              <select className="input" value={form.channel} onChange={(event) => setForm((current) => ({ ...current, channel: event.target.value as Interaction['channel'] }))}>
                <option value="whatsapp">WhatsApp</option>
                <option value="email">Email</option>
                <option value="phone">Telefono</option>
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Asunto</label>
              <input className="input" value={form.subject} onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
            <button type="button" className="btn-primary" onClick={createInteraction}>Guardar</button>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(selectedInteraction)}
        title={selectedInteraction?.subject ?? 'Interaccion'}
        description="Detalle rapido de la interaccion seleccionada."
        onClose={() => setSelectedInteraction(null)}
      >
        {selectedInteraction ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-surface-200/60 px-4 py-4 dark:border-surface-800/60">
                <p className="text-xs text-surface-500">Cliente</p>
                <p className="mt-1 font-semibold text-surface-900 dark:text-white">{selectedInteraction.client}</p>
              </div>
              <div className="rounded-2xl border border-surface-200/60 px-4 py-4 dark:border-surface-800/60">
                <p className="text-xs text-surface-500">Responsable</p>
                <p className="mt-1 font-semibold text-surface-900 dark:text-white">{selectedInteraction.handler || 'Sin asignar'}</p>
              </div>
            </div>
            <div className="rounded-2xl border border-surface-200/60 px-4 py-4 text-sm text-surface-500 dark:border-surface-800/60">
              Canal: {selectedInteraction.channel}. Estado actual: {selectedInteraction.resolved ? 'resuelto' : 'pendiente'}.
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setInteractions((current) => current.map((item) => (
                    item.id === selectedInteraction.id ? { ...item, resolved: !item.resolved } : item
                  )));
                  setSelectedInteraction((current) => current ? { ...current, resolved: !current.resolved } : current);
                }}
              >
                {selectedInteraction.resolved ? 'Marcar pendiente' : 'Marcar resuelto'}
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  toast.success('Interaccion revisada');
                  setSelectedInteraction(null);
                }}
              >
                Cerrar
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </motion.div>
  );
}
