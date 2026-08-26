import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatBRL, formatBrDate, formatCompactBRL, formatInt } from '../lib/masks';
import { currentMonthRange, monthLabel, type DateRange } from '../lib/period';
import type { DashTodayResponse } from '../lib/reports';
import { buildWhatsAppResumo } from '../lib/whatsapp';
import {
  PageContainer, PageHeader, KpiRow, KpiCard, QueryState, CopyWhatsAppButton, DateRangeFilter,
} from '../components/ui';
import { AgentStatus } from '../components/dashboard/AgentStatus';
import { RevenueYoYChart } from '../components/dashboard/RevenueYoYChart';
import { PaymentMethodsChart } from '../components/dashboard/PaymentMethodsChart';
import { PeakHoursChart } from '../components/dashboard/PeakHoursChart';
import { SellerRanking } from '../components/dashboard/SellerRanking';
import { FinancialPosition } from '../components/dashboard/FinancialPosition';

interface SalesSummary {
  data: { quantity: number; total: number; ticket: number; workingDays: number; uniqueCustomers: number };
  meta: { lastSyncedAt: string | null; stalenessSeconds: number | null; agentsOffline: string[] };
}
interface AbcProducts {
  data: { rows: { productCode: string | null; description: string | null; quantity: number; value: number; accPct: number; klass: 'A' | 'B' | 'C' }[]; grandTotal: number };
}
interface SalesByPayment {
  data: { rows: { paymentType: string; total: number; count: number; pct: number }[]; grandTotal: number };
}

const KLASS_COLOR: Record<string, string> = { A: 'text-green-700 bg-green-50', B: 'text-blue-700 bg-blue-50', C: 'text-slate-600 bg-slate-50' };

// Dashboard reorganizado 26/08 (pedido do dono: estava "bagunçado"). Topo = totais do
// período que interessam ao empresário (vendido / recebido / contas); depois pico de
// horário, ranking por VENDEDOR (não caixa), formas de pagamento e curva ABC.
export function DashboardPage(): JSX.Element {
  // Filtro de data (pedido do dono 26/08): abre no mês atual (dia 1..hoje, regra de 23/08),
  // mas o usuário pode escolher qualquer período — todos os blocos abaixo seguem o filtro,
  // exceto "Horário de pico" (sempre últimos 7 dias, decisão do dono).
  const [range, setRange] = useState<DateRange>(() => currentMonthRange());
  const { from, to } = range;
  const qs = `from=${from}&to=${to}`;
  const padrao = currentMonthRange();
  const ehMesAtual = padrao.from === from && padrao.to === to;
  // rótulo do período: "agosto/2026" quando é o mês atual, senão "01/08 a 15/08"
  const mesLabel = ehMesAtual ? monthLabel() : `${formatBrDate(from)} a ${formatBrDate(to)}`;

  const today = useQuery({ queryKey: ['dash-today', from, to], queryFn: () => api<DashTodayResponse>(`/api/reports/dashboard/today?${qs}`) });
  const summary = useQuery({ queryKey: ['sales-summary', from, to], queryFn: () => api<SalesSummary>(`/api/reports/sales-summary?${qs}`) });
  const payments = useQuery({ queryKey: ['sales-by-payment', from, to], queryFn: () => api<SalesByPayment>(`/api/reports/sales-by-payment?${qs}`) });
  const abc = useQuery({ queryKey: ['abc-products', from, to], queryFn: () => api<AbcProducts>(`/api/reports/abc-products?${qs}`) });

  const t = today.data;
  const s = summary.data?.data;

  const whatsapp = buildWhatsAppResumo({
    titulo: `Resumo de ${mesLabel}`,
    emoji: '📊',
    linhas: [
      { label: '💰 Vendido', value: t?.vendido.total ?? 0, bold: true },
      { label: '🧾 Recebido em caixa', value: t?.recebidoCaixa.total ?? 0 },
      { label: '📥 Contas recebidas', value: t?.contasRecebidas.total ?? 0 },
      { label: '📤 Contas pagas', value: t?.contasPagas.total ?? 0 },
      { label: '🛒 Vendas', value: s ? formatInt(s.quantity) : '0' },
      { label: '🎫 Ticket médio', value: s?.ticket ?? 0 },
    ],
  });

  return (
    <PageContainer>
      <PageHeader
        title={`Resumo de ${mesLabel}`}
        subtitle="Os números do período — vendas, caixa e contas."
        actions={<CopyWhatsAppButton text={whatsapp} disabled={!t} />}
      />
      <DateRangeFilter value={range} onChange={setRange} />

      {/* Status do agente: última sincronização + botão Atualizar (no lugar do alerta seco
          de "agente offline"). Detalhes de caixa ficam na tela de Fluxo de Caixa. */}
      <AgentStatus meta={today.data?.meta} />
      {t && t.nfceSemPv.count > 0 && (
        <div className="bg-amber-50 border border-amber-300 text-amber-900 px-4 py-2.5 rounded-lg text-sm">
          ⚠ {t.nfceSemPv.count} NFC-e emitida{t.nfceSemPv.count > 1 ? 's' : ''} direto no caixa, sem passar pela pré-venda ({formatBRL(t.nfceSemPv.total)}). Já está no faturamento — mas não deveria acontecer.
        </div>
      )}

      {/* Totais do período — o que o dono pediu em primeiro plano */}
      <QueryState query={today}>
        <KpiRow cols={4}>
          <KpiCard label="Vendido" value={formatCompactBRL(t?.vendido.total ?? 0)} tone="blue" highlight sub={`${formatInt(t?.vendido.count ?? 0)} vendas · ${formatBRL(t?.vendido.total ?? 0)}`} />
          <KpiCard label="Recebido em caixa" value={formatCompactBRL(t?.recebidoCaixa.total ?? 0)} tone="emerald" sub={formatBRL(t?.recebidoCaixa.total ?? 0)} />
          <KpiCard label="Contas recebidas" value={formatCompactBRL(t?.contasRecebidas.total ?? 0)} tone="emerald" sub={`${formatInt(t?.contasRecebidas.count ?? 0)} baixas`} />
          <KpiCard label="Contas pagas" value={formatCompactBRL(t?.contasPagas.total ?? 0)} tone="red" sub={`${formatInt(t?.contasPagas.count ?? 0)} baixas`} />
        </KpiRow>
      </QueryState>

      {/* linha secundária: métricas de venda */}
      {s && s.quantity > 0 && (
        <KpiRow cols={3}>
          <KpiCard label="Ticket médio" value={formatBRL(s.ticket)} compact />
          <KpiCard label="Dias com venda" value={formatInt(s.workingDays)} compact />
          <KpiCard label="Clientes únicos" value={formatInt(s.uniqueCustomers)} compact />
        </KpiRow>
      )}

      {/* Financeiro com previsibilidade (Parte 3 do doc do dono) */}
      <FinancialPosition from={from} to={to} />

      <RevenueYoYChart />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PeakHoursChart />
        <SellerRanking from={from} to={to} />
      </div>

      {/* Formas de pagamento: lista + pizza */}
      <section className="bg-white rounded-xl shadow-sm border p-5">
        <h3 className="font-semibold text-slate-700 mb-4">Formas de Pagamento</h3>
        <QueryState query={payments} empty={payments.data && payments.data.data.rows.length === 0 ? `Nenhum pagamento em ${mesLabel}.` : undefined}>
          {payments.data && payments.data.data.rows.length > 0 && (
            <div className="grid sm:grid-cols-2 gap-4 items-center">
              <div className="space-y-2">
                {payments.data.data.rows.slice(0, 6).map((r) => (
                  <div key={r.paymentType} className="flex items-center gap-2">
                    <span className="text-sm text-slate-600 flex-1 min-w-0 truncate">{r.paymentType}</span>
                    <div className="w-16 sm:w-24 bg-slate-100 rounded-full h-2 shrink-0">
                      <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${(r.pct * 100).toFixed(1)}%` }} />
                    </div>
                    <span className="text-sm font-medium text-slate-700 w-20 text-right shrink-0">{formatBRL(r.total)}</span>
                  </div>
                ))}
                <div className="pt-2 border-t text-sm font-semibold text-slate-700 flex justify-between">
                  <span>Total</span><span>{formatBRL(payments.data.data.grandTotal)}</span>
                </div>
              </div>
              <PaymentMethodsChart rows={payments.data.data.rows} />
            </div>
          )}
        </QueryState>
      </section>

      {/* Curva ABC */}
      <section className="bg-white rounded-xl shadow-sm border p-5">
        <h3 className="font-semibold text-slate-700 mb-4">Curva ABC — Top 20 Produtos</h3>
        <QueryState query={abc} empty={abc.data && abc.data.data.rows.length === 0 ? `Nenhuma venda em ${mesLabel}.` : undefined}>
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
                {(abc.data?.data.rows ?? []).slice(0, 20).map((r, i) => (
                  <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="py-2 pr-4 text-slate-700 max-w-xs truncate">{r.description ?? r.productCode ?? '—'}</td>
                    <td className="py-2 text-right text-slate-600">{formatInt(r.quantity)}</td>
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
        </QueryState>
      </section>
    </PageContainer>
  );
}
