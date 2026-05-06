import { useRef, useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/utils';

interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  maxLength?: number;
  className?: string;
  disabled?: boolean;
}

export default function TagInput({
  value,
  onChange,
  placeholder = 'Escribe y presiona Enter…',
  maxLength = 30,
  className,
  disabled = false,
}: TagInputProps) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const addTag = (raw: string) => {
    const cleaned = raw.trim().replace(/,/g, '').slice(0, maxLength);
    if (!cleaned) return;
    const lower = cleaned.toLowerCase();
    if (value.some((t) => t.toLowerCase() === lower)) {
      setDraft('');
      return;
    }
    onChange([...value, cleaned]);
    setDraft('');
  };

  const removeTag = (index: number) => {
    const next = [...value];
    next.splice(index, 1);
    onChange(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (event.key === 'Enter' || event.key === ',' || event.key === 'Tab') {
      if (draft.trim()) {
        event.preventDefault();
        addTag(draft);
      }
      return;
    }
    if (event.key === 'Backspace' && !draft && value.length) {
      removeTag(value.length - 1);
    }
  };

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      className={cn(
        'input flex flex-wrap items-center gap-1.5 min-h-[42px] cursor-text py-1.5',
        disabled && 'opacity-60 cursor-not-allowed',
        className,
      )}
    >
      {value.map((tag, idx) => (
        <span
          key={`${tag}-${idx}`}
          className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2.5 py-1 text-xs font-medium text-brand-800 dark:bg-brand-950/40 dark:text-brand-200"
        >
          {tag}
          {!disabled ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                removeTag(idx);
              }}
              className="rounded-full p-0.5 transition-colors hover:bg-brand-200 dark:hover:bg-brand-900/60"
              aria-label={`Quitar ${tag}`}
            >
              <X size={10} />
            </button>
          ) : null}
        </span>
      ))}
      <input
        ref={inputRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (draft.trim()) addTag(draft);
        }}
        placeholder={value.length ? '' : placeholder}
        disabled={disabled}
        className="flex-1 min-w-[120px] border-0 bg-transparent px-1 py-1 text-sm focus:outline-none focus:ring-0"
      />
    </div>
  );
}
