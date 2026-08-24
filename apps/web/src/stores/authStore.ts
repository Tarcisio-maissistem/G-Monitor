import { create } from 'zustand';
import { setAccessToken, api } from '../lib/api';

interface AuthState {
  user: { id: string; name: string; email: string; role: string; isSuperAdmin?: boolean } | null;
  token: string | null;
  activeTenantId: string | null;   // tenant sendo visualizado (pode diferir do tenant do user)
  activeTenantName: string | null;
  login(token: string, user: AuthState['user'], tenantId?: string, tenantName?: string): void;
  switchTenant(token: string, tenantId: string, tenantName: string): void;
  logout(): Promise<void>;
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
  async logout() {
    // Precisa avisar o backend (revoga o refresh token + limpa o cookie httpOnly) —
    // achado 24/08: so limpava o estado local, entao o cookie continuava valido e o
    // auto-login ao recarregar a pagina (refreshSession) logava de volta sozinho.
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setAccessToken(null);
    set({ token: null, user: null, activeTenantId: null, activeTenantName: null });
  },
}));
