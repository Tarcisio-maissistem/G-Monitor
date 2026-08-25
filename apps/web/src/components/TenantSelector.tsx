// Seletor de empresa (tenant). Dois modos:
// - super-admin: ve TODAS as empresas (GET /api/admin/tenants), sem limite.
// - usuario comum: so aparece se tiver ao menos 1 concessao de TenantAccess (matriz que
//   precisa ver filiais) — GET /api/users/me/tenant-access. Decisao do dono 23/08: por
//   padrao ninguem alem do super-admin acessa outra empresa; e concessao explicita.
import { useState, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listTenants, switchTenant, listMyTenantAccess, switchMyTenant, type TenantItem, type TenantAccessItem } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import { Spinner } from './Spinner';

interface Option {
  id: string;
  name: string;
  subtitle?: string;
}

export function TenantSelector(): JSX.Element | null {
  const user = useAuthStore((s) => s.user);
  const activeTenantId = useAuthStore((s) => s.activeTenantId);
  const activeTenantName = useAuthStore((s) => s.activeTenantName);
  const doSwitch = useAuthStore((s) => s.switchTenant);
  const queryClient = useQueryClient();
  const isSuperAdmin = user?.isSuperAdmin === true;

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [switching, setSwitching] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Fecha dropdown ao clicar fora
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const adminQuery = useQuery({
    queryKey: ['admin-tenants'],
    queryFn: listTenants,
    enabled: isSuperAdmin,
    staleTime: 30_000,
  });
  const accessQuery = useQuery({
    queryKey: ['my-tenant-access'],
    queryFn: listMyTenantAccess,
    enabled: !isSuperAdmin && !!user,
    staleTime: 30_000,
  });

  const isLoading = isSuperAdmin ? adminQuery.isLoading : accessQuery.isLoading;
  const options: Option[] = isSuperAdmin
    ? (adminQuery.data ?? []).map((t: TenantItem) => ({ id: t.id, name: t.name, subtitle: t.cnpj ?? undefined }))
    : (accessQuery.data ?? []).map((a: TenantAccessItem) => ({ id: a.tenantId, name: a.tenantName }));

  // Usuario comum sem nenhuma concessao: nao mostra seletor (so tem a propria empresa mesmo).
  if (!user) return null;
  if (!isSuperAdmin && options.length === 0) return null;

  const filtered = options.filter((o) => o.name.toLowerCase().includes(search.toLowerCase()) || (o.subtitle ?? '').includes(search));

  const handleSelect = async (id: string) => {
    setOpen(false);
    setSearch('');
    setSwitching(true);
    try {
      const res = isSuperAdmin ? await switchTenant(id) : await switchMyTenant(id);
      doSwitch(res.token, res.tenant.id, res.tenant.name);
      // Invalida todos os reports — recarregam com novo token/tenant
      await queryClient.invalidateQueries();
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => !switching && setOpen((v) => !v)}
        disabled={switching}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-sm text-slate-700 shadow-sm disabled:opacity-70"
      >
        <span className="text-xs text-slate-400">Cliente:</span>
        {switching ? (
          <span className="font-medium flex items-center gap-1.5 text-slate-500">
            <Spinner className="h-3.5 w-3.5" /> Trocando...
          </span>
        ) : (
          <span className="font-medium truncate max-w-[160px]">{activeTenantName ?? '—'}</span>
        )}
        <svg className="w-3 h-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 mt-1 w-72 max-w-[calc(100vw-1.5rem)] bg-white border border-slate-200 rounded-xl shadow-lg z-50">
          <div className="p-2 border-b">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar cliente..."
              className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {isLoading && (
              <li className="px-4 py-2 text-sm text-slate-400 flex items-center gap-2">
                <Spinner className="h-3.5 w-3.5" /> Carregando...
              </li>
            )}
            {!isLoading && filtered.length === 0 && (
              <li className="px-4 py-2 text-sm text-slate-400">Nenhum cliente encontrado</li>
            )}
            {filtered.map((o) => (
              <li key={o.id}>
                <button
                  onClick={() => void handleSelect(o.id)}
                  className={`w-full text-left px-4 py-2 hover:bg-slate-50 ${o.id === activeTenantId ? 'bg-blue-50' : ''}`}
                >
                  <div className="text-sm font-medium text-slate-800">{o.name}</div>
                  {o.subtitle && <div className="text-xs text-slate-400">{o.subtitle}</div>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
