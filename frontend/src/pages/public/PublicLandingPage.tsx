import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { ArrowRight, CalendarCheck2, Building2, Store, Smartphone, Check, Zap } from 'lucide-react';
import NexoBrand from '@/components/branding/NexoBrand';
import { publicApi, billingApi } from '@/services/api';
import { getApiError } from '@/utils';

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

const PLAN_FEATURES = [
  'Clases ilimitadas (presencial, online, híbrido)',
  'Miembros y membresías con control de acceso',
  'Check-in con QR desde la app del miembro',
  'Pagos con Stripe y MercadoPago',
  'Campañas de email y notificaciones a clientes',
  'Reportes y exportación de datos',
  'App para miembros desde el celular',
  'Soporte técnico por email',
];

const formatPrice = (price: number, currency: string) => {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency, maximumFractionDigits: 0 }).format(price);
};

export default function PublicLandingPage() {
  const [form, setForm] = useState(emptyForm);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');

  const { data: plansData } = useQuery({
    queryKey: ['public-plans'],
    queryFn: () => billingApi.listPublicPlans().then((r) => r.data),
    staleTime: 1000 * 60 * 5,
  });

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
      toast.error(getApiError(error, 'No se pudo enviar la solicitud'));
    },
  });

  return (
    <div className="min-h-screen bg-surface-950 text-white">
      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b border-white/5 bg-surface-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <NexoBrand
            iconSize={32}
            iconClassName="shadow-lg shadow-brand-500/25"
            titleClassName="text-base"
            accentClassName="text-brand-400"
          />
          <div className="flex items-center gap-6 text-sm">
            <a href="#precios" className="text-surface-400 hover:text-white transition-colors">Precios</a>
            <a href="/login" className="text-surface-400 hover:text-white transition-colors">Ingresar</a>
            <a href="/register" className="rounded-xl bg-brand-500 px-4 py-2 font-medium text-white hover:bg-brand-600 transition-colors">
              Comenzar gratis
            </a>
          </div>
        </div>
      </nav>

      <section id="demo" className="relative overflow-hidden px-4 py-14 sm:px-6 lg:px-10">
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
                Nexo Fitness reúne la gestión de tu gimnasio, la venta online de planes y la app para clientes en un solo lugar.
              </p>

              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  { title: 'Operación completa', description: 'Clientes, planes, check-in, clases y reportes en tiempo real', icon: Building2 },
                  { title: 'Venta digital del gimnasio', description: 'Tienda online, pago seguro, links y QR para vender membresías', icon: Store },
                  { title: 'App para clientes', description: 'Reservas, pagos, QR de acceso y avisos desde el celular', icon: Smartphone },
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
                Déjanos tus datos y te contactamos para mostrarte el panel, la tienda online y el flujo completo de ventas.
              </p>

              <div className="mt-6 space-y-4">
                <input className="input bg-white/5 text-white" value={form.owner_name} onChange={(event) => setForm((current) => ({ ...current, owner_name: event.target.value }))} placeholder="Tu nombre" required />
                <input className="input bg-white/5 text-white" value={form.gym_name} onChange={(event) => setForm((current) => ({ ...current, gym_name: event.target.value }))} placeholder="Nombre del gimnasio" required />
                <input type="email" className="input bg-white/5 text-white" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} placeholder="Email" required />
                <input className="input bg-white/5 text-white" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} placeholder="Teléfono" />
                <textarea className="input min-h-28 resize-y bg-white/5 text-white" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Cuántas sedes tienes, cómo vendes hoy y qué quieres resolver" />
              </div>

              <button type="submit" className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-brand-500 to-brand-600 px-6 py-4 font-semibold text-white shadow-xl shadow-brand-500/25" disabled={mutation.isPending}>
                {mutation.isPending ? 'Enviando...' : 'Solicitar demo'}
                <ArrowRight size={18} />
              </button>
            </motion.form>
          </div>
        </div>
      </section>
      {/* Pricing section */}
      <section id="precios" className="relative px-4 py-20 sm:px-6 lg:px-10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(6,182,212,0.08),_transparent_60%)]" />
        <div className="relative mx-auto max-w-4xl">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-bold font-display sm:text-4xl">
              Precios simples y transparentes
            </h2>
            <p className="mt-3 text-surface-400">
              Sin costos ocultos. Sin sorpresas. Cancela cuando quieras.
            </p>

            {/* Toggle mensual / anual */}
            <div className="mt-6 inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
              <button
                onClick={() => setBillingCycle('monthly')}
                className={`rounded-lg px-5 py-2 text-sm font-medium transition-all ${
                  billingCycle === 'monthly'
                    ? 'bg-brand-500 text-white shadow-lg shadow-brand-500/30'
                    : 'text-surface-400 hover:text-white'
                }`}
              >
                Mensual
              </button>
              <button
                onClick={() => setBillingCycle('annual')}
                className={`rounded-lg px-5 py-2 text-sm font-medium transition-all ${
                  billingCycle === 'annual'
                    ? 'bg-brand-500 text-white shadow-lg shadow-brand-500/30'
                    : 'text-surface-400 hover:text-white'
                }`}
              >
                Anual
                <span className="ml-2 rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-400">
                  2 meses gratis
                </span>
              </button>
            </div>
          </div>

          <motion.div
            key={billingCycle}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="mx-auto max-w-sm"
          >
            <div className="rounded-3xl border border-brand-500/40 bg-gradient-to-b from-brand-500/10 to-surface-900/80 p-8 shadow-2xl shadow-brand-500/10 backdrop-blur-xl ring-1 ring-brand-500/20">
              <div className="flex items-center gap-3 mb-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/20">
                  <Zap size={20} className="text-brand-400" />
                </div>
                <h3 className="text-xl font-bold">Plan Completo</h3>
              </div>
              <p className="text-sm text-surface-400 mb-6">Todo lo que necesita tu gimnasio.</p>

              <div className="flex items-end gap-2 mb-2">
                <span className="text-5xl font-extrabold font-display">
                  {plansData
                    ? formatPrice(
                        billingCycle === 'annual'
                          ? Math.round((plansData.annual_price ?? plansData.annual?.price ?? 349900) / 12)
                          : (plansData.monthly_price ?? plansData.monthly?.price ?? 34990),
                        plansData.currency ?? 'CLP'
                      )
                    : billingCycle === 'annual' ? '$29.158' : '$34.990'
                  }
                </span>
                <span className="mb-2 text-surface-400 text-sm">/mes</span>
              </div>
              {billingCycle === 'annual' && (
                <p className="text-xs text-emerald-400 mb-6">
                  Facturado anualmente. Ahorras 2 meses.
                </p>
              )}
              {billingCycle === 'monthly' && <div className="mb-6" />}

              <a
                href="/register"
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r
                           from-brand-500 to-brand-600 py-4 font-semibold text-white
                           shadow-xl shadow-brand-500/30 hover:shadow-brand-500/50 transition-shadow"
              >
                Comenzar prueba gratis de 14 días
                <ArrowRight size={18} />
              </a>
              <p className="mt-3 text-center text-xs text-surface-500">
                Sin tarjeta de crédito. Sin compromisos.
              </p>

              <ul className="mt-8 space-y-3">
                {PLAN_FEATURES.map((f) => (
                  <li key={f} className="flex items-start gap-3 text-sm text-surface-300">
                    <Check size={16} className="mt-0.5 shrink-0 text-brand-400" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>

          <p className="mt-10 text-center text-sm text-surface-500">
            ¿Necesitas un plan personalizado para múltiples sedes?{' '}
            <a href="#demo" className="text-brand-400 hover:text-brand-300 transition-colors">
              Contáctanos
            </a>
          </p>
        </div>
      </section>
    </div>
  );
}
