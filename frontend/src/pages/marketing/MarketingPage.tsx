import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  Megaphone, Plus, Mail, MessageCircle, Send, Eye, MousePointer,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import Modal from '@/components/ui/Modal';
import { staggerContainer, fadeInUp } from '@/utils/animations';
import { cn } from '@/utils';

type Campaign = {
  id: string;
  name: string;
  channel: 'email' | 'whatsapp' | 'sms';
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled';
  sent: number;
  opened: number;
};

const initialCampaigns: Campaign[] = [
  { id: '1', name: 'Promo Verano 2025', channel: 'email', status: 'sent', sent: 195, opened: 87 },
  { id: '2', name: 'Bienvenida Nuevos', channel: 'email', status: 'sent', sent: 45, opened: 38 },
  { id: '3', name: 'Recordatorio Clases', channel: 'whatsapp', status: 'sent', sent: 118, opened: 105 },
  { id: '4', name: 'Renovacion Marzo', channel: 'email', status: 'draft', sent: 0, opened: 0 },
  { id: '5', name: 'Flash Sale Fin de Semana', channel: 'whatsapp', status: 'scheduled', sent: 0, opened: 0 },
];

const statusConfig: Record<Campaign['status'], { label: string; class: string }> = {
  draft: { label: 'Borrador', class: 'badge-neutral' },
  scheduled: { label: 'Programada', class: 'badge-info' },
  sending: { label: 'Enviando', class: 'badge-warning' },
  sent: { label: 'Enviada', class: 'badge-success' },
  cancelled: { label: 'Cancelada', class: 'badge-danger' },
};

const emptyCampaign = {
  name: '',
  channel: 'email' as Campaign['channel'],
  status: 'draft' as Campaign['status'],
  sent: '0',
  opened: '0',
};

export default function MarketingPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>(initialCampaigns);
  const [showModal, setShowModal] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [form, setForm] = useState(emptyCampaign);

  const stats = useMemo(() => {
    const totalSent = campaigns.reduce((sum, item) => sum + item.sent, 0);
    const totalOpened = campaigns.reduce((sum, item) => sum + item.opened, 0);
    const openRate = totalSent ? Math.round((totalOpened / totalSent) * 100) : 0;
    return {
      activeCampaigns: campaigns.filter((item) => item.status === 'scheduled' || item.status === 'sending').length,
      totalSent,
      openRate,
      clickRate: Math.max(8, Math.round(openRate * 0.35)),
    };
  }, [campaigns]);

  const channelData = useMemo(() => {
    const base = [
      { name: 'Email', sent: 0, opened: 0, color: '#06b6d4' },
      { name: 'WhatsApp', sent: 0, opened: 0, color: '#10b981' },
      { name: 'SMS', sent: 0, opened: 0, color: '#8b5cf6' },
    ];

    campaigns.forEach((campaign) => {
      const target = base.find((item) => item.name.toLowerCase() === campaign.channel);
      if (target) {
        target.sent += campaign.sent;
        target.opened += campaign.opened;
      }
    });

    return base;
  }, [campaigns]);

  const createCampaign = () => {
    const sent = Number(form.sent);
    const opened = Number(form.opened);

    if (!form.name.trim()) {
      toast.error('Ingresa un nombre para la campana');
      return;
    }

    if (opened > sent) {
      toast.error('Los abiertos no pueden superar a los enviados');
      return;
    }

    const nextCampaign: Campaign = {
      id: crypto.randomUUID(),
      name: form.name.trim(),
      channel: form.channel,
      status: form.status,
      sent,
      opened,
    };

    setCampaigns((current) => [nextCampaign, ...current]);
    setShowModal(false);
    setForm(emptyCampaign);
    toast.success('Campana creada');
  };

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-6">
      <motion.div variants={fadeInUp} className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Marketing</h1>
          <p className="mt-1 text-sm text-surface-500">Campanas, segmentos y comunicacion con interacciones reales en la UI</p>
        </div>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => setShowModal(true)}
          className="btn-primary text-sm"
        >
          <Plus size={16} /> Nueva Campana
        </motion.button>
      </motion.div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        {[
          { label: 'Campanas activas', value: String(stats.activeCampaigns), icon: Megaphone, color: 'text-brand-500 bg-brand-50 dark:bg-brand-950/40' },
          { label: 'Total enviados', value: String(stats.totalSent), icon: Send, color: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-950/40' },
          { label: 'Tasa apertura', value: `${stats.openRate}%`, icon: Eye, color: 'text-violet-500 bg-violet-50 dark:bg-violet-950/40' },
          { label: 'Tasa click', value: `${stats.clickRate}%`, icon: MousePointer, color: 'text-amber-500 bg-amber-50 dark:bg-amber-950/40' },
        ].map((stat, index) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.08 }}
            className="flex items-center gap-4 rounded-2xl border border-surface-200/50 bg-white p-4 dark:border-surface-800/50 dark:bg-surface-900"
          >
            <div className={cn('flex h-11 w-11 items-center justify-center rounded-xl', stat.color)}>
              <stat.icon size={20} />
            </div>
            <div>
              <p className="text-xs text-surface-500">{stat.label}</p>
              <p className="text-xl font-bold font-display text-surface-900 dark:text-white">{stat.value}</p>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <motion.div
          variants={fadeInUp}
          className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900"
        >
          <h3 className="mb-4 text-base font-semibold text-surface-900 dark:text-white">Rendimiento por canal</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={channelData} barGap={8}>
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <Tooltip contentStyle={{ backgroundColor: 'rgba(15,23,42,0.9)', border: 'none', borderRadius: '10px', color: '#fff', fontSize: '13px' }} />
              <Bar dataKey="sent" name="Enviados" radius={[6, 6, 0, 0]}>
                {channelData.map((entry, index) => <Cell key={index} fill={entry.color} opacity={0.4} />)}
              </Bar>
              <Bar dataKey="opened" name="Abiertos" radius={[6, 6, 0, 0]}>
                {channelData.map((entry, index) => <Cell key={index} fill={entry.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </motion.div>

        <motion.div
          variants={fadeInUp}
          className="lg:col-span-2 rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900"
        >
          <h3 className="mb-4 text-base font-semibold text-surface-900 dark:text-white">Campanas recientes</h3>
          <div className="space-y-2">
            {campaigns.map((campaign, index) => (
              <motion.button
                key={campaign.id}
                type="button"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 + index * 0.06 }}
                onClick={() => setSelectedCampaign(campaign)}
                className="flex w-full items-center gap-4 rounded-xl p-3 text-left transition-all duration-200 hover:bg-surface-50 dark:hover:bg-surface-800/50"
              >
                <div className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-xl',
                  campaign.channel === 'email'
                    ? 'bg-brand-50 text-brand-500 dark:bg-brand-950/40'
                    : campaign.channel === 'whatsapp'
                      ? 'bg-emerald-50 text-emerald-500 dark:bg-emerald-950/40'
                      : 'bg-violet-50 text-violet-500 dark:bg-violet-950/40',
                )}>
                  {campaign.channel === 'email' ? <Mail size={18} /> : <MessageCircle size={18} />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-surface-900 dark:text-white">{campaign.name}</p>
                  <p className="text-xs text-surface-500">
                    {campaign.sent > 0 ? `${campaign.sent} enviados · ${campaign.opened} abiertos` : 'Sin enviar'}
                  </p>
                </div>
                <span className={cn('badge text-[10px]', statusConfig[campaign.status].class)}>
                  {statusConfig[campaign.status].label}
                </span>
              </motion.button>
            ))}
          </div>
        </motion.div>
      </div>

      <Modal
        open={showModal}
        title="Nueva campana"
        description="Crea una campana visible dentro de esta demo para validar interacciones reales."
        onClose={() => setShowModal(false)}
      >
        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Nombre</label>
            <input className="input" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Canal</label>
              <select className="input" value={form.channel} onChange={(event) => setForm((current) => ({ ...current, channel: event.target.value as Campaign['channel'] }))}>
                <option value="email">Email</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="sms">SMS</option>
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Estado</label>
              <select className="input" value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as Campaign['status'] }))}>
                <option value="draft">Borrador</option>
                <option value="scheduled">Programada</option>
                <option value="sending">Enviando</option>
                <option value="sent">Enviada</option>
                <option value="cancelled">Cancelada</option>
              </select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Enviados</label>
              <input type="number" min="0" className="input" value={form.sent} onChange={(event) => setForm((current) => ({ ...current, sent: event.target.value }))} />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Abiertos</label>
              <input type="number" min="0" className="input" value={form.opened} onChange={(event) => setForm((current) => ({ ...current, opened: event.target.value }))} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
            <button type="button" className="btn-primary" onClick={createCampaign}>Crear campana</button>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(selectedCampaign)}
        title={selectedCampaign?.name ?? 'Detalle de campana'}
        description="Resumen interactivo de la campana seleccionada."
        onClose={() => setSelectedCampaign(null)}
      >
        {selectedCampaign ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-surface-200/60 px-4 py-4 dark:border-surface-800/60">
                <p className="text-xs text-surface-500">Canal</p>
                <p className="mt-1 font-semibold text-surface-900 dark:text-white">{selectedCampaign.channel}</p>
              </div>
              <div className="rounded-2xl border border-surface-200/60 px-4 py-4 dark:border-surface-800/60">
                <p className="text-xs text-surface-500">Estado</p>
                <p className="mt-1 font-semibold text-surface-900 dark:text-white">{statusConfig[selectedCampaign.status].label}</p>
              </div>
              <div className="rounded-2xl border border-surface-200/60 px-4 py-4 dark:border-surface-800/60">
                <p className="text-xs text-surface-500">Apertura</p>
                <p className="mt-1 font-semibold text-surface-900 dark:text-white">
                  {selectedCampaign.sent ? Math.round((selectedCampaign.opened / selectedCampaign.sent) * 100) : 0}%
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setCampaigns((current) => current.map((item) => (
                    item.id === selectedCampaign.id ? { ...item, status: item.status === 'scheduled' ? 'sent' : 'scheduled' } : item
                  )));
                  setSelectedCampaign((current) => current ? { ...current, status: current.status === 'scheduled' ? 'sent' : 'scheduled' } : current);
                }}
              >
                Cambiar estado
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  toast.success('Campana marcada como revisada');
                  setSelectedCampaign(null);
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
