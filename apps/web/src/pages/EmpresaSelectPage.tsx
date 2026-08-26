import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listTenants, switchTenant, listMyTenantAccess, switchMyTenant } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import { applyCpfOrCnpj } from '../lib/masks';
import { Spinner } from '../components/Spinner';

interface Opt { id: string; name: string; sub?: string | undefined }

// Tela de selecao de estabelecimento apos o login, quando o usuario tem mais de uma empresa
// (pedido do dono 26/08). Uma empresa so -> pula direto pro dashboard.
export function EmpresaSelectPage(): JSX.Element {
  const user = useAuthStore((s) => s.user);
  const doSwitch = useAuthStore((s) => s.switchTenant);
  const clearPick = useAuthStore((s) => s.clearStorePick);
  const isSuper = user?.isSuperAdmin === true;
  const [switching, setSwitching] = useState<string | null>(null);

  const q = useQuery({
    queryKey: isSuper ? ['admin-tenants'] : ['my-tenant-access'],
    queryFn: async (): Promise<Opt[]> =>
      isSuper
        ? (await listTenants()).map((t) => ({ id: t.id, name: t.name, sub: t.cnpj ? applyCpfOrCnpj(t.cnpj) : undefined }))
        : (await listMyTenantAccess()).map((a) => ({ id: a.tenantId, name: a.tenantName })),
    staleTime: 30_000,
  });

  const opts = q.data ?? [];

  // 0 ou 1 empresa: nao faz sentido escolher — segue direto.
  useEffect(() => {
    if (q.isSuccess && opts.length <= 1) clearPick();
  }, [q.isSuccess, opts.length, clearPick]);

  const pick = async (id: string, name: string): Promise<void> => {
    setSwitching(id);
    try {
      const res = isSuper ? await switchTenant(id) : await switchMyTenant(id);
      doSwitch(res.token, res.tenant.id, res.tenant.name ?? name); // switchTenant ja zera promptStorePick
    } finally {
      setSwitching(null);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold gm-brand">G-Monitor</h1>
          <p className="text-slate-500 text-sm mt-1">Olá, {user?.name}. Escolha o estabelecimento:</p>
        </div>

        {q.isLoading ? (
          <div className="flex items-center justify-center gap-2 text-slate-400 py-10"><Spinner /> Carregando empresas...</div>
        ) : (
          <div className="space-y-2">
            {opts.map((o) => (
              <button
                key={o.id}
                onClick={() => void pick(o.id, o.name)}
                disabled={!!switching}
                className="w-full text-left bg-white border border-slate-200 rounded-xl px-4 py-3 hover:bg-slate-50 shadow-sm disabled:opacity-60 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="font-medium text-slate-800 truncate">{o.name}</div>
                  {o.sub && <div className="text-xs text-slate-400">{o.sub}</div>}
                </div>
                {switching === o.id ? <Spinner className="h-4 w-4 shrink-0" /> : <span className="text-slate-300 shrink-0">→</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
