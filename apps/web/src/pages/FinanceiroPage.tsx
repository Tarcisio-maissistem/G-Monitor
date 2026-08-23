import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts';
import { api } from '../lib/api';

interface FinancialData {
  revenue: number;
  salesCount: number;
  receivablesEstimate: number;
  receivablesCount: number;
  paymentBreakdown: {
    dinheiro: number;
    cartao: number;
    pix: number;
    crediario: number;
    outros: number;
  };
}

interface FinancialResponse {
  data: FinancialData;
  meta: { lastSyncedAt: string | null };
}

export function FinanceiroPage(): JSX.Element {
  const today = useMemo(() => new Date(), []);
  const defaultFrom = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  }, [today]);
  const defaultTo = useMemo(() => today.toISOString().slice(0, 10), [today]);

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);

  const financeiro = useQuery({
    queryKey: ['financial', from, to],
    queryFn: () => api<FinancialResponse>(`/api/reports/financial?from=${from}&to=${to}`),
  });

  const d = financeiro.data?.data;

  const breakdownData = d
    ? [
        { name: 'Dinheiro', valor: d.paymentBreakdown.dinheiro, color: '#10b981' },
        { name: 'Cartão', valor: d.paymentBreakdown.cartao, color: '#3b82f6' },
        { name: 'PIX', valor: d.paymentBreakdown.pix, color: '#f59e0b' },
        { name: 'Crediário', valor: d.paymentBreakdown.crediario, color: '#ef4444' },
        { name: 'Outros', valor: d.paymentBreakdown.outros, color: '#8b5cf6' },
      ].filter((x) => x.valor > 0)
    : [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex justify-between items-end gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold">Financeiro</h2>
          <p className="text-sm text-slate-500 mt-1">Panorama financeiro do período: receitas, formas de pagamento e crediário em aberto.</p>
        </div>
        <div className="flex gap-3 items-end">
          <div>
            <label className="block text-xs uppercase text-slate-500 mb-1">De</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="border rounded px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs uppercase text-slate-500 mb-1">Até</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="border rounded px-2 py-1 text-sm"
            />
          </div>
        </div>
      </div>

      {financeiro.isLoading ? (
        <div className="p-12 text-center text-slate-400">Carregando...</div>
      ) : !d ? (
        <div className="bg-white rounded-lg shadow p-12 text-center text-slate-400">Sem dados no período.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard label="Receita Bruta" value={formatBRL(d.revenue)} accent="emerald" subtext={`${d.salesCount} vendas`} />
            <KpiCard
              label="Recebido à vista"
              value={formatBRL(d.paymentBreakdown.dinheiro + d.paymentBreakdown.cartao + d.paymentBreakdown.pix)}
              subtext="Dinheiro + Cartão + PIX"
            />
            <KpiCard
              label="Crediário em aberto"
              value={formatBRL(d.receivablesEstimate)}
              accent="red"
              subtext={`${d.receivablesCount} pagamentos a prazo`}
            />
            <KpiCard
              label="Outros recebimentos"
              value={formatBRL(d.paymentBreakdown.outros)}
              subtext="Formas diversas"
            />
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="font-semibold mb-3">Distribuição das receitas</h3>
              {breakdownData.length === 0 ? (
                <p className="text-slate-400 text-sm py-8 text-center">Sem dados de pagamento no período.</p>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={breakdownData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `R$ ${Math.round(v / 1000)}k`} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(v: number) => formatBRL(v)} />
                    <Bar dataKey="valor" name="Valor">
                      {breakdownData.map((b) => (
                        <Cell key={b.name} fill={b.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="font-semibold mb-3">Indicadores</h3>
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between border-b pb-2">
                  <dt className="text-slate-500">Total de pagamentos recebidos</dt>
                  <dd className="font-medium">
                    {formatBRL(
                      d.paymentBreakdown.dinheiro +
                        d.paymentBreakdown.cartao +
                        d.paymentBreakdown.pix +
                        d.paymentBreakdown.crediario +
                        d.paymentBreakdown.outros,
                    )}
                  </dd>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <dt className="text-slate-500">% recebido à vista</dt>
                  <dd className="font-medium text-emerald-700">{calcPctVista(d).toFixed(1)}%</dd>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <dt className="text-slate-500">% crediário</dt>
                  <dd className="font-medium text-red-700">{calcPctCrediario(d).toFixed(1)}%</dd>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <dt className="text-slate-500">Ticket médio</dt>
                  <dd className="font-medium">{formatBRL(d.salesCount > 0 ? d.revenue / d.salesCount : 0)}</dd>
                </div>
              </dl>

              <div className="mt-4 bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-900">
                <strong>Nota:</strong> contas a pagar e a receber detalhadas (CONTAS_PAGAR / CONTAS_RECEBER do GDOOR) ainda
                não estão sincronizadas. O crediário em aberto aqui é apenas a estimativa baseada nos pagamentos a prazo das vendas do período.
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function calcPctVista(d: FinancialData): number {
  const vista = d.paymentBreakdown.dinheiro + d.paymentBreakdown.cartao + d.paymentBreakdown.pix;
  const total =
    vista + d.paymentBreakdown.crediario + d.paymentBreakdown.outros;
  return total > 0 ? (vista / total) * 100 : 0;
}

function calcPctCrediario(d: FinancialData): number {
  const total =
    d.paymentBreakdown.dinheiro +
    d.paymentBreakdown.cartao +
    d.paymentBreakdown.pix +
    d.paymentBreakdown.crediario +
    d.paymentBreakdown.outros;
  return total > 0 ? (d.paymentBreakdown.crediario / total) * 100 : 0;
}

function KpiCard({
  label,
  value,
  accent,
  subtext,
}: {
  label: string;
  value: string;
  accent?: 'emerald' | 'red';
  subtext?: string;
}): JSX.Element {
  const accentClass = accent === 'emerald' ? 'text-emerald-700' : accent === 'red' ? 'text-red-700' : '';
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="text-xs text-slate-500 uppercase">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${accentClass}`}>{value}</div>
      {subtext && <div className="text-xs text-slate-500 mt-1">{subtext}</div>}
    </div>
  );
}

function formatBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}
