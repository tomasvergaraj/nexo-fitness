import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@/types';
import { queryClient } from '@/lib/queryClient';
import { identifyUser, resetAnalytics, capture } from '@/utils/analytics';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  setAuth: (user: User, accessToken: string, refreshToken: string) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  setUser: (user: User) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,

      setAuth: (user, accessToken, refreshToken) => {
        // Limpiar caché de datos del usuario anterior antes de guardar el nuevo
        queryClient.clear();
        set({ user, accessToken, refreshToken, isAuthenticated: true });
        identifyUser({ id: user.id, email: user.email, role: user.role, tenant_id: user.tenant_id });
        capture('login_success', { role: user.role });
      },

      setTokens: (accessToken, refreshToken) =>
        set({ accessToken, refreshToken }),

      setUser: (user) => set({ user }),

      logout: () => {
        capture('logout');
        resetAnalytics();
        queryClient.clear();
        set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
      },
    }),
    {
      name: 'nexo-auth',
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
