import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { api } from '../../lib/api';

interface MonthRow {
  ym: string;
  faturamento: number;
  qtd: number;
  ticket: number;
  clientes: number;
}

interface EvolutionResp {
  periodo: { current: { from: string; to: string }; previous: { from: string; to: string } };
  current: MonthRow[];
  previous: MonthRow[];
  totals: {
    current: { faturamento: number; qtd: number; clientes: number };
    previous: { faturamento: number; qtd: number; clientes: number };
    ticket: { current: number; previous: number };
  };
  growth: { faturamento: number; qtd: number; clientes: number; ticket: number };
}

type Metric = 'faturamento' | 'qtd' | 'ticket' | 'clientes';

const METRIC_LABEL: Record<Metric, string> = {
  faturamento: 'Faturamento',
  qtd: 'Qtd. Vendas',
  ticket: 'Ticket Médio',
  clientes: 'Clientes Únicos',
};

export function VendasPeriodoChart(): JSX.Element {
  const [months, setMonths] = useState(12);
  const [metric, setMetric] = useState<Metric>('faturamento');

  const r = useQuery({
    queryKey: ['sales-evolution', months],
    queryFn: () => api<EvolutionResp>(`/api/reports/dashboard/sales-evolution?months=${months}`),
  });

  const chartData = useMemo(() => {
    if (!r.data) return [];
    return r.data.current.map((cur, i) => {
      const prev = r.data!.previous[i];
      return {
        label: monthLabel(cur.ym),
        atual: cur[metric],
        anterior: prev?.[metric] ?? 0,
      };
    });
  }, [r.data, metric]);

  const totals = r.data?.totals;
  const growth = r.data?.growth;

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <div>
          <h3 className="font-semibold text-lg">Vendas por Período</h3>
          <p className="text-xs text-slate-500">
            Últimos {months} Meses {r.data && `(vs ${dateRangeBR(r.data.periodo.previous.from, r.data.periodo.previous.to)})`}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <select value={months} onChange={(e) => setMonths(parseInt(e.target.value))} className="border rounded px-2 py-1 text-sm">
            <option value={3}>3 meses</option>
            <option value={6}>6 meses</option>
            <option value={12}>12 meses</option>
            <option value={24}>24 meses</option>
          </select>
        </div>
      </div>

      <div className="flex gap-2 border-b mb-3">
        {(Object.keys(METRIC_LABEL) as Metric[]).map((m) => (
          <button
            key={m}
            onClick={() => setMetric(m)}
            className={`px-3 py-1 text-sm border-b-2 ${
              metric === m ? 'border-blue-600 text-blue-700 font-medium' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {METRIC_LABEL[m]}
          </button>
        ))}
      </div>

      {r.isLoading ? (
        <div className="h-64 flex items-center justify-center text-slate-400">Carregando...</div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatAxis(v, metric)} />
              <Tooltip formatter={(v: number) => formatValue(v, metric)} />
              <Legend />
              <Bar dataKey="anterior" name="Período anterior" fill="#cbd5e1" />
              <Line type="monotone" dataKey="atual" name="Atual" stroke="#3b82f6" strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>

          {totals && growth && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3 border-t pt-3">
              <SummaryBox label="Total Faturado" value={formatBRL(totals.current.faturamento)} growth={growth.faturamento} />
              <SummaryBox label="Total Vendas" value={totals.current.qtd.toLocaleString('pt-BR')} growth={growth.qtd} />
              <SummaryBox label="Ticket Médio" value={formatBRL(totals.ticket.current)} growth={growth.ticket} />
              <SummaryBox label="Clientes Únicos" value={totals.current.clientes.toLocaleString('pt-BR')} growth={growth.clientes} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SummaryBox({ label, value, growth }: { label: string; value: string; growth: number }): JSX.Element {
  const positive = growth >= 0;
  return (
    <div className="bg-slate-50 rounded-lg p-3 border">
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
      <div className={`text-xs font-medium mt-1 ${positive ? 'text-emerald-700' : 'text-red-700'}`}>
        {positive ? '▲' : '▼'} {Math.abs(growth).toFixed(1)}% vs anterior
      </div>
    </div>
  );
}

function formatBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}

function formatValue(v: number, metric: Metric): string {
  if (metric === 'faturamento' || metric === 'ticket') return formatBRL(v);
  return v.toLocaleString('pt-BR');
}

function formatAxis(v: number, metric: Metric): string {
  if (metric === 'faturamento') return `R$ ${Math.round(v / 1000)}k`;
  if (metric === 'ticket') return `R$ ${v}`;
  return v.toString();
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${months[parseInt(m!) - 1]}/${y!.slice(2)}`;
}

function dateRangeBR(from: string, to: string): string {
  const d1 = new Date(from), d2 = new Date(to);
  return `${monthLabel(`${d1.getFullYear()}-${String(d1.getMonth() + 1).padStart(2, '0')}`)} - ${monthLabel(`${d2.getFullYear()}-${String(d2.getMonth() + 1).padStart(2, '0')}`)}`;
}
