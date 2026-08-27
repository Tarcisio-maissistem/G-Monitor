// Cliente HTTP minimo para o backend.
// Token em memoria; refresh via cookie httpOnly gerido pelo backend.

let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export interface TenantItem {
  id: string;
  name: string;
  cnpj: string | null;
  plan: string;
  subscriptionStatus: string;
  createdAt: string;
  _count: { agents: number; stores: number };
}

export async function listTenants(): Promise<TenantItem[]> {
  const res = await api<{ tenants: TenantItem[] }>('/api/admin/tenants');
  return res.tenants;
}

export async function switchTenant(tenantId: string): Promise<{ token: string; tenant: { id: string; name: string } }> {
  return api(`/api/admin/tenants/${tenantId}/switch`, { method: 'POST' });
}

export interface TenantAccessItem {
  tenantId: string;
  tenantName: string;
  role: string;
}

// Para usuario comum (nao super-admin) com acesso concedido a outras empresas.
export async function listMyTenantAccess(): Promise<TenantAccessItem[]> {
  const res = await api<{ accesses: TenantAccessItem[] }>('/api/users/me/tenant-access');
  return res.accesses;
}

export async function switchMyTenant(tenantId: string): Promise<{ token: string; tenant: { id: string; name: string } }> {
  return api(`/api/users/me/tenant-access/${tenantId}/switch`, { method: 'POST' });
}

export interface RefreshResponse {
  accessToken: string;
  user: { id: string; name: string; email: string; role: string; isSuperAdmin?: boolean };
  tenant: { id: string; name: string };
}

// Troca o cookie httpOnly "refresh" por um access token novo — chamado uma vez ao carregar
// a pagina, pra nao pedir login de novo so por causa de um F5 (pedido do dono 24/08).
// null = sem sessao valida (usuario realmente precisa logar), nao um erro pra mostrar.
export async function refreshSession(): Promise<RefreshResponse | null> {
  try {
    return await api<RefreshResponse>('/api/auth/refresh', { method: 'POST' });
  } catch {
    return null;
  }
}

// Refresh SERIALIZADO (uma unica chamada em voo). O access token vale 15min; quando expira no
// meio do uso, varias queries batem 401 ao mesmo tempo. Se cada uma chamasse /auth/refresh, o
// refresh token (que ROTACIONA a cada uso) seria reusado em paralelo -> o backend detecta reuse
// e derruba a familia inteira (ver memoria sso-relogin-familia-tokens). Entao todas compartilham
// a MESMA promise de refresh. Corrige o "Token invalido ou expirado" que aparecia apos 15min
// (pedido do dono 26/08).
let refreshInFlight: Promise<RefreshResponse | null> | null = null;
function refreshOnce(): Promise<RefreshResponse | null> {
  if (!refreshInFlight) {
    refreshInFlight = refreshSession().finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

export async function api<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

  const res = await fetch(path, { ...init, headers, credentials: 'include' });

  // 401 = access token expirado: renova UMA vez pelo cookie de refresh e repete a chamada.
  // Nao tenta no proprio /auth/refresh (evita recursao) nem numa 2a rodada.
  if (res.status === 401 && !retried && path !== '/api/auth/refresh') {
    const refreshed = await refreshOnce();
    if (refreshed) {
      setAccessToken(refreshed.accessToken);
      return api<T>(path, init, true);
    }
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Erro ${res.status}`);
  }
  return res.json() as Promise<T>;
}
