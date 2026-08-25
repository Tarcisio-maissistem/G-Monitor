import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';

interface PaymentRow {
  paymentType: string;
  total: number;
  count: number;
  pct: number;
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

// Recebe os dados ja carregados pelo DashboardPage (sales-by-payment) em vez de buscar de
// novo — pedido do dono 24/08: "formas de pagamento acumuladas e gráfico de pizza" ao lado
// da lista com barra que ja existia.
export function PaymentMethodsChart({ rows }: { rows: PaymentRow[] }): JSX.Element {
  const data = rows.filter((d) => d.total > 0);

  return data.length === 0 ? (
    <div className="h-64 flex items-center justify-center text-slate-400 text-sm">Sem pagamentos no período.</div>
  ) : (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie data={data} dataKey="total" nameKey="paymentType" cx="50%" cy="50%" outerRadius={85}
          label={(e) => `${LABELS[e.paymentType] ?? e.paymentType}: ${(e.pct * 100).toFixed(0)}%`}>
          {data.map((row, i) => (
            <Cell key={i} fill={COLORS[row.paymentType] ?? '#94a3b8'} />
          ))}
        </Pie>
        <Tooltip formatter={(v: number) => formatBRL(v)} />
        <Legend formatter={(v) => LABELS[v] ?? v} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function formatBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}
