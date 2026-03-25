import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '@/stores/authStore';

const API_URL = import.meta.env.VITE_API_URL || '/api/v1';

const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});

// Request interceptor: attach token
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = useAuthStore.getState().accessToken;
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor: handle 401 and refresh
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      const refreshToken = useAuthStore.getState().refreshToken;

      if (refreshToken) {
        try {
          const { data } = await axios.post(`${API_URL}/auth/refresh`, { refresh_token: refreshToken });
          useAuthStore.getState().setTokens(data.access_token, data.refresh_token);
          if (originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${data.access_token}`;
          }
          return api(originalRequest);
        } catch {
          useAuthStore.getState().logout();
          window.location.href = '/login';
        }
      } else {
        useAuthStore.getState().logout();
        window.location.href = '/login';
      }
    }

    return Promise.reject(error);
  }
);

export default api;

/* ─── API Service Functions ──────────────────────────────────── */

export const authApi = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }),
  registerGym: (data: Record<string, unknown>) =>
    api.post('/auth/register-gym', data),
  me: () => api.get('/auth/me'),
  logout: () => api.post('/auth/logout'),
  refresh: (refreshToken: string) =>
    api.post('/auth/refresh', { refresh_token: refreshToken }),
};

export const billingApi = {
  listPublicPlans: () => api.get('/billing/public/plans'),
  signup: (data: unknown) => api.post('/billing/signup', data),
  currentSubscription: () => api.get('/billing/subscription'),
  listAdminTenants: (params?: Record<string, unknown>) => api.get('/billing/admin/tenants', { params }),
  listAdminPlans: () => api.get('/billing/admin/plans'),
  createAdminPlan: (data: unknown) => api.post('/billing/admin/plans', data),
  updateAdminPlan: (planId: string, data: unknown) => api.patch(`/billing/admin/plans/${planId}`, data),
};

export const dashboardApi = {
  getMetrics: () => api.get('/dashboard/metrics'),
};

export const classesApi = {
  list: (params?: Record<string, unknown>) => api.get('/classes', { params }),
  get: (id: string) => api.get(`/classes/${id}`),
  create: (data: Record<string, unknown>) => api.post('/classes', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/classes/${id}`, data),
  cancel: (id: string) => api.delete(`/classes/${id}`),
};

export const reservationsApi = {
  list: (params?: Record<string, unknown>) => api.get('/reservations', { params }),
  create: (data: { gym_class_id: string; user_id?: string }) => api.post('/reservations', data),
  cancel: (id: string) => api.delete(`/reservations/${id}`),
};

export const clientsApi = {
  list: (params?: Record<string, unknown>) => api.get('/clients', { params }),
  get: (id: string) => api.get(`/clients/${id}`),
  create: (data: Record<string, unknown>) => api.post('/clients', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/clients/${id}`, data),
};

export const plansApi = {
  list: (params?: Record<string, unknown>) => api.get('/plans', { params }),
  create: (data: Record<string, unknown>) => api.post('/plans', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/plans/${id}`, data),
};

export const paymentsApi = {
  list: (params?: Record<string, unknown>) => api.get('/payments', { params }),
  create: (data: Record<string, unknown>) => api.post('/payments', data),
};

export const checkinsApi = {
  create: (data: Record<string, unknown>) => api.post('/checkins', data),
};

export const branchesApi = {
  list: () => api.get('/branches'),
  create: (data: Record<string, unknown>) => api.post('/branches', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/branches/${id}`, data),
};

export const membershipsApi = {
  list: (params?: Record<string, unknown>) => api.get('/memberships', { params }),
  create: (data: Record<string, unknown>) => api.post('/memberships', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/memberships/${id}`, data),
};

export const campaignsApi = {
  list: (params?: Record<string, unknown>) => api.get('/campaigns', { params }),
  overview: () => api.get('/campaigns/overview'),
  create: (data: Record<string, unknown>) => api.post('/campaigns', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/campaigns/${id}`, data),
};

export const supportApi = {
  list: (params?: Record<string, unknown>) => api.get('/support/interactions', { params }),
  create: (data: Record<string, unknown>) => api.post('/support/interactions', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/support/interactions/${id}`, data),
};

export const programsApi = {
  list: (params?: Record<string, unknown>) => api.get('/programs', { params }),
  create: (data: Record<string, unknown>) => api.post('/programs', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/programs/${id}`, data),
};

export const settingsApi = {
  get: () => api.get('/settings'),
  update: (data: Record<string, unknown>) => api.patch('/settings', data),
};

export const reportsApi = {
  overview: (params?: Record<string, unknown>) => api.get('/reports/overview', { params }),
};

export const notificationsApi = {
  list: () => api.get('/notifications'),
  create: (data: Record<string, unknown>) => api.post('/notifications', data),
  getDispatch: (id: string, params?: Record<string, unknown>) => api.get(`/notifications/${id}/dispatch`, { params }),
  broadcast: (data: Record<string, unknown>) => api.post('/notifications/broadcast', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/notifications/${id}`, data),
};

export const paymentProviderApi = {
  list: () => api.get('/payment-provider/accounts'),
  create: (data: Record<string, unknown>) => api.post('/payment-provider/accounts', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/payment-provider/accounts/${id}`, data),
};

export const platformApi = {
  listLeads: (params?: Record<string, unknown>) => api.get('/platform/leads', { params }),
  updateLead: (id: string, data: Record<string, unknown>) => api.patch(`/platform/leads/${id}`, data),
};

export const publicApi = {
  getTenantProfile: (slug: string) => api.get(`/public/tenants/${slug}/profile`),
  getTenantPlans: (slug: string) => api.get(`/public/tenants/${slug}/plans`),
  getTenantClasses: (slug: string, params?: Record<string, unknown>) => api.get(`/public/tenants/${slug}/classes`, { params }),
  createCheckoutSession: (slug: string, data: Record<string, unknown>) => api.post(`/public/tenants/${slug}/checkout-session`, data),
  createLead: (data: Record<string, unknown>) => api.post('/public/leads', data),
};

export const mobileApi = {
  wallet: () => api.get('/mobile/wallet'),
  listPayments: (params?: Record<string, unknown>) => api.get('/mobile/payments', { params }),
  getPushConfig: () => api.get('/mobile/push-config'),
  pushPreview: (data: Record<string, unknown>) => api.post('/mobile/push-preview', data),
  listPushSubscriptions: () => api.get('/mobile/push-subscriptions'),
  registerPushSubscription: (data: Record<string, unknown>) => api.post('/mobile/push-subscriptions', data),
};
