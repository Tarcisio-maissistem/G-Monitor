import { useState, type ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useRoute } from '../lib/router';
import { TenantSelector } from './TenantSelector';

interface NavItem {
  label: string;
  path: string;
  icon: string;
  superAdminOnly?: boolean;
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
  { label: 'Empresas', path: '/empresas', icon: '🏢', superAdminOnly: true },
];

export function AppShell({ children }: { children: ReactNode }): JSX.Element {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { path, navigate } = useRoute();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (item: NavItem): boolean => {
    if (item.path === '/') return path === '/' || path === '';
    return path.startsWith(item.path);
  };

  function go(itemPath: string): void {
    navigate(itemPath);
    setMobileOpen(false);
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Botao hamburguer — sidebar fixa vira off-canvas abaixo de lg (celular E tablet ate
          1024px; sidebar de 224px fixa cabia mal em tablet, cortava coluna de valor nas
          tabelas — achado com screenshot real em 768px, nao so leitura de codigo) */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-3 left-3 z-30 bg-slate-900 text-white rounded-lg p-2 shadow-lg"
        aria-label="Abrir menu"
      >
        ☰
      </button>

      {mobileOpen && <div className="lg:hidden fixed inset-0 bg-black/40 z-30" onClick={() => setMobileOpen(false)} />}

      <aside
        className={`w-56 bg-slate-900 text-slate-100 flex flex-col fixed lg:static inset-y-0 left-0 z-40 transition-transform duration-200 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between">
          <h1 className="text-lg font-bold">G-Monitor</h1>
          <button onClick={() => setMobileOpen(false)} className="lg:hidden text-slate-400 hover:text-white text-xl leading-none" aria-label="Fechar menu">
            ×
          </button>
        </div>
        <TenantSelector />
        <nav className="flex-1 py-3 space-y-1 overflow-y-auto">
          {NAV.filter((item) => !item.superAdminOnly || user?.isSuperAdmin).map((item) => (
            <button
              key={item.path}
              onClick={() => go(item.path)}
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

      <main className="flex-1 overflow-x-auto pt-14 lg:pt-0">{children}</main>
    </div>
  );
}
