import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ImageIcon, Upload, X, AlertCircle, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { uploadApi } from '@/services/api';
import { getApiError } from '@/utils';

interface LogoUploaderProps {
  currentUrl?: string | null;
  onUploaded: (url: string) => void;
}

const RECOMMENDED = [
  { label: '256 × 256 px', note: 'Mínimo recomendado' },
  { label: '512 × 512 px', note: 'Ideal para pantallas retina' },
  { label: '1024 × 1024 px', note: 'Máxima calidad' },
];

export default function LogoUploader({ currentUrl, onUploaded }: LogoUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadApi.logo(file),
    onSuccess: (res) => {
      onUploaded(res.data.url);
      setPreview(null);
      setPendingFile(null);
      toast.success('Logo actualizado');
    },
    onError: (err: unknown) => {
      toast.error(getApiError(err, 'No se pudo subir el logo'));
    },
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!e.target.files) return;
    // Reset
    e.target.value = '';
    setValidationError(null);
    setPendingFile(null);
    setPreview(null);
    if (!file) return;

    if (file.type !== 'image/png') {
      setValidationError('El archivo debe ser PNG. Otros formatos no son compatibles con fondo transparente.');
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setValidationError('El archivo supera 4 MB. Exporta a una resolución menor.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      setPreview(ev.target?.result as string);
      setPendingFile(file);
    };
    reader.readAsDataURL(file);
  }

  function cancelPreview() {
    setPreview(null);
    setPendingFile(null);
    setValidationError(null);
  }

  const displayUrl = preview ?? currentUrl;

  return (
    <div className="space-y-3">
      {/* Guidance banner */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-900/40 dark:bg-amber-950/20">
        <div className="flex items-start gap-2">
          <AlertCircle size={15} className="mt-0.5 shrink-0 text-amber-500" />
          <div className="text-xs leading-5 text-amber-700 dark:text-amber-300">
            <strong>PNG sin fondo (transparente)</strong> — el logo se mostrará sobre fondos oscuros y claros.<br />
            Tamaños recomendados: {RECOMMENDED.map((r) => r.label).join(', ')}.
          </div>
        </div>
      </div>

      {/* Preview area */}
      <div className="flex items-center gap-4">
        <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-surface-300 bg-surface-100 dark:border-surface-700 dark:bg-surface-800">
          {displayUrl ? (
            <>
              <img
                src={displayUrl}
                alt="Logo"
                className="h-full w-full object-contain p-2"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              {preview && (
                <button
                  type="button"
                  onClick={cancelPreview}
                  className="absolute right-1 top-1 rounded-full bg-surface-900/70 p-0.5 text-white"
                >
                  <X size={12} />
                </button>
              )}
            </>
          ) : (
            <ImageIcon size={28} className="text-surface-400" />
          )}
        </div>

        <div className="flex-1 space-y-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="btn-secondary text-sm"
              disabled={uploadMutation.isPending}
            >
              <Upload size={14} />
              Seleccionar PNG
            </button>
            {pendingFile && (
              <button
                type="button"
                onClick={() => uploadMutation.mutate(pendingFile)}
                className="btn-primary text-sm"
                disabled={uploadMutation.isPending}
              >
                <CheckCircle2 size={14} />
                {uploadMutation.isPending ? 'Subiendo...' : 'Confirmar y subir'}
              </button>
            )}
          </div>

          {pendingFile && !validationError && (
            <p className="text-xs text-surface-500">
              {pendingFile.name} — {(pendingFile.size / 1024).toFixed(0)} KB
            </p>
          )}
          {validationError && (
            <p className="text-xs text-rose-600 dark:text-rose-400">{validationError}</p>
          )}
          {!pendingFile && !validationError && (
            <div className="text-xs text-surface-400">
              {RECOMMENDED.map((r) => (
                <span key={r.label} className="mr-3">{r.label} <span className="text-surface-300">({r.note})</span></span>
              ))}
            </div>
          )}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
