import { createBrowserRouter, Navigate } from 'react-router-dom';
import AppLayout from '@/components/layout/AppLayout';
import AuthGuard from '@/components/auth/AuthGuard';
import LoginPage from '@/pages/auth/LoginPage';
import RegisterPage from '@/pages/auth/RegisterPage';
import DashboardPage from '@/pages/dashboard/DashboardPage';
import ClassesPage from '@/pages/classes/ClassesPage';
import ClientsPage from '@/pages/clients/ClientsPage';
import PlansPage from '@/pages/plans/PlansPage';
import CheckInPage from '@/pages/checkin/CheckInPage';
import ProgramsPage from '@/pages/programs/ProgramsPage';
import MarketingPage from '@/pages/marketing/MarketingPage';
import ReportsPage from '@/pages/reports/ReportsPage';
import SettingsPage from '@/pages/settings/SettingsPage';
import SupportPage from '@/pages/support/SupportPage';
import PlatformTenantsPage from '@/pages/platform/PlatformTenantsPage';
import PlatformPlansPage from '@/pages/platform/PlatformPlansPage';
import PlatformLeadsPage from '@/pages/platform/PlatformLeadsPage';
import PublicLandingPage from '@/pages/public/PublicLandingPage';
import TenantStorefrontPage from '@/pages/public/TenantStorefrontPage';
import { useAuthStore } from '@/stores/authStore';

function HomeRedirect() {
  const user = useAuthStore((state) => state.user);
  return <Navigate to={user?.role === 'superadmin' ? '/platform/tenants' : '/dashboard'} replace />;
}

export const router = createBrowserRouter([
  {
    path: '/site',
    element: <PublicLandingPage />,
  },
  {
    path: '/store/:slug',
    element: <TenantStorefrontPage />,
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
    path: '/',
    element: (
      <AuthGuard>
        <AppLayout />
      </AuthGuard>
    ),
    children: [
      { index: true, element: <HomeRedirect /> },
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'classes', element: <ClassesPage /> },
      { path: 'clients', element: <ClientsPage /> },
      { path: 'plans', element: <PlansPage /> },
      { path: 'checkin', element: <CheckInPage /> },
      { path: 'programs', element: <ProgramsPage /> },
      { path: 'marketing', element: <MarketingPage /> },
      { path: 'reports', element: <ReportsPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'support', element: <SupportPage /> },
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
        path: 'platform/leads',
        element: (
          <AuthGuard roles={['superadmin']}>
            <PlatformLeadsPage />
          </AuthGuard>
        ),
      },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/login" replace />,
  },
]);
