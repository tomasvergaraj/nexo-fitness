export type SupportTimelineEntry = {
  id: string;
  kind: 'initial' | 'reply' | 'note';
  created_at: string;
  author_name: string;
  author_role?: string | null;
  message: string;
};

const SUPPORT_TIMELINE_PREFIX = '__NEXO_SUPPORT_TIMELINE__::';

function isSupportTimelineEntry(value: unknown): value is SupportTimelineEntry {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === 'string'
    && typeof entry.kind === 'string'
    && typeof entry.created_at === 'string'
    && typeof entry.author_name === 'string'
    && typeof entry.message === 'string'
  );
}

function sanitizeTimelineEntries(value: unknown): SupportTimelineEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isSupportTimelineEntry)
    .map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      created_at: entry.created_at,
      author_name: entry.author_name,
      author_role: entry.author_role ?? null,
      message: entry.message,
    }));
}

export function createSupportTimelineEntry({
  kind,
  createdAt,
  authorName,
  authorRole,
  message,
}: {
  kind: SupportTimelineEntry['kind'];
  createdAt?: string;
  authorName: string;
  authorRole?: string | null;
  message: string;
}): SupportTimelineEntry {
  const timestamp = createdAt || new Date().toISOString();
  return {
    id: `${timestamp}-${Math.random().toString(36).slice(2, 10)}`,
    kind,
    created_at: timestamp,
    author_name: authorName,
    author_role: authorRole ?? null,
    message: message.trim(),
  };
}

export function parseSupportTimeline(
  notes?: string | null,
  fallback?: {
    createdAt?: string;
    authorName?: string;
    authorRole?: string | null;
  },
): SupportTimelineEntry[] {
  const raw = notes?.trim();
  if (!raw) {
    return [];
  }

  if (raw.startsWith(SUPPORT_TIMELINE_PREFIX)) {
    try {
      const parsed = JSON.parse(raw.slice(SUPPORT_TIMELINE_PREFIX.length));
      const entries = sanitizeTimelineEntries(parsed);
      return entries.sort(
        (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
      );
    } catch {
      return [];
    }
  }

  return [
    {
      id: `legacy-${fallback?.createdAt || 'initial'}`,
      kind: 'initial',
      created_at: fallback?.createdAt || new Date(0).toISOString(),
      author_name: fallback?.authorName || 'Solicitud',
      author_role: fallback?.authorRole ?? null,
      message: raw,
    },
  ];
}

export function serializeSupportTimeline(entries: SupportTimelineEntry[]): string | null {
  const normalized = entries
    .map((entry) => ({
      ...entry,
      message: entry.message.trim(),
    }))
    .filter((entry) => entry.message);

  if (!normalized.length) {
    return null;
  }

  return `${SUPPORT_TIMELINE_PREFIX}${JSON.stringify(normalized)}`;
}

export function getSupportLastTimelineEntry(
  notes?: string | null,
  fallback?: {
    createdAt?: string;
    authorName?: string;
    authorRole?: string | null;
  },
): SupportTimelineEntry | null {
  const timeline = parseSupportTimeline(notes, fallback);
  return timeline.length ? timeline[timeline.length - 1] : null;
}

export function getSupportLastActivityAt(
  notes?: string | null,
  fallback?: {
    createdAt?: string;
    authorName?: string;
    authorRole?: string | null;
  },
): string | null {
  return getSupportLastTimelineEntry(notes, fallback)?.created_at ?? fallback?.createdAt ?? null;
}

export function getSupportTraceCount(
  notes?: string | null,
  fallback?: {
    createdAt?: string;
    authorName?: string;
    authorRole?: string | null;
  },
): number {
  return parseSupportTimeline(notes, fallback).length;
}
