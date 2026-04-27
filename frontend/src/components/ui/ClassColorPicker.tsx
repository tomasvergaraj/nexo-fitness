import { Plus } from 'lucide-react';

import { cn } from '@/utils';

const CLASS_COLOR_PRESETS = [
  { value: '#06b6d4', label: 'Cian' },
  { value: '#14b8a6', label: 'Turquesa' },
  { value: '#22c55e', label: 'Verde' },
  { value: '#84cc16', label: 'Lima' },
  { value: '#eab308', label: 'Amarillo' },
  { value: '#f97316', label: 'Naranja' },
  { value: '#ef4444', label: 'Rojo' },
  { value: '#ec4899', label: 'Rosa' },
  { value: '#8b5cf6', label: 'Violeta' },
  { value: '#a855f7', label: 'Morado' },
] as const;

type ClassColorPickerProps = {
  value: string;
  inputId: string;
  onChange: (nextColor: string) => void;
  hideLabel?: boolean;
};

export default function ClassColorPicker({
  value,
  inputId,
  onChange,
  hideLabel = false,
}: ClassColorPickerProps) {
  const normalizedValue = value || '#06b6d4';
  const selectedPreset = CLASS_COLOR_PRESETS.find(
    (preset) => preset.value.toLowerCase() === normalizedValue.toLowerCase(),
  );

  return (
    <div>
      {!hideLabel ? (
        <label className="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-300">Color</label>
      ) : null}

      <div className="rounded-2xl border border-surface-200 bg-white p-4 dark:border-surface-800 dark:bg-surface-950/20">
        <div className="flex flex-wrap gap-2">
          {CLASS_COLOR_PRESETS.map((preset) => {
            const isSelected = preset.value.toLowerCase() === normalizedValue.toLowerCase();

            return (
              <button
                key={preset.value}
                type="button"
                title={preset.label}
                aria-label={`Usar color ${preset.label}`}
                onClick={() => onChange(preset.value)}
                className={cn(
                  'flex h-11 w-11 items-center justify-center rounded-2xl border transition-all',
                  isSelected
                    ? 'border-brand-400 bg-brand-50 shadow-sm dark:border-brand-600 dark:bg-brand-950/20'
                    : 'border-surface-200 bg-surface-50 hover:border-surface-300 hover:bg-white dark:border-surface-700 dark:bg-surface-900 dark:hover:bg-surface-800',
                )}
              >
                <span
                  className="h-5 w-5 rounded-full border border-white/70 shadow-sm"
                  style={{ backgroundColor: preset.value }}
                />
              </button>
            );
          })}

          <label
            htmlFor={inputId}
            className={cn(
              'relative inline-flex h-11 cursor-pointer items-center gap-2 rounded-2xl border px-3 text-sm font-medium transition-colors',
              selectedPreset
                ? 'border-surface-200 bg-surface-50 text-surface-600 hover:border-surface-300 hover:bg-white dark:border-surface-700 dark:bg-surface-900 dark:text-surface-300 dark:hover:bg-surface-800'
                : 'border-brand-400 bg-brand-50 text-brand-700 dark:border-brand-600 dark:bg-brand-950/20 dark:text-brand-300',
            )}
          >
            <span
              className="h-4 w-4 rounded-full border border-white/70 shadow-sm"
              style={{ backgroundColor: normalizedValue }}
            />
            Más colores
            <Plus size={14} />
            <input
              id={inputId}
              type="color"
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              value={normalizedValue}
              onChange={(event) => onChange(event.target.value)}
            />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-2 rounded-full bg-surface-100 px-3 py-1.5 text-surface-600 dark:bg-surface-800 dark:text-surface-300">
            <span
              className="h-3 w-3 rounded-full border border-white/70 shadow-sm"
              style={{ backgroundColor: normalizedValue }}
            />
            {selectedPreset?.label || 'Personalizado'}
          </span>
          <span className="font-mono uppercase tracking-wide text-surface-400">
            {normalizedValue}
          </span>
        </div>
      </div>
    </div>
  );
}
