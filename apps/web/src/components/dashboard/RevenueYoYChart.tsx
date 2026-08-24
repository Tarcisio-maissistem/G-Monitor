import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { api } from '../../lib/api';
import { Spinner } from '../Spinner';

interface RevenueBucket {
  label: string;
  current: number;
  previous: number;
}

interface RevenueComparisonResp {
  data: {
    granularity: 'annual' | 'semiannual' | 'monthly';
    buckets: RevenueBucket[];
    totals: { current: number; previous: number; growthPct: number };
  };
}

type Granularity = 'annual' | 'semiannual' | 'monthly';

const GRANULARITY_LABEL: Record<Granularity, string> = {
  annual: 'Anual',
  semiannual: 'Semestral',
  monthly: 'Mensal (semanas)',
};

// Faturamento bruto sempre comparado com o MESMO periodo do ano passado (nao periodo
// anterior rolante) — pedido do dono 24/08. Mensal quebra o mes corrente em semanas.
export function RevenueYoYChart(): JSX.Element {
  const [granularity, setGranularity] = useState<Granularity>('annual');

  const r = useQuery({
    queryKey: ['revenue-comparison', granularity],
    queryFn: () => api<RevenueComparisonResp>(`/api/reports/dashboard/revenue-comparison?granularity=${granularity}`),
  });

  const totals = r.data?.data.totals;
  const positive = (totals?.growthPct ?? 0) >= 0;

  return (
    <section className="bg-white rounded-xl shadow-sm border p-5">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <h3 className="font-semibold text-slate-700">Faturamento Bruto vs Ano Passado</h3>
          <p className="text-xs text-slate-500">Comparado sempre com o mesmo período do ano anterior</p>
        </div>
        <div className="flex gap-1 border rounded-lg p-0.5 bg-slate-50">
          {(Object.keys(GRANULARITY_LABEL) as Granularity[]).map((g) => (
            <button
              key={g}
              onClick={() => setGranularity(g)}
              className={`px-3 py-1 text-xs font-medium rounded-md ${
                granularity === g ? 'bg-white shadow-sm text-blue-700' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {GRANULARITY_LABEL[g]}
            </button>
          ))}
        </div>
      </div>

      {r.isLoading && (
        <div className="h-64 flex items-center justify-center text-slate-400 text-sm gap-2">
          <Spinner className="h-3.5 w-3.5" /> Carregando...
        </div>
      )}
      {r.error && <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded p-3">{(r.error as Error).message}</div>}

      {r.data && (
        <>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={r.data.data.buckets}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `R$ ${Math.round(v / 1000)}k`} />
              <Tooltip formatter={(v: number) => formatBRL(v)} />
              <Legend />
              <Bar dataKey="previous" name="Ano passado" fill="#cbd5e1" radius={[3, 3, 0, 0]} />
              <Bar dataKey="current" name="Este ano" fill="#3b82f6" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>

          {totals && (
            <div className="grid grid-cols-3 gap-3 mt-3 border-t pt-3">
              <div className="bg-slate-50 rounded-lg p-3 border">
                <div className="text-xs uppercase text-slate-500">Este ano</div>
                <div className="text-lg font-bold mt-1 text-slate-800">{formatBRL(totals.current)}</div>
              </div>
              <div className="bg-slate-50 rounded-lg p-3 border">
                <div className="text-xs uppercase text-slate-500">Ano passado</div>
                <div className="text-lg font-bold mt-1 text-slate-800">{formatBRL(totals.previous)}</div>
              </div>
              <div className="bg-slate-50 rounded-lg p-3 border">
                <div className="text-xs uppercase text-slate-500">Variação</div>
                <div className={`text-lg font-bold mt-1 ${positive ? 'text-emerald-700' : 'text-red-700'}`}>
                  {positive ? '▲' : '▼'} {Math.abs(totals.growthPct).toFixed(1)}%
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function formatBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}
