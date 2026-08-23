import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';
import { api } from '../lib/api';

interface PaymentSummary {
  paymentType: string;
  count: number;
  value: number;
  percent: number;
}

interface PaymentsResponse {
  data: PaymentSummary[];
  total: number;
  meta: { lastSyncedAt: string | null };
}

const TYPE_COLORS: Record<string, string> = {
  DINHEIRO: '#10b981',
  CARTAO: '#3b82f6',
  PIX: '#f59e0b',
  CREDIARIO: '#ef4444',
  OUTROS: '#8b5cf6',
};

const TYPE_LABEL: Record<string, string> = {
  DINHEIRO: 'Dinheiro',
  CARTAO: 'Cartão',
  PIX: 'PIX',
  CREDIARIO: 'Crediário',
  OUTROS: 'Outros',
};

export function PagamentosPage(): JSX.Element {
  const today = useMemo(() => new Date(), []);
  const defaultFrom = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  }, [today]);
  const defaultTo = useMemo(() => today.toISOString().slice(0, 10), [today]);

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);

  const qs = `?from=${from}&to=${to}`;
  const payments = useQuery({
    queryKey: ['payments-summary', from, to],
    queryFn: () => api<PaymentsResponse>(`/api/reports/payments-summary${qs}`),
  });

  const data = payments.data?.data ?? [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex justify-between items-end gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold">Pagamentos</h2>
          <p className="text-sm text-slate-500 mt-1">Distribuição das vendas por forma de pagamento.</p>
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

      {payments.isLoading ? (
        <div className="p-12 text-center text-slate-400">Carregando...</div>
      ) : data.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center text-slate-400">
          Nenhum pagamento encontrado no período.
          <span className="block text-xs mt-2">
            Pagamentos aparecem conforme o agente sincroniza. Se acabou de atualizar o agente, aguarde 1-2 minutos.
          </span>
        </div>
      ) : (
        <>
          <div className="grid lg:grid-cols-5 gap-4">
            {data.map((d) => (
              <div key={d.paymentType} className="bg-white rounded-lg shadow p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500 uppercase">{TYPE_LABEL[d.paymentType] ?? d.paymentType}</span>
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: TYPE_COLORS[d.paymentType] ?? '#94a3b8' }}
                  />
                </div>
                <div className="text-xl font-bold mt-1">{formatBRL(d.value)}</div>
                <div className="text-xs text-slate-500 mt-1">
                  {d.count.toLocaleString('pt-BR')} pagamentos · {d.percent.toFixed(1)}%
                </div>
              </div>
            ))}
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="font-semibold mb-3">Distribuição por forma</h3>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={data}
                    dataKey="value"
                    nameKey="paymentType"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    label={(e) => `${TYPE_LABEL[e.paymentType] ?? e.paymentType}: ${e.percent.toFixed(1)}%`}
                  >
                    {data.map((d) => (
                      <Cell key={d.paymentType} fill={TYPE_COLORS[d.paymentType] ?? '#94a3b8'} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatBRL(v)} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="font-semibold mb-3">Valor por forma de pagamento</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="paymentType"
                    tick={{ fontSize: 12 }}
                    tickFormatter={(t) => TYPE_LABEL[t] ?? t}
                  />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `R$ ${Math.round(v / 1000)}k`} />
                  <Tooltip
                    formatter={(v: number) => formatBRL(v)}
                    labelFormatter={(t) => TYPE_LABEL[t] ?? t}
                  />
                  <Legend />
                  <Bar dataKey="value" name="Valor recebido">
                    {data.map((d) => (
                      <Cell key={d.paymentType} fill={TYPE_COLORS[d.paymentType] ?? '#94a3b8'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="font-semibold mb-3">Resumo geral do período</h3>
            <div className="text-3xl font-bold text-emerald-700">{formatBRL(payments.data?.total ?? 0)}</div>
            <p className="text-sm text-slate-500 mt-1">
              Total recebido em {data.reduce((s, d) => s + d.count, 0).toLocaleString('pt-BR')} pagamentos,
              entre {new Date(from).toLocaleDateString('pt-BR')} e {new Date(to).toLocaleDateString('pt-BR')}.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function formatBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}
