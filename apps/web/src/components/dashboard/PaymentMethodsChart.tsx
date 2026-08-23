import { useQuery } from '@tanstack/react-query';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
import { api } from '../../lib/api';

interface PaymentRow {
  categoria: string;
  qtd: number;
  valor: number;
  percentual: number;
}

const COLORS: Record<string, string> = {
  DINHEIRO: '#10b981',
  PIX: '#3b82f6',
  CARTAO: '#8b5cf6',
  CREDIARIO: '#f59e0b',
  OUTROS: '#94a3b8',
};

const LABELS: Record<string, string> = {
  DINHEIRO: 'Dinheiro',
  PIX: 'PIX',
  CARTAO: 'Cartão',
  CREDIARIO: 'Crediário',
  OUTROS: 'Outros',
};

export function PaymentMethodsChart({ from, to }: { from: string; to: string }): JSX.Element {
  const r = useQuery({
    queryKey: ['payment-methods', from, to],
    queryFn: () => api<{ data: PaymentRow[]; total: number }>(`/api/reports/dashboard/payment-methods?from=${from}&to=${to}`),
  });

  const rows = (r.data?.data ?? []).filter((d) => d.valor > 0);

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h3 className="font-semibold mb-3">Formas de Pagamento</h3>
      {r.isLoading ? (
        <div className="h-64 flex items-center justify-center text-slate-400 text-sm">Carregando...</div>
      ) : rows.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-slate-400 text-sm">Sem pagamentos no período.</div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie data={rows} dataKey="valor" nameKey="categoria" cx="50%" cy="50%" outerRadius={85}
              label={(e) => `${LABELS[e.categoria] ?? e.categoria}: ${e.percentual.toFixed(0)}%`}>
              {rows.map((row, i) => (
                <Cell key={i} fill={COLORS[row.categoria] ?? '#94a3b8'} />
              ))}
            </Pie>
            <Tooltip formatter={(v: number) => formatBRL(v)} />
            <Legend formatter={(v) => LABELS[v] ?? v} />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function formatBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}
