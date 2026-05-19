import { lazy } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import AppLayout from '@/components/layout/AppLayout';
import PlatformLayout from '@/components/layout/platform/PlatformLayout';
import AuthGuard from '@/components/auth/AuthGuard';
import LoginPage from '@/pages/auth/LoginPage';
import { useAuthStore } from '@/stores/authStore';
import { getDefaultRouteForRole, isCustomStorefrontHost } from '@/utils';

// Páginas auth — comunes pero no críticas: lazy
const MfaVerifyPage = lazy(() => import('@/pages/auth/MfaVerifyPage'));
const Setup2faPage = lazy(() => import('@/pages/auth/Setup2faPage'));
const RegisterPage = lazy(() => import('@/pages/auth/RegisterPage'));
const ForgotPasswordPage = lazy(() => import('@/pages/auth/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('@/pages/auth/ResetPasswordPage'));
const AcceptInvitationPage = lazy(() => import('@/pages/auth/AcceptInvitationPage'));
const BillingWallPage = lazy(() => import('@/pages/billing/BillingWallPage'));

// Tenant app pages
const DashboardPage = lazy(() => import('@/pages/dashboard/DashboardPage'));
const ClassesPage = lazy(() => import('@/pages/classes/ClassesPage'));
const ClientsPage = lazy(() => import('@/pages/clients/ClientsPage'));
const PlansPage = lazy(() => import('@/pages/plans/PlansPage'));
const PromoCodesPage = lazy(() => import('@/pages/promo/PromoCodesPage'));
const ApiClientsPage = lazy(() => import('@/pages/developer/ApiClientsPage'));
const CheckInPage = lazy(() => import('@/pages/checkin/CheckInPage'));
const ReceptionCheckInPage = lazy(() => import('@/pages/checkin/ReceptionCheckInPage'));
const ProgramsPage = lazy(() => import('@/pages/programs/ProgramsPage'));
const MarketingPage = lazy(() => import('@/pages/marketing/MarketingPage'));
const ReportsPage = lazy(() => import('@/pages/reports/ReportsPage'));
const RetentionPage = lazy(() => import('@/pages/retention/RetentionPage'));
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage'));
const SubscriptionPage = lazy(() => import('@/pages/subscription/SubscriptionPage'));
const SupportPage = lazy(() => import('@/pages/support/SupportPage'));
const FeedbackPage = lazy(() => import('@/pages/feedback/FeedbackPage'));
const POSPage = lazy(() => import('@/pages/pos/POSPage'));
const InventoryPage = lazy(() => import('@/pages/inventory/InventoryPage'));
const ExpensesPage = lazy(() => import('@/pages/expenses/ExpensesPage'));

// Platform (superadmin) — pesado y casi nunca cargado por usuarios normales
const PlatformDashboardPage = lazy(() => import('@/pages/platform/PlatformDashboardPage'));
const PlatformAuditLogPage = lazy(() => import('@/pages/platform/PlatformAuditLogPage'));
const PlatformEmailTemplatesPage = lazy(() => import('@/pages/platform/PlatformEmailTemplatesPage'));
const PlatformTenantsPage = lazy(() => import('@/pages/platform/PlatformTenantsPage'));
const PlatformPlansPage = lazy(() => import('@/pages/platform/PlatformPlansPage'));
const PlatformLeadsPage = lazy(() => import('@/pages/platform/PlatformLeadsPage'));
const PlatformFeedbackPage = lazy(() => import('@/pages/platform/PlatformFeedbackPage'));
const PlatformPromoCodesPage = lazy(() => import('@/pages/platform/PlatformPromoCodesPage'));

// Públicas / legales
const TenantStorefrontPage = lazy(() => import('@/pages/public/TenantStorefrontPage'));
const StorefrontPage = lazy(() => import('@/pages/storefront/StorefrontPage'));
const MemberAppPage = lazy(() => import('@/pages/member/MemberAppPage'));
const TermsPage = lazy(() => import('@/pages/legal/TermsPage'));
const PrivacyPage = lazy(() => import('@/pages/legal/PrivacyPage'));

function RootEntry() {
  if (isCustomStorefrontHost()) {
    return <TenantStorefrontPage />;
  }

  const user = useAuthStore((state) => state.user);
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (user?.role === 'client') {
    return <Navigate to="/member" replace />;
  }

  return <Navigate to={getDefaultRouteForRole(user?.role)} replace />;
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootEntry />,
  },
  {
    path: '/store/:slug',
    element: <TenantStorefrontPage />,
  },
  {
    path: '/s/:slug',
    element: <StorefrontPage />,
  },
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/auth/mfa',
    element: <MfaVerifyPage />,
  },
  {
    path: '/auth/setup-2fa',
    element: <Setup2faPage />,
  },
  {
    path: '/register',
    element: <RegisterPage />,
  },
  {
    path: '/forgot-password',
    element: <ForgotPasswordPage />,
  },
  {
    path: '/reset-password',
    element: <ResetPasswordPage />,
  },
  {
    path: '/accept-invitation',
    element: <AcceptInvitationPage />,
  },
  {
    // Accesible para usuarios autenticados cuya suscripción venció
    path: '/billing/expired',
    element: (
      <AuthGuard>
        <BillingWallPage />
      </AuthGuard>
    ),
  },
  {
    path: '/reception/checkin',
    element: (
      <AuthGuard roles={['owner', 'admin', 'reception']}>
        <ReceptionCheckInPage />
      </AuthGuard>
    ),
  },
  {
    path: '/',
    element: (
      <AuthGuard roles={['owner', 'admin', 'reception', 'trainer', 'marketing']}>
        <AppLayout />
      </AuthGuard>
    ),
    children: [
      {
        path: 'dashboard',
        element: (
          <AuthGuard roles={['owner', 'admin']}>
            <DashboardPage />
          </AuthGuard>
        ),
      },
      { path: 'classes', element: <ClassesPage /> },
      { path: 'clients', element: <ClientsPage /> },
      { path: 'plans', element: <PlansPage /> },
      { path: 'promo-codes', element: <PromoCodesPage /> },
      {
        path: 'api-clients',
        element: (
          <AuthGuard roles={['owner', 'admin']}>
            <ApiClientsPage />
          </AuthGuard>
        ),
      },
      { path: 'checkin', element: <CheckInPage /> },
      { path: 'programs', element: <ProgramsPage /> },
      { path: 'marketing', element: <MarketingPage /> },
      { path: 'reports', element: <ReportsPage /> },
      { path: 'retention', element: <RetentionPage /> },
      {
        path: 'pos',
        element: (
          <AuthGuard roles={['owner', 'admin', 'reception']}>
            <POSPage />
          </AuthGuard>
        ),
      },
      {
        path: 'inventory',
        element: (
          <AuthGuard roles={['owner', 'admin']}>
            <InventoryPage />
          </AuthGuard>
        ),
      },
      {
        path: 'expenses',
        element: (
          <AuthGuard roles={['owner', 'admin']}>
            <ExpensesPage />
          </AuthGuard>
        ),
      },
      {
        path: 'settings',
        element: (
          <AuthGuard roles={['owner', 'admin']}>
            <SettingsPage />
          </AuthGuard>
        ),
      },
      {
        path: 'subscription',
        element: (
          <AuthGuard roles={['owner']}>
            <SubscriptionPage />
          </AuthGuard>
        ),
      },
      { path: 'support', element: <SupportPage /> },
      {
        path: 'feedback',
        element: (
          <AuthGuard roles={['owner', 'admin', 'reception']}>
            <FeedbackPage />
          </AuthGuard>
        ),
      },
    ],
  },
  {
    path: '/platform',
    element: (
      <AuthGuard roles={['superadmin']}>
        <PlatformLayout />
      </AuthGuard>
    ),
    children: [
      { index: true, element: <Navigate to="dashboard" replace /> },
      { path: 'dashboard', element: <PlatformDashboardPage /> },
      { path: 'tenants', element: <PlatformTenantsPage /> },
      { path: 'plans', element: <PlatformPlansPage /> },
      { path: 'promo-codes', element: <PlatformPromoCodesPage /> },
      { path: 'leads', element: <PlatformLeadsPage /> },
      { path: 'feedback', element: <PlatformFeedbackPage /> },
      { path: 'audit', element: <PlatformAuditLogPage /> },
      { path: 'email-templates', element: <PlatformEmailTemplatesPage /> },
    ],
  },
  {
    path: '/member',
    element: (
      <AuthGuard roles={['client']}>
        <MemberAppPage />
      </AuthGuard>
    ),
  },
  // Páginas legales — públicas, sin auth
  { path: '/terms', element: <TermsPage /> },
  { path: '/privacy', element: <PrivacyPage /> },
  {
    path: '*',
    element: <Navigate to="/login" replace />,
  },
]);
