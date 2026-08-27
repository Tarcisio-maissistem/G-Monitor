import { useQuery } from '@tanstack/react-query';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, LabelList } from 'recharts';
import { api } from '../../lib/api';
import { formatBRL, formatCompactBRL } from '../../lib/masks';
import { getTheme } from '../../lib/theme';
import { QueryState } from '../ui';

interface CashflowResp {
  totals: { entradas: number; saidas: number; variacao: number };
}

// Entradas x Saidas do periodo (pedido do dono 26/08): tudo que ENTROU no caixa x tudo que
// SAIU de pagamentos. Duas barras — verde (entrou) / vermelho (saiu) — com o saldo ao lado.
// Polaridade boa/ruim: cor de status (verde/vermelho), sempre com rotulo direto no valor.
export function EntradasSaidasChart({ from, to }: { from: string; to: string }): JSX.Element {
  const dark = getTheme() === 'dark';
  const q = useQuery({
    queryKey: ['cashflow-totais', from, to],
    queryFn: () => api<CashflowResp>(`/api/reports/cashflow?from=${from}&to=${to}`),
  });
  const t = q.data?.totals;
  const data = t ? [
    { nome: 'Entradas', valor: t.entradas, cor: dark ? '#12b981' : '#0ca30c' },
    { nome: 'Saídas', valor: t.saidas, cor: dark ? '#f0776b' : '#d03b3b' },
  ] : [];
  const saldoPos = (t?.variacao ?? 0) >= 0;

  return (
    <section className="bg-white rounded-xl shadow-sm border p-5">
      <div className="flex items-start justify-between gap-2 mb-4">
        <div>
          <h3 className="font-semibold text-slate-700">Entradas × Saídas do período</h3>
          <p className="text-xs text-slate-500">Tudo que entrou no caixa contra tudo que saiu em pagamentos.</p>
        </div>
        {t && (
          <div className="text-right shrink-0">
            <div className={`text-lg font-bold ${saldoPos ? 'text-emerald-700' : 'text-red-700'}`}>{saldoPos ? '+' : '−'}{formatCompactBRL(Math.abs(t.variacao))}</div>
            <div className="text-[11px] text-slate-500">saldo do período</div>
          </div>
        )}
      </div>
      <QueryState query={q}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 20, right: 8, left: 8, bottom: 0 }}>
            <XAxis dataKey="nome" tick={{ fontSize: 13 }} />
            <YAxis tick={{ fontSize: 11 }} width={52} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
            <Tooltip formatter={(v: number) => [formatBRL(v), '']} cursor={{ fill: dark ? '#ffffff10' : '#00000008' }} />
            <Bar dataKey="valor" radius={[4, 4, 0, 0]} maxBarSize={110}>
              {data.map((d) => <Cell key={d.nome} fill={d.cor} />)}
              <LabelList dataKey="valor" position="top" formatter={(v: number) => formatCompactBRL(v)} style={{ fontSize: 12, fontWeight: 600, fill: dark ? '#c3c2b7' : '#52514e' }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </QueryState>
    </section>
  );
}
