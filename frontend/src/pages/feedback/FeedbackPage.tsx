import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  Bug,
  CheckCircle2,
  CircleHelp,
  Gift,
  History,
  ImagePlus,
  Lightbulb,
  type LucideIcon,
  SendHorizonal,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';
import { feedbackApi } from '@/services/api';
import type { FeedbackCategory, FeedbackSubmission } from '@/types';
import {
  cn,
  feedbackCategoryBadgeColor,
  formatDateTime,
  formatFeedbackCategoryLabel,
  formatRelative,
  getApiError,
} from '@/utils';
import { fadeInUp, staggerContainer } from '@/utils/animations';

const FEEDBACK_MESSAGE_LIMIT = 5000;
const FEEDBACK_MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const FEEDBACK_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

type FeedbackFormState = {
  category: FeedbackCategory;
  message: string;
};

const initialForm: FeedbackFormState = {
  category: 'suggestion',
  message: '',
};

const CATEGORY_OPTIONS: Array<{
  value: FeedbackCategory;
  label: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    value: 'suggestion',
    label: 'Sugerencia',
    description: 'Ideas nuevas para mejorar tu experiencia con Nexo.',
    icon: Lightbulb,
  },
  {
    value: 'improvement',
    label: 'Solicitud de mejora',
    description: 'Cambios concretos sobre funciones que ya existen.',
    icon: Wrench,
  },
  {
    value: 'problem',
    label: 'Problema',
    description: 'Errores, comportamientos inesperados o bloqueos.',
    icon: Bug,
  },
  {
    value: 'other',
    label: 'Otro',
    description: 'Cualquier comentario que no encaje en las categorías anteriores.',
    icon: CircleHelp,
  },
];

export default function FeedbackPage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [form, setForm] = useState<FeedbackFormState>(initialForm);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const feedbackQuery = useQuery<FeedbackSubmission[]>({
    queryKey: ['feedback-submissions'],
    queryFn: async () => (await feedbackApi.list({ limit: 12 })).data,
  });

  const createMutation = useMutation({
    mutationFn: async (formData: FormData) => (await feedbackApi.create(formData)).data as FeedbackSubmission,
    onSuccess: async () => {
      setForm(initialForm);
      clearSelectedFile();
      await queryClient.invalidateQueries({ queryKey: ['feedback-submissions'] });
      toast.success('Feedback enviado. Gracias por ayudar a mejorar Nexo.');
    },
    onError: (error) => {
      toast.error(getApiError(error, 'No pudimos enviar tu feedback.'));
    },
  });

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl(null);
      return;
    }

    const nextUrl = URL.createObjectURL(selectedFile);
    setPreviewUrl(nextUrl);

    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [selectedFile]);

  const submissions = feedbackQuery.data ?? [];
  const messageLength = form.message.length;
  const remainingChars = FEEDBACK_MESSAGE_LIMIT - messageLength;

  function clearSelectedFile() {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  function handleSelectFile(file: File | null) {
    if (!file) {
      clearSelectedFile();
      return;
    }

    if (!FEEDBACK_ALLOWED_TYPES.includes(file.type)) {
      toast.error('Solo se aceptan imágenes JPEG, PNG o WebP.');
      clearSelectedFile();
      return;
    }

    if (file.size > FEEDBACK_MAX_IMAGE_BYTES) {
      toast.error('La imagen supera el tamaño máximo de 15 MB.');
      clearSelectedFile();
      return;
    }

    setSelectedFile(file);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!form.message.trim()) {
      toast.error('Describe tu feedback antes de enviarlo.');
      return;
    }

    const formData = new FormData();
    formData.append('category', form.category);
    formData.append('message', form.message.trim());
    if (selectedFile) {
      formData.append('image', selectedFile);
    }

    await createMutation.mutateAsync(formData);
  }

  return (
    <motion.div
      initial="initial"
      animate="animate"
      variants={staggerContainer}
      className="space-y-6"
    >
      <motion.section
        variants={fadeInUp}
        className="overflow-hidden rounded-[2rem] border border-amber-200/70 bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.3),_transparent_40%),linear-gradient(135deg,_rgba(255,251,235,0.95),_rgba(255,237,213,0.92)_55%,_rgba(255,228,230,0.95))] px-6 py-7 shadow-sm dark:border-amber-900/40 dark:bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.2),_transparent_35%),linear-gradient(135deg,_rgba(69,26,3,0.35),_rgba(67,20,7,0.5)_55%,_rgba(76,5,25,0.4))]"
      >
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-300/70 bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-amber-700 dark:border-amber-700/40 dark:bg-black/10 dark:text-amber-200">
              <Sparkles size={14} />
              Feedback de producto
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-surface-950 dark:text-white">
              Tus opiniones importan y pueden convertirse en mejoras reales.
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-surface-700 dark:text-surface-200">
              Usa este canal para enviarnos sugerencias, solicitudes de mejora, problemas u otros comentarios sobre Nexo.
              Algunos aportes destacados pueden recibir códigos promocionales como agradecimiento.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <HighlightCard
              icon={Gift}
              title="Códigos promocionales"
              description="Algunos feedbacks útiles o bien documentados pueden recibir beneficios."
            />
            <HighlightCard
              icon={CheckCircle2}
              title="Historial compartido"
              description="Tu equipo verá lo ya enviado para evitar duplicar reportes."
            />
          </div>
        </div>
      </motion.section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.9fr)]">
        <motion.section
          variants={fadeInUp}
          className="rounded-[1.75rem] border border-surface-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-surface-900/70"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-surface-900 dark:text-white">Enviar feedback</p>
              <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
                Cuéntanos el contexto con el mayor detalle posible. Si hay una captura, mejor.
              </p>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-right dark:border-amber-900/40 dark:bg-amber-950/20">
              <p className="text-[11px] uppercase tracking-[0.18em] text-amber-700 dark:text-amber-200">Límite</p>
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">{FEEDBACK_MESSAGE_LIMIT} caracteres</p>
            </div>
          </div>

          <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
            <div>
              <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Tipo de feedback</label>
              <div className="grid gap-3 sm:grid-cols-2">
                {CATEGORY_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  const isSelected = form.category === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setForm((current) => ({ ...current, category: option.value }))}
                      className={cn(
                        'rounded-[1.25rem] border px-4 py-4 text-left transition-all',
                        isSelected
                          ? 'border-amber-300 bg-gradient-to-r from-amber-50 to-rose-50 text-surface-900 shadow-sm dark:border-amber-700/40 dark:from-amber-950/25 dark:to-rose-950/15 dark:text-white'
                          : 'border-surface-200 bg-surface-50/70 text-surface-600 hover:border-surface-300 dark:border-white/10 dark:bg-surface-950/25 dark:text-surface-300 dark:hover:border-white/20',
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div className={cn(
                          'flex h-11 w-11 items-center justify-center rounded-2xl border',
                          isSelected
                            ? 'border-amber-200 bg-white text-rose-500 dark:border-amber-700/40 dark:bg-black/10 dark:text-amber-200'
                            : 'border-surface-200 bg-white text-surface-500 dark:border-white/10 dark:bg-white/5 dark:text-surface-300',
                        )}>
                          <Icon size={18} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold">{option.label}</p>
                          <p className="mt-1 text-xs leading-5 opacity-80">{option.description}</p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300">Mensaje</label>
                <span className={cn(
                  'text-xs font-medium',
                  remainingChars < 300 ? 'text-amber-600 dark:text-amber-300' : 'text-surface-400 dark:text-surface-500',
                )}>
                  {messageLength}/{FEEDBACK_MESSAGE_LIMIT}
                </span>
              </div>
              <textarea
                className="input min-h-48 resize-y"
                value={form.message}
                maxLength={FEEDBACK_MESSAGE_LIMIT}
                onChange={(event) => setForm((current) => ({ ...current, message: event.target.value }))}
                placeholder="Describe el problema o la mejora con el mayor contexto posible: qué intentabas hacer, qué pasó, desde cuándo ocurre y cómo impacta a tu equipo."
                required
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300">Imagen adjunta</label>
                <span className="text-xs text-surface-400 dark:text-surface-500">JPEG, PNG o WebP hasta 15 MB</span>
              </div>

              <div className="rounded-[1.25rem] border border-dashed border-amber-300/70 bg-gradient-to-r from-amber-50/80 to-rose-50/60 p-4 dark:border-amber-700/40 dark:from-amber-950/10 dark:to-rose-950/10">
                {previewUrl ? (
                  <div className="space-y-3">
                    <div className="overflow-hidden rounded-[1.1rem] border border-amber-200 bg-white dark:border-amber-800/40 dark:bg-surface-950">
                      <img src={previewUrl} alt="Vista previa del adjunto" className="max-h-72 w-full object-cover" />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-surface-900 dark:text-white">{selectedFile?.name}</p>
                        <p className="text-xs text-surface-500 dark:text-surface-400">
                          {selectedFile ? `${Math.round(selectedFile.size / 1024)} KB` : ''}
                        </p>
                      </div>
                      <button type="button" className="btn-secondary" onClick={clearSelectedFile}>
                        <X size={16} />
                        Quitar imagen
                      </button>
                    </div>
                  </div>
                ) : (
                  <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-[1.1rem] border border-amber-200/70 bg-white/70 px-5 py-8 text-center dark:border-amber-800/30 dark:bg-black/10">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-100 to-rose-100 text-rose-500 dark:from-amber-950/40 dark:to-rose-950/30 dark:text-amber-200">
                      <ImagePlus size={22} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-surface-900 dark:text-white">Adjunta una captura si ayuda a explicar mejor</p>
                      <p className="mt-1 text-xs leading-5 text-surface-500 dark:text-surface-400">
                        Ideal para errores visuales, pantallas rotas o pasos que quieras mostrarnos.
                      </p>
                    </div>
                    <span className="btn-secondary">Seleccionar imagen</span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(event) => handleSelectFile(event.target.files?.[0] ?? null)}
                    />
                  </label>
                )}
              </div>
            </div>

            <div className="rounded-[1.25rem] border border-surface-200 bg-surface-50 px-4 py-4 dark:border-white/10 dark:bg-surface-950/35">
              <p className="text-[11px] uppercase tracking-[0.18em] text-surface-500">Lo que haremos con esto</p>
              <p className="mt-2 text-sm leading-6 text-surface-600 dark:text-surface-300">
                Tu feedback quedará registrado en un historial compartido para tu cuenta y también lo recibirá el equipo de Nexo.
                Así evitamos duplicados y mantenemos trazabilidad de lo que más importa.
              </p>
            </div>

            <div className="flex justify-end">
              <button type="submit" className="btn-primary min-w-[190px]" disabled={createMutation.isPending}>
                <SendHorizonal size={16} />
                {createMutation.isPending ? 'Enviando...' : 'Enviar feedback'}
              </button>
            </div>
          </form>
        </motion.section>

        <motion.aside
          variants={fadeInUp}
          className="space-y-6"
        >
          <section className="rounded-[1.75rem] border border-surface-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-surface-900/70">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-100 to-rose-100 text-rose-500 dark:from-amber-950/30 dark:to-rose-950/20 dark:text-amber-200">
                <Gift size={20} />
              </div>
              <div>
                <p className="text-sm font-semibold text-surface-900 dark:text-white">Tus opiniones sí pesan</p>
                <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
                  Lo que reportas aquí ayuda a priorizar mejoras reales de producto.
                </p>
              </div>
            </div>
            <div className="mt-5 rounded-[1.2rem] border border-amber-200 bg-amber-50/90 px-4 py-4 dark:border-amber-900/40 dark:bg-amber-950/20">
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">Códigos promocionales</p>
              <p className="mt-2 text-sm leading-6 text-amber-800 dark:text-amber-200">
                Cuando un feedback aporta contexto claro o detecta una mejora valiosa, podemos reconocerlo con beneficios promocionales.
              </p>
            </div>
          </section>

          <section className="rounded-[1.75rem] border border-surface-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-surface-900/70">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-100 text-surface-600 dark:bg-white/10 dark:text-surface-200">
                <History size={18} />
              </div>
              <div>
                <p className="text-sm font-semibold text-surface-900 dark:text-white">Historial reciente</p>
                <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
                  Últimos feedbacks enviados por tu equipo.
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {feedbackQuery.isLoading ? (
                <div className="rounded-[1.2rem] border border-surface-200 bg-surface-50 px-4 py-5 text-sm text-surface-500 dark:border-white/10 dark:bg-surface-950/35 dark:text-surface-300">
                  Cargando historial...
                </div>
              ) : submissions.length ? (
                submissions.map((submission) => (
                  <FeedbackHistoryCard key={submission.id} submission={submission} />
                ))
              ) : (
                <div className="rounded-[1.2rem] border border-dashed border-surface-200 bg-surface-50 px-4 py-6 text-center dark:border-white/10 dark:bg-surface-950/35">
                  <p className="text-sm font-semibold text-surface-900 dark:text-white">Todavía no hay feedback enviado</p>
                  <p className="mt-2 text-sm leading-6 text-surface-500 dark:text-surface-400">
                    El primer envío que hagas quedará visible aquí para el resto de tu equipo.
                  </p>
                </div>
              )}
            </div>
          </section>
        </motion.aside>
      </div>
    </motion.div>
  );
}

function HighlightCard({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-[1.25rem] border border-white/60 bg-white/75 p-4 backdrop-blur dark:border-white/10 dark:bg-black/10">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-100 to-rose-100 text-rose-500 dark:from-amber-950/40 dark:to-rose-950/30 dark:text-amber-200">
          <Icon size={18} />
        </div>
        <div>
          <p className="text-sm font-semibold text-surface-900 dark:text-white">{title}</p>
          <p className="mt-1 text-xs leading-5 text-surface-500 dark:text-surface-300">{description}</p>
        </div>
      </div>
    </div>
  );
}

function FeedbackHistoryCard({ submission }: { submission: FeedbackSubmission }) {
  return (
    <article className="overflow-hidden rounded-[1.25rem] border border-surface-200 bg-surface-50/70 dark:border-white/10 dark:bg-surface-950/30">
      {submission.image_url ? (
        <a href={submission.image_url} target="_blank" rel="noreferrer" className="block overflow-hidden border-b border-surface-200 dark:border-white/10">
          <img src={submission.image_url} alt="Adjunto del feedback" className="h-36 w-full object-cover transition-transform duration-300 hover:scale-[1.02]" />
        </a>
      ) : null}

      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('badge', feedbackCategoryBadgeColor(submission.category))}>
            {formatFeedbackCategoryLabel(submission.category)}
          </span>
          <span className="badge badge-neutral">{formatRelative(submission.created_at)}</span>
        </div>

        <p className="text-sm leading-6 text-surface-700 dark:text-surface-200">
          {submission.message.length > 220 ? `${submission.message.slice(0, 220)}...` : submission.message}
        </p>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-surface-200/80 pt-3 text-xs text-surface-500 dark:border-white/10 dark:text-surface-400">
          <span>{submission.created_by_name || 'Equipo del gimnasio'}</span>
          <span title={formatDateTime(submission.created_at)}>{formatDateTime(submission.created_at)}</span>
        </div>
      </div>
    </article>
  );
}
