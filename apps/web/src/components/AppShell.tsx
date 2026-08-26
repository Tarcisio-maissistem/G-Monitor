import { useState, type ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useRoute } from '../lib/router';
import { TenantSelector } from './TenantSelector';
import { NotificationBell } from './NotificationBell';
import { ThemeToggle } from './ThemeToggle';

interface NavItem {
  label: string;
  path: string;
  icon: string;
  superAdminOnly?: boolean;
}

export const NAV: NavItem[] = [
  { label: 'Dashboard', path: '/', icon: '📊' },
  { label: 'Meta Mensal', path: '/meta-mensal', icon: '🎯' },
  { label: 'Vendas', path: '/vendas', icon: '🛒' },
  { label: 'DAV (Pré-vendas)', path: '/dav', icon: '📝' },
  { label: 'Pagamentos', path: '/pagamentos', icon: '💳' },
  { label: 'Financeiro', path: '/financeiro', icon: '💰' },
  // Fluxo de Caixa e DRE logo apos Financeiro (D18) — rotas entram em App.tsx na Fase 3.
  { label: 'Fluxo de Caixa', path: '/fluxo-caixa', icon: '💵' },
  { label: 'DRE', path: '/dre', icon: '📑' },
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

function isActivePath(item: NavItem, path: string): boolean {
  if (item.path === '/') return path === '/' || path === '';
  return path.startsWith(item.path);
}

// Titulo da rota atual pra top bar do celular. Rota fora do NAV (ex: /empresas/:id/usuarios
// cai em "Empresas" pelo startsWith; rota desconhecida) mostra o nome do app.
export function routeTitle(path: string): string {
  return NAV.find((item) => isActivePath(item, path))?.label ?? 'G-Monitor';
}

// Camadas (z-index) — antes botao e overlay dividiam z-30 e o drawer ficava abaixo dos
// dropdowns. Agora: top bar 40 < overlay 45 < drawer 50 < dropdowns (z-50 dentro da top
// bar/drawer) < modais (FinanceCalendar 50, ConfirmDialog 90) < toast 100.
export function AppShell({ children }: { children: ReactNode }): JSX.Element {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { path, navigate } = useRoute();
  const [mobileOpen, setMobileOpen] = useState(false);

  function go(itemPath: string): void {
    navigate(itemPath);
    setMobileOpen(false);
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Top bar do celular/tablet (abaixo de lg): hamburguer + titulo da rota + empresa +
          sino. Antes so existia um hamburguer flutuante; titulo e seletor de empresa
          ficavam escondidos dentro do drawer. */}
      <header className="lg:hidden fixed top-0 inset-x-0 h-12 z-40 bg-slate-900 text-white flex items-center gap-1 px-2 shadow-md">
        <button
          onClick={() => setMobileOpen(true)}
          className="shrink-0 rounded-lg p-2 hover:bg-slate-800 text-lg leading-none"
          aria-label="Abrir menu"
        >
          ☰
        </button>
        <h1 className="flex-1 min-w-0 truncate text-sm font-semibold">{routeTitle(path)}</h1>
        <TenantSelector compact />
        <ThemeToggle className="text-base" />
        <NotificationBell align="right" />
      </header>

      {mobileOpen && <div className="lg:hidden fixed inset-0 bg-black/40 z-[45]" onClick={() => setMobileOpen(false)} />}

      {/* Sidebar fixa vira off-canvas abaixo de lg (celular E tablet ate 1024px; sidebar de
          224px fixa cabia mal em tablet, cortava coluna de valor nas tabelas — achado com
          screenshot real em 768px). */}
      <aside
        className={`w-56 bg-slate-900 text-slate-100 flex flex-col fixed lg:static inset-y-0 left-0 z-50 transition-transform duration-200 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between">
          <h1 className="text-lg font-bold">G-Monitor</h1>
          <div className="flex items-center gap-1">
            {/* No celular o sino/tema ja estao na top bar — evita duplicar ao abrir o menu */}
            <div className="hidden lg:flex items-center">
              <ThemeToggle />
              <NotificationBell />
            </div>
            <button onClick={() => setMobileOpen(false)} className="lg:hidden text-slate-400 hover:text-white text-xl leading-none" aria-label="Fechar menu">
              ×
            </button>
          </div>
        </div>
        {/* Idem: seletor de empresa completo so no desktop; no celular fica o compacto da top bar */}
        <div className="hidden lg:block">
          <TenantSelector />
        </div>
        <nav className="flex-1 py-3 space-y-1 overflow-y-auto">
          {NAV.filter((item) => !item.superAdminOnly || user?.isSuperAdmin).map((item) => (
            <button
              key={item.path}
              onClick={() => go(item.path)}
              className={`w-full text-left px-5 py-2 text-sm transition-colors ${
                isActivePath(item, path)
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

      {/* pt-12 = altura da top bar. min-w-0 impede o flex-1 de crescer alem da viewport;
          overflow-x-auto segue como rede de seguranca pras 5 tabelas admin sem wrapper
          proprio (onda 4) — a pagina inteira rola em vez de cortar conteudo. */}
      <main className="flex-1 min-w-0 overflow-x-auto pt-12 lg:pt-0">{children}</main>
    </div>
  );
}
