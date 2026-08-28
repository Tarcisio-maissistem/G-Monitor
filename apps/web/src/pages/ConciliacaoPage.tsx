import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatBRL, formatCompactBRL, formatInt } from '../lib/masks';
import { currentMonthRange, rangeQuery, type DateRange } from '../lib/period';
import type { PrevistoResponse } from '../lib/reports';
import { FEE_CHANNEL_LABEL, FEE_CHANNEL_COLOR } from '../lib/feeChannels';
import { PageContainer, PageHeader, KpiRow, KpiCard, DateRangeFilter, DataQualityBanner, QueryState } from '../components/ui';
import { ExtratoConciliacao } from '../components/dashboard/ExtratoConciliacao';
import { CobrancasSemVenda } from '../components/dashboard/CobrancasSemVenda';
import { TaxasContrato } from '../components/dashboard/TaxasContrato';


// Conciliacao bancaria — Fase 2 (26/08): bruto x taxa x LIQUIDO PREVISTO por canal.
// A taxa NAO vem do GDOOR (TAXAS_CARTAO do cliente esta toda zerada, ver openspec D21) —
// o lojista cadastra aqui. Canal sem taxa cadastrada fica FORA do liquido, sinalizado, em vez
// de virar taxa zero (que inflaria o liquido). Fase 3 (extrato do portal TEF) ainda nao entrou.
export function ConciliacaoPage(): JSX.Element {
  const [range, setRange] = useState<DateRange>(() => currentMonthRange());

  const prev = useQuery({
    queryKey: ['conciliacao-previsto', range.from, range.to],
    queryFn: () => api<PrevistoResponse>(`/api/reports/conciliacao/previsto?${rangeQuery(range)}`),
  });

  const d = prev.data;
  const totals = d?.totals;

  return (
    <PageContainer>
      <PageHeader
        title="Conciliação"
        subtitle="Quanto você vendeu em cada canal, quanto a taxa come e quanto deve cair na conta."
      />
      <DateRangeFilter value={range} onChange={setRange} />
      <DataQualityBanner
        meta={d?.meta}
        items={[
          ...(d && d.totals.brutoSemRegra > 0
            ? [{ label: `${formatBRL(d.totals.brutoSemRegra)} em canais SEM taxa cadastrada — fora do líquido previsto. Cadastre a taxa abaixo.`, kind: 'warn' as const }]
            : []),
          { label: 'Conferência contra o extrato da adquirente (portal TEF) ainda não está ligada — os números aqui são o previsto pela taxa cadastrada.', kind: 'info' as const },
        ]}
      />

      <QueryState query={prev}>
        <KpiRow cols={3}>
          <KpiCard
            label="Bruto no período" info="Soma das vendas nos canais que passam por adquirente (cartão e PIX). Dinheiro e crediário da própria loja não entram."
            value={formatCompactBRL(totals?.bruto ?? 0)} tone="blue" highlight sub={formatBRL(totals?.bruto ?? 0)}
          />
          <KpiCard
            label="Taxa prevista" info="Quanto as adquirentes devem descontar, pela taxa que você cadastrou. Só conta canais com taxa cadastrada."
            value={formatCompactBRL(totals?.taxa ?? 0)} tone="red" sub={formatBRL(totals?.taxa ?? 0)}
          />
          <KpiCard
            label="Líquido previsto" info="Bruto menos a taxa: o que deve efetivamente cair na conta. Canal sem taxa cadastrada fica de fora desta conta."
            value={formatCompactBRL(totals?.liquido ?? 0)} tone="emerald" sub={formatBRL(totals?.liquido ?? 0)}
          />
        </KpiRow>

        {/* por canal */}
        <section className="bg-white rounded-xl shadow-sm border p-5">
          <h3 className="font-semibold text-slate-700 mb-4">Por canal</h3>
          {(d?.canais ?? []).length === 0 ? (
            <p className="text-sm text-slate-400">Nenhuma venda em cartão ou PIX no período.</p>
          ) : (
            <div className="space-y-2">
              {(d?.canais ?? []).map((c) => (
                <div key={c.channel} className="flex items-center gap-2 flex-wrap py-2 border-b last:border-0">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: FEE_CHANNEL_COLOR[c.channel] }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-slate-800 truncate">{FEE_CHANNEL_LABEL[c.channel]}</div>
                    <div className="text-[11px] text-slate-500">
                      {formatInt(c.transacoes)} transações
                      {c.temRegra ? ` · taxa ${c.percent}% · cai em ${c.diasParaReceber}d` : ' · sem taxa cadastrada'}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-semibold text-slate-800">{formatBRL(c.bruto)}</div>
                    {c.temRegra ? (
                      <div className="text-[11px] text-slate-500">
                        <span className="text-red-700">−{formatBRL(c.taxa ?? 0)}</span> → <span className="text-emerald-700 font-medium">{formatBRL(c.liquido ?? 0)}</span>
                      </div>
                    ) : (
                      <div className="text-[11px] text-amber-700">cadastre a taxa</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {(d?.semTaxaAdquirente ?? 0) > 0 && (
            <p className="text-[11px] text-slate-400 mt-3">
              + {formatBRL(d?.semTaxaAdquirente ?? 0)} em dinheiro/crediário — não passam por adquirente, não têm taxa.
            </p>
          )}
        </section>

        <CobrancasSemVenda range={range} />

        <ExtratoConciliacao range={range} />

        <TaxasContrato />
      </QueryState>
    </PageContainer>
  );
}

