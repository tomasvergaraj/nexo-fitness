import {
  AppNotification,
  CheckoutSession,
  CheckoutSessionRequest,
  GymClass,
  LoginResponse,
  MobileWallet,
  NotificationDispatchResponse,
  PaginatedResponse,
  PaymentHistoryItem,
  PublicPlan,
  PushPreviewRequest,
  Reservation,
  PushSubscriptionRequest,
  PushSubscriptionResponse,
  TenantPublicProfile,
} from '../types';

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  accessToken?: string;
  body?: unknown;
};

export const DEFAULT_API_BASE_URL = 'http://localhost:8000/api/v1';

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, '');
}

function buildQuery(params?: Record<string, string | number | boolean | undefined | null>) {
  if (!params) {
    return '';
  }

  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    searchParams.set(key, String(value));
  });

  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

async function extractErrorMessage(response: Response) {
  try {
    const payload = (await response.json()) as { detail?: string; message?: string };
    if (typeof payload.detail === 'string' && payload.detail) {
      return payload.detail;
    }
    if (typeof payload.message === 'string' && payload.message) {
      return payload.message;
    }
  } catch {
    return `HTTP ${response.status}`;
  }

  return `HTTP ${response.status}`;
}

async function request<T>(baseUrl: string, path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (options.accessToken) {
    headers.Authorization = `Bearer ${options.accessToken}`;
  }

  const response = await fetch(`${normalizeBaseUrl(baseUrl)}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export const authApi = {
  login: (baseUrl: string, email: string, password: string) =>
    request<LoginResponse>(baseUrl, '/auth/login', {
      method: 'POST',
      body: { email, password },
    }),
};

export const publicApi = {
  getTenantProfile: (baseUrl: string, slug: string) =>
    request<TenantPublicProfile>(baseUrl, `/public/tenants/${slug}/profile`),
  getTenantPlans: (baseUrl: string, slug: string) =>
    request<PublicPlan[]>(baseUrl, `/public/tenants/${slug}/plans`),
  createCheckoutSession: (baseUrl: string, slug: string, payload: CheckoutSessionRequest) =>
    request<CheckoutSession>(baseUrl, `/public/tenants/${slug}/checkout-session`, {
      method: 'POST',
      body: payload,
    }),
};

export const mobileApi = {
  getWallet: (baseUrl: string, accessToken: string) =>
    request<MobileWallet>(baseUrl, '/mobile/wallet', {
      accessToken,
    }),
  listPayments: (baseUrl: string, accessToken: string, limit = 20) =>
    request<PaymentHistoryItem[]>(baseUrl, `/mobile/payments${buildQuery({ limit })}`, {
      accessToken,
    }),
  listPushSubscriptions: (baseUrl: string, accessToken: string) =>
    request<PushSubscriptionResponse[]>(baseUrl, '/mobile/push-subscriptions', {
      accessToken,
    }),
  registerPushSubscription: (baseUrl: string, accessToken: string, payload: PushSubscriptionRequest) =>
    request<PushSubscriptionResponse>(baseUrl, '/mobile/push-subscriptions', {
      method: 'POST',
      accessToken,
      body: payload,
    }),
  createPushPreview: (baseUrl: string, accessToken: string, payload: PushPreviewRequest) =>
    request<NotificationDispatchResponse>(baseUrl, '/mobile/push-preview', {
      method: 'POST',
      accessToken,
      body: payload,
    }),
};

export const notificationsApi = {
  list: (baseUrl: string, accessToken: string) =>
    request<AppNotification[]>(baseUrl, '/notifications', {
      accessToken,
    }),
  update: (
    baseUrl: string,
    accessToken: string,
    notificationId: string,
    payload: {
      is_read?: boolean;
      mark_opened?: boolean;
      mark_clicked?: boolean;
    },
  ) =>
    request<AppNotification>(baseUrl, `/notifications/${notificationId}`, {
      method: 'PATCH',
      accessToken,
      body: payload,
    }),
};

export const classesApi = {
  list: (
    baseUrl: string,
    accessToken: string,
    params?: Record<string, string | number | boolean | undefined | null>,
  ) =>
    request<PaginatedResponse<GymClass>>(baseUrl, `/classes${buildQuery(params)}`, {
      accessToken,
    }),
};

export const reservationsApi = {
  list: (
    baseUrl: string,
    accessToken: string,
    params?: Record<string, string | number | boolean | undefined | null>,
  ) =>
    request<PaginatedResponse<Reservation>>(baseUrl, `/reservations${buildQuery(params)}`, {
      accessToken,
    }),
  create: (baseUrl: string, accessToken: string, gymClassId: string) =>
    request<Reservation>(baseUrl, '/reservations', {
      method: 'POST',
      accessToken,
      body: { gym_class_id: gymClassId },
    }),
  cancel: (baseUrl: string, accessToken: string, reservationId: string) =>
    request<void>(baseUrl, `/reservations/${reservationId}`, {
      method: 'DELETE',
      accessToken,
    }),
};
