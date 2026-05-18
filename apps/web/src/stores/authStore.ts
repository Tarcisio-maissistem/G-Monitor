import { create } from 'zustand';
import { setAccessToken } from '../lib/api';

interface AuthState {
  user: { id: string; name: string; email: string; role: string } | null;
  token: string | null;
  login(token: string, user: AuthState['user']): void;
  logout(): void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  login(token, user) {
    setAccessToken(token);
    set({ token, user });
  },
  logout() {
    setAccessToken(null);
    set({ token: null, user: null });
  },
}));
