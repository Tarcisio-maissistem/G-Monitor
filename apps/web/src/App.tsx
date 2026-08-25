import { useEffect, useState } from 'react';
import { useAuthStore } from './stores/authStore';
import { useRoute, matchRoute } from './lib/router';
import { refreshSession } from './lib/api';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { ContasPagarPage } from './pages/ContasPagarPage';
import { ContasReceberPage } from './pages/ContasReceberPage';
import { EmpresasPage } from './pages/EmpresasPage';
import { UsuariosPage } from './pages/UsuariosPage';
import { VendasPage } from './pages/VendasPage';
import { ProdutosPage } from './pages/ProdutosPage';
import { ClientesPage } from './pages/ClientesPage';
import { PagamentosPage } from './pages/PagamentosPage';
import { AppShell } from './components/AppShell';
import { ToastContainer } from './components/Toast';
import { ConfirmDialog } from './components/ConfirmDialog';

// Paginas trazidas do trabalho local do Tarcisio (servidor ms-gestor, nunca commitado —
// resgatado 23/08) que ainda nao tem backend correspondente. Aparecem no menu (o AppShell
// ja lista todas) mas mostram um aviso em vez de tela quebrada/em branco.
// Vendas/Produtos/Clientes/Pagamentos saíram daqui em 24/08 — endpoints implementados.
const COMING_SOON: Record<string, string> = {
  '/meta-mensal': 'Meta Mensal',
  '/dav': 'DAV (Pré-vendas)',
  '/financeiro': 'Financeiro',
  '/movimento-caixa': 'Caixa',
  '/caixa-detalhado': 'Caixa Detalhado',
  '/comissao': 'Comissão',
  '/alertas-estoque': 'Alertas de Estoque',
  '/sugestao-compras': 'Sugestão de Compras',
  '/fechamento': 'Fechamento Mensal',
  '/relatorios': 'Relatórios',
};

export function App(): JSX.Element {
  const user = useAuthStore((s) => s.user);
  const login = useAuthStore((s) => s.login);
  const { path } = useRoute();
  const [bootstrapping, setBootstrapping] = useState(true);

  // Ao carregar a pagina (F5, aba nova), troca o cookie httpOnly de refresh por um access
  // token novo antes de decidir mostrar a tela de login — pedido do dono 24/08: "toda vez
  // que atualiza a pagina pede login". O token em si so vive em memoria (nunca em
  // localStorage — evita expor o JWT a XSS); o cookie httpOnly e que sobrevive ao F5.
  useEffect(() => {
    let cancelled = false;
    refreshSession().then((res) => {
      if (cancelled) return;
      if (res) login(res.accessToken, res.user, res.tenant.id, res.tenant.name);
      setBootstrapping(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (bootstrapping) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-400 text-sm">
        Carregando...
      </div>
    );
  }

  return (
    <>
      {!user ? <LoginPage /> : <AppShell>{renderPage(path, user.isSuperAdmin === true)}</AppShell>}
      {/* Montados uma vez aqui — achado 24/08: existiam mas nunca eram renderizados em
          lugar nenhum, entao os toasts de sucesso/erro (Empresas, Usuarios) e as
          confirmacoes de exclusao nunca apareciam de verdade na tela. */}
      <ToastContainer />
      <ConfirmDialog />
    </>
  );
}

function renderPage(path: string, isSuperAdmin: boolean): JSX.Element {
  if (path === '/' || path === '') return <DashboardPage />;
  if (path === '/contas-pagar') return <ContasPagarPage />;
  if (path === '/contas-receber') return <ContasReceberPage />;
  if (path === '/vendas') return <VendasPage />;
  if (path === '/produtos') return <ProdutosPage />;
  if (path === '/clientes') return <ClientesPage />;
  if (path === '/pagamentos') return <PagamentosPage />;

  // Empresas: console de gestao cross-tenant, so pra super-admin.
  if (path === '/empresas') return isSuperAdmin ? <EmpresasPage /> : <ComingSoon label="Empresas" />;
  const usuariosParams = matchRoute('/empresas/:tenantId/usuarios', path);
  if (usuariosParams) return isSuperAdmin ? <UsuariosPage tenantId={usuariosParams.tenantId!} /> : <ComingSoon label="Usuários" />;

  const label = COMING_SOON[path];
  if (label) return <ComingSoon label={label} />;

  return <ComingSoon label="Página" />;
}

function ComingSoon({ label }: { label: string }): JSX.Element {
  return (
    <div className="p-12 text-center text-slate-400">
      <div className="text-4xl mb-3">🚧</div>
      <div className="text-lg font-medium text-slate-600">{label} ainda não está ligado ao backend.</div>
      <div className="text-sm mt-1">A tela já existe, falta a API por trás.</div>
    </div>
  );
}
