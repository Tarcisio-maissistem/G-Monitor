import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
import { getTheme } from '../../lib/theme';
import { payStyle } from '../../lib/paymentColors';

// Uma fatia por FORMA canonica (dinheiro/pix/cartao/crediario/outros) — cor e rotulo vem do
// paymentColors (fonte unica, cor segue a forma). Recebe byKind ja agregado do backend.
interface KindRow { kind: string; total: number; pct: number }

export function PaymentMethodsChart({ rows }: { rows: KindRow[] }): JSX.Element {
  const dark = getTheme() === 'dark';
  const data = rows.filter((d) => d.total > 0);
  const fill = (kind: string): string => { const s = payStyle(kind); return dark ? s.colorDark : s.color; };

  return data.length === 0 ? (
    <div className="h-64 flex items-center justify-center text-slate-400 text-sm">Sem pagamentos no período.</div>
  ) : (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie data={data} dataKey="total" nameKey="kind" cx="50%" cy="50%" outerRadius={85}
          stroke={dark ? '#1a1a19' : '#fcfcfb'} strokeWidth={2}
          label={(e) => `${payStyle(e.kind).label}: ${(e.pct * 100).toFixed(0)}%`}>
          {data.map((row) => (
            <Cell key={row.kind} fill={fill(row.kind)} />
          ))}
        </Pie>
        <Tooltip formatter={(v: number) => formatBRL(v)} labelFormatter={(k: string) => payStyle(k).label} />
        <Legend formatter={(v: string) => payStyle(v).label} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function formatBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}
