import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { formatBRL, formatInt, formatPct, formatBrDate } from '../../lib/masks';
import type { FinancialPositionResponse, FinancialSide } from '../../lib/reports';
import { KpiRow, KpiCard, QueryState } from '../ui';

const FAIXA: Record<string, string> = { a_vencer: 'A vencer', ate_30: 'Atraso até 30d', '31_60': '31–60d', acima_60: '+60d' };

// Bloco financeiro do dashboard (doc do dono, Parte 3): receitas x despesas lado a lado,
// saldo projetado ate o fim do mes ("o mes fecha positivo?"), % fiado (quando sobe, o lucro
// cresce no papel e o caixa aperta) e os maiores devedores (quem cobrar primeiro).
export function FinancialPosition({ from, to }: { from: string; to: string }): JSX.Element {
  const q = useQuery({ queryKey: ['financial-position', from, to], queryFn: () => api<FinancialPositionResponse>(`/api/reports/dashboard/financial-position?from=${from}&to=${to}`) });
  const d = q.data;
  const saldo = d?.saldoProjetado.saldo ?? 0;
  return (
    <section className="space-y-4">
      <QueryState query={q}>
        {d && (
          <>
            <KpiRow cols={2}>
              <KpiCard label={`Saldo projetado até ${formatBrDate(d.saldoProjetado.ate)}`} value={formatBRL(saldo)} tone={saldo >= 0 ? 'emerald' : 'red'} highlight sub={`a receber ${formatBRL(d.saldoProjetado.entradas)} − a pagar ${formatBRL(d.saldoProjetado.saidas)}`} />
              <KpiCard label="Vendido a prazo (fiado)" value={formatPct(d.fiado.pct, 1)} tone={d.fiado.pct > 30 ? 'amber' : 'default'} sub={`${formatBRL(d.fiado.valor)} de ${formatBRL(d.fiado.totalPagamentos)} recebidos`} />
            </KpiRow>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Lado titulo="A receber" s={d.receber} tone="emerald" />
              <Lado titulo="A pagar" s={d.pagar} tone="red" />
            </div>
            {d.inadimplentes.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border p-4">
                <h3 className="font-semibold text-slate-700 mb-2">Quem cobrar primeiro</h3>
                <div className="divide-y text-sm">
                  {d.inadimplentes.slice(0, 8).map((i) => (
                    <div key={i.nome} className="py-1.5 flex items-center gap-2">
                      <span className="flex-1 min-w-0 truncate text-slate-700">{i.nome}</span>
                      <span className="text-[11px] text-slate-400 shrink-0">{i.titulos} tít. · {i.diasAtrasoMaior}d</span>
                      <span className="text-red-700 font-semibold shrink-0 w-24 text-right">{formatBRL(i.saldo)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </QueryState>
    </section>
  );
}

function Lado({ titulo, s, tone }: { titulo: string; s: FinancialSide; tone: 'emerald' | 'red' }): JSX.Element {
  const c = tone === 'emerald' ? 'text-emerald-700' : 'text-red-700';
  return (
    <div className="bg-white rounded-xl shadow-sm border p-4 text-sm">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="font-semibold text-slate-700">{titulo}</h3>
        <span className={`font-semibold ${c}`}>{formatBRL(s.realizadoMes.valor)} <span className="text-[11px] text-slate-400 font-normal">no período · {formatInt(s.realizadoMes.qtd)}</span></span>
      </div>
      <div className="flex justify-between text-slate-600"><span>A vencer até o fim do mês</span><span>{formatBRL(s.aVencerMes)}</span></div>
      <div className="flex justify-between text-slate-600"><span>Em atraso (total)</span><span className={s.atrasadoTotal > 0 ? 'text-red-700 font-medium' : ''}>{formatBRL(s.atrasadoTotal)}</span></div>
      <div className="mt-2 grid grid-cols-4 gap-1 text-[11px] text-center">
        {s.aging.map((a) => (
          <div key={a.faixa} className="bg-slate-50 rounded p-1.5">
            <div className="text-slate-400">{FAIXA[a.faixa]}</div>
            <div className="font-medium text-slate-700">{formatBRL(a.valor)}</div>
            <div className="text-slate-400">{formatInt(a.qtd)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
