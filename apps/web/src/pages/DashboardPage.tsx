import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

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

interface AbcProducts {
  data: {
    rows: { productCode: string | null; description: string | null; quantity: number; value: number; accPct: number; klass: 'A' | 'B' | 'C' }[];
    grandTotal: number;
  };
  meta: SalesSummary['meta'];
}

interface SalesByPayment {
  data: {
    rows: { paymentType: string; total: number; count: number; pct: number }[];
    grandTotal: number;
  };
  meta: SalesSummary['meta'];
}

interface OperatorCommission {
  data: {
    rows: { operator: string; count: number; total: number; pct: number }[];
    grandTotal: number;
  };
  meta: SalesSummary['meta'];
}

const KLASS_COLOR: Record<string, string> = { A: 'text-green-700 bg-green-50', B: 'text-blue-700 bg-blue-50', C: 'text-slate-600 bg-slate-50' };

// Header/logout/seletor de empresa agora ficam no AppShell (sidebar). Esta pagina e so
// o conteudo da rota "/" — resumo geral de vendas.
export function DashboardPage(): JSX.Element {
  // Padrao: mes atual, do dia 1 ate hoje (nao "ultimos 30 dias" — pedido do dono 23/08).
  const today = new Date();
  const from = new Date(Date.UTC(today.getFullYear(), today.getMonth(), 1)).toISOString().slice(0, 10);
  const to = today.toISOString().slice(0, 10);
  const qs = `from=${from}&to=${to}`;
  const mesAtualLabel = today.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  const summary = useQuery({ queryKey: ['sales-summary', from, to], queryFn: () => api<SalesSummary>(`/api/reports/sales-summary?${qs}`) });
  const abc = useQuery({ queryKey: ['abc-products', from, to], queryFn: () => api<AbcProducts>(`/api/reports/abc-products?${qs}`) });
  const payments = useQuery({ queryKey: ['sales-by-payment', from, to], queryFn: () => api<SalesByPayment>(`/api/reports/sales-by-payment?${qs}`) });
  const operators = useQuery({ queryKey: ['operator-commission', from, to], queryFn: () => api<OperatorCommission>(`/api/reports/operator-commission?${qs}`) });

  const staleness = summary.data?.meta.stalenessSeconds;
  const agentsOffline = summary.data?.meta.agentsOffline ?? [];

  return (
    <div className="p-3 sm:p-6 space-y-6 max-w-7xl mx-auto">
      {agentsOffline.length > 0 && (
        <div className="bg-red-50 border border-red-300 text-red-800 px-4 py-3 rounded-lg text-sm">
          ⚠ {agentsOffline.length} agente{agentsOffline.length > 1 ? 's' : ''} offline.
        </div>
      )}
      {staleness && staleness > 300 && (
        <div className="bg-amber-50 border border-amber-300 text-amber-900 px-4 py-3 rounded-lg text-sm">
          ⚠ Dados sincronizados há {Math.round(staleness / 60)} min — pode haver defasagem.
        </div>
      )}

      {/* KPIs */}
      <section>
        <h2 className="text-lg font-semibold text-slate-700 mb-3">Resumo de {mesAtualLabel}</h2>
        {summary.isLoading && <div className="text-slate-400 text-sm">Carregando...</div>}
        {summary.error && <ErrorBox msg={(summary.error as Error).message} />}
        {summary.data && (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <KpiCard label="Vendas" value={summary.data.data.quantity.toLocaleString('pt-BR')} />
            <KpiCard label="Faturamento" value={formatBRL(summary.data.data.total)} highlight />
            <KpiCard label="Ticket Médio" value={formatBRL(summary.data.data.ticket)} />
            <KpiCard label="Dias Úteis" value={summary.data.data.workingDays.toString()} />
            <KpiCard label="Clientes Únicos" value={summary.data.data.uniqueCustomers.toLocaleString('pt-BR')} />
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Formas de pagamento */}
        <section className="bg-white rounded-xl shadow-sm border p-5">
          <h3 className="font-semibold text-slate-700 mb-4">Formas de Pagamento</h3>
          {payments.isLoading && <div className="text-slate-400 text-sm">Carregando...</div>}
          {payments.error && <ErrorBox msg={(payments.error as Error).message} />}
          {payments.data && (
            <div className="space-y-2">
              {payments.data.data.rows.slice(0, 6).map((r) => (
                <div key={r.paymentType} className="flex items-center gap-2">
                  <span className="text-sm text-slate-600 w-32 truncate">{r.paymentType}</span>
                  <div className="flex-1 bg-slate-100 rounded-full h-2">
                    <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${(r.pct * 100).toFixed(1)}%` }} />
                  </div>
                  <span className="text-sm font-medium text-slate-700 w-24 text-right">{formatBRL(r.total)}</span>
                  <span className="text-xs text-slate-400 w-10 text-right">{(r.pct * 100).toFixed(0)}%</span>
                </div>
              ))}
              <div className="pt-2 border-t text-sm font-semibold text-slate-700 flex justify-between">
                <span>Total</span>
                <span>{formatBRL(payments.data.data.grandTotal)}</span>
              </div>
            </div>
          )}
        </section>

        {/* Operadores */}
        <section className="bg-white rounded-xl shadow-sm border p-5">
          <h3 className="font-semibold text-slate-700 mb-4">Ranking de Operadores</h3>
          {operators.isLoading && <div className="text-slate-400 text-sm">Carregando...</div>}
          {operators.error && <ErrorBox msg={(operators.error as Error).message} />}
          {operators.data && (
            <div className="space-y-2">
              {operators.data.data.rows.slice(0, 6).map((r, i) => (
                <div key={r.operator} className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 w-4">{i + 1}</span>
                  <span className="text-sm text-slate-600 flex-1 truncate">{r.operator}</span>
                  <span className="text-xs text-slate-400">{r.count} vend.</span>
                  <span className="text-sm font-medium text-slate-700 w-28 text-right">{formatBRL(r.total)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Curva ABC */}
      <section className="bg-white rounded-xl shadow-sm border p-5">
        <h3 className="font-semibold text-slate-700 mb-4">Curva ABC — Top 20 Produtos</h3>
        {abc.isLoading && <div className="text-slate-400 text-sm">Carregando...</div>}
        {abc.error && <ErrorBox msg={(abc.error as Error).message} />}
        {abc.data && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 border-b">
                  <th className="text-left pb-2 font-medium">Produto</th>
                  <th className="text-right pb-2 font-medium">Qtd</th>
                  <th className="text-right pb-2 font-medium">Valor</th>
                  <th className="text-right pb-2 font-medium">% Acum.</th>
                  <th className="text-center pb-2 font-medium">Classe</th>
                </tr>
              </thead>
              <tbody>
                {abc.data.data.rows.slice(0, 20).map((r, i) => (
                  <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="py-2 pr-4 text-slate-700 max-w-xs truncate">{r.description ?? r.productCode ?? '—'}</td>
                    <td className="py-2 text-right text-slate-600">{Number(r.quantity).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</td>
                    <td className="py-2 text-right font-medium text-slate-800">{formatBRL(r.value)}</td>
                    <td className="py-2 text-right text-slate-500">{(r.accPct * 100).toFixed(1)}%</td>
                    <td className="py-2 text-center">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${KLASS_COLOR[r.klass] ?? ''}`}>{r.klass}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function KpiCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }): JSX.Element {
  return (
    <div className="bg-white rounded-xl shadow-sm border p-4">
      <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">{label}</div>
      <div className={`text-2xl font-bold ${highlight ? 'text-blue-700' : 'text-slate-800'}`}>{value}</div>
    </div>
  );
}

function ErrorBox({ msg }: { msg: string }): JSX.Element {
  return <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded p-3">{msg}</div>;
}

function formatBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}
