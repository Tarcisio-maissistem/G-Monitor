import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/authStore';

interface SalesSummary {
  data: {
    quantity: number;
    total: number;
    ticket: number;
    workingDays: number;
    uniqueCustomers: number;
  };
  meta: { lastSyncedAt: string | null; stalenessSeconds: number | null; agentsOffline: string[] };
}

export function DashboardPage(): JSX.Element {
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);

  const summary = useQuery({
    queryKey: ['sales-summary'],
    queryFn: () => api<SalesSummary>('/api/reports/sales-summary'),
  });

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b px-6 py-3 flex justify-between items-center">
        <h1 className="text-xl font-bold">G-Monitor</h1>
        <div className="text-sm">
          <span className="mr-4">{user?.name}</span>
          <button onClick={logout} className="text-slate-600 hover:underline">
            Sair
          </button>
        </div>
      </header>

      <main className="p-6 space-y-6 max-w-6xl mx-auto">
        <h2 className="text-2xl font-bold">Dashboard</h2>

        {summary.data?.meta.stalenessSeconds && summary.data.meta.stalenessSeconds > 300 && (
          <div className="bg-amber-100 border border-amber-300 text-amber-900 p-3 rounded">
            Dados sincronizados ha {Math.round(summary.data.meta.stalenessSeconds / 60)} min. Pode haver defasagem.
          </div>
        )}

        {summary.isLoading && <div>Carregando...</div>}
        {summary.error && <div className="text-red-600">Erro: {(summary.error as Error).message}</div>}

        {summary.data && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card label="Vendas" value={summary.data.data.quantity.toString()} />
            <Card label="Faturamento" value={formatBRL(summary.data.data.total)} />
            <Card label="Ticket Medio" value={formatBRL(summary.data.data.ticket)} />
            <Card label="Clientes Unicos" value={summary.data.data.uniqueCustomers.toString()} />
          </div>
        )}
      </main>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="text-xs text-slate-500 uppercase">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}

function formatBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}
