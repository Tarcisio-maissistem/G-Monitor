import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatBRL, formatBrDate } from '../lib/masks';
import { currentMonthRange, rangeQuery, type DateRange } from '../lib/period';
import type { CashConferenceResponse, CashConferenceClosing } from '../lib/reports';
import { PageContainer, PageHeader, KpiRow, KpiCard, DateRangeFilter, DataQualityBanner, QueryState, Badge, CardList, CardRow, CardMeta } from '../components/ui';

const ESP_LABEL: Record<string, string> = { dinheiro: 'Dinheiro', pix: 'PIX', cartao: 'Cartão', crediario: 'Prazo/Crediário', outros: 'Outros' };

// Conferencia de Caixa (D20, 26/08). Duas verdades, lado a lado, por fechamento (PDV + dia):
//   ESPERADO = o que o GDOOR registrou no expediente (payments por forma + fundo de troco +
//              suprimento - sangria) — verdade do SISTEMA, e o que vale pro faturamento.
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
  const tot = d?.totals;
  const quebraTone = (tot?.quebra ?? 0) < 0 ? 'red' : (tot?.quebra ?? 0) > 0 ? 'amber' : 'emerald';

  return (
    <PageContainer>
      <PageHeader title="Conferência de Caixa" subtitle="Esperado pelo sistema × contado pelo operador, por caixa e dia. A quebra nunca mexe no faturamento." />
      <DateRangeFilter value={range} onChange={setRange} />
      <DataQualityBanner meta={d?.meta} items={d?.avisos?.map((a) => ({ label: a, kind: 'info' as const }))} />

      <QueryState query={q} empty={rows.length === 0 ? 'Nenhum fechamento de caixa sincronizado no período (precisa do agente v0.8 na loja).' : undefined}>
        <KpiRow cols={3}>
          <KpiCard label="Esperado" value={formatBRL(tot?.esperado ?? 0)} compact sub="registrado no expediente" />
          <KpiCard label="Contado" value={formatBRL(tot?.contado ?? 0)} compact sub="informado no fechamento" />
          <KpiCard label="Quebra" value={formatBRL(tot?.quebra ?? 0)} tone={quebraTone} compact highlight sub={`${d?.fechamentosComQuebra ?? 0} de ${rows.length} caixas com diferença`} />
        </KpiRow>

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
