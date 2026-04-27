import { createBrowserRouter, Navigate } from 'react-router-dom';
import AppLayout from '@/components/layout/AppLayout';
import AuthGuard from '@/components/auth/AuthGuard';
import LoginPage from '@/pages/auth/LoginPage';
import RegisterPage from '@/pages/auth/RegisterPage';
import ForgotPasswordPage from '@/pages/auth/ForgotPasswordPage';
import ResetPasswordPage from '@/pages/auth/ResetPasswordPage';
import AcceptInvitationPage from '@/pages/auth/AcceptInvitationPage';
import BillingWallPage from '@/pages/billing/BillingWallPage';
import DashboardPage from '@/pages/dashboard/DashboardPage';
import ClassesPage from '@/pages/classes/ClassesPage';
import ClientsPage from '@/pages/clients/ClientsPage';
import PlansPage from '@/pages/plans/PlansPage';
import PromoCodesPage from '@/pages/promo/PromoCodesPage';
import ApiClientsPage from '@/pages/developer/ApiClientsPage';
import CheckInPage from '@/pages/checkin/CheckInPage';
import ReceptionCheckInPage from '@/pages/checkin/ReceptionCheckInPage';
import ProgramsPage from '@/pages/programs/ProgramsPage';
import MarketingPage from '@/pages/marketing/MarketingPage';
import ReportsPage from '@/pages/reports/ReportsPage';
import SettingsPage from '@/pages/settings/SettingsPage';
import SubscriptionPage from '@/pages/subscription/SubscriptionPage';
import SupportPage from '@/pages/support/SupportPage';
import FeedbackPage from '@/pages/feedback/FeedbackPage';
import PlatformTenantsPage from '@/pages/platform/PlatformTenantsPage';
import PlatformPlansPage from '@/pages/platform/PlatformPlansPage';
import PlatformLeadsPage from '@/pages/platform/PlatformLeadsPage';
import PlatformFeedbackPage from '@/pages/platform/PlatformFeedbackPage';
import PlatformPromoCodesPage from '@/pages/platform/PlatformPromoCodesPage';
import TenantStorefrontPage from '@/pages/public/TenantStorefrontPage';
import StorefrontPage from '@/pages/storefront/StorefrontPage';
import MemberAppPage from '@/pages/member/MemberAppPage';
import POSPage from '@/pages/pos/POSPage';
import InventoryPage from '@/pages/inventory/InventoryPage';
import ExpensesPage from '@/pages/expenses/ExpensesPage';
import TermsPage from '@/pages/legal/TermsPage';
import PrivacyPage from '@/pages/legal/PrivacyPage';
import { useAuthStore } from '@/stores/authStore';
import { getDefaultRouteForRole, isCustomStorefrontHost } from '@/utils';

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
      {
        path: 'platform/tenants',
        element: (
          <AuthGuard roles={['superadmin']}>
            <PlatformTenantsPage />
          </AuthGuard>
        ),
      },
      {
        path: 'platform/plans',
        element: (
          <AuthGuard roles={['superadmin']}>
            <PlatformPlansPage />
          </AuthGuard>
        ),
      },
      {
        path: 'platform/promo-codes',
        element: (
          <AuthGuard roles={['superadmin']}>
            <PlatformPromoCodesPage />
          </AuthGuard>
        ),
      },
      {
        path: 'platform/leads',
        element: (
          <AuthGuard roles={['superadmin']}>
            <PlatformLeadsPage />
          </AuthGuard>
        ),
      },
      {
        path: 'platform/feedback',
        element: (
          <AuthGuard roles={['superadmin']}>
            <PlatformFeedbackPage />
          </AuthGuard>
        ),
      },
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
