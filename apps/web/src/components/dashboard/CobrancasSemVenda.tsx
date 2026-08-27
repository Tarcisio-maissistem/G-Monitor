import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { formatBRL, formatInt, formatBrDate } from '../../lib/masks';
import type { DateRange } from '../../lib/period';
import { rangeQuery } from '../../lib/period';
import type { CobrancasSemVendaResponse } from '../../lib/reports';

// "Cobrou e não virou venda" direto do GDOOR (MOVIMENTACAO_CARTAO.PROCESSADA = 0) — aparece
// sozinho, sem precisar buscar o extrato no portal. É o mesmo achado da conciliação, só que
// na hora. Ver openspec D29.
export function CobrancasSemVenda({ range }: { range: DateRange }): JSX.Element | null {
  const q = useQuery({
    queryKey: ['cobrancas-sem-venda', range.from, range.to],
    queryFn: () => api<CobrancasSemVendaResponse>(`/api/reports/conciliacao/cobrancas-sem-venda?${rangeQuery(range)}`),
  });
  const d = q.data;
  // sem dado nenhum = agente antigo; não mostrar "tudo certo" seria mentira, mas encher a tela
  // com aviso técnico também não ajuda — some.
  if (!d || d.semDado) return null;
  if (d.total === 0) {
    return (
      <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-2.5 rounded-lg text-sm">
        ✓ Nenhuma cobrança sem venda no período — as {formatInt(d.transacoesNoPeriodo)} transações da maquininha viraram venda.
      </div>
    );
  }
  return (
    <section className="bg-red-50 border border-red-200 rounded-xl p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <h3 className="font-semibold text-red-900">Cobrou e não virou venda</h3>
          <p className="text-xs text-red-800">
            O cartão foi aprovado na maquininha, mas a venda não fechou no sistema. Vale conferir se o cliente levou a mercadoria — ou se há estorno a fazer.
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-lg font-bold text-red-800">{formatBRL(d.valor)}</div>
          <div className="text-[11px] text-red-700">{formatInt(d.total)} transação{d.total > 1 ? 'ões' : ''}</div>
        </div>
      </div>
      <div className="divide-y divide-red-200">
        {d.linhas.map((l) => (
          <div key={l.id} className="flex items-center justify-between gap-2 py-1.5">
            <div className="text-[11px] text-red-800 min-w-0 truncate">
              {formatBrDate(l.transactionAt.slice(0, 10))} · {l.transactionAt.slice(11, 19)}
              {l.acquirer ? ` · ${l.acquirer}` : ''}{l.nsu ? ` · NSU ${l.nsu}` : ''}{l.authCode ? ` · aut ${l.authCode}` : ''}
            </div>
            <div className="text-sm font-semibold text-red-800 shrink-0">{formatBRL(l.value)}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
