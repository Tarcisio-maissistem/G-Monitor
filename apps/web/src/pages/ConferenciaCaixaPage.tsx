import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatBRL, formatBrDate } from '../lib/masks';
import { currentMonthRange, rangeQuery, type DateRange } from '../lib/period';
import type { CashConferenceResponse, CashConferenceClosing, CashConferenceDia } from '../lib/reports';
import { PageContainer, PageHeader, KpiRow, KpiCard, DateRangeFilter, DataQualityBanner, QueryState, Badge, CardList, CardRow, CardMeta } from '../components/ui';

const ESP_LABEL: Record<string, string> = { dinheiro: 'Dinheiro', pix: 'PIX', cartao: 'Cartão', crediario: 'Prazo/Crediário', outros: 'Outros' };

// Conferencia de Caixa (D20, 26/08). Duas verdades, lado a lado, por fechamento (PDV + dia):
//   ESPERADO = o que o GDOOR registrou no expediente (payments por forma + fundo de troco
//              − sangria) — verdade do SISTEMA, e o que vale pro faturamento. O suprimento NAO
//              soma: ele E o proprio troco do fundo (conferido 25-29/08), somar contava 2x.
//   CONTADO  = o que o operador contou ao fechar (FECHAMENTO_CAIXA_ESPECIES) — verdade FISICA.
//   QUEBRA   = contado - esperado. Negativo = falta (vermelho). NUNCA altera o faturamento.
export function ConferenciaCaixaPage(): JSX.Element {
  const [range, setRange] = useState<DateRange>(() => currentMonthRange());
  const [aberto, setAberto] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['cash-conference', range.from, range.to],
    queryFn: () => api<CashConferenceResponse>(`/api/reports/cash-conference?${rangeQuery(range)}`),
  });
  const d = q.data;
  const rows = d?.closings ?? [];
  const dias = d?.porDia ?? [];
  const tot = d?.totals;
  const quebraTone = (tot?.quebra ?? 0) < 0 ? 'red' : (tot?.quebra ?? 0) > 0 ? 'amber' : 'emerald';

  return (
    <PageContainer>
      <PageHeader title="Conferência de Caixa" subtitle="Dinheiro esperado × dinheiro contado na gaveta, por dia. Cartão e PIX se conferem no extrato, não na gaveta. A quebra nunca mexe no faturamento." />
      <DateRangeFilter value={range} onChange={setRange} />
      <DataQualityBanner meta={d?.meta} items={d?.avisos?.map((a) => ({ label: a, kind: 'info' as const }))} />

      <QueryState query={q} empty={rows.length === 0 ? 'Nenhum fechamento de caixa sincronizado no período (precisa do agente v0.8 na loja).' : undefined}>
        <KpiRow cols={3}>
          <KpiCard label="Dinheiro esperado" info="Vendas em dinheiro do dia + fundo de troco − sangrias. O suprimento não soma: ele é o próprio troco do fundo, e contar os dois dobrava o valor. Cartão e PIX ficam fora: não se contam na gaveta." value={formatBRL(tot?.esperado ?? 0)} compact sub="dinheiro registrado" />
          <KpiCard label="Dinheiro contado" info="O que o operador informou ter contado em dinheiro ao fechar o caixa, incluindo o troco que ficou na gaveta." value={formatBRL(tot?.contado ?? 0)} compact sub="contado na gaveta" />
          <KpiCard label="Quebra" info="Dinheiro contado − dinheiro esperado. Negativo = faltou (vermelho); positivo = sobrou. Só dinheiro entra aqui: cartão e PIX se conferem pelo extrato da maquininha. A quebra não muda o faturamento." value={formatBRL(tot?.quebra ?? 0)} tone={quebraTone} compact highlight sub={`${d?.diasComQuebra ?? 0} de ${dias.length} dias com diferença`} />
        </KpiRow>

        {/* Fechamento do DIA: a sangria do GDOOR não diz de qual caixa saiu, então o número que
            fecha de verdade é o do dia inteiro (soma dos caixas − sangrias). */}
        {dias.length > 0 && (
          <section className="bg-white rounded-xl shadow-sm border p-4">
            <h3 className="font-semibold text-slate-700 mb-1">Fechamento por dia</h3>
            <p className="text-xs text-slate-500 mb-3">Só dinheiro: vendas em dinheiro + troco dos caixas − sangrias, contra o que foi contado na gaveta. Cartão e PIX aparecem à direita só como referência (confere-se no extrato).</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[34rem]">
                <thead>
                  <tr className="text-[11px] uppercase text-slate-500 border-b">
                    <th className="text-left pb-1">Dia</th>
                    <th className="text-right pb-1">Caixas</th>
                    <th className="text-right pb-1">Dinheiro esperado</th>
                    <th className="text-right pb-1">Sangrias</th>
                    <th className="text-right pb-1">Dinheiro contado</th>
                    <th className="text-right pb-1">Quebra</th>
                    <th className="text-right pb-1">Cartão/PIX</th>
                  </tr>
                </thead>
                <tbody>
                  {dias.map((dd: CashConferenceDia) => (
                    <tr key={dd.dia} className="border-b border-slate-50">
                      <td className="py-1.5">
                        {formatBrDate(dd.dia)}
                        {dd.caixaAberto && <span className="ml-1 text-amber-600" title="Um caixa do dia não foi fechado — a falta está exagerada">⚠</span>}
                      </td>
                      <td className="py-1.5 text-right text-slate-500">{dd.caixas}</td>
                      <td className="py-1.5 text-right">{formatBRL(dd.esperado)}</td>
                      <td className="py-1.5 text-right text-slate-500">{dd.sangrias > 0 ? `− ${formatBRL(dd.sangrias)}` : '—'}</td>
                      <td className="py-1.5 text-right">{formatBRL(dd.contado)}</td>
                      <td className="py-1.5 text-right font-semibold"><QuebraCell v={dd.quebra} /></td>
                      <td className="py-1.5 text-right text-slate-400">{formatBRL(dd.outrasFormas)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <CardList<CashConferenceClosing>
          rows={rows}
          keyOf={(r) => r.id}
          onRowTap={(r) => setAberto(aberto === r.id ? null : r.id)}
          columns={[
            { key: 'dia', header: 'Dia', render: (r) => formatBrDate(r.dia) },
            { key: 'pdv', header: 'Caixa', render: (r) => `PDV ${r.pdv ?? '?'}` },
            { key: 'op', header: 'Operador', render: (r) => r.operador ?? '—' },
            { key: 'esp', header: 'Esperado', align: 'right', render: (r) => formatBRL(r.esperado) },
            { key: 'con', header: 'Contado', align: 'right', render: (r) => formatBRL(r.contado) },
            { key: 'q', header: 'Quebra', align: 'right', className: 'font-semibold', render: (r) => <QuebraCell v={r.quebra} /> },
          ]}
          renderCard={(r) => (
            <>
              <CardRow title={`${formatBrDate(r.dia)} · PDV ${r.pdv ?? '?'}`} sub={r.operador ?? undefined} right={<QuebraCell v={r.quebra} />} />
              <CardMeta left={`esperado ${formatBRL(r.esperado)}`} right={`contado ${formatBRL(r.contado)}`} muted />
              {aberto === r.id && <Detalhe r={r} />}
            </>
          )}
        />
        {/* no desktop a tabela nao expande — mostra o detalhe do selecionado abaixo */}
        {aberto && rows.find((r) => r.id === aberto) && (
          <div className="hidden sm:block bg-white rounded-xl shadow-sm border p-4">
            <Detalhe r={rows.find((r) => r.id === aberto)!} />
          </div>
        )}
      </QueryState>
    </PageContainer>
  );
}

function QuebraCell({ v }: { v: number }): JSX.Element {
  if (Math.abs(v) < 0.005) return <Badge tone="emerald">confere</Badge>;
  return <span className={v < 0 ? 'text-red-700 font-semibold' : 'text-amber-700 font-semibold'}>{v < 0 ? '−' : '+'}{formatBRL(Math.abs(v))}</span>;
}

// Quebra por forma de pagamento — mostra ONDE faltou (ex: -R$10 em dinheiro).
function Detalhe({ r }: { r: CashConferenceClosing }): JSX.Element {
  return (
    <div className="mt-2 text-xs space-y-1">
      {r.fundoTroco != null && <div className="flex justify-between text-slate-500"><span>Fundo de troco (abertura)</span><span>{formatBRL(r.fundoTroco)}</span></div>}
      {r.suprimentos > 0 && <div className="flex justify-between text-slate-500"><span>+ Suprimentos</span><span>{formatBRL(r.suprimentos)}</span></div>}
      {r.sangrias > 0 && <div className="flex justify-between text-slate-500"><span>− Sangrias</span><span>{formatBRL(r.sangrias)}</span></div>}
      <div className="grid grid-cols-4 gap-1 pt-1 border-t text-slate-500"><span>Forma</span><span className="text-right">Esperado</span><span className="text-right">Contado</span><span className="text-right">Quebra</span></div>
      {r.porForma.map((f) => (
        <div key={f.forma} className="grid grid-cols-4 gap-1">
          <span className="text-slate-700">{ESP_LABEL[f.forma] ?? f.forma}</span>
          <span className="text-right">{formatBRL(f.esperado)}</span>
          <span className="text-right">{formatBRL(f.contado)}</span>
          <span className="text-right"><QuebraCell v={f.quebra} /></span>
        </div>
      ))}
    </div>
  );
}
