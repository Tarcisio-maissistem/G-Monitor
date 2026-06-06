// Seletor de tenant para super-admin — visivel apenas quando isSuperAdmin=true.
import { useState, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listTenants, switchTenant } from '../lib/api';
import { useAuthStore } from '../stores/authStore';

export function TenantSelector(): JSX.Element | null {
  const user = useAuthStore((s) => s.user);
  const activeTenantId = useAuthStore((s) => s.activeTenantId);
  const activeTenantName = useAuthStore((s) => s.activeTenantName);
  const doSwitch = useAuthStore((s) => s.switchTenant);
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  // Fecha dropdown ao clicar fora
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-tenants'],
    queryFn: listTenants,
    enabled: user?.isSuperAdmin === true,
    staleTime: 30_000,
  });

  if (!user?.isSuperAdmin) return null;

  const filtered = (data ?? []).filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    (t.cnpj ?? '').includes(search),
  );

  const handleSelect = async (id: string, _name: string) => {
    setOpen(false);
    setSearch('');
    const res = await switchTenant(id);
    doSwitch(res.token, res.tenant.id, res.tenant.name);
    // Invalida todos os reports — recarregam com novo token/tenant
    await queryClient.invalidateQueries();
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-sm text-slate-700 shadow-sm"
      >
        <span className="text-xs text-slate-400">Cliente:</span>
        <span className="font-medium truncate max-w-[160px]">{activeTenantName ?? '—'}</span>
        <svg className="w-3 h-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-72 bg-white border border-slate-200 rounded-xl shadow-lg z-50">
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
            {isLoading && <li className="px-4 py-2 text-sm text-slate-400">Carregando...</li>}
            {!isLoading && filtered.length === 0 && (
              <li className="px-4 py-2 text-sm text-slate-400">Nenhum cliente encontrado</li>
            )}
            {filtered.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => void handleSelect(t.id, t.name)}
                  className={`w-full text-left px-4 py-2 hover:bg-slate-50 flex items-center justify-between ${
                    t.id === activeTenantId ? 'bg-blue-50' : ''
                  }`}
                >
                  <div>
                    <div className="text-sm font-medium text-slate-800">{t.name}</div>
                    {t.cnpj && <div className="text-xs text-slate-400">{t.cnpj}</div>}
                  </div>
                  <div className="flex flex-col items-end gap-0.5">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                      t.subscriptionStatus === 'active' || t.subscriptionStatus === 'trialing'
                        ? 'bg-green-50 text-green-700'
                        : 'bg-red-50 text-red-700'
                    }`}>
                      {t.subscriptionStatus}
                    </span>
                    <span className="text-xs text-slate-400">{t._count.agents} ag.</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
