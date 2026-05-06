import { useCallback, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { motion } from 'framer-motion';
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, FileText, Loader2, RotateCcw, Upload, X } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { clientsApi } from '@/services/api';
import { cn, getApiError } from '@/utils';

type ImportError = { row: number; column: string; message: string };

type PreviewRow = {
  row: number;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string | null;
  date_of_birth?: string | null;
  gender?: string | null;
  tags?: string[];
};

type PreviewResponse = {
  import_token: string;
  total_rows: number;
  valid_count: number;
  error_count: number;
  valid_preview: PreviewRow[];
  errors: ImportError[];
  quota_remaining: number;
  quota_max: number;
  quota_blocked: boolean;
};

type Stage = 'idle' | 'previewing' | 'preview' | 'committing' | 'done';

interface ImportClientsModalProps {
  open: boolean;
  onClose: () => void;
  onCompleted: () => void;
}

const ACCEPTED_TYPES = '.xlsx,.csv';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function ImportClientsModal({ open, onClose, onCompleted }: ImportClientsModalProps) {
  const [stage, setStage] = useState<Stage>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [commitResult, setCommitResult] = useState<{ created: number; skipped: number } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const reset = useCallback(() => {
    setStage('idle');
    setFile(null);
    setPreview(null);
    setCommitResult(null);
    setDragOver(false);
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  const handleClose = () => {
    if (stage === 'previewing' || stage === 'committing') return;
    reset();
    onClose();
  };

  const downloadTemplate = async (format: 'xlsx' | 'csv') => {
    try {
      const response = await clientsApi.importTemplate(format);
      const filename = format === 'xlsx' ? 'plantilla_clientes.xlsx' : 'plantilla_clientes.csv';
      downloadBlob(response.data, filename);
    } catch (error) {
      toast.error(getApiError(error, 'No se pudo descargar la plantilla'));
    }
  };

  const submitFile = async (selected: File) => {
    setFile(selected);
    setStage('previewing');
    try {
      const response = await clientsApi.importPreview(selected);
      setPreview(response.data);
      setStage('preview');
    } catch (error) {
      toast.error(getApiError(error, 'No se pudo procesar el archivo'));
      setStage('idle');
      setFile(null);
    }
  };

  const onFileChosen = (selected: File | null) => {
    if (!selected) return;
    const name = selected.name.toLowerCase();
    if (!name.endsWith('.xlsx') && !name.endsWith('.csv')) {
      toast.error('Solo se aceptan archivos XLSX o CSV');
      return;
    }
    if (selected.size > 2 * 1024 * 1024) {
      toast.error('El archivo excede 2 MB');
      return;
    }
    submitFile(selected);
  };

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) onFileChosen(dropped);
  };

  const handleCommit = async () => {
    if (!preview) return;
    setStage('committing');
    try {
      const response = await clientsApi.importCommit(preview.import_token);
      setCommitResult(response.data);
      setStage('done');
      onCompleted();
    } catch (error) {
      toast.error(getApiError(error, 'No se pudo completar la importación'));
      setStage('preview');
    }
  };

  const downloadErrorsReport = async () => {
    if (!preview?.errors.length) return;
    try {
      const response = await clientsApi.importErrorsExport(preview.errors);
      downloadBlob(response.data, 'errores_importacion.xlsx');
    } catch (error) {
      toast.error(getApiError(error, 'No se pudo descargar el reporte de errores'));
    }
  };

  const canCommit = useMemo(
    () => Boolean(preview && preview.valid_count > 0 && !preview.quota_blocked && stage === 'preview'),
    [preview, stage],
  );

  return (
    <Modal
      open={open}
      title="Importar clientes desde Excel"
      description="Sube un archivo XLSX o CSV. Verás un resumen antes de confirmar la importación."
      onClose={handleClose}
      size="lg"
    >
      {stage === 'idle' || stage === 'previewing' ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-surface-200 bg-surface-50 px-4 py-3 text-sm text-surface-600 dark:border-surface-800 dark:bg-surface-950/40 dark:text-surface-300">
            <p className="font-medium text-surface-900 dark:text-white">Antes de empezar</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Descarga la plantilla y rellena una fila por cliente.</li>
              <li>Las columnas Nombre, Apellido y Email son obligatorias.</li>
              <li>Cada cliente recibirá una contraseña aleatoria — comparte el flujo de "olvidé mi contraseña".</li>
              <li>Máximo 500 filas y 2 MB por archivo.</li>
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="btn-secondary text-sm" onClick={() => downloadTemplate('xlsx')}>
                <Download size={14} /> Plantilla Excel
              </button>
              <button type="button" className="btn-ghost text-sm" onClick={() => downloadTemplate('csv')}>
                <FileText size={14} /> Plantilla CSV
              </button>
            </div>
          </div>

          <motion.div
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={cn(
              'flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors',
              dragOver
                ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/30'
                : 'border-surface-300 bg-white dark:border-surface-700 dark:bg-surface-900',
            )}
          >
            {stage === 'previewing' ? (
              <>
                <Loader2 className="mb-3 animate-spin text-brand-500" size={32} />
                <p className="text-sm font-medium text-surface-700 dark:text-surface-200">Procesando {file?.name}…</p>
              </>
            ) : (
              <>
                <FileSpreadsheet className="mb-3 text-surface-400" size={36} />
                <p className="text-sm font-medium text-surface-700 dark:text-surface-200">
                  Arrastra tu archivo aquí o haz clic para buscarlo
                </p>
                <p className="mt-1 text-xs text-surface-500">XLSX o CSV · hasta 2 MB</p>
                <button
                  type="button"
                  className="btn-primary mt-4 text-sm"
                  onClick={() => inputRef.current?.click()}
                >
                  <Upload size={14} /> Seleccionar archivo
                </button>
                <input
                  ref={inputRef}
                  type="file"
                  accept={ACCEPTED_TYPES}
                  className="hidden"
                  onChange={(event) => onFileChosen(event.target.files?.[0] ?? null)}
                />
              </>
            )}
          </motion.div>
        </div>
      ) : null}

      {(stage === 'preview' || stage === 'committing') && preview ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-surface-200 bg-white px-4 py-3 dark:border-surface-800 dark:bg-surface-950/40">
              <p className="text-xs uppercase tracking-wider text-surface-500">Total filas</p>
              <p className="mt-1 text-2xl font-bold text-surface-900 dark:text-white">{preview.total_rows}</p>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-900/50 dark:bg-emerald-950/30">
              <p className="text-xs uppercase tracking-wider text-emerald-700 dark:text-emerald-300">Listas para importar</p>
              <p className="mt-1 text-2xl font-bold text-emerald-700 dark:text-emerald-200">{preview.valid_count}</p>
            </div>
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900/50 dark:bg-red-950/30">
              <p className="text-xs uppercase tracking-wider text-red-700 dark:text-red-300">Con errores</p>
              <p className="mt-1 text-2xl font-bold text-red-700 dark:text-red-200">{preview.error_count}</p>
            </div>
          </div>

          {preview.quota_blocked ? (
            <div className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertCircle className="mt-0.5 flex-shrink-0" size={18} />
              <div>
                <p className="font-semibold">Cupo de plan insuficiente</p>
                <p className="mt-1">
                  Tu plan permite {preview.quota_max} clientes y solo te quedan {preview.quota_remaining} cupos.
                  Este archivo intenta crear {preview.valid_count}. Reduce filas o mejora tu plan antes de continuar.
                </p>
              </div>
            </div>
          ) : null}

          {preview.errors.length ? (
            <details className="rounded-2xl border border-red-200 bg-white dark:border-red-900/40 dark:bg-surface-950/40" open>
              <summary className="flex cursor-pointer items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-red-700 dark:text-red-300">
                <span>Filas con error ({preview.errors.length})</span>
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    downloadErrorsReport();
                  }}
                  className="btn-ghost text-xs"
                >
                  <Download size={12} /> Descargar lista
                </button>
              </summary>
              <div className="max-h-56 overflow-y-auto border-t border-red-100 px-4 py-2 text-sm dark:border-red-900/40">
                <table className="w-full text-left">
                  <thead className="text-xs uppercase tracking-wider text-surface-500">
                    <tr>
                      <th className="py-1 pr-2">Fila</th>
                      <th className="py-1 pr-2">Columna</th>
                      <th className="py-1">Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.errors.map((err, idx) => (
                      <tr key={`${err.row}-${err.column}-${idx}`} className="border-t border-surface-100 dark:border-surface-800">
                        <td className="py-1.5 pr-2 font-mono text-xs">{err.row}</td>
                        <td className="py-1.5 pr-2 text-xs">{err.column}</td>
                        <td className="py-1.5 text-xs text-red-700 dark:text-red-300">{err.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}

          {preview.valid_preview.length ? (
            <details className="rounded-2xl border border-surface-200 bg-white dark:border-surface-800 dark:bg-surface-950/40">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-surface-700 dark:text-surface-200">
                Vista previa ({preview.valid_preview.length} de {preview.valid_count})
              </summary>
              <div className="max-h-56 overflow-y-auto border-t border-surface-100 px-4 py-2 text-xs dark:border-surface-800">
                <table className="w-full text-left">
                  <thead className="text-[11px] uppercase tracking-wider text-surface-500">
                    <tr>
                      <th className="py-1 pr-2">Fila</th>
                      <th className="py-1 pr-2">Nombre</th>
                      <th className="py-1 pr-2">Email</th>
                      <th className="py-1 pr-2">Teléfono</th>
                      <th className="py-1">Nacimiento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.valid_preview.map((row) => (
                      <tr key={row.row} className="border-t border-surface-100 dark:border-surface-800">
                        <td className="py-1.5 pr-2 font-mono">{row.row}</td>
                        <td className="py-1.5 pr-2">{row.first_name} {row.last_name}</td>
                        <td className="py-1.5 pr-2">{row.email}</td>
                        <td className="py-1.5 pr-2">{row.phone ?? '—'}</td>
                        <td className="py-1.5">{row.date_of_birth ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <button type="button" className="btn-ghost text-sm" onClick={reset} disabled={stage === 'committing'}>
              <RotateCcw size={14} /> Cargar otro archivo
            </button>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary text-sm" onClick={handleClose} disabled={stage === 'committing'}>
                <X size={14} /> Cancelar
              </button>
              <button
                type="button"
                className="btn-primary text-sm"
                onClick={handleCommit}
                disabled={!canCommit || stage === 'committing'}
              >
                {stage === 'committing' ? (
                  <>
                    <Loader2 className="animate-spin" size={14} /> Importando…
                  </>
                ) : (
                  <>Importar {preview.valid_count} cliente{preview.valid_count === 1 ? '' : 's'}</>
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {stage === 'done' && commitResult ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 dark:border-emerald-900/50 dark:bg-emerald-950/30">
            <CheckCircle2 className="mt-0.5 flex-shrink-0 text-emerald-600 dark:text-emerald-300" size={22} />
            <div>
              <p className="font-semibold text-emerald-800 dark:text-emerald-200">Importación completada</p>
              <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300">
                {commitResult.created} cliente{commitResult.created === 1 ? '' : 's'} creado{commitResult.created === 1 ? '' : 's'}.
                {commitResult.skipped > 0
                  ? ` ${commitResult.skipped} se omitieron porque su email ya existía.`
                  : ''}
              </p>
              <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
                Cada cliente recibió una contraseña aleatoria. Comparte el flujo de "Olvidé mi contraseña" para que la definan.
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost text-sm" onClick={reset}>
              Importar otro archivo
            </button>
            <button type="button" className="btn-primary text-sm" onClick={handleClose}>
              Listo
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
