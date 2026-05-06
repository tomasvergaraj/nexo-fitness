import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  AlertCircle,
  Eye,
  FileText,
  Loader2,
  Mail,
  Save,
  Sparkles,
} from 'lucide-react';
import { platformAdminApi } from '@/services/api';
import { fadeInUp, staggerContainer } from '@/utils/animations';
import { getApiError } from '@/utils';

interface EmailTemplate {
  id: string;
  key: string;
  name: string;
  description: string | null;
  subject: string;
  body_html: string;
  body_text: string | null;
  variables: Record<string, string>;
  placeholders: string[];
  is_active: boolean;
  updated_at: string | null;
}

interface PreviewResponse {
  key: string;
  subject: string;
  body_html: string;
  body_text: string;
}

interface Draft {
  name: string;
  subject: string;
  body_html: string;
  body_text: string;
  description: string;
  variables: Record<string, string>;
  is_active: boolean;
}

function toDraft(t: EmailTemplate | null): Draft {
  return {
    name: t?.name ?? '',
    subject: t?.subject ?? '',
    body_html: t?.body_html ?? '',
    body_text: t?.body_text ?? '',
    description: t?.description ?? '',
    variables: t?.variables ?? {},
    is_active: t?.is_active ?? true,
  };
}

export default function PlatformEmailTemplatesPage() {
  const queryClient = useQueryClient();
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showPreview, setShowPreview] = useState(true);

  const listQuery = useQuery<EmailTemplate[]>({
    queryKey: ['platform-email-templates'],
    queryFn: async () => (await platformAdminApi.listEmailTemplates()).data as EmailTemplate[],
  });

  const templates = listQuery.data ?? [];
  const active = templates.find((t) => t.key === activeKey) ?? templates[0] ?? null;

  useEffect(() => {
    if (active && (!activeKey || activeKey !== active.key)) {
      setActiveKey(active.key);
      setDraft(toDraft(active));
    } else if (active && activeKey === active.key && draft === null) {
      setDraft(toDraft(active));
    }
  }, [active, activeKey, draft]);

  const previewQuery = useQuery<PreviewResponse>({
    queryKey: ['platform-email-template-preview', active?.key, draft?.variables],
    queryFn: async () =>
      (await platformAdminApi.previewEmailTemplate(active!.key, draft?.variables ?? {})).data as PreviewResponse,
    enabled: Boolean(active && showPreview),
  });

  const upsertMutation = useMutation({
    mutationFn: async () => {
      if (!active || !draft) return null;
      const response = await platformAdminApi.upsertEmailTemplate(active.key, {
        name: draft.name,
        subject: draft.subject,
        body_html: draft.body_html,
        body_text: draft.body_text || undefined,
        description: draft.description || undefined,
        variables: draft.variables,
        is_active: draft.is_active,
      });
      return response.data;
    },
    onSuccess: async () => {
      toast.success('Template guardado.');
      await queryClient.invalidateQueries({ queryKey: ['platform-email-templates'] });
      await previewQuery.refetch();
    },
    onError: (error: any) => toast.error(getApiError(error, 'No se pudo guardar el template.')),
  });

  const dirty = useMemo(() => {
    if (!active || !draft) return false;
    const original = toDraft(active);
    return JSON.stringify(original) !== JSON.stringify(draft);
  }, [active, draft]);

  const localPreview = useMemo(() => {
    if (!draft) return { subject: '', html: '' };
    const ctx = draft.variables;
    const render = (text: string) =>
      text.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_, k) => ctx[k] ?? `{{${k}}}`);
    return { subject: render(draft.subject), html: render(draft.body_html) };
  }, [draft]);

  const previewHtml = previewQuery.data?.body_html ?? localPreview.html;
  const previewSubject = previewQuery.data?.subject ?? localPreview.subject;

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-5">
      <motion.div variants={fadeInUp}>
        <span className="inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-brand-300">
          <Mail size={12} /> Templates
        </span>
        <h1 className="mt-3 text-3xl font-bold tracking-tight font-display text-white">
          Editor de emails
        </h1>
        <p className="mt-1 text-sm text-surface-400">
          Plantillas usadas en recordatorios, expiración y bienvenida. Variables con {'{{nombre}}'}.
        </p>
      </motion.div>

      <motion.div variants={fadeInUp} className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)_360px]">
        {/* Sidebar list */}
        <div className="rounded-xl border border-surface-800 bg-surface-900/40 p-2">
          <p className="px-2 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-surface-500">
            Plantillas
          </p>
          {listQuery.isLoading ? (
            <div className="space-y-1 p-1">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-md bg-surface-800/50" />
              ))}
            </div>
          ) : templates.length === 0 ? (
            <p className="px-2 py-4 text-xs text-surface-500">Sin plantillas.</p>
          ) : (
            <ul className="space-y-0.5">
              {templates.map((t) => {
                const isActive = active?.key === t.key;
                const isDirty = isActive && dirty;
                return (
                  <li key={t.key}>
                    <button
                      type="button"
                      onClick={() => {
                        if (isDirty && !window.confirm('Hay cambios sin guardar. Descartarlos?')) return;
                        setActiveKey(t.key);
                        setDraft(toDraft(t));
                      }}
                      className={`flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors ${
                        isActive
                          ? 'bg-brand-500/15 text-brand-100'
                          : 'text-surface-300 hover:bg-surface-800/60'
                      }`}
                    >
                      <FileText size={14} className={isActive ? 'mt-0.5 text-brand-300' : 'mt-0.5 text-surface-500'} />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 truncate font-medium">
                          {t.name}
                          {!t.is_active && (
                            <span className="rounded-full border border-surface-700 px-1 py-px text-[9px] uppercase text-surface-500">
                              Off
                            </span>
                          )}
                          {isDirty && (
                            <span className="ml-auto h-1.5 w-1.5 rounded-full bg-amber-400" title="Cambios sin guardar" />
                          )}
                        </p>
                        <p className="truncate font-mono text-[10px] text-surface-500">{t.key}</p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Editor */}
        <div className="rounded-xl border border-surface-800 bg-surface-900/40 p-5">
          {!active || !draft ? (
            <div className="flex h-full items-center justify-center text-sm text-surface-500">
              Selecciona una plantilla
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-300">
                    {active.key}
                  </p>
                  <p className="text-xs text-surface-500">
                    Última edición {active.updated_at ? new Date(active.updated_at).toLocaleString('es-CL') : '—'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 text-xs text-surface-400">
                    <input
                      type="checkbox"
                      checked={draft.is_active}
                      onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}
                      className="h-3.5 w-3.5 rounded border-surface-600 text-brand-500"
                    />
                    Activa
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowPreview((s) => !s)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-surface-700 px-2.5 py-1.5 text-xs text-surface-300 hover:border-surface-600 hover:bg-surface-800/60"
                  >
                    <Eye size={12} />
                    {showPreview ? 'Ocultar' : 'Ver'} preview
                  </button>
                  <button
                    type="button"
                    disabled={!dirty || upsertMutation.isPending}
                    onClick={() => upsertMutation.mutate()}
                    className="inline-flex items-center gap-1.5 rounded-md bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
                  >
                    {upsertMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                    Guardar
                  </button>
                </div>
              </div>

              <div className="grid gap-3">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-surface-400">Nombre</label>
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    className="w-full rounded-md border border-surface-700 bg-surface-950 px-3 py-1.5 text-sm text-white focus:border-brand-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-surface-400">Descripción</label>
                  <input
                    type="text"
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    placeholder="Cuándo / a quién se envía"
                    className="w-full rounded-md border border-surface-700 bg-surface-950 px-3 py-1.5 text-sm text-white placeholder:text-surface-600 focus:border-brand-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-surface-400">Asunto</label>
                  <input
                    type="text"
                    value={draft.subject}
                    onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                    className="w-full rounded-md border border-surface-700 bg-surface-950 px-3 py-1.5 font-mono text-sm text-white focus:border-brand-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-surface-400">Cuerpo HTML</label>
                  <textarea
                    rows={12}
                    value={draft.body_html}
                    onChange={(e) => setDraft({ ...draft, body_html: e.target.value })}
                    className="w-full rounded-md border border-surface-700 bg-surface-950 px-3 py-2 font-mono text-xs leading-relaxed text-white focus:border-brand-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-surface-400">Cuerpo plano (fallback)</label>
                  <textarea
                    rows={6}
                    value={draft.body_text}
                    onChange={(e) => setDraft({ ...draft, body_text: e.target.value })}
                    className="w-full rounded-md border border-surface-700 bg-surface-950 px-3 py-2 font-mono text-xs leading-relaxed text-white focus:border-brand-500 focus:outline-none"
                  />
                </div>
              </div>

              <details className="rounded-md border border-surface-800 bg-surface-950 p-3">
                <summary className="cursor-pointer select-none text-xs font-semibold text-surface-300">
                  <Sparkles size={11} className="inline-block mr-1 -mt-0.5" />
                  Variables sample ({active.placeholders.length})
                </summary>
                <div className="mt-2 grid gap-2">
                  {active.placeholders.length === 0 && (
                    <p className="text-xs text-surface-500">Sin placeholders detectados.</p>
                  )}
                  {active.placeholders.map((key) => (
                    <div key={key} className="flex items-center gap-2 text-xs">
                      <span className="w-44 truncate font-mono text-brand-300">{`{{${key}}}`}</span>
                      <input
                        type="text"
                        value={draft.variables[key] ?? ''}
                        onChange={(e) => setDraft({ ...draft, variables: { ...draft.variables, [key]: e.target.value } })}
                        placeholder="Valor de muestra"
                        className="flex-1 rounded border border-surface-700 bg-surface-900 px-2 py-1 text-xs text-white focus:border-brand-500 focus:outline-none"
                      />
                    </div>
                  ))}
                </div>
              </details>

              {dirty && (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
                  <AlertCircle size={13} className="mt-0.5" />
                  <span>Cambios sin guardar. Pulsa <strong>Guardar</strong> para aplicar.</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Preview */}
        {showPreview && (
          <div className="rounded-xl border border-surface-800 bg-white text-surface-900 dark:bg-surface-950 dark:text-surface-100">
            <div className="border-b border-surface-200 px-4 py-3 dark:border-surface-800">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-surface-500">Preview</p>
              <p className="mt-1 break-words text-sm font-semibold text-surface-900 dark:text-white">
                {previewSubject || <span className="text-surface-400">(sin asunto)</span>}
              </p>
              {previewQuery.isFetching && (
                <p className="mt-1 inline-flex items-center gap-1 text-[10px] text-surface-500">
                  <Loader2 size={10} className="animate-spin" /> Renderizando…
                </p>
              )}
            </div>
            <div className="max-h-[60vh] overflow-y-auto px-4 py-3 text-sm">
              <div
                className="prose prose-sm max-w-none dark:prose-invert"
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
