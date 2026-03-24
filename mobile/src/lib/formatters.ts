export function formatCurrency(value: number, currency = 'CLP') {
  try {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${Math.round(value)}`;
  }
}

export function formatDate(value?: string | null) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString('es-CL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(value?: string | null) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('es-CL', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatStatus(value?: string | null) {
  if (!value) {
    return 'sin estado';
  }

  const normalized = value.replace(/_/g, ' ');
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function formatPlanDuration(durationType?: string, durationDays?: number) {
  switch (durationType) {
    case 'monthly':
      return 'Mensual';
    case 'annual':
      return 'Anual';
    case 'perpetual':
      return 'Sin vencimiento';
    case 'custom':
      return durationDays ? `${durationDays} dias` : 'Duracion custom';
    default:
      return durationDays ? `${durationDays} dias` : 'Duracion configurable';
  }
}
