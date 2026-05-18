import { useState } from 'react';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/authStore';

interface LoginResponse {
  accessToken: string;
  user: { id: string; name: string; email: string; role: string };
}

export function LoginPage(): JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needs2fa, setNeeds2fa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const login = useAuthStore((s) => s.login);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api<LoginResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, ...(totp ? { totp } : {}) }),
      });
      login(res.accessToken, res.user);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'erro';
      if (msg === '2fa_required') {
        setNeeds2fa(true);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm bg-white rounded-lg shadow p-6 space-y-4">
        <h1 className="text-2xl font-bold">G-Monitor</h1>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full border rounded p-2"
          required
        />
        <input
          type="password"
          placeholder="Senha"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border rounded p-2"
          required
        />
        {needs2fa && (
          <input
            type="text"
            placeholder="Codigo 2FA"
            value={totp}
            onChange={(e) => setTotp(e.target.value)}
            className="w-full border rounded p-2"
            maxLength={6}
          />
        )}
        {error && <div className="text-red-600 text-sm">{error}</div>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-slate-900 text-white rounded p-2 disabled:opacity-50"
        >
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
