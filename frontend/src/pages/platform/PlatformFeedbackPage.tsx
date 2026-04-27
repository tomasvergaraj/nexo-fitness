import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Eye,
  Filter,
  ImagePlus,
  Lightbulb,
  Mail,
  Search,
  UserRound,
} from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { billingApi, platformApi } from '@/services/api';
import type {
  AdminTenantBilling,
  FeedbackCategory,
  PaginatedResponse,
  PlatformFeedbackSubmission,
} from '@/types';
import {
  cn,
  feedbackCategoryBadgeColor,
  formatDateTime,
  formatFeedbackCategoryLabel,
  formatRelative,
  getApiError,
} from '@/utils';
import { fadeInUp, staggerContainer } from '@/utils/animations';

const PAGE_SIZE = 12;

type ImageFilter = 'all' | 'with' | 'without';
type CategoryFilter = 'all' | FeedbackCategory;

const CATEGORY_FILTER_OPTIONS: Array<{ value: CategoryFilter; label: string }> = [
  { value: 'all', label: 'Todas las categorías' },
  { value: 'suggestion', label: 'Sugerencia' },
  { value: 'improvement', label: 'Solicitud de mejora' },
  { value: 'problem', label: 'Problema' },
  { value: 'other', label: 'Otro' },
];

const IMAGE_FILTER_OPTIONS: Array<{ value: ImageFilter; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'with', label: 'Con imagen' },
  { value: 'without', label: 'Sin imagen' },
];

export default function PlatformFeedbackPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [tenantSearch, setTenantSearch] = useState('');
  const [selectedTenant, setSelectedTenant] = useState<AdminTenantBilling | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [imageFilter, setImageFilter] = useState<ImageFilter>('all');
  const [selectedSubmission, setSelectedSubmission] = useState<PlatformFeedbackSubmission | null>(null);

  const deferredSearch = useDeferredValue(search);
  const deferredTenantSearch = useDeferredValue(tenantSearch);
  const normalizedSearch = deferredSearch.trim();
  const normalizedTenantSearch = deferredTenantSearch.trim();
  const invalidDateRange = Boolean(dateFrom && dateTo && dateFrom > dateTo);

  useEffect(() => {
    setPage(1);
  }, [normalizedSearch, categoryFilter, selectedTenant?.tenant_id, dateFrom, dateTo, imageFilter]);

  const tenantsQuery = useQuery<PaginatedResponse<AdminTenantBilling>>({
    queryKey: ['platform-feedback-tenants', normalizedTenantSearch],
    queryFn: async () => (
      await billingApi.listAdminTenants({
        page: 1,
        per_page: 20,
        ...(normalizedTenantSearch ? { search: normalizedTenantSearch } : {}),
      })
    ).data,
    staleTime: 60_000,
  });

  const feedbackQuery = useQuery<PaginatedResponse<PlatformFeedbackSubmission>>({
    queryKey: [
      'platform-feedback',
      page,
      normalizedSearch,
      categoryFilter,
      selectedTenant?.tenant_id ?? '',
      dateFrom,
      dateTo,
      imageFilter,
    ],
    enabled: !invalidDateRange,
    queryFn: async () => {
      const params: Record<string, unknown> = {
        page,
        per_page: PAGE_SIZE,
      };
      if (normalizedSearch) params.search = normalizedSearch;
      if (categoryFilter !== 'all') params.category = categoryFilter;
      if (selectedTenant?.tenant_id) params.tenant_id = selectedTenant.tenant_id;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      if (imageFilter !== 'all') params.has_image = imageFilter === 'with';
      return (await platformApi.listFeedback(params)).data;
    },
  });

  const tenantOptions = useMemo(() => {
    const items = tenantsQuery.data?.items ?? [];
    const options = new Map<string, AdminTenantBilling>();
    if (selectedTenant?.tenant_id) {
      options.set(selectedTenant.tenant_id, selectedTenant);
    }
    items.forEach((item) => {
      options.set(item.tenant_id, item);
    });
    return Array.from(options.values());
  }, [selectedTenant, tenantsQuery.data?.items]);

  const feedbackItems = feedbackQuery.data?.items ?? [];
  const activeFilters = useMemo(() => {
    const items: string[] = [];
    if (categoryFilter !== 'all') items.push(formatFeedbackCategoryLabel(categoryFilter));
    if (selectedTenant) items.push(selectedTenant.tenant_name);
    if (dateFrom || dateTo) items.push(`Fechas: ${dateFrom || 'inicio'} a ${dateTo || 'hoy'}`);
    if (imageFilter === 'with') items.push('Con imagen');
    if (imageFilter === 'without') items.push('Sin imagen');
    if (normalizedSearch) items.push(`Busqueda: ${normalizedSearch}`);
    return items;
  }, [categoryFilter, dateFrom, dateTo, imageFilter, normalizedSearch, selectedTenant]);

  const totalPages = Math.max(feedbackQuery.data?.pages ?? 1, 1);

  function clearFilters() {
    setSearch('');
    setCategoryFilter('all');
    setTenantSearch('');
    setSelectedTenant(null);
    setDateFrom('');
    setDateTo('');
    setImageFilter('all');
    setPage(1);
  }

  return (
    <>
      <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-6">
        <motion.section
          variants={fadeInUp}
          className="overflow-hidden rounded-[2rem] border border-surface-200/70 bg-[radial-gradient(circle_at_top_left,_rgba(253,224,71,0.24),_transparent_36%),linear-gradient(135deg,_rgba(255,255,255,0.98),_rgba(248,250,252,0.96)_52%,_rgba(254,242,242,0.92))] px-6 py-7 shadow-sm dark:border-white/10 dark:bg-[radial-gradient(circle_at_top_left,_rgba(250,204,21,0.14),_transparent_34%),linear-gradient(135deg,_rgba(15,23,42,0.88),_rgba(17,24,39,0.9)_52%,_rgba(76,5,25,0.18))]"
        >
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-300/70 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-amber-700 dark:border-amber-700/30 dark:bg-white/5 dark:text-amber-200">
                <Lightbulb size={14} />
                Feedback de plataforma
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight text-surface-950 dark:text-white">
                Revisa el feedback enviado por las cuentas SaaS en un solo lugar.
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-surface-600 dark:text-surface-300">
                Esta bandeja centraliza sugerencias, mejoras solicitadas, problemas y otros comentarios que llegan desde los gimnasios.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <SummaryCard label="Feedback filtrado" value={String(feedbackQuery.data?.total ?? 0)} />
              <SummaryCard label="Pagina actual" value={`${feedbackQuery.data?.page ?? page}/${totalPages}`} />
            </div>
          </div>
        </motion.section>

        <motion.section
          variants={fadeInUp}
          className="rounded-[1.75rem] border border-surface-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-surface-900/70"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-surface-900 dark:text-white">Filtros</p>
              <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
                Busca por mensaje, cuenta SaaS o autor, y acota por categoría, fecha e imagen.
              </p>
            </div>

            <button type="button" className="btn-secondary" onClick={clearFilters}>
              <Filter size={16} />
              Limpiar filtros
            </button>
          </div>

          <div className="mt-6 grid gap-4 xl:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Busqueda libre</span>
              <div className="relative">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                <input
                  className="input pl-10"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Busca por mensaje, cuenta, slug, autor o correo"
                />
              </div>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Categoria</span>
              <select
                className="input"
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value as CategoryFilter)}
              >
                {CATEGORY_FILTER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="rounded-[1.25rem] border border-surface-200 bg-surface-50/70 p-4 dark:border-white/10 dark:bg-surface-950/35">
              <div className="flex items-center gap-2">
                <Building2 size={16} className="text-surface-500" />
                <p className="text-sm font-medium text-surface-700 dark:text-surface-300">Cuenta SaaS</p>
              </div>
              <div className="mt-3 space-y-3">
                <input
                  className="input"
                  value={tenantSearch}
                  onChange={(event) => setTenantSearch(event.target.value)}
                  placeholder="Buscar cuenta por nombre, slug o owner"
                />
                <select
                  className="input"
                  value={selectedTenant?.tenant_id ?? ''}
                  onChange={(event) => {
                    const nextTenantId = event.target.value;
                    if (!nextTenantId) {
                      setSelectedTenant(null);
                      return;
                    }
                    setSelectedTenant(
                      tenantOptions.find((item) => item.tenant_id === nextTenantId) ?? null,
                    );
                  }}
                >
                  <option value="">Todas las cuentas</option>
                  {tenantOptions.map((tenant) => (
                    <option key={tenant.tenant_id} value={tenant.tenant_id}>
                      {tenant.tenant_name} ({tenant.tenant_slug})
                    </option>
                  ))}
                </select>
                <p className="text-xs text-surface-400 dark:text-surface-500">
                  {tenantsQuery.isFetching ? 'Buscando cuentas...' : 'El selector consulta las cuentas SaaS en tiempo real.'}
                </p>
              </div>
            </div>

            <div className="rounded-[1.25rem] border border-surface-200 bg-surface-50/70 p-4 dark:border-white/10 dark:bg-surface-950/35">
              <div className="flex items-center gap-2">
                <CalendarDays size={16} className="text-surface-500" />
                <p className="text-sm font-medium text-surface-700 dark:text-surface-300">Rango de fechas</p>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-surface-400">Desde</span>
                  <input className="input" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-surface-400">Hasta</span>
                  <input className="input" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
                </label>
              </div>
            </div>

            <label className="block xl:col-span-2">
              <span className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Adjunto</span>
              <div className="grid gap-3 sm:grid-cols-3">
                {IMAGE_FILTER_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setImageFilter(option.value)}
                    className={cn(
                      'rounded-2xl border px-4 py-3 text-sm font-medium transition-colors',
                      imageFilter === option.value
                        ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700/40 dark:bg-amber-950/20 dark:text-amber-100'
                        : 'border-surface-200 bg-surface-50 text-surface-600 hover:border-surface-300 dark:border-white/10 dark:bg-surface-950/35 dark:text-surface-300',
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </label>
          </div>

          {activeFilters.length ? (
            <div className="mt-5 flex flex-wrap gap-2">
              {activeFilters.map((item) => (
                <span key={item} className="badge badge-neutral">
                  {item}
                </span>
              ))}
            </div>
          ) : null}

          {invalidDateRange ? (
            <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
              La fecha inicial no puede ser posterior a la final.
            </div>
          ) : null}
        </motion.section>

        <motion.section
          variants={fadeInUp}
          className="overflow-hidden rounded-[1.75rem] border border-surface-200 bg-white shadow-sm dark:border-white/10 dark:bg-surface-900/70"
        >
          <div className="border-b border-surface-200/80 px-6 py-5 dark:border-white/10">
            <p className="text-sm font-semibold text-surface-900 dark:text-white">Bandeja de feedback</p>
            <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
              Ordenado por fecha de envio, desde lo mas reciente.
            </p>
          </div>

          <div className="space-y-4 p-5">
            {feedbackQuery.isLoading ? (
              Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="shimmer h-40 rounded-[1.5rem]" />
              ))
            ) : feedbackQuery.isError ? (
              <div className="rounded-[1.5rem] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-600 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
                {getApiError(feedbackQuery.error, 'No pudimos cargar el feedback de plataforma.')}
              </div>
            ) : feedbackItems.length ? (
              feedbackItems.map((submission) => (
                <article
                  key={submission.id}
                  className="rounded-[1.5rem] border border-surface-200 bg-surface-50/70 p-4 transition-colors hover:border-surface-300 dark:border-white/10 dark:bg-surface-950/30 dark:hover:border-white/20"
                >
                  <div className="flex flex-col gap-4 xl:flex-row">
                    <button
                      type="button"
                      onClick={() => setSelectedSubmission(submission)}
                      className="w-full overflow-hidden rounded-[1.25rem] border border-surface-200 bg-white text-left xl:max-w-[220px] dark:border-white/10 dark:bg-surface-900"
                    >
                      {submission.image_url ? (
                        <img
                          src={submission.image_url}
                          alt="Adjunto del feedback"
                          className="h-40 w-full object-cover transition-transform duration-300 hover:scale-[1.02]"
                        />
                      ) : (
                        <div className="flex h-40 flex-col items-center justify-center gap-2 bg-gradient-to-br from-surface-100 to-surface-50 text-surface-500 dark:from-surface-900 dark:to-surface-950 dark:text-surface-400">
                          <ImagePlus size={22} />
                          <span className="text-sm font-medium">Sin imagen</span>
                        </div>
                      )}
                    </button>

                    <div className="min-w-0 flex-1 space-y-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn('badge', feedbackCategoryBadgeColor(submission.category))}>
                          {formatFeedbackCategoryLabel(submission.category)}
                        </span>
                        <span className="badge badge-neutral">{formatRelative(submission.created_at)}</span>
                        {submission.image_url ? <span className="badge badge-warning">Con imagen</span> : null}
                      </div>

                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-lg font-semibold text-surface-900 dark:text-white">{submission.tenant_name}</h2>
                          <span className="text-sm text-surface-400 dark:text-surface-500">/{submission.tenant_slug}</span>
                        </div>
                        <p className="mt-3 text-sm leading-6 text-surface-600 dark:text-surface-300">
                          {summarizeMessage(submission.message)}
                        </p>
                      </div>

                      <div className="grid gap-3 text-sm text-surface-500 sm:grid-cols-3 dark:text-surface-400">
                        <DetailMeta
                          icon={UserRound}
                          label="Autor"
                          value={submission.created_by_name || 'Usuario eliminado o sin nombre'}
                        />
                        <DetailMeta
                          icon={Mail}
                          label="Correo"
                          value={submission.created_by_email || 'Sin correo disponible'}
                        />
                        <DetailMeta
                          icon={CalendarDays}
                          label="Fecha"
                          value={formatDateTime(submission.created_at)}
                        />
                      </div>
                    </div>

                    <div className="flex xl:items-start">
                      <button type="button" className="btn-secondary w-full xl:w-auto" onClick={() => setSelectedSubmission(submission)}>
                        <Eye size={16} />
                        Ver detalle
                      </button>
                    </div>
                  </div>
                </article>
              ))
            ) : (
              <div className="rounded-[1.5rem] border border-dashed border-surface-200 bg-surface-50 px-5 py-10 text-center dark:border-white/10 dark:bg-surface-950/35">
                <p className="text-sm font-semibold text-surface-900 dark:text-white">No encontramos feedback con estos filtros</p>
                <p className="mt-2 text-sm leading-6 text-surface-500 dark:text-surface-400">
                  Ajusta la busqueda, cambia la cuenta SaaS o limpia los filtros para volver a cargar la bandeja.
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-surface-200/80 bg-surface-50 px-5 py-3 dark:border-white/10 dark:bg-surface-950/20">
            <span className="text-sm text-surface-500 dark:text-surface-400">
              Pagina {feedbackQuery.data?.page ?? page} de {totalPages}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={(feedbackQuery.data?.page ?? page) <= 1 || feedbackQuery.isLoading}
                className="rounded-lg p-2 transition-colors hover:bg-surface-200 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-surface-800"
              >
                <ChevronLeft size={16} className="text-surface-500" />
              </button>
              <button
                type="button"
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={(feedbackQuery.data?.page ?? page) >= totalPages || feedbackQuery.isLoading}
                className="rounded-lg p-2 transition-colors hover:bg-surface-200 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-surface-800"
              >
                <ChevronRight size={16} className="text-surface-500" />
              </button>
            </div>
          </div>
        </motion.section>
      </motion.div>

      <Modal
        open={!!selectedSubmission}
        size="lg"
        title={selectedSubmission ? `Feedback de ${selectedSubmission.tenant_name}` : 'Detalle de feedback'}
        description={selectedSubmission ? `Enviado ${formatDateTime(selectedSubmission.created_at)}` : undefined}
        onClose={() => setSelectedSubmission(null)}
      >
        {selectedSubmission ? (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn('badge', feedbackCategoryBadgeColor(selectedSubmission.category))}>
                {formatFeedbackCategoryLabel(selectedSubmission.category)}
              </span>
              <span className="badge badge-neutral">/{selectedSubmission.tenant_slug}</span>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <InfoCard label="Cuenta SaaS" value={selectedSubmission.tenant_name} />
              <InfoCard label="Autor" value={selectedSubmission.created_by_name || 'Usuario eliminado o sin nombre'} />
              <InfoCard label="Correo" value={selectedSubmission.created_by_email || 'Sin correo disponible'} />
            </div>

            {selectedSubmission.image_url ? (
              <div className="overflow-hidden rounded-[1.5rem] border border-surface-200 bg-white dark:border-white/10 dark:bg-surface-950/35">
                <a href={selectedSubmission.image_url} target="_blank" rel="noreferrer" className="block">
                  <img src={selectedSubmission.image_url} alt="Adjunto del feedback" className="max-h-[420px] w-full object-cover" />
                </a>
              </div>
            ) : null}

            <div className="rounded-[1.5rem] border border-surface-200 bg-surface-50 px-5 py-5 dark:border-white/10 dark:bg-surface-950/35">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-surface-400">Mensaje completo</p>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-surface-700 dark:text-surface-200">
                {selectedSubmission.message}
              </p>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.25rem] border border-white/70 bg-white/80 px-4 py-4 backdrop-blur dark:border-white/10 dark:bg-white/5">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-surface-400 dark:text-surface-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-surface-900 dark:text-white">{value}</p>
    </div>
  );
}

function DetailMeta({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Building2;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[1.1rem] border border-surface-200 bg-white px-3 py-3 dark:border-white/10 dark:bg-surface-900">
      <div className="flex items-center gap-2 text-surface-400 dark:text-surface-500">
        <Icon size={14} />
        <span className="text-xs font-semibold uppercase tracking-[0.18em]">{label}</span>
      </div>
      <p className="mt-2 text-sm font-medium text-surface-700 dark:text-surface-200">{value}</p>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.2rem] border border-surface-200 bg-surface-50 px-4 py-4 dark:border-white/10 dark:bg-surface-950/35">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-surface-400">{label}</p>
      <p className="mt-2 text-sm font-medium text-surface-800 dark:text-surface-200">{value}</p>
    </div>
  );
}

function summarizeMessage(message: string): string {
  const normalized = message.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 220) {
    return normalized;
  }
  return `${normalized.slice(0, 220)}...`;
}
