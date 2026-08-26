import { useQuery } from '@tanstack/react-query';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from 'recharts';
import { api } from '../../lib/api';
import { formatBRL } from '../../lib/masks';
import type { WeekdayResponse } from '../../lib/reports';

// Vendas por dia da semana (onda 1 dos cards do Gdoor Relatorios antigo, 26/08). Mostra a
// MEDIA por dia observado (nao o total): um periodo com 5 segundas e 4 sabados compararia
// errado no total. Serve pra decidir escala de funcionario — o melhor dia fica destacado.
export function WeekdayChart({ from, to }: { from: string; to: string }): JSX.Element {
  const q = useQuery({
    queryKey: ['sales-by-weekday', from, to],
    queryFn: () => api<WeekdayResponse>(`/api/reports/sales-by-weekday?from=${from}&to=${to}`),
  });
  const data = (q.data?.data ?? []).map((d) => ({ ...d, curto: d.label.slice(0, 3) }));
  const melhor = data.reduce((m, d) => (d.mediaRevenuePorDia > (m?.mediaRevenuePorDia ?? 0) ? d : m), data[0]);
  const vazio = !q.isLoading && data.every((d) => d.totalQtd === 0);

  return (
    <section className="bg-white rounded-xl shadow-sm border p-5">
      <div className="mb-4">
        <h3 className="font-semibold text-slate-700">Dia da Semana</h3>
        <p className="text-xs text-slate-500">
          {melhor && melhor.totalQtd > 0 ? `Melhor dia: ${melhor.label} (média ${formatBRL(melhor.mediaRevenuePorDia)}/dia)` : 'Média de faturamento por dia da semana'}
        </p>
      </div>
      {q.isLoading ? (
        <div className="h-56 flex items-center justify-center text-slate-400 text-sm">Carregando...</div>
      ) : vazio ? (
        <div className="h-56 flex items-center justify-center text-slate-400 text-sm">Nenhuma venda no período.</div>
      ) : (
        <ResponsiveContainer width="100%" height={224}>
          <BarChart data={data}>
            <XAxis dataKey="curto" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} width={44} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
            <Tooltip formatter={(v: number) => [formatBRL(v), 'média/dia']} labelFormatter={(_l, p) => (p?.[0]?.payload as { label?: string } | undefined)?.label ?? ''} />
            <Bar dataKey="mediaRevenuePorDia" radius={[3, 3, 0, 0]}>
              {data.map((d) => (
                <Cell key={d.dia} fill={melhor && d.dia === melhor.dia ? '#3b82f6' : '#93c5fd'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </section>
  );
}
