import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';

interface AuthGuardProps {
  children: React.ReactNode;
  roles?: string[];
}

export default function AuthGuard({ children, roles }: AuthGuardProps) {
  const { isAuthenticated, user } = useAuthStore();
  const location = useLocation();

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (roles && roles.length > 0) {
    const hasRole = roles.includes(user.role) || user.role === 'superadmin';
    if (!hasRole) {
      const fallbackPath =
        user.role === 'client'
          ? '/member'
          : user.role === 'superadmin'
            ? '/platform/tenants'
            : '/dashboard';
      return <Navigate to={fallbackPath} replace />;
    }
  }

  return <>{children}</>;
}
