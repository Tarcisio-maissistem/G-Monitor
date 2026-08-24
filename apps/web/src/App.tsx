import { useAuthStore } from './stores/authStore';
import { useRoute, matchRoute } from './lib/router';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { ContasPagarPage } from './pages/ContasPagarPage';
import { ContasReceberPage } from './pages/ContasReceberPage';
import { EmpresasPage } from './pages/EmpresasPage';
import { UsuariosPage } from './pages/UsuariosPage';
import { AppShell } from './components/AppShell';
import { ToastContainer } from './components/Toast';
import { ConfirmDialog } from './components/ConfirmDialog';

// Paginas trazidas do trabalho local do Tarcisio (servidor ms-gestor, nunca commitado —
// resgatado 23/08) que ainda nao tem backend correspondente. Aparecem no menu (o AppShell
// ja lista todas) mas mostram um aviso em vez de tela quebrada/em branco.
const COMING_SOON: Record<string, string> = {
  '/meta-mensal': 'Meta Mensal',
  '/vendas': 'Vendas',
  '/dav': 'DAV (Pré-vendas)',
  '/pagamentos': 'Pagamentos',
  '/financeiro': 'Financeiro',
  '/movimento-caixa': 'Caixa',
  '/caixa-detalhado': 'Caixa Detalhado',
  '/comissao': 'Comissão',
  '/alertas-estoque': 'Alertas de Estoque',
  '/sugestao-compras': 'Sugestão de Compras',
  '/fechamento': 'Fechamento Mensal',
  '/relatorios': 'Relatórios',
  '/produtos': 'Produtos',
  '/clientes': 'Clientes',
};

export function App(): JSX.Element {
  const user = useAuthStore((s) => s.user);
  const { path } = useRoute();

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
