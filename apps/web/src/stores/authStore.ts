import { create } from 'zustand';
import { setAccessToken } from '../lib/api';

interface AuthState {
  user: { id: string; name: string; email: string; role: string; isSuperAdmin?: boolean } | null;
  token: string | null;
  activeTenantId: string | null;   // tenant sendo visualizado (pode diferir do tenant do user)
  activeTenantName: string | null;
  login(token: string, user: AuthState['user'], tenantId?: string, tenantName?: string): void;
  switchTenant(token: string, tenantId: string, tenantName: string): void;
  logout(): void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  activeTenantId: null,
  activeTenantName: null,
  login(token, user, tenantId, tenantName) {
    setAccessToken(token);
    set({ token, user, activeTenantId: tenantId ?? null, activeTenantName: tenantName ?? null });
  },
  switchTenant(token, tenantId, tenantName) {
    setAccessToken(token);
    set({ token, activeTenantId: tenantId, activeTenantName: tenantName });
  },
  logout() {
    setAccessToken(null);
    set({ token: null, user: null, activeTenantId: null, activeTenantName: null });
  },
}));
