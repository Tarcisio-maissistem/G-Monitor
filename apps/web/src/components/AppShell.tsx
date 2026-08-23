import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useRoute } from '../lib/router';
import { TenantSelector } from './TenantSelector';

interface NavItem {
  label: string;
  path: string;
  icon: string;
}

const NAV: NavItem[] = [
  { label: 'Dashboard', path: '/', icon: '📊' },
  { label: 'Meta Mensal', path: '/meta-mensal', icon: '🎯' },
  { label: 'Vendas', path: '/vendas', icon: '🛒' },
  { label: 'DAV (Pré-vendas)', path: '/dav', icon: '📝' },
  { label: 'Pagamentos', path: '/pagamentos', icon: '💳' },
  { label: 'Financeiro', path: '/financeiro', icon: '💰' },
  { label: 'A Receber', path: '/contas-receber', icon: '📥' },
  { label: 'A Pagar', path: '/contas-pagar', icon: '📤' },
  { label: 'Caixa', path: '/movimento-caixa', icon: '💼' },
  { label: 'Caixa Detalhado', path: '/caixa-detalhado', icon: '📒' },
  { label: 'Comissão', path: '/comissao', icon: '💎' },
  { label: 'Alertas Estoque', path: '/alertas-estoque', icon: '⚠️' },
  { label: 'Sugestão Compras', path: '/sugestao-compras', icon: '🛍️' },
  { label: 'Fechamento', path: '/fechamento', icon: '📅' },
  { label: 'Relatórios', path: '/relatorios', icon: '📈' },
  { label: 'Produtos', path: '/produtos', icon: '📦' },
  { label: 'Clientes', path: '/clientes', icon: '👥' },
  { label: 'Empresas', path: '/empresas', icon: '🏢' },
];

export function AppShell({ children }: { children: ReactNode }): JSX.Element {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { path, navigate } = useRoute();

  const isActive = (item: NavItem): boolean => {
    if (item.path === '/') return path === '/' || path === '';
    return path.startsWith(item.path);
  };

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="w-56 bg-slate-900 text-slate-100 flex flex-col">
        <div className="px-5 py-4 border-b border-slate-700">
          <h1 className="text-lg font-bold">G-Monitor</h1>
        </div>
        <TenantSelector />
        <nav className="flex-1 py-3 space-y-1">
          {NAV.map((item) => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`w-full text-left px-5 py-2 text-sm transition-colors ${
                isActive(item)
                  ? 'bg-slate-800 text-white border-l-4 border-blue-500'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <span className="mr-2">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="px-5 py-3 border-t border-slate-700 text-xs">
          <div className="text-slate-200 font-medium">{user?.name}</div>
          <div className="text-slate-400 truncate">{user?.email}</div>
          <button
            onClick={logout}
            className="mt-2 text-slate-300 hover:text-white text-xs underline"
          >
            Sair
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-x-auto">{children}</main>
    </div>
  );
}
