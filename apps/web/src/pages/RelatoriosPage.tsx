import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { api } from '../lib/api';
import { isoDate, currentMonthRange } from '../lib/period';

type Tab = 'abc' | 'comparativo' | 'weekday' | 'margem' | 'operadores';

export function RelatoriosPage(): JSX.Element {
  const [tab, setTab] = useState<Tab>('abc');

  const tabs: Array<{ id: Tab; label: string; icon: string }> = [
    { id: 'abc', label: 'Curva ABC', icon: '📊' },
    { id: 'comparativo', label: 'Comparativo', icon: '⚖️' },
    { id: 'weekday', label: 'Dia da semana', icon: '📅' },
    { id: 'margem', label: 'Margem por produto', icon: '💵' },
    { id: 'operadores', label: 'Ranking operadores', icon: '🏆' },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div>
        <h2 className="text-2xl font-bold">Relatórios</h2>
        <p className="text-sm text-slate-500 mt-1">Análises gerenciais detalhadas. Escolha o relatório abaixo.</p>
      </div>

      <div className="flex flex-wrap gap-2 border-b">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <DateFilter>
        {(from, to) => (
          <>
            {tab === 'abc' && <CurvaAbc from={from} to={to} />}
            {tab === 'comparativo' && <Comparativo from={from} to={to} />}
            {tab === 'weekday' && <DiaDaSemana from={from} to={to} />}
            {tab === 'margem' && <Margem from={from} to={to} />}
            {tab === 'operadores' && <RankingOperadores from={from} to={to} />}
          </>
        )}
      </DateFilter>
    </div>
  );
}

function DateFilter({ children }: { children: (from: string, to: string) => JSX.Element }): JSX.Element {
  const today = useMemo(() => new Date(), []);
  const [from, setFrom] = useState(() => {
    return currentMonthRange(today).from;
  });
  const [to, setTo] = useState(isoDate(today));

  return (
    <>
      <div className="flex gap-3 items-end justify-end">
        <div>
          <label className="block text-xs uppercase text-slate-500 mb-1">De</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border rounded px-2 py-1 text-sm" />
        </div>
        <div>
          <label className="block text-xs uppercase text-slate-500 mb-1">Até</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border rounded px-2 py-1 text-sm" />
        </div>
      </div>
      {children(from, to)}
    </>
  );
}

function CurvaAbc({ from, to }: { from: string; to: string }): JSX.Element {
  interface AbcRow {
    productCode: string | null;
    description: string | null;
    quantity: number;
    value: number;
    accValue: number;
    accPct: number;
    klass: 'A' | 'B' | 'C';
  }
  const { data, isLoading } = useQuery({
    queryKey: ['abc', from, to],
    queryFn: () => api<{ data: { rows: AbcRow[]; grandTotal: number } }>(`/api/reports/abc-products?from=${from}&to=${to}`),
  });

  const rows = data?.data.rows ?? [];
  if (isLoading) return <Loader />;
  if (rows.length === 0) return <Empty msg="Sem dados. Os itens de venda chegam quando o agente sincroniza (v0.2.0)." />;

  const counts = { A: 0, B: 0, C: 0 };
  rows.forEach((r) => counts[r.klass]++);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <Card label="Classe A" sub="80% do faturamento" value={`${counts.A} produtos`} color="text-emerald-700" />
        <Card label="Classe B" sub="15% do faturamento" value={`${counts.B} produtos`} color="text-amber-700" />
        <Card label="Classe C" sub="5% do faturamento" value={`${counts.C} produtos`} color="text-red-700" />
      </div>
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
              <tr>
                <th className="px-3 py-2 text-left">#</th>
                <th className="px-3 py-2 text-left">Código</th>
                <th className="px-3 py-2 text-left">Produto</th>
                <th className="px-3 py-2 text-right">Qtd</th>
                <th className="px-3 py-2 text-right">Valor</th>
                <th className="px-3 py-2 text-right">% acum.</th>
                <th className="px-3 py-2 text-center">Classe</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 100).map((r, i) => (
                <tr key={i} className="border-t hover:bg-slate-50">
                  <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.productCode ?? '-'}</td>
                  <td className="px-3 py-2">{r.description ?? '-'}</td>
                  <td className="px-3 py-2 text-right">{r.quantity.toLocaleString('pt-BR')}</td>
                  <td className="px-3 py-2 text-right font-medium">{formatBRL(r.value)}</td>
                  <td className="px-3 py-2 text-right">{(r.accPct * 100).toFixed(1)}%</td>
                  <td className="px-3 py-2 text-center">
                    <KlassBadge k={r.klass} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > 100 && (
          <div className="p-3 text-center text-xs text-slate-500 border-t bg-slate-50">
            Mostrando 100 de {rows.length}. Refine o período pra ver tudo.
          </div>
        )}
      </div>
    </div>
  );
}

function KlassBadge({ k }: { k: 'A' | 'B' | 'C' }): JSX.Element {
  const map = {
    A: 'bg-emerald-100 text-emerald-800',
    B: 'bg-amber-100 text-amber-800',
    C: 'bg-red-100 text-red-800',
  };
  return <span className={`px-2 py-0.5 rounded text-xs font-bold ${map[k]}`}>{k}</span>;
}

function Comparativo({ from, to }: { from: string; to: string }): JSX.Element {
  interface CmpRes {
    current: { from: string; to: string; sales: number; revenue: number; ticket: number };
    previous: { from: string; to: string; sales: number; revenue: number; ticket: number };
    growth: { sales: number; revenue: number; ticket: number };
  }
  const { data, isLoading } = useQuery({
    queryKey: ['cmp', from, to],
    queryFn: () => api<CmpRes>(`/api/reports/sales-comparison?from=${from}&to=${to}`),
  });

  if (isLoading || !data) return <Loader />;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow p-4 text-sm text-slate-600">
        Comparando <strong>{dateRange(data.current.from, data.current.to)}</strong> com{' '}
        <strong>{dateRange(data.previous.from, data.previous.to)}</strong>.
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <CmpCard label="Vendas" current={data.current.sales.toLocaleString('pt-BR')} previous={data.previous.sales.toLocaleString('pt-BR')} growth={data.growth.sales} />
        <CmpCard label="Faturamento" current={formatBRL(data.current.revenue)} previous={formatBRL(data.previous.revenue)} growth={data.growth.revenue} />
        <CmpCard label="Ticket médio" current={formatBRL(data.current.ticket)} previous={formatBRL(data.previous.ticket)} growth={data.growth.ticket} />
      </div>
    </div>
  );
}

function CmpCard({ label, current, previous, growth }: { label: string; current: string; previous: string; growth: number }): JSX.Element {
  const up = growth > 0;
  const color = up ? 'text-emerald-700' : growth < 0 ? 'text-red-700' : 'text-slate-500';
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className="text-2xl font-bold mt-1">{current}</div>
      <div className="text-xs text-slate-500 mt-1">Anterior: {previous}</div>
      <div className={`text-sm font-medium mt-2 ${color}`}>
        {up ? '▲' : growth < 0 ? '▼' : '−'} {growth >= 0 ? '+' : ''}
        {growth.toFixed(1)}%
      </div>
    </div>
  );
}

function DiaDaSemana({ from, to }: { from: string; to: string }): JSX.Element {
  interface DayRow {
    dia: number;
    label: string;
    diasObservados: number;
    totalQtd: number;
    totalRevenue: number;
    mediaQtdPorDia: number;
    mediaRevenuePorDia: number;
  }
  const { data, isLoading } = useQuery({
    queryKey: ['weekday', from, to],
    queryFn: () => api<{ data: DayRow[] }>(`/api/reports/sales-by-weekday?from=${from}&to=${to}`),
  });

  const rows = data?.data ?? [];
  if (isLoading) return <Loader />;
  if (rows.every((r) => r.totalRevenue === 0)) return <Empty msg="Sem vendas no período." />;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="font-semibold mb-3">Média de faturamento por dia da semana</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `R$ ${Math.round(v / 1000)}k`} />
            <Tooltip
              formatter={(v: number) => formatBRL(v)}
              labelFormatter={(l) => `${l} (média)`}
            />
            <Legend />
            <Bar dataKey="mediaRevenuePorDia" name="Média de faturamento" fill="#3b82f6" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
            <tr>
              <th className="px-3 py-2 text-left">Dia</th>
              <th className="px-3 py-2 text-right">Dias observados</th>
              <th className="px-3 py-2 text-right">Total vendas</th>
              <th className="px-3 py-2 text-right">Total faturamento</th>
              <th className="px-3 py-2 text-right">Média/dia</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.dia} className="border-t">
                <td className="px-3 py-2 font-medium">{r.label}</td>
                <td className="px-3 py-2 text-right">{r.diasObservados}</td>
                <td className="px-3 py-2 text-right">{r.totalQtd.toLocaleString('pt-BR')}</td>
                <td className="px-3 py-2 text-right">{formatBRL(r.totalRevenue)}</td>
                <td className="px-3 py-2 text-right font-medium">{formatBRL(r.mediaRevenuePorDia)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Margem({ from, to }: { from: string; to: string }): JSX.Element {
  interface MgRow {
    productCode: string | null;
    description: string | null;
    qtdVendida: number;
    receita: number;
    custoTotal: number;
    margem: number;
    margemPct: number;
  }
  const { data, isLoading } = useQuery({
    queryKey: ['margem', from, to],
    queryFn: () => api<{ data: MgRow[] }>(`/api/reports/product-margin?from=${from}&to=${to}&limit=100`),
  });

  const rows = data?.data ?? [];
  if (isLoading) return <Loader />;
  if (rows.length === 0)
    return <Empty msg="Sem dados. Margem precisa de itens de venda + custo cadastrado nos produtos." />;

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
            <tr>
              <th className="px-3 py-2 text-left">Código</th>
              <th className="px-3 py-2 text-left">Produto</th>
              <th className="px-3 py-2 text-right">Qtd</th>
              <th className="px-3 py-2 text-right">Receita</th>
              <th className="px-3 py-2 text-right">Custo total</th>
              <th className="px-3 py-2 text-right">Margem R$</th>
              <th className="px-3 py-2 text-right">Margem %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const cls =
                r.margemPct >= 30 ? 'text-emerald-700' : r.margemPct >= 10 ? 'text-amber-700' : 'text-red-700';
              return (
                <tr key={i} className="border-t hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono text-xs">{r.productCode ?? '-'}</td>
                  <td className="px-3 py-2">{r.description ?? '-'}</td>
                  <td className="px-3 py-2 text-right">{r.qtdVendida.toLocaleString('pt-BR')}</td>
                  <td className="px-3 py-2 text-right">{formatBRL(r.receita)}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{formatBRL(r.custoTotal)}</td>
                  <td className={`px-3 py-2 text-right font-medium ${cls}`}>{formatBRL(r.margem)}</td>
                  <td className={`px-3 py-2 text-right font-medium ${cls}`}>{r.margemPct.toFixed(1)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RankingOperadores({ from, to }: { from: string; to: string }): JSX.Element {
  interface OpRow {
    operator: string | null;
    qtd: number;
    value: number;
  }
  const { data, isLoading } = useQuery({
    queryKey: ['operators', from, to],
    queryFn: () =>
      api<{ data: OpRow[] }>(`/api/reports/dashboard/top-operators?from=${from}&to=${to}&limit=50`),
  });

  const rows = data?.data ?? [];
  const totalRevenue = rows.reduce((s, r) => s + r.value, 0);
  if (isLoading) return <Loader />;
  if (rows.length === 0) return <Empty msg="Sem dados de operadores no período." />;

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
            <tr>
              <th className="px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">Operador</th>
              <th className="px-3 py-2 text-right">Vendas</th>
              <th className="px-3 py-2 text-right">Faturamento</th>
              <th className="px-3 py-2 text-right">Ticket médio</th>
              <th className="px-3 py-2 text-right">% do total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.operator ?? i} className="border-t hover:bg-slate-50">
                <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                <td className="px-3 py-2 font-medium">{r.operator ?? '-'}</td>
                <td className="px-3 py-2 text-right">{r.qtd.toLocaleString('pt-BR')}</td>
                <td className="px-3 py-2 text-right font-medium">{formatBRL(r.value)}</td>
                <td className="px-3 py-2 text-right">{formatBRL(r.qtd > 0 ? r.value / r.qtd : 0)}</td>
                <td className="px-3 py-2 text-right text-slate-600">
                  {totalRevenue > 0 ? ((r.value / totalRevenue) * 100).toFixed(1) : '0'}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Loader(): JSX.Element {
  return <div className="bg-white rounded-lg shadow p-12 text-center text-slate-400">Carregando...</div>;
}

function Empty({ msg }: { msg: string }): JSX.Element {
  return <div className="bg-white rounded-lg shadow p-12 text-center text-slate-400">{msg}</div>;
}

function Card({ label, sub, value, color }: { label: string; sub: string; value: string; color?: string }): JSX.Element {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color ?? ''}`}>{value}</div>
      <div className="text-xs text-slate-500 mt-1">{sub}</div>
    </div>
  );
}

function formatBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}

function dateRange(iso1: string, iso2: string): string {
  return `${new Date(iso1).toLocaleDateString('pt-BR')} → ${new Date(iso2).toLocaleDateString('pt-BR')}`;
}
