import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { api } from '../../lib/api';

interface CashflowResp {
  data: Array<{ dia: string; entradas: number; saidas: number; saldo: number }>;
  totals: { entradas: number; saidas: number; saldo: number };
}

export function CashflowForecast(): JSX.Element {
  const [days, setDays] = useState(30);
  const r = useQuery({
    queryKey: ['cashflow-forecast', days],
    queryFn: () => api<CashflowResp>(`/api/reports/dashboard/cashflow-30days?days=${days}`),
  });

  const chartData = (r.data?.data ?? []).map((d) => ({
    ...d,
    label: new Date(d.dia).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
  }));

  const t = r.data?.totals;
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
        <div>
          <h3 className="font-semibold text-lg">Fluxo de Caixa</h3>
          <p className="text-xs text-slate-500">Próximos {days} dias (contas a receber/pagar)</p>
        </div>
        <select value={days} onChange={(e) => setDays(parseInt(e.target.value))} className="border rounded px-2 py-1 text-sm">
          <option value={7}>7 dias</option>
          <option value={15}>15 dias</option>
          <option value={30}>30 dias</option>
          <option value={60}>60 dias</option>
          <option value={90}>90 dias</option>
        </select>
      </div>

      {r.isLoading ? (
        <div className="h-64 flex items-center justify-center text-slate-400">Carregando...</div>
      ) : chartData.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-slate-400 text-sm">Sem contas a vencer no período.</div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `R$ ${Math.round(v / 1000)}k`} />
            <Tooltip formatter={(v: number) => formatBRL(v)} />
            <Legend />
            <Bar dataKey="entradas" name="Entradas" fill="#10b981" />
            <Bar dataKey="saidas" name="Saídas" fill="#ef4444" />
          </BarChart>
        </ResponsiveContainer>
      )}

      {t && (
        <div className="grid grid-cols-3 gap-3 mt-3 border-t pt-3">
          <div>
            <div className="text-xs uppercase text-slate-500">Total Entradas</div>
            <div className="text-lg font-bold text-emerald-700">{formatBRL(t.entradas)}</div>
            <div className="text-xs text-slate-500">Contas a Receber</div>
          </div>
          <div>
            <div className="text-xs uppercase text-slate-500">Total Saídas</div>
            <div className="text-lg font-bold text-red-700">{formatBRL(t.saidas)}</div>
            <div className="text-xs text-slate-500">Contas a Pagar</div>
          </div>
          <div>
            <div className="text-xs uppercase text-slate-500">Saldo Previsto</div>
            <div className={`text-lg font-bold ${t.saldo >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{formatBRL(t.saldo)}</div>
            <div className="text-xs text-slate-500">Entradas - Saídas</div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}
