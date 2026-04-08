import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  CreditCard,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  Store,
} from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import Modal from '@/components/ui/Modal';
import { publicApi } from '@/services/api';
import {
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_SECONDARY_COLOR,
  formatCurrency,
  formatDateTime,
  getApiError,
  getPublicAppOrigin,
  hexToRgbString,
  normalizeHexColor,
} from '@/utils';
import type { PublicCheckoutSession, TenantPublicProfile } from '@/types';

type CheckoutForm = {
  plan_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
};

type CheckoutResumeSession = {
  checkout_url: string;
  payment_link_url: string;
  session_reference: string;
  plan_id: string;
  customer_email: string;
  created_at: number;
};

const emptyForm: CheckoutForm = {
  plan_id: '',
  customer_name: '',
  customer_email: '',
  customer_phone: '',
};

const getDurationLabel = (durationType: string) => {
  switch (durationType) {
    case 'monthly':
      return 'Mensual';
    case 'annual':
      return 'Anual';
    case 'perpetual':
      return 'Pago unico';
    default:
      return 'Plan flexible';
  }
};

const getCheckoutStorageKey = (storefrontKey: string) => `nexo-storefront-checkout:${storefrontKey}`;

const readStoredCheckoutSession = (storefrontKey: string): CheckoutResumeSession | null => {
  if (!storefrontKey || typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(getCheckoutStorageKey(storefrontKey));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as CheckoutResumeSession;
    const isExpired = Date.now() - parsed.created_at > 1000 * 60 * 60 * 24;

    if (isExpired || !parsed.checkout_url || !parsed.plan_id) {
      window.sessionStorage.removeItem(getCheckoutStorageKey(storefrontKey));
      return null;
    }

    return parsed;
  } catch {
    window.sessionStorage.removeItem(getCheckoutStorageKey(storefrontKey));
    return null;
  }
};

const saveCheckoutSession = (storefrontKey: string, session: CheckoutResumeSession) => {
  if (!storefrontKey || typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.setItem(getCheckoutStorageKey(storefrontKey), JSON.stringify(session));
};

const clearCheckoutSession = (storefrontKey: string) => {
  if (!storefrontKey || typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.removeItem(getCheckoutStorageKey(storefrontKey));
};

const buildPlanHighlights = (
  plan: TenantPublicProfile['featured_plans'][number],
  profile: TenantPublicProfile
) => {
  const highlights: string[] = [];

  if (plan.description) {
    highlights.push(plan.description);
  }

  if (plan.duration_days) {
    highlights.push(`Vigencia por ${plan.duration_days} dias desde la activacion.`);
  } else {
    highlights.push(`Acceso ${getDurationLabel(plan.duration_type).toLowerCase()} con compra online inmediata.`);
  }

  if (profile.upcoming_classes.length > 0) {
    highlights.push('Despues de comprar podras coordinar reservas y activacion con el gimnasio.');
  } else {
    highlights.push('Compra en minutos y recibe la confirmacion para comenzar sin pasos extra.');
  }

  return highlights.slice(0, 3);
};

export default function TenantStorefrontPage() {
  const { slug = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [showCheckout, setShowCheckout] = useState(false);
  const [form, setForm] = useState<CheckoutForm>(emptyForm);
  const [resumeSession, setResumeSession] = useState<CheckoutResumeSession | null>(null);
  const handledCheckoutStateRef = useRef(false);
  const isHostResolvedStorefront = !slug;
  const hostStorefrontKey = typeof window === 'undefined' ? '' : window.location.hostname;
  const storefrontKey = isHostResolvedStorefront ? hostStorefrontKey : slug;

  useEffect(() => {
    setResumeSession(readStoredCheckoutSession(storefrontKey));
  }, [storefrontKey]);

  useEffect(() => {
    const checkoutState = new URLSearchParams(location.search).get('checkout');
    if (!checkoutState || handledCheckoutStateRef.current) {
      return;
    }
    handledCheckoutStateRef.current = true;

    const storedSession = readStoredCheckoutSession(storefrontKey);
    const email = storedSession?.customer_email || resumeSession?.customer_email || form.customer_email || '';
    if (checkoutState === 'success') {
      clearCheckoutSession(storefrontKey);
      setResumeSession(null);
      const next = new URLSearchParams();
      next.set('purchase', 'success');
      if (email) {
        next.set('email', email);
      }
      navigate(`/login?${next.toString()}`, { replace: true });
    } else if (checkoutState === 'cancelled' || checkoutState === 'cancel') {
      clearCheckoutSession(storefrontKey);
      const next = new URLSearchParams();
      next.set('purchase', 'cancelled');
      if (email) {
        next.set('email', email);
      }
      navigate(`/login?${next.toString()}`, { replace: true });
    } else {
      handledCheckoutStateRef.current = false;
      return;
    }
  }, [form.customer_email, location.search, navigate, resumeSession?.customer_email, storefrontKey]);

  const { data, isLoading, isError } = useQuery<TenantPublicProfile>({
    queryKey: ['tenant-public-profile', isHostResolvedStorefront ? `host:${hostStorefrontKey}` : slug],
    queryFn: async () => {
      const response = isHostResolvedStorefront
        ? await publicApi.getStorefrontProfile()
        : await publicApi.getTenantProfile(slug);
      return response.data;
    },
    enabled: isHostResolvedStorefront || Boolean(slug),
  });

  const defaultPlan = data?.featured_plans.find((plan) => plan.is_featured) ?? data?.featured_plans[0] ?? null;
  const selectedPlan = data?.featured_plans.find((plan) => plan.id === form.plan_id) ?? defaultPlan;
  const selectedPlanHighlights = selectedPlan && data ? buildPlanHighlights(selectedPlan, data) : [];
  const resumePlan = data?.featured_plans.find((plan) => plan.id === resumeSession?.plan_id) ?? selectedPlan;
  const hasMultiplePlans = (data?.featured_plans.length ?? 0) > 1;

  useEffect(() => {
    if (!defaultPlan) {
      return;
    }

    setForm((current) => (
      current.plan_id
        ? current
        : { ...current, plan_id: defaultPlan.id }
    ));
  }, [defaultPlan]);

  const checkoutMutation = useMutation({
    mutationFn: async () => {
      const storefrontUrl = isHostResolvedStorefront
        ? `${window.location.origin}${location.pathname || '/'}`
        : `${getPublicAppOrigin()}${location.pathname}`;
      const payload = {
        ...form,
        success_url: `${storefrontUrl}?checkout=success`,
        cancel_url: `${storefrontUrl}?checkout=cancelled`,
      };
      const response = isHostResolvedStorefront
        ? await publicApi.createStorefrontCheckoutSession(payload)
        : await publicApi.createCheckoutSession(slug, payload);
      return response.data as PublicCheckoutSession;
    },
    onSuccess: (payload) => {
      const nextSession = {
        checkout_url: payload.checkout_url,
        payment_link_url: payload.payment_link_url,
        session_reference: payload.session_reference,
        plan_id: form.plan_id,
        customer_email: form.customer_email,
        created_at: Date.now(),
      };

      saveCheckoutSession(storefrontKey, nextSession);
      setResumeSession(nextSession);
      setShowCheckout(false);
      toast.success('Te estamos llevando al pago seguro...');
      window.location.assign(payload.checkout_url);
    },
    onError: (error: unknown) => {
      toast.error(getApiError(error, 'No se pudo iniciar la compra'));
    },
  });

  const primaryColor = normalizeHexColor(data?.branding?.primary_color, DEFAULT_PRIMARY_COLOR) ?? DEFAULT_PRIMARY_COLOR;
  const secondaryColor = normalizeHexColor(data?.branding?.secondary_color, DEFAULT_SECONDARY_COLOR) ?? DEFAULT_SECONDARY_COLOR;
  const primaryRgb = hexToRgbString(primaryColor);
  const secondaryRgb = hexToRgbString(secondaryColor);
  const ctaStyle = {
    backgroundImage: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`,
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f8f5ef] px-4 py-8 sm:px-6 lg:px-10">
        <div className="mx-auto h-[620px] max-w-6xl rounded-[2rem] border border-surface-200/70 bg-white/80 shimmer" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen bg-[#f8f5ef] px-4 py-10 text-surface-900">
        <div className="mx-auto max-w-4xl rounded-[2rem] border border-surface-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-3xl font-bold font-display">Tienda no disponible</h1>
          <p className="mt-3 text-surface-600">
            No encontramos el gimnasio solicitado o su compra online aun no esta habilitada.
          </p>
        </div>
      </div>
    );
  }

  const checkoutReady = Boolean(data.checkout_enabled && selectedPlan);

  return (
    <div className="min-h-screen bg-[#f8f5ef] text-surface-900">
      <section className="relative overflow-hidden px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(circle at top left, rgba(${primaryRgb},0.16), transparent 32%), radial-gradient(circle at bottom right, rgba(${secondaryRgb},0.12), transparent 30%)`,
          }}
        />

        <div className="relative mx-auto max-w-6xl space-y-6">
          <div className="grid gap-8 xl:grid-cols-[1.05fr_0.95fr]">
            <div className="space-y-6">
              <div className="rounded-[2rem] border border-white/60 bg-white/80 p-8 shadow-[0_30px_80px_-45px_rgba(15,23,42,0.35)] backdrop-blur-xl">
                <div className="flex items-start gap-4">
                  {data.branding.logo_url ? (
                    <img
                      src={data.branding.logo_url}
                      alt={data.tenant_name}
                      className="h-16 w-16 shrink-0 rounded-2xl border border-surface-200 bg-white object-contain p-2"
                      onError={(event) => {
                        (event.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <div
                      className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-2xl font-bold text-white shadow-lg"
                      style={ctaStyle}
                    >
                      {data.tenant_name.slice(0, 1).toUpperCase()}
                    </div>
                  )}

                  <div className="min-w-0">
                    <div className="inline-flex items-center gap-2 rounded-full border border-surface-200 bg-surface-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-surface-600">
                      <Store size={14} />
                      Compra online
                    </div>
                    <h1 className="mt-4 max-w-3xl text-4xl font-bold font-display leading-tight sm:text-5xl">
                      {data.branding.marketplace_headline || `Compra tu plan en ${data.tenant_name}`}
                    </h1>
                    <p className="mt-4 max-w-2xl text-base leading-7 text-surface-600">
                      {data.branding.marketplace_description || 'Elige tu plan, completa tus datos y continua al pago seguro en pocos pasos.'}
                    </p>
                  </div>
                </div>

                <div className="mt-6 flex flex-wrap gap-3 text-sm text-surface-600">
                  {data.city ? (
                    <span className="inline-flex items-center gap-2 rounded-full border border-surface-200 bg-white px-4 py-2">
                      <MapPin size={15} />
                      {data.city}
                    </span>
                  ) : null}
                  {data.phone ? (
                    <span className="inline-flex items-center gap-2 rounded-full border border-surface-200 bg-white px-4 py-2">
                      <Phone size={15} />
                      {data.phone}
                    </span>
                  ) : null}
                  {data.email ? (
                    <span className="inline-flex items-center gap-2 rounded-full border border-surface-200 bg-white px-4 py-2">
                      <Mail size={15} />
                      {data.email}
                    </span>
                  ) : null}
                </div>

                <div className="mt-8 grid gap-4 md:grid-cols-3">
                  <div className="rounded-[1.5rem] border border-surface-200 bg-[#fcfbf7] p-5">
                    <p className="text-sm font-semibold text-surface-900">1. Elige tu plan</p>
                    <p className="mt-2 text-sm leading-6 text-surface-600">Selecciona el plan que mejor se ajusta a tu objetivo y revisa lo esencial antes de pagar.</p>
                  </div>
                  <div className="rounded-[1.5rem] border border-surface-200 bg-[#fcfbf7] p-5">
                    <p className="text-sm font-semibold text-surface-900">2. Completa tus datos</p>
                    <p className="mt-2 text-sm leading-6 text-surface-600">Ingresas nombre, email y telefono para que el gimnasio pueda activar tu compra sin friccion.</p>
                  </div>
                  <div className="rounded-[1.5rem] border border-surface-200 bg-[#fcfbf7] p-5">
                    <p className="text-sm font-semibold text-surface-900">3. Paga de forma segura</p>
                    <p className="mt-2 text-sm leading-6 text-surface-600">Te redirigimos a un checkout seguro y puedes retomar la compra si la dejas pendiente.</p>
                  </div>
                </div>
              </div>

              {hasMultiplePlans ? (
                <div className="rounded-[2rem] border border-white/60 bg-white/80 p-6 shadow-sm backdrop-blur-xl">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-2xl font-bold font-display">Elige tu plan</h2>
                      <p className="mt-1 text-sm text-surface-600">Mostramos solo lo necesario para decidir y avanzar al pago.</p>
                    </div>
                    <span className="badge badge-neutral">{data.featured_plans.length} opciones</span>
                  </div>

                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    {data.featured_plans.map((plan) => {
                      const isSelected = plan.id === selectedPlan?.id;

                      return (
                        <button
                          key={plan.id}
                          type="button"
                          onClick={() => setForm((current) => ({ ...current, plan_id: plan.id }))}
                          style={isSelected ? ctaStyle : undefined}
                          className={`rounded-[1.5rem] border p-5 text-left transition-all ${
                            isSelected
                              ? 'border-transparent text-white shadow-xl shadow-surface-900/10'
                              : 'border-surface-200 bg-[#fcfbf7] hover:border-surface-300 hover:bg-white'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className={`text-lg font-semibold ${isSelected ? 'text-white' : 'text-surface-900'}`}>{plan.name}</p>
                              <p className={`mt-1 text-sm ${isSelected ? 'text-surface-300' : 'text-surface-600'}`}>
                                {plan.description || 'Plan listo para comprar online.'}
                              </p>
                            </div>
                            {plan.is_featured ? (
                              <span className={`badge ${isSelected ? 'bg-white/15 text-white' : 'badge-info'}`}>
                                Recomendado
                              </span>
                            ) : null}
                          </div>

                          <div className="mt-5 flex items-end justify-between gap-3">
                            <div>
                              <p className={`text-3xl font-bold font-display ${isSelected ? 'text-white' : 'text-surface-900'}`}>
                                {formatCurrency(plan.price, plan.currency)}
                              </p>
                              <p className={`mt-1 text-xs uppercase tracking-[0.18em] ${isSelected ? 'text-surface-300' : 'text-surface-500'}`}>
                                {getDurationLabel(plan.duration_type)}
                              </p>
                            </div>
                            <span className={`inline-flex items-center gap-2 text-sm font-semibold ${isSelected ? 'text-white' : 'text-surface-700'}`}>
                              {isSelected ? 'Seleccionado' : 'Elegir'}
                              <ChevronRight size={16} />
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {(data.upcoming_classes.length > 0 || data.branches.length > 0) ? (
                <div className="grid gap-6 lg:grid-cols-2">
                  {data.upcoming_classes.length > 0 ? (
                    <div className="rounded-[2rem] border border-white/60 bg-white/80 p-6 shadow-sm backdrop-blur-xl">
                      <h2 className="text-2xl font-bold font-display">Proximas clases</h2>
                      <div className="mt-5 space-y-3">
                        {data.upcoming_classes.slice(0, 3).map((item) => (
                          <div key={item.id} className="rounded-[1.25rem] border border-surface-200 bg-[#fcfbf7] px-4 py-4">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <p className="font-semibold text-surface-900">{item.name}</p>
                                <p className="mt-1 text-sm text-surface-600">{item.class_type || 'Clase general'} - {item.modality}</p>
                              </div>
                              <div className="text-sm text-surface-600">
                                <div className="flex items-center gap-2">
                                  <CalendarDays size={15} />
                                  {formatDateTime(item.start_time)}
                                </div>
                                <div className="mt-1">Cupos ocupados: {item.bookings}/{item.capacity}</div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {data.branches.length > 0 ? (
                    <div className="rounded-[2rem] border border-white/60 bg-white/80 p-6 shadow-sm backdrop-blur-xl">
                      <h2 className="text-2xl font-bold font-display">Donde encontrarnos</h2>
                      <div className="mt-5 space-y-3">
                        {data.branches.slice(0, 3).map((branch) => (
                          <div key={branch.id} className="rounded-[1.25rem] border border-surface-200 bg-[#fcfbf7] px-4 py-4">
                            <p className="font-semibold text-surface-900">{branch.name}</p>
                            <p className="mt-1 text-sm text-surface-600">{branch.address || 'Direccion por confirmar'}</p>
                            <p className="mt-1 text-sm text-surface-500">
                              {branch.city || 'Ciudad por confirmar'}{branch.phone ? ` - ${branch.phone}` : ''}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="space-y-6">
              <div className="rounded-[2rem] border border-surface-200 bg-white p-6 shadow-[0_40px_100px_-55px_rgba(15,23,42,0.4)]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.2em] text-surface-500">Producto destacado</p>
                    <h2 className="mt-2 text-3xl font-bold font-display">{selectedPlan?.name || 'Plan disponible'}</h2>
                  </div>
                  <div className="rounded-2xl border border-surface-200 bg-surface-50 px-4 py-3 text-right">
                    <p className="text-xs uppercase tracking-[0.18em] text-surface-500">{selectedPlan ? getDurationLabel(selectedPlan.duration_type) : 'Disponible'}</p>
                    <p className="mt-1 text-2xl font-bold font-display">
                      {selectedPlan ? formatCurrency(selectedPlan.price, selectedPlan.currency) : '--'}
                    </p>
                  </div>
                </div>

                <div className="mt-5 rounded-[1.5rem] border border-surface-200 bg-[#fcfbf7] p-5">
                  <div className="flex items-center gap-3 text-sm text-surface-600">
                    <ShieldCheck size={18} className="text-emerald-600" />
                    Pago seguro y confirmacion inmediata del intento de compra
                  </div>
                  <div className="mt-3 flex items-center gap-3 text-sm text-surface-600">
                    <Clock3 size={18} className="text-surface-500" />
                    Proceso guiado en pocos pasos y sin informacion tecnica innecesaria
                  </div>
                </div>

                <ul className="mt-6 space-y-3">
                  {selectedPlanHighlights.map((item) => (
                    <li key={item} className="flex items-start gap-3 text-sm leading-6 text-surface-700">
                      <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>

                <button
                  type="button"
                  onClick={() => {
                    if (!selectedPlan) {
                      return;
                    }

                    setForm((current) => ({ ...current, plan_id: selectedPlan.id }));
                    setShowCheckout(true);
                  }}
                  className="mt-8 btn-primary w-full py-4 text-base"
                  style={ctaStyle}
                  disabled={!checkoutReady}
                >
                  <CreditCard size={18} />
                  {checkoutReady ? `Comprar ${selectedPlan?.name ?? 'plan'}` : 'Compra online no disponible'}
                </button>

                <p className="mt-3 text-center text-sm text-surface-500">
                  {checkoutReady
                    ? 'Te redirigiremos a un checkout seguro para finalizar la compra.'
                    : 'Este gimnasio aun no tiene la compra online habilitada.'}
                </p>
              </div>

              {resumeSession ? (
                <div className="rounded-[2rem] border border-surface-200 bg-white p-6 shadow-sm">
                  <h3 className="text-xl font-bold font-display">Retomar compra</h3>
                  <p className="mt-2 text-sm leading-6 text-surface-600">
                    Tienes una compra pendiente para {resumePlan?.name ?? 'tu plan seleccionado'}. Puedes seguir desde donde la dejaste.
                  </p>
                  <a href={resumeSession.checkout_url} className="mt-5 btn-secondary w-full bg-surface-900 text-white hover:bg-surface-800">
                    Continuar al pago
                    <ArrowRight size={16} />
                  </a>
                </div>
              ) : null}

              <div className="rounded-[2rem] border border-surface-200 bg-white p-6 shadow-sm">
                <h3 className="text-xl font-bold font-display">Antes de pagar</h3>
                <ul className="mt-4 space-y-3 text-sm leading-6 text-surface-600">
                  <li className="flex items-start gap-3">
                    <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" />
                    Verifica que tu email este bien escrito para recibir instrucciones y confirmaciones.
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" />
                    Si detienes el pago, podras retomarlo desde esta misma pagina.
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" />
                    Si tienes dudas sobre horarios o sucursales, puedes escribir directamente al gimnasio.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Modal
        open={showCheckout}
        title="Completa tus datos"
        description="Usaremos esta informacion para identificar tu compra y llevarte al pago seguro."
        onClose={() => {
          if (!checkoutMutation.isPending) {
            setShowCheckout(false);
          }
        }}
      >
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            checkoutMutation.mutate();
          }}
        >
          {selectedPlan ? (
            <div className="rounded-[1.5rem] border border-surface-200 bg-[#fcfbf7] p-5">
              <p className="text-sm font-semibold text-surface-900">{selectedPlan.name}</p>
              <div className="mt-2 flex items-center justify-between gap-3">
                <p className="text-sm text-surface-600">{selectedPlan.description || 'Plan listo para compra online.'}</p>
                <div className="text-right">
                  <p className="text-xl font-bold font-display text-surface-900">{formatCurrency(selectedPlan.price, selectedPlan.currency)}</p>
                  <p className="text-xs uppercase tracking-[0.18em] text-surface-500">{getDurationLabel(selectedPlan.duration_type)}</p>
                </div>
              </div>
            </div>
          ) : null}

          <input
            className="input"
            value={form.customer_name}
            onChange={(event) => setForm((current) => ({ ...current, customer_name: event.target.value }))}
            placeholder="Nombre completo"
            required
          />
          <input
            type="email"
            className="input"
            value={form.customer_email}
            onChange={(event) => setForm((current) => ({ ...current, customer_email: event.target.value }))}
            placeholder="Email"
            required
          />
          <input
            className="input"
            value={form.customer_phone}
            onChange={(event) => setForm((current) => ({ ...current, customer_phone: event.target.value }))}
            placeholder="Telefono"
          />

          <div className="rounded-[1.25rem] border border-surface-200 bg-surface-50 px-4 py-3 text-sm text-surface-600">
            Al continuar, te redirigiremos al checkout para finalizar el pago.
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn-secondary" onClick={() => setShowCheckout(false)}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" style={ctaStyle} disabled={checkoutMutation.isPending}>
              {checkoutMutation.isPending ? 'Preparando pago...' : 'Continuar al pago'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
