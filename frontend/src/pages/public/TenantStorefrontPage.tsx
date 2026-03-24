import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { CalendarDays, CreditCard, MapPin, QrCode, Store } from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import Modal from '@/components/ui/Modal';
import { publicApi } from '@/services/api';
import { formatCurrency, formatDateTime } from '@/utils';
import type { PublicCheckoutSession, TenantPublicProfile } from '@/types';

type CheckoutForm = {
  plan_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
};

const emptyForm: CheckoutForm = {
  plan_id: '',
  customer_name: '',
  customer_email: '',
  customer_phone: '',
};

export default function TenantStorefrontPage() {
  const { slug = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [showCheckout, setShowCheckout] = useState(false);
  const [form, setForm] = useState<CheckoutForm>(emptyForm);
  const [session, setSession] = useState<PublicCheckoutSession | null>(null);

  useEffect(() => {
    const checkoutState = new URLSearchParams(location.search).get('checkout');
    if (!checkoutState) {
      return;
    }

    if (checkoutState === 'success') {
      toast.success('Volviste desde checkout con pago confirmado.');
    } else if (checkoutState === 'cancelled' || checkoutState === 'cancel') {
      toast('Volviste desde checkout sin completar el pago. Puedes intentarlo nuevamente cuando quieras.');
    } else {
      return;
    }

    navigate(location.pathname, { replace: true });
  }, [location.pathname, location.search, navigate]);

  const { data, isLoading, isError } = useQuery<TenantPublicProfile>({
    queryKey: ['tenant-public-profile', slug],
    queryFn: async () => {
      const response = await publicApi.getTenantProfile(slug);
      return response.data;
    },
    enabled: Boolean(slug),
  });

  const checkoutMutation = useMutation({
    mutationFn: async () => {
      const storefrontUrl = `${window.location.origin}${location.pathname}`;
      const response = await publicApi.createCheckoutSession(slug, {
        ...form,
        success_url: `${storefrontUrl}?checkout=success`,
        cancel_url: `${storefrontUrl}?checkout=cancelled`,
      });
      return response.data as PublicCheckoutSession;
    },
    onSuccess: (payload) => {
      setSession(payload);
      toast.success('Checkout preparado');
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.detail || 'No se pudo preparar el checkout');
    },
  });

  if (isLoading) {
    return <div className="min-h-screen bg-surface-950 p-8"><div className="mx-auto h-[520px] max-w-6xl shimmer rounded-[2rem]" /></div>;
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen bg-surface-950 px-4 py-10 text-white">
        <div className="mx-auto max-w-4xl rounded-[2rem] border border-white/10 bg-white/5 p-8 text-center">
          <h1 className="text-3xl font-bold font-display">Storefront no disponible</h1>
          <p className="mt-3 text-surface-300">No encontramos el gimnasio solicitado o todavia no tiene canal publico habilitado.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-950 text-white">
      <section className="relative overflow-hidden px-4 py-12 sm:px-6 lg:px-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(6,182,212,0.22),_transparent_30%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.18),_transparent_28%)]" />
        <div className="relative mx-auto max-w-7xl space-y-8">
          <div className="rounded-[2rem] border border-white/10 bg-white/5 p-8 backdrop-blur-2xl">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-surface-300">
                  <Store size={14} />
                  Storefront publico
                </div>
                <h1 className="mt-4 text-4xl font-bold font-display">{data.tenant_name}</h1>
                <p className="mt-3 max-w-3xl text-base leading-7 text-surface-300">
                  {data.branding.marketplace_description || 'Compra tu plan, reserva tus clases y administra tu acceso desde un solo lugar.'}
                </p>
                <div className="mt-4 flex flex-wrap gap-4 text-sm text-surface-300">
                  {data.city ? <span className="inline-flex items-center gap-2"><MapPin size={15} /> {data.city}</span> : null}
                  {data.email ? <span>{data.email}</span> : null}
                  {data.phone ? <span>{data.phone}</span> : null}
                </div>
              </div>

              <div className="rounded-[1.5rem] border border-white/10 bg-black/10 px-5 py-5">
                <p className="text-xs uppercase tracking-[0.18em] text-surface-400">Checkout</p>
                <p className="mt-2 text-lg font-semibold">{data.checkout_enabled ? 'Listo para vender online' : 'Pendiente de configurar'}</p>
              </div>
            </div>
          </div>

          <div className="grid gap-8 xl:grid-cols-[1.05fr_0.95fr]">
            <div className="space-y-6">
              <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 backdrop-blur-2xl">
                <h2 className="text-2xl font-bold font-display">Planes disponibles</h2>
                <div className="mt-5 grid gap-4 lg:grid-cols-2">
                  {data.featured_plans.map((plan) => (
                    <div key={plan.id} className="rounded-[1.5rem] border border-white/10 bg-black/10 p-5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-xl font-semibold">{plan.name}</h3>
                          <p className="mt-2 text-sm text-surface-300">{plan.description || 'Plan activo del gimnasio.'}</p>
                        </div>
                        {plan.is_featured ? <span className="badge badge-info">Destacado</span> : null}
                      </div>
                      <p className="mt-5 text-3xl font-bold font-display">{formatCurrency(plan.price, plan.currency)}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.18em] text-surface-400">{plan.duration_type}</p>
                      <button
                        type="button"
                        onClick={() => {
                          setForm((current) => ({ ...current, plan_id: plan.id }));
                          setSession(null);
                          setShowCheckout(true);
                        }}
                        className="mt-5 btn-primary w-full"
                      >
                        <CreditCard size={16} />
                        Comprar este plan
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 backdrop-blur-2xl">
                <h2 className="text-2xl font-bold font-display">Clases proximas</h2>
                <div className="mt-5 space-y-3">
                  {data.upcoming_classes.map((item) => (
                    <div key={item.id} className="rounded-[1.25rem] border border-white/10 bg-black/10 px-4 py-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="font-semibold">{item.name}</p>
                          <p className="text-sm text-surface-300">{item.class_type || 'Clase general'} - {item.modality}</p>
                        </div>
                        <div className="text-sm text-surface-300">
                          <div className="flex items-center gap-2"><CalendarDays size={15} /> {formatDateTime(item.start_time)}</div>
                          <div className="mt-1">Cupos: {item.bookings}/{item.capacity}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 backdrop-blur-2xl">
                <h2 className="text-2xl font-bold font-display">Sucursales</h2>
                <div className="mt-5 space-y-3">
                  {data.branches.map((branch) => (
                    <div key={branch.id} className="rounded-[1.25rem] border border-white/10 bg-black/10 px-4 py-4">
                      <p className="font-semibold">{branch.name}</p>
                      <p className="mt-1 text-sm text-surface-300">{branch.address || 'Direccion por confirmar'}</p>
                      <p className="mt-1 text-sm text-surface-400">{branch.city || 'Ciudad por confirmar'} {branch.phone ? `- ${branch.phone}` : ''}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 backdrop-blur-2xl">
                <h2 className="text-2xl font-bold font-display">Venta rapida</h2>
                <p className="mt-2 text-sm leading-6 text-surface-300">
                  Cada plan puede publicarse como checkout, link compartible y QR descargable desde el mismo tenant.
                </p>
                {session ? (
                  <div className="mt-5 rounded-[1.5rem] border border-emerald-400/20 bg-emerald-500/10 p-5">
                    <p className="text-sm text-emerald-100">Sesion generada: {session.session_reference}</p>
                    <a href={session.checkout_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 font-semibold text-white">
                      <CreditCard size={16} />
                      Abrir checkout
                    </a>
                    <div className="mt-4 rounded-2xl border border-white/10 bg-black/10 px-4 py-4 text-sm text-surface-300">
                      <div className="flex items-center gap-2"><QrCode size={16} /> QR / Link compartible</div>
                      <p className="mt-2 break-all font-mono text-xs">{session.qr_payload}</p>
                    </div>
                  </div>
                ) : (
                  <div className="mt-5 rounded-[1.5rem] border border-dashed border-white/15 px-4 py-8 text-center text-sm text-surface-300">
                    Selecciona un plan para generar el checkout publico.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <Modal
        open={showCheckout}
        title="Preparar checkout"
        description="Este flujo genera el checkout URL, el link compartible y el QR para vender el plan."
        onClose={() => {
          if (!checkoutMutation.isPending) {
            setShowCheckout(false);
          }
        }}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            checkoutMutation.mutate();
          }}
        >
          <input className="input" value={form.customer_name} onChange={(event) => setForm((current) => ({ ...current, customer_name: event.target.value }))} placeholder="Nombre completo" required />
          <input type="email" className="input" value={form.customer_email} onChange={(event) => setForm((current) => ({ ...current, customer_email: event.target.value }))} placeholder="Email" required />
          <input className="input" value={form.customer_phone} onChange={(event) => setForm((current) => ({ ...current, customer_phone: event.target.value }))} placeholder="Telefono" />
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setShowCheckout(false)}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={checkoutMutation.isPending}>
              {checkoutMutation.isPending ? 'Preparando...' : 'Generar checkout'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
