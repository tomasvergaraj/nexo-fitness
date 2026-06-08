import { useParams, useSearchParams } from 'react-router-dom';
import { Calendar, Clock, Users, ArrowRight, Loader2, AlertCircle } from 'lucide-react';
import { useStorefront } from './hooks/useStorefront';
import { formatCurrency, formatDurationLabel, formatTime } from '@/utils';

/**
 * Widget de reservas embebible (Fase 6.7).
 *
 * Pensado para incrustarse en sitios externos vía <iframe src="/embed/:slug">.
 * Reusa el perfil público del storefront. El checkout NO ocurre dentro del
 * iframe (evita problemas con pasarelas de pago en frames de terceros): los
 * botones abren el storefront completo (/s/:slug) en una pestaña nueva.
 *
 * Query params:
 *   ?view=all | classes | plans   (default: all)
 */
export default function EmbedPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const [params] = useSearchParams();
  const view = params.get('view') ?? 'all';
  const { data: profile, isLoading, isError } = useStorefront(slug);

  const storeUrl = `${window.location.origin}/s/${slug}`;
  const openStore = (hash = '') => window.open(`${storeUrl}${hash}`, '_blank', 'noopener,noreferrer');

  if (isLoading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center bg-white">
        <Loader2 className="h-6 w-6 animate-spin text-surface-400" />
      </div>
    );
  }

  if (isError || !profile) {
    return (
      <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 bg-white px-6 text-center text-surface-600">
        <AlertCircle className="h-7 w-7 text-red-400" />
        <p className="text-sm font-medium">No pudimos cargar la información del gimnasio.</p>
      </div>
    );
  }

  const brand = profile.branding.primary_color ?? '#06b6d4';
  const brand2 = profile.branding.secondary_color ?? '#0f766e';
  const gradient = `linear-gradient(135deg, ${brand}, ${brand2})`;
  const showClasses = view !== 'plans' && profile.upcoming_classes.length > 0;
  const showPlans = view !== 'classes' && profile.featured_plans.length > 0;

  return (
    <div className="min-h-screen bg-white p-3 text-surface-900 antialiased sm:p-4">
      <div className="mx-auto max-w-md">
        {/* Header */}
        <div className="mb-4 flex items-center gap-3">
          {profile.branding.logo_url ? (
            <img
              src={profile.branding.logo_url}
              alt={profile.tenant_name}
              className="h-10 w-10 rounded-xl object-contain"
            />
          ) : (
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl text-base font-black text-white"
              style={{ background: gradient }}
            >
              {profile.tenant_name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">{profile.tenant_name}</p>
            {profile.city ? <p className="truncate text-xs text-surface-500">{profile.city}</p> : null}
          </div>
        </div>

        {/* Próximas clases */}
        {showClasses ? (
          <section className="mb-4">
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-surface-500">
              <Calendar size={13} /> Próximas clases
            </h3>
            <div className="space-y-2">
              {profile.upcoming_classes.slice(0, 4).map((cls) => {
                const full = cls.bookings >= cls.capacity;
                return (
                  <button
                    key={cls.id}
                    type="button"
                    onClick={() => openStore()}
                    className="flex w-full items-center gap-3 rounded-xl border border-surface-200 bg-surface-50 px-3 py-2.5 text-left transition-colors hover:border-surface-300"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{cls.name}</p>
                      <p className="flex items-center gap-2 text-xs text-surface-500">
                        <span className="inline-flex items-center gap-1">
                          <Clock size={11} /> {formatTime(cls.start_time)}
                        </span>
                        {cls.branch_name ? <span className="truncate">· {cls.branch_name}</span> : null}
                      </p>
                    </div>
                    <span
                      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                        full ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      <Users size={11} />
                      {full ? 'Llena' : `${cls.bookings}/${cls.capacity}`}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        {/* Planes */}
        {showPlans ? (
          <section className="mb-4">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-surface-500">Planes</h3>
            <div className="space-y-2">
              {profile.featured_plans.slice(0, 4).map((plan) => {
                const price = plan.discount_pct
                  ? Math.round(plan.price * (1 - plan.discount_pct / 100))
                  : plan.price;
                return (
                  <div
                    key={plan.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-surface-200 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{plan.name}</p>
                      <p className="text-xs text-surface-500">
                        <span className="font-bold text-surface-900">{formatCurrency(price, plan.currency)}</span>
                        {' · '}
                        {formatDurationLabel(plan.duration_type, plan.duration_days)}
                      </p>
                    </div>
                    {profile.checkout_enabled ? (
                      <button
                        type="button"
                        onClick={() => openStore('#sf-plans')}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-white"
                        style={{ background: gradient }}
                      >
                        Inscribirme <ArrowRight size={12} />
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {/* CTA general */}
        <button
          type="button"
          onClick={() => openStore()}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white"
          style={{ background: gradient }}
        >
          Ver todo y reservar <ArrowRight size={15} />
        </button>

        <p className="mt-2 text-center text-[10px] text-surface-500">
          Reservas por{' '}
          <a href="https://nexofitness.cl" target="_blank" rel="noopener noreferrer" className="underline">
            Nexo Fitness
          </a>
        </p>
      </div>
    </div>
  );
}
