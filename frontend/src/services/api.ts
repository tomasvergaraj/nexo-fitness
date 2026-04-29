import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '@/stores/authStore';
import type { BulkClassCancelRequest } from '@/types';

const API_URL = import.meta.env.VITE_API_URL || '/api/v1';

const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});

// Mutex: prevents concurrent refresh requests from using the same (soon-to-be-invalidated) refresh token.
// All 401s that arrive while a refresh is in flight queue here and reuse the result.
let activeRefresh: Promise<{ access_token: string; refresh_token: string }> | null = null;

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
      && (
        (error.response.data as Record<string, unknown>).next_action === 'redirect_to_checkout'
        || (error.response.data as Record<string, unknown>).next_action === 'billing_required'
        || Boolean((error.response.data as Record<string, unknown>).billing_status)
      );

    if (is403Billing && !window.location.pathname.startsWith('/billing/')) {
      const data = error.response!.data as Record<string, string>;
      const params = new URLSearchParams();
      if (data.billing_status) params.set('status', data.billing_status);
      if (data.tenant_slug) params.set('tenant', data.tenant_slug);
      window.location.href = `/billing/expired?${params.toString()}`;
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      const refreshToken = useAuthStore.getState().refreshToken;

      if (refreshToken) {
        try {
          if (!activeRefresh) {
            activeRefresh = axios
              .post(`${API_URL}/auth/refresh`, { refresh_token: refreshToken })
              .then((res) => res.data as { access_token: string; refresh_token: string })
              .finally(() => { activeRefresh = null; });
          }
          const data = await activeRefresh;
          useAuthStore.getState().setTokens(data.access_token, data.refresh_token);
          if (originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${data.access_token}`;
          }
          return api(originalRequest);
        } catch {
          activeRefresh = null;
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
  changePassword: (data: { current_password: string; new_password: string }) =>
    api.post('/auth/change-password', data),
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
  quote: (data: { plan_key: string; promo_code?: string; promo_code_id?: string | null }) => api.post('/billing/quote', data),
  /** Genera URL de checkout para renovación. plan_key opcional para cambiar de plan. */
  reactivate: (data: { plan_key: string; promo_code?: string; promo_code_id?: string | null; force_immediate?: boolean; success_url?: string; cancel_url?: string }) => api.post('/billing/reactivate', data),
  cancelNextPlan: () => api.delete('/billing/next-plan'),
  listPayments: (params?: { page?: number; per_page?: number }) => api.get('/billing/payments', { params }),
  listAdminTenants: (params?: Record<string, unknown>) => api.get('/billing/admin/tenants', { params }),
  listAdminPlans: () => api.get('/billing/admin/plans'),
  createAdminPlan: (data: unknown) => api.post('/billing/admin/plans', data),
  updateAdminPlan: (planId: string, data: unknown) => api.patch(`/billing/admin/plans/${planId}`, data),
  listAdminPromoCodes: () => api.get('/billing/admin/promo-codes'),
  createAdminPromoCode: (data: unknown) => api.post('/billing/admin/promo-codes', data),
  updateAdminPromoCode: (promoId: string, data: unknown) => api.patch(`/billing/admin/promo-codes/${promoId}`, data),
  deleteAdminPromoCode: (promoId: string) => api.delete(`/billing/admin/promo-codes/${promoId}`),
  registerTenantManualPayment: (tenantId: string, data: unknown) => api.post(`/billing/admin/tenants/${tenantId}/manual-payment`, data),
  listAdminTenantPayments: (tenantId: string, params?: { page?: number; per_page?: number }) =>
    api.get(`/billing/admin/tenants/${tenantId}/payments`, { params }),
  recordPaymentInvoice: (paymentId: string, data: { folio_number: number; invoice_date: string }) =>
    api.patch(`/billing/admin/payments/${paymentId}/invoice`, data),
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
  previewBulkCancel: (data: BulkClassCancelRequest) => api.post('/classes/bulk-cancel/preview', data),
  bulkCancel: (data: BulkClassCancelRequest) => api.post('/classes/bulk-cancel', data),
  cancel: (id: string, options?: { cancelReason?: string; series?: boolean }) =>
    api.delete(`/classes/${id}`, {
      params: {
        ...(options?.cancelReason ? { cancel_reason: options.cancelReason } : {}),
        ...(options?.series ? { series: true } : {}),
      },
    }),
  replicate: (data: { mode: 'day' | 'week' | 'month'; source_date: string; target_dates: string[] }) =>
    api.post('/classes/replicate', data),
};

export const reservationsApi = {
  list: (params?: Record<string, unknown>) => api.get('/reservations', { params }),
  create: (data: { gym_class_id: string; user_id?: string }) => api.post('/reservations', data),
  updateStatus: (id: string, status: 'no_show' | 'attended') =>
    api.patch(`/reservations/${id}`, null, { params: { status } }),
  cancel: (id: string, cancelReason?: string) =>
    api.delete(`/reservations/${id}`, { params: cancelReason ? { cancel_reason: cancelReason } : undefined }),
};

export const clientsApi = {
  list: (params?: Record<string, unknown>) => api.get('/clients', { params }),
  get: (id: string) => api.get(`/clients/${id}`),
  create: (data: Record<string, unknown>) => api.post('/clients', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/clients/${id}`, data),
  hardDelete: (id: string) => api.delete(`/clients/${id}/hard-delete`),
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
  context: () => api.get('/checkins/context'),
  list: (params?: Record<string, unknown>) => api.get('/checkins', { params }),
  create: (data: Record<string, unknown>) => api.post('/checkins', data),
  scan: (data: Record<string, unknown>) => api.post('/checkins/scan', data),
  listSuspiciousCases: (params?: Record<string, unknown>) => api.get('/checkins/suspicious-cases', { params }),
  getSuspiciousCase: (id: string) => api.get(`/checkins/suspicious-cases/${id}`),
  updateSuspiciousCase: (id: string, data: Record<string, unknown>) => api.patch(`/checkins/suspicious-cases/${id}`, data),
};

export const staffApi = {
  list: () => api.get<Array<{ id: string; full_name: string; role: string; email: string; is_active: boolean }>>('/staff'),
  invite: (data: { email: string; first_name: string; last_name: string; role: string; replace_pending?: boolean }) =>
    api.post('/staff/invite', data),
  listInvitations: () => api.get<Array<{
    email: string; first_name: string; last_name: string;
    role: string; role_label: string; invited_by: string;
    invited_at: string; expires_in_hours: number;
  }>>('/staff/invitations'),
  cancelInvitation: (email: string) => api.delete(`/staff/invitations/${encodeURIComponent(email)}`),
  update: (id: string, data: { role?: string; first_name?: string; last_name?: string; is_active?: boolean }) =>
    api.patch(`/staff/${id}`, data),
  deactivate: (id: string) => api.delete(`/staff/${id}`),
  hardDelete: (id: string) => api.delete(`/staff/${id}/hard-delete`),
};

export const invitationApi = {
  getInfo: (token: string) => api.get(`/auth/invitation/${token}`),
  accept: (token: string, password: string) => api.post('/auth/accept-invitation', { token, password }),
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
  manualSale: (data: Record<string, unknown>) => api.post('/memberships/manual-sale', data),
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

export const feedbackApi = {
  list: (params?: Record<string, unknown>) => api.get('/feedback/submissions', { params }),
  create: (formData: FormData) => api.post('/feedback/submissions', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
};

export const programsApi = {
  list: (params?: Record<string, unknown>) => api.get('/programs', { params }),
  create: (data: Record<string, unknown>) => api.post('/programs', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/programs/${id}`, data),
  delete: (id: string) => api.delete(`/programs/${id}`),
  listExerciseLibrary: () => api.get('/programs/exercise-library'),
  createExerciseLibraryItem: (data: { name: string; group: string }) => api.post('/programs/exercise-library', data),
  deleteExerciseLibraryItem: (id: string) => api.delete(`/programs/exercise-library/${id}`),
  listEnrollments: (id: string) => api.get(`/programs/${id}/enrollments`),
  listClasses: (id: string) => api.get(`/programs/${id}/classes`),
  generateClasses: (id: string, data: Record<string, unknown>) => api.post(`/programs/${id}/generate-classes`, data),
};

export const programBookingsApi = {
  list: (params?: Record<string, unknown>) => api.get('/program-bookings', { params }),
  create: (data: { program_id: string; recurrence_group_id: string }) => api.post('/program-bookings', data),
  get: (id: string) => api.get(`/program-bookings/${id}`),
  listReservations: (id: string) => api.get(`/program-bookings/${id}/reservations`),
  cancel: (id: string, data?: { cancel_reason?: string }, force = false) =>
    api.delete(`/program-bookings/${id}${force ? '?force=true' : ''}`, { data }),
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
  delete: (id: string) => api.delete(`/payment-provider/accounts/${id}`),
};

export const platformApi = {
  listLeads: (params?: Record<string, unknown>) => api.get('/platform/leads', { params }),
  listFeedback: (params?: Record<string, unknown>) => api.get('/platform/feedback', { params }),
  updateLead: (id: string, data: Record<string, unknown>) => api.patch(`/platform/leads/${id}`, data),
};

export const publicApi = {
  getTenantProfile: (slug: string) => api.get(`/public/tenants/${slug}/profile`),
  getStorefrontProfile: () => api.get('/public/storefront/profile'),
  getTenantPlans: (slug: string) => api.get(`/public/tenants/${slug}/plans`),
  getTenantClasses: (slug: string, params?: Record<string, unknown>) => api.get(`/public/tenants/${slug}/classes`, { params }),
  validateTenantPromoCode: (slug: string, code: string, planId: string) =>
    api.post(`/public/tenants/${slug}/promo-codes/validate`, { code, plan_id: planId }),
  validateStorefrontPromoCode: (code: string, planId: string) =>
    api.post('/public/storefront/promo-codes/validate', { code, plan_id: planId }),
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

export const posApi = {
  // Categories
  listCategories: () => api.get('/pos/categories'),
  createCategory: (data: Record<string, unknown>) => api.post('/pos/categories', data),
  updateCategory: (id: string, data: Record<string, unknown>) => api.put(`/pos/categories/${id}`, data),
  deleteCategory: (id: string) => api.delete(`/pos/categories/${id}`),

  // Products
  listProducts: (params?: Record<string, unknown>) => api.get('/pos/products', { params }),
  getProduct: (id: string) => api.get(`/pos/products/${id}`),
  createProduct: (data: Record<string, unknown>) => api.post('/pos/products', data),
  updateProduct: (id: string, data: Record<string, unknown>) => api.put(`/pos/products/${id}`, data),
  deleteProduct: (id: string) => api.delete(`/pos/products/${id}`),

  // Inventory
  listInventory: (params?: Record<string, unknown>) => api.get('/pos/inventory', { params }),
  adjustStock: (productId: string, data: Record<string, unknown>) => api.put(`/pos/inventory/${productId}`, data),
  listMovements: (params?: Record<string, unknown>) => api.get('/pos/inventory/movements', { params }),

  // Suppliers
  listSuppliers: () => api.get('/pos/suppliers'),
  createSupplier: (data: Record<string, unknown>) => api.post('/pos/suppliers', data),
  updateSupplier: (id: string, data: Record<string, unknown>) => api.put(`/pos/suppliers/${id}`, data),
  deleteSupplier: (id: string) => api.delete(`/pos/suppliers/${id}`),

  // Purchase orders
  listPurchaseOrders: () => api.get('/pos/purchase-orders'),
  getPurchaseOrder: (id: string) => api.get(`/pos/purchase-orders/${id}`),
  createPurchaseOrder: (data: Record<string, unknown>) => api.post('/pos/purchase-orders', data),
  receivePurchaseOrder: (id: string, data: Record<string, unknown>) => api.post(`/pos/purchase-orders/${id}/receive`, data),
  deletePurchaseOrder: (id: string) => api.delete(`/pos/purchase-orders/${id}`),

  // Transactions
  listTransactions: (params?: Record<string, unknown>) => api.get('/pos/transactions', { params }),
  getTransaction: (id: string) => api.get(`/pos/transactions/${id}`),
  createTransaction: (data: Record<string, unknown>) => api.post('/pos/transactions', data),
  refundTransaction: (id: string) => api.post(`/pos/transactions/${id}/refund`, {}),

  // Expenses
  listExpenses: (params?: Record<string, unknown>) => api.get('/pos/expenses', { params }),
  createExpense: (data: Record<string, unknown>) => api.post('/pos/expenses', data),
  updateExpense: (id: string, data: Record<string, unknown>) => api.put(`/pos/expenses/${id}`, data),
  deleteExpense: (id: string) => api.delete(`/pos/expenses/${id}`),
};
