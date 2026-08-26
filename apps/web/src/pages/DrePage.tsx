import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatBRL, formatCompactBRL, formatPct } from '../lib/masks';
import { currentMonthRange, periodLabel, rangeQuery, type DateRange } from '../lib/period';
import { countRealLines, type DreResponse, type DreRegime } from '../lib/reports';
import { buildWhatsAppResumo } from '../lib/whatsapp';
import { PageContainer, PageHeader, DateRangeFilter, DataQualityBanner, dreLinesToItems, QueryState, FilterChip, DataStatusBadge, CopyWhatsAppButton, KpiRow, KpiCard } from '../components/ui';
import { PlanoContasCard } from '../components/dashboard/PlanoContasCard';

// DRE v1 (D17, 25/08): extrato vertical, cada linha com selo real/estimativa/N/D. A palavra
// "lucro" nao aparece — e "resultado aproximado" (P3: liberar com selo visivel).
export function DrePage(): JSX.Element {
  const [range, setRange] = useState<DateRange>(() => currentMonthRange());
  const [regime, setRegime] = useState<DreRegime>('caixa');

  const q = useQuery({
    queryKey: ['dre', range.from, range.to, regime],
    queryFn: () => api<DreResponse>(`/api/reports/dre-simplified?${rangeQuery(range, { regime })}`),
  });
  const d = q.data;
  const lines = d?.lines ?? [];
  const real = countRealLines(lines);
  const resultado = lines.find((l) => l.key === 'resultado');
  const receita = lines.find((l) => l.key === 'receita_bruta');

  const whatsapp = d
    ? buildWhatsAppResumo({
        titulo: 'DRE',
        emoji: '📑',
        periodo: periodLabel(range),
        linhas: lines.filter((l) => l.value !== null).map((l) => ({ label: l.label, value: l.value, bold: l.key === 'resultado' || l.key === 'receita_bruta' })),
        secoes: [{ titulo: 'Não disponível ainda', linhas: lines.filter((l) => l.status === 'nd').map((l) => `${l.label} — ${l.note ?? 'N/D'}`) }],
      })
    : '';

  return (
    <PageContainer>
      <PageHeader
        title="DRE"
        subtitle="Resultado aproximado do período com o dado que já sincroniza."
        actions={
          <div className="flex gap-1">
            <FilterChip active={regime === 'caixa'} onClick={() => setRegime('caixa')}>Caixa</FilterChip>
            <FilterChip active={regime === 'vencimento'} onClick={() => setRegime('vencimento')}>Por vencimento</FilterChip>
          </div>
        }
      />
      <DateRangeFilter value={range} onChange={setRange}>
        <CopyWhatsAppButton text={whatsapp} disabled={!d} />
      </DateRangeFilter>
      <DataQualityBanner items={dreLinesToItems(lines)} meta={d?.meta} />

      <QueryState query={q} empty={d && (receita?.value ?? 0) === 0 ? 'Nenhuma venda no período.' : undefined}>
        <KpiRow cols={2}>
          <KpiCard label="Receita bruta" info="Tudo que a loja vendeu no período (pré-vendas + NF-e), antes de qualquer desconto de custo ou despesa." value={formatBRL(receita?.value ?? 0)} tone="blue" compact sub={periodLabel(range)} />
          <KpiCard
            label="Resultado aproximado"
            value={formatCompactBRL(resultado?.value ?? 0)}
            tone={(resultado?.value ?? 0) >= 0 ? 'emerald' : 'red'}
            compact
            highlight
            sub={`${formatBRL(resultado?.value ?? 0)} · ${real.real} de ${real.total} linhas reais`}
            badge={<DataStatusBadge status={resultado?.status ?? 'estimate'} />}
          />
        </KpiRow>

        {/* Extrato vertical: label esquerda, valor + % direita — sem tabela larga em nenhum breakpoint */}
        <div className="bg-white rounded-xl shadow-sm border divide-y">
          {lines.map((l) => {
            const isTotal = l.label.startsWith('=');
            return (
              <div key={l.key} className={`px-3 sm:px-4 py-2.5 flex items-center gap-2 ${isTotal ? 'bg-slate-50 font-semibold' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-800 truncate">{l.label}</div>
                  {l.note && <div className="text-[11px] text-slate-400 truncate">{l.note}</div>}
                </div>
                <DataStatusBadge status={l.status} />
                <div className="text-right shrink-0 w-28 sm:w-36">
                  <div className={`text-sm ${l.value === null ? 'text-slate-400' : ''}`}>{l.value === null ? 'N/D' : formatBRL(l.value)}</div>
                  {l.pct !== null && <div className="text-[11px] text-slate-400">{formatPct(l.pct)}</div>}
                </div>
              </div>
            );
          })}
        </div>

        {d && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <PlanoContasCard
              title="Despesas por fornecedor"
              subtitle={regime === 'caixa' ? 'contas pagas no período' : 'contas por vencimento no período'}
              data={d.despesasPorFornecedor}
              total={d.despesasPorFornecedor.reduce((s, x) => s + x.value, 0)}
              emptyText="Nenhuma conta a pagar no período."
            />
            <div className="bg-white rounded-xl shadow-sm border p-4 text-sm space-y-2">
              <h3 className="font-semibold text-slate-700">Informativo (não deduzido)</h3>
              <div className="flex justify-between"><span className="text-slate-500">Vendas canceladas</span><span>{formatBRL(d.memo.cancelamentos.value)} · {d.memo.cancelamentos.count}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Pré-vendas não faturadas</span><span>{formatBRL(d.memo.naoProcessadas.value)} · {d.memo.naoProcessadas.count}</span></div>
              {Object.entries(d.memo.receitaPorModelo).map(([m, v]) => (
                <div key={m} className="flex justify-between"><span className="text-slate-500">Receita {m === 'PV' ? 'pré-venda' : m === '65' ? 'NFC-e' : m === '55' ? 'NF-e' : m}</span><span>{formatBRL(v)}</span></div>
              ))}
            </div>
          </div>
        )}
      </QueryState>
    </PageContainer>
  );
}
