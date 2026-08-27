import { useState } from 'react';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import { Spinner } from '../components/Spinner';
import { MaskedInput } from '../components/MaskedInput';

interface LoginResponse {
  accessToken: string;
  user: { id: string; name: string; email: string; role: string; isSuperAdmin?: boolean };
  tenant: { id: string; name: string };
}

interface SignupResponse {
  tenantId: string;
  ownerId: string;
  pendingApproval: boolean;
}

export function LoginPage(): JSX.Element {
  const [mode, setMode] = useState<'login' | 'signup' | 'signup-done'>('login');
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      {mode === 'login' && <LoginForm onSignupClick={() => setMode('signup')} />}
      {mode === 'signup' && <SignupForm onBack={() => setMode('login')} onDone={() => setMode('signup-done')} />}
      {mode === 'signup-done' && <SignupDone onBack={() => setMode('login')} />}
    </div>
  );
}

function LoginForm({ onSignupClick }: { onSignupClick(): void }): JSX.Element {
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
      login(res.accessToken, res.user, res.tenant.id, res.tenant.name);
      // Vai pro dashboard. Antes quem levava pra ca era a tela de selecao de empresa; sem ela,
      // a rota continuava em '#/login' e o app renderizava "pagina nao encontrada" logo apos
      // entrar. Sem replace: usar Voltar depois de sair nao te joga de volta pra dentro.
      window.location.hash = '#/';
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
        className="w-full bg-slate-900 text-white rounded p-2 disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {loading && <Spinner />}
        {loading ? 'Entrando...' : 'Entrar'}
      </button>
      <button type="button" onClick={onSignupClick} className="w-full text-sm text-blue-600 hover:underline text-center">
        Cadastrar minha empresa
      </button>
    </form>
  );
}

// Autocadastro pelo login (pedido do dono 24/08): cria a empresa direto, sem precisar do
// admin criar na mao — mas fica pendente de aprovacao ate o Tarcisio autorizar.
function SignupForm({ onBack, onDone }: { onBack(): void; onDone(): void }): JSX.Element {
  const [tenantName, setTenantName] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api<SignupResponse>('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ tenantName, cnpj, name, email, password }),
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'erro');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="w-full max-w-sm bg-white rounded-lg shadow p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Cadastrar empresa</h1>
        <p className="text-xs text-slate-500 mt-1">Depois de cadastrar, um administrador precisa aprovar antes do agente sincronizar.</p>
      </div>
      <input
        type="text"
        placeholder="Nome da empresa"
        value={tenantName}
        onChange={(e) => setTenantName(e.target.value)}
        className="w-full border rounded p-2"
        minLength={2}
        required
      />
      <MaskedInput mask="cnpj" value={cnpj} onChange={setCnpj} className="w-full border rounded p-2" placeholder="CNPJ" />
      <input
        type="text"
        placeholder="Seu nome"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full border rounded p-2"
        minLength={2}
        required
      />
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
        placeholder="Senha (mín. 12 caracteres)"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full border rounded p-2"
        minLength={12}
        required
      />
      {error && <div className="text-red-600 text-sm">{error}</div>}
      <button
        type="submit"
        disabled={loading}
        className="w-full bg-slate-900 text-white rounded p-2 disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {loading && <Spinner />}
        {loading ? 'Cadastrando...' : 'Cadastrar'}
      </button>
      <button type="button" onClick={onBack} className="w-full text-sm text-slate-500 hover:underline text-center">
        Voltar pro login
      </button>
    </form>
  );
}

function SignupDone({ onBack }: { onBack(): void }): JSX.Element {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const wsUrl = origin ? `wss://${window.location.host}/ws/agent` : '';
  return (
    <div className="w-full max-w-md bg-white rounded-lg shadow p-6 space-y-4 text-center">
      <div className="text-4xl">✅</div>
      <h1 className="text-xl font-bold">Cadastro enviado</h1>
      <p className="text-sm text-slate-600">
        Sua empresa foi cadastrada e está aguardando aprovação. Agora baixe o instalador do agente e rode na
        máquina onde fica o Firebird/GDOOR — ele vai pedir o CNPJ que você acabou de cadastrar.
      </p>
      <div className="flex flex-col gap-2">
        <a href="/downloads/gmonitor-agent.exe" className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded p-2 text-sm font-medium">
          Baixar gmonitor-agent.exe
        </a>
        <a href="/downloads/install.ps1" className="w-full border rounded p-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Baixar install.ps1
        </a>
      </div>
      <p className="text-xs text-slate-400">
        No PowerShell (como administrador), na pasta dos dois arquivos:<br />
        <code className="text-[11px]">.\install.ps1 -Cnpj "SEU_CNPJ" -SaasUrl "{origin}" -WsUrl "{wsUrl}" -FdbPath "C:\GDOOR Sistemas\GDOOR PRO\DATAGES.FDB" -FbPassword "masterkey"</code>
      </p>
      <button onClick={onBack} className="text-sm text-blue-600 hover:underline">
        Voltar pro login
      </button>
    </div>
  );
}
