import { useEffect, useState } from 'react';
import { useAuthStore } from './stores/authStore';
import { useRoute, matchRoute } from './lib/router';
import { refreshSession } from './lib/api';
import { LoginPage } from './pages/LoginPage';
import { EmpresaSelectPage } from './pages/EmpresaSelectPage';
import { DashboardPage } from './pages/DashboardPage';
import { ContasPagarPage } from './pages/ContasPagarPage';
import { ContasReceberPage } from './pages/ContasReceberPage';
import { EmpresasPage } from './pages/EmpresasPage';
import { UsuariosPage } from './pages/UsuariosPage';
import { ProdutosPage } from './pages/ProdutosPage';
import { ClientesPage } from './pages/ClientesPage';
import { PagamentosPage } from './pages/PagamentosPage';
import { FinanceiroPage } from './pages/FinanceiroPage';
import { MovimentoCaixaPage } from './pages/MovimentoCaixaPage';
import { CaixaDetalhadoPage } from './pages/CaixaDetalhadoPage';
import { ComissaoPage } from './pages/ComissaoPage';
import { EstoqueAlertasPage } from './pages/EstoqueAlertasPage';
import { SugestaoComprasPage } from './pages/SugestaoComprasPage';
import { FechamentoMensalPage } from './pages/FechamentoMensalPage';
import { RelatoriosPage } from './pages/RelatoriosPage';
import { FluxoCaixaPage } from './pages/FluxoCaixaPage';
import { DrePage } from './pages/DrePage';
import { ConciliacaoPage } from './pages/ConciliacaoPage';
import { ConferenciaCaixaPage } from './pages/ConferenciaCaixaPage';
import { AppShell } from './components/AppShell';
import { ToastContainer } from './components/Toast';
import { ConfirmDialog } from './components/ConfirmDialog';

// Paginas trazidas do trabalho local do Tarcisio (servidor ms-gestor, nunca commitado —
// resgatado 23/08) que ainda nao tem backend correspondente. Aparecem no menu (o AppShell
// ja lista todas) mas mostram um aviso em vez de tela quebrada/em branco.
// Vendas/Produtos/Clientes/Pagamentos saíram daqui em 24/08; as outras 9 em 25/08 —
// endpoints implementados. So DAV continua aqui (sem model no schema, sem sync do agente).
const COMING_SOON: Record<string, string> = {
  '/dav': 'DAV (Pré-vendas)',
};

export function App(): JSX.Element {
  const user = useAuthStore((s) => s.user);
  const restoreSession = useAuthStore((s) => s.restoreSession);
  const promptStorePick = useAuthStore((s) => s.promptStorePick);
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
      // restoreSession (nao login): F5 nao dispara a tela de selecao de estabelecimento
      if (res) restoreSession(res.accessToken, res.user, res.tenant.id, res.tenant.name);
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
      {!user ? (
        <LoginPage />
      ) : promptStorePick ? (
        <EmpresaSelectPage />
      ) : (
        <AppShell>{renderPage(path, user.isSuperAdmin === true)}</AppShell>
      )}
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
  if (path === '/produtos') return <ProdutosPage />;
  if (path === '/clientes') return <ClientesPage />;
  if (path === '/pagamentos') return <PagamentosPage />;
  if (path === '/financeiro') return <FinanceiroPage />;
  if (path === '/movimento-caixa') return <MovimentoCaixaPage />;
  if (path === '/caixa-detalhado') return <CaixaDetalhadoPage />;
  if (path === '/comissao') return <ComissaoPage />;
  if (path === '/alertas-estoque') return <EstoqueAlertasPage />;
  if (path === '/sugestao-compras') return <SugestaoComprasPage />;
  if (path === '/fechamento') return <FechamentoMensalPage />;
  if (path === '/relatorios') return <RelatoriosPage />;
  if (path === '/fluxo-caixa') return <FluxoCaixaPage />;
  if (path === '/dre') return <DrePage />;
  if (path === '/conferencia-caixa') return <ConferenciaCaixaPage />;
  if (path === '/conciliacao') return <ConciliacaoPage />;

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
