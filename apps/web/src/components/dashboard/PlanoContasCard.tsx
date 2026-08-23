import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { api } from '../../lib/api';

interface PlanoResp {
  data: Array<{ label: string; value: number; percent: number }>;
  total: number;
  range: 'month' | 'semester' | 'year';
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1', '#94a3b8'];

export function PlanoContasCard(): JSX.Element {
  const [range, setRange] = useState<'month' | 'semester' | 'year'>('month');

  const r = useQuery({
    queryKey: ['plano-contas', range],
    queryFn: () => api<PlanoResp>(`/api/reports/dashboard/plano-contas?range=${range}`),
  });

  const data = r.data?.data ?? [];
  const total = r.data?.total ?? 0;

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
        <h3 className="font-semibold text-lg">Plano de Contas</h3>
        <div className="flex gap-1">
          {(['month', 'semester', 'year'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1 text-xs rounded ${range === r ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              {r === 'month' ? 'Mês' : r === 'semester' ? 'Semestre' : 'Ano'}
            </button>
          ))}
        </div>
      </div>

      {r.isLoading ? (
        <div className="h-64 flex items-center justify-center text-slate-400">Carregando...</div>
      ) : data.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-slate-400 text-sm">
          Sem contas a pagar no período.
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="label" cx="50%" cy="50%" outerRadius={75}>
                {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v: number) => formatBRL(v)} />
            </PieChart>
          </ResponsiveContainer>
          <div className="text-center text-sm text-slate-600 font-medium mt-2">Total: {formatBRL(total)}</div>
          <ol className="mt-3 space-y-1 max-h-48 overflow-y-auto">
            {data.map((d, i) => (
              <li key={i} className="flex items-center gap-2 text-xs">
                <span className="w-3 h-3 rounded shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                <span className="flex-1 truncate" title={d.label}>{d.label}</span>
                <span className="font-medium">{d.percent.toFixed(1)}%</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

function formatBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}
