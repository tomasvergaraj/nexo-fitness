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
    const is403Billing = error.response?.status === 403
      && typeof error.response.data === 'object'
      && error.response.data !== null
      && (error.response.data as Record<string, unknown>).next_action === 'redirect_to_checkout';

    if (is403Billing && !window.location.pathname.startsWith('/billing/')) {
      const data = error.response!.data as Record<string, string>;
      if (data.checkout_url) {
        // Plan con Stripe activo → redirigir directo al checkout
        window.location.href = data.checkout_url;
      } else {
        // Sin checkout configurado → mostrar billing wall interno
        const params = new URLSearchParams();
        if (data.billing_status) params.set('status', data.billing_status);
        if (data.tenant_slug) params.set('tenant', data.tenant_slug);
        window.location.href = `/billing/expired?${params.toString()}`;
      }
      return Promise.reject(error);
    }

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
  updateMe: (data: { first_name?: string; last_name?: string; phone?: string }) =>
    api.patch('/auth/me', data),
  logout: () => api.post('/auth/logout'),
  refresh: (refreshToken: string) =>
    api.post('/auth/refresh', { refresh_token: refreshToken }),
  forgotPassword: (email: string) =>
    api.post('/auth/forgot-password', { email }),
  resetPassword: (token: string, new_password: string) =>
    api.post('/auth/reset-password', { token, new_password }),
  sendEmailVerification: (email: string) =>
    api.post('/auth/email-verification/send', { email }),
  confirmEmailVerification: (email: string, code: string) =>
    api.post('/auth/email-verification/confirm', { email, code }),
};

export const billingApi = {
  listPublicPlans: () => api.get('/billing/public/plans'),
  signup: (data: unknown) => api.post('/billing/signup', data),
  currentSubscription: () => api.get('/billing/subscription'),
  /** Consulta estado sin forzar acceso — seguro para billing wall y banner */
  getStatus: () => api.get('/billing/status'),
  /** Genera URL de checkout para renovación. plan_key opcional para cambiar de plan. */
  reactivate: (planKey?: string) => api.post('/billing/reactivate', planKey ? { plan_key: planKey } : {}),
  listAdminTenants: (params?: Record<string, unknown>) => api.get('/billing/admin/tenants', { params }),
  listAdminPlans: () => api.get('/billing/admin/plans'),
  createAdminPlan: (data: unknown) => api.post('/billing/admin/plans', data),
  updateAdminPlan: (planId: string, data: unknown) => api.patch(`/billing/admin/plans/${planId}`, data),
};

export const dashboardApi = {
  getMetrics: () => api.get('/dashboard/metrics'),
  getToday: () => api.get('/dashboard/today'),
};

export const classesApi = {
  list: (params?: Record<string, unknown>) => api.get('/classes', { params }),
  get: (id: string) => api.get(`/classes/${id}`),
  listReservations: (id: string) => api.get(`/classes/${id}/reservations`),
  create: (data: Record<string, unknown>) => api.post('/classes', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/classes/${id}`, data),
  cancel: (id: string, cancelReason?: string) =>
    api.delete(`/classes/${id}`, { params: cancelReason ? { cancel_reason: cancelReason } : undefined }),
};

export const reservationsApi = {
  list: (params?: Record<string, unknown>) => api.get('/reservations', { params }),
  create: (data: { gym_class_id: string; user_id?: string }) => api.post('/reservations', data),
  cancel: (id: string, cancelReason?: string) =>
    api.delete(`/reservations/${id}`, { params: cancelReason ? { cancel_reason: cancelReason } : undefined }),
};

export const clientsApi = {
  list: (params?: Record<string, unknown>) => api.get('/clients', { params }),
  get: (id: string) => api.get(`/clients/${id}`),
  create: (data: Record<string, unknown>) => api.post('/clients', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/clients/${id}`, data),
  resetPassword: (id: string, newPassword: string) => api.post(`/clients/${id}/reset-password`, { new_password: newPassword }),
  stats: (id: string) => api.get(`/clients/${id}/stats`),
  membershipHistory: (id: string) => api.get(`/clients/${id}/membership-history`),
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
  scan: (data: Record<string, unknown>) => api.post('/checkins/scan', data),
};

export const staffApi = {
  list: () => api.get<Array<{ id: string; full_name: string; role: string; email: string }>>('/staff'),
};

export const uploadApi = {
  logo: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post<{ url: string }>('/upload/logo', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
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
  listEnrollments: (id: string) => api.get(`/programs/${id}/enrollments`),
};

export const settingsApi = {
  get: () => api.get('/settings'),
  update: (data: Record<string, unknown>) => api.patch('/settings', data),
};

export const reportsApi = {
  overview: (params?: Record<string, unknown>) => api.get('/reports/overview', { params }),
  attendance: (params?: Record<string, unknown>) => api.get('/reports/attendance', { params }),
};

export const notificationsApi = {
  list: (params?: Record<string, unknown>) => api.get('/notifications', { params }),
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
  getStorefrontProfile: () => api.get('/public/storefront/profile'),
  getTenantPlans: (slug: string) => api.get(`/public/tenants/${slug}/plans`),
  getTenantClasses: (slug: string, params?: Record<string, unknown>) => api.get(`/public/tenants/${slug}/classes`, { params }),
  createCheckoutSession: (slug: string, data: Record<string, unknown>) => api.post(`/public/tenants/${slug}/checkout-session`, data),
  createStorefrontCheckoutSession: (data: Record<string, unknown>) => api.post('/public/storefront/checkout-session', data),
  createLead: (data: Record<string, unknown>) => api.post('/public/leads', data),
};

export const mobileApi = {
  wallet: () => api.get('/mobile/wallet'),
  listPrograms: () => api.get('/mobile/programs'),
  enrollProgram: (id: string) => api.post(`/mobile/programs/${id}/enroll`),
  leaveProgram: (id: string) => api.delete(`/mobile/programs/${id}/enroll`),
  listPayments: (params?: Record<string, unknown>) => api.get('/mobile/payments', { params }),
  listSupportInteractions: (params?: Record<string, unknown>) => api.get('/mobile/support/interactions', { params }),
  createSupportInteraction: (data: Record<string, unknown>) => api.post('/mobile/support/interactions', data),
  getPushConfig: () => api.get('/mobile/push-config'),
  pushPreview: (data: Record<string, unknown>) => api.post('/mobile/push-preview', data),
  listPushSubscriptions: () => api.get('/mobile/push-subscriptions'),
  registerPushSubscription: (data: Record<string, unknown>) => api.post('/mobile/push-subscriptions', data),
  updateMembership: (data: { auto_renew?: boolean }) => api.patch('/mobile/membership', data),
  downloadCalendar: () => api.get('/mobile/calendar.ics', { responseType: 'blob' }),
  listMeasurements: () => api.get('/mobile/progress'),
  createMeasurement: (data: Record<string, unknown>) => api.post('/mobile/progress', data),
  deleteMeasurement: (id: string) => api.delete(`/mobile/progress/${id}`),
  listProgressPhotos: () => api.get('/mobile/progress/photos'),
  uploadProgressPhoto: (formData: FormData) => api.post('/mobile/progress/photos', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
  deleteProgressPhoto: (id: string) => api.delete(`/mobile/progress/photos/${id}`),
  listPersonalRecords: (exercise?: string) => api.get('/mobile/personal-records', { params: exercise ? { exercise } : undefined }),
  createPersonalRecord: (data: Record<string, unknown>) => api.post('/mobile/personal-records', data),
  deletePersonalRecord: (id: string) => api.delete(`/mobile/personal-records/${id}`),
};

export const apiClientsApi = {
  list: () => api.get('/api-clients'),
  create: (data: Record<string, unknown>) => api.post('/api-clients', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/api-clients/${id}`, data),
  delete: (id: string) => api.delete(`/api-clients/${id}`),
};

export const promoCodesApi = {
  list: () => api.get('/promo-codes'),
  create: (data: Record<string, unknown>) => api.post('/promo-codes', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/promo-codes/${id}`, data),
  delete: (id: string) => api.delete(`/promo-codes/${id}`),
  validate: (code: string, planId: string) => api.post('/promo-codes/validate', { code, plan_id: planId }),
};
