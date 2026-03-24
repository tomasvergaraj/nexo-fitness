import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { ArrowRight, CalendarCheck2, Building2, Store, Smartphone } from 'lucide-react';
import { publicApi } from '@/services/api';

const emptyForm = {
  owner_name: '',
  gym_name: '',
  email: '',
  phone: '',
  request_type: 'demo',
  source: 'site',
  desired_plan_key: 'monthly',
  notes: '',
};

export default function PublicLandingPage() {
  const [form, setForm] = useState(emptyForm);

  const mutation = useMutation({
    mutationFn: async () => {
      const response = await publicApi.createLead(form);
      return response.data;
    },
    onSuccess: () => {
      toast.success('Solicitud enviada. Te contactaremos para la demo.');
      setForm(emptyForm);
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.detail || 'No se pudo enviar la solicitud');
    },
  });

  return (
    <div className="min-h-screen bg-surface-950 text-white">
      <section className="relative overflow-hidden px-4 py-14 sm:px-6 lg:px-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(6,182,212,0.24),_transparent_30%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.18),_transparent_28%)]" />
        <div className="relative mx-auto max-w-7xl">
          <div className="grid gap-8 xl:grid-cols-[1.08fr_0.92fr]">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-surface-300">
                <CalendarCheck2 size={14} />
                Funnel comercial de Nexo
              </div>
              <h1 className="max-w-4xl text-4xl font-bold font-display leading-tight sm:text-5xl">
                Vende tu gimnasio mejor y opera todo desde una sola plataforma.
              </h1>
              <p className="max-w-3xl text-base leading-7 text-surface-300">
                Nexo Fitness une panel de owner, storefront publico, checkout de planes y app movil para clientes en una misma base SaaS multitenant.
              </p>

              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  { title: 'Operacion completa', description: 'Clientes, planes, check-in, clases y reportes en tiempo real', icon: Building2 },
                  { title: 'Venta digital por gym', description: 'Storefront, checkout, links y QR para vender membresias', icon: Store },
                  { title: 'App central para clientes', description: 'Reserva, pagos, QR de acceso y notificaciones push', icon: Smartphone },
                ].map((item) => (
                  <div key={item.title} className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
                    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10">
                      <item.icon size={22} />
                    </div>
                    <h2 className="text-lg font-semibold">{item.title}</h2>
                    <p className="mt-2 text-sm leading-6 text-surface-300">{item.description}</p>
                  </div>
                ))}
              </div>
            </div>

            <motion.form
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              onSubmit={(event) => {
                event.preventDefault();
                mutation.mutate();
              }}
              className="rounded-[2rem] border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur-2xl"
            >
              <h2 className="text-2xl font-bold font-display">Agenda una demo</h2>
              <p className="mt-2 text-sm text-surface-300">
                Dejanos tus datos y te contactamos para mostrarte el panel, el storefront y el flujo completo de ventas.
              </p>

              <div className="mt-6 space-y-4">
                <input className="input bg-white/5 text-white" value={form.owner_name} onChange={(event) => setForm((current) => ({ ...current, owner_name: event.target.value }))} placeholder="Tu nombre" required />
                <input className="input bg-white/5 text-white" value={form.gym_name} onChange={(event) => setForm((current) => ({ ...current, gym_name: event.target.value }))} placeholder="Nombre del gimnasio" required />
                <input type="email" className="input bg-white/5 text-white" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} placeholder="Email" required />
                <input className="input bg-white/5 text-white" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} placeholder="Telefono" />
                <textarea className="input min-h-28 resize-y bg-white/5 text-white" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Cuantas sedes tienes, como vendes hoy y que quieres resolver" />
              </div>

              <button type="submit" className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-brand-500 to-brand-600 px-6 py-4 font-semibold text-white shadow-xl shadow-brand-500/25" disabled={mutation.isPending}>
                {mutation.isPending ? 'Enviando...' : 'Solicitar demo'}
                <ArrowRight size={18} />
              </button>
            </motion.form>
          </div>
        </div>
      </section>
    </div>
  );
}
