import { useQuery } from '@tanstack/react-query';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { api } from '../../lib/api';

interface CashflowRow {
  dia: string;
  entradas: number;
  saidas: number;
  saldoLiquido: number;
}

export function FluxoCaixaChart({ from, to }: { from: string; to: string }): JSX.Element {
  const r = useQuery({
    queryKey: ['cashflow', from, to],
    queryFn: () => api<{ data: CashflowRow[] }>(`/api/reports/dashboard/cashflow?from=${from}&to=${to}`),
  });

  const rows = (r.data?.data ?? []).map((row) => ({ ...row, dia: new Date(row.dia).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) }));

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h3 className="font-semibold mb-3">Fluxo de Caixa</h3>
      {r.isLoading ? (
        <div className="h-64 flex items-center justify-center text-slate-400 text-sm">Carregando...</div>
      ) : rows.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-slate-400 text-sm">Sem movimentações no período.</div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="dia" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `R$ ${Math.round(v / 1000)}k`} />
            <Tooltip formatter={(v: number) => formatBRL(v)} />
            <Legend />
            <Bar dataKey="entradas" name="Entradas" fill="#10b981" />
            <Bar dataKey="saidas" name="Saídas" fill="#ef4444" />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function formatBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}
