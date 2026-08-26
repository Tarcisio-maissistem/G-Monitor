import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatBRL, formatBrDate } from '../lib/masks';
import { currentMonthRange, periodLabel, rangeQuery, type DateRange } from '../lib/period';
import type { CashflowResponse, CashflowRow, CashflowDayResponse, CashflowForecastResponse } from '../lib/reports';
import { PageContainer, PageHeader, KpiRow, KpiCard, DateRangeFilter, DataQualityBanner, qualityToItems, CardList, CardRow, CardMeta, QueryState, FilterChip, DataStatusBadge } from '../components/ui';
import { FluxoCaixaChart } from '../components/dashboard/FluxoCaixaChart';
import { CashflowForecast } from '../components/dashboard/CashflowForecast';

type Modo = 'realizado' | 'projetado';

// Fluxo de Caixa (D16, 25/08). Realizado = entradas (vendas por forma + crediario recebido +
// avulsos) - saidas (contas a pagar baixadas), por dia; Projetado = a receber/a pagar por
// vencimento. Nunca mostra "saldo em caixa" — sem saldo inicial sincronizado e VARIACAO.
export function FluxoCaixaPage(): JSX.Element {
  const [range, setRange] = useState<DateRange>(() => currentMonthRange());
  const [modo, setModo] = useState<Modo>('realizado');
  const [diaAberto, setDiaAberto] = useState<string | null>(null);

  const cf = useQuery({
    queryKey: ['cashflow', range.from, range.to],
    queryFn: () => api<CashflowResponse>(`/api/reports/cashflow?${rangeQuery(range)}`),
    enabled: modo === 'realizado',
  });

  const rows = cf.data?.data ?? [];
  const totals = cf.data?.totals;
  const variacaoTone = (totals?.variacao ?? 0) >= 0 ? 'emerald' : 'red';

  return (
    <PageContainer>
      <PageHeader
        title="Fluxo de Caixa"
        subtitle="Entradas e saídas com o dado que já sincroniza — o que falta fica marcado, não vira zero."
        actions={
          <div className="flex gap-1">
            <FilterChip active={modo === 'realizado'} onClick={() => setModo('realizado')}>Realizado</FilterChip>
            <FilterChip active={modo === 'projetado'} onClick={() => setModo('projetado')}>Projetado</FilterChip>
          </div>
        }
      />

      {modo === 'projetado' && <CashflowForecast />}

      {modo === 'realizado' && (
        <>
          <DateRangeFilter value={range} onChange={setRange} />
          <DataQualityBanner items={qualityToItems(cf.data?.quality)} meta={cf.data?.meta} />

          <KpiRow cols={3}>
            <KpiCard label="Entradas" value={formatBRL(totals?.entradas ?? 0)} tone="emerald" compact sub={periodLabel(range)} />
            <KpiCard label="Saídas" value={formatBRL(totals?.saidas ?? 0)} tone="red" compact sub="contas a pagar baixadas" badge={<DataStatusBadge status="estimate" />} />
            <KpiCard label="Variação" value={formatBRL(totals?.variacao ?? 0)} tone={variacaoTone} compact highlight sub="não é saldo em caixa" />
          </KpiRow>

          <QueryState query={cf} empty={rows.length === 0 ? 'Nenhuma entrada ou saída sincronizada no período.' : undefined}>
            <FluxoCaixaChart from={range.from} to={range.to} data={cf.data} />
            <CardList<CashflowRow>
              rows={rows}
              keyOf={(r) => r.dia}
              onRowTap={(r) => setDiaAberto(r.dia)}
              columns={[
                { key: 'dia', header: 'Dia', render: (r) => formatBrDate(r.dia) },
                { key: 'entradas', header: 'Entradas', align: 'right', render: (r) => <span className="text-emerald-700">{formatBRL(r.entradas)}</span> },
                { key: 'saidas', header: 'Saídas', align: 'right', render: (r) => <span className="text-red-700">{formatBRL(r.saidas)}</span> },
                { key: 'saldoDia', header: 'Dia', align: 'right', render: (r) => formatBRL(r.saldoDia) },
                { key: 'saldoAcumulado', header: 'Acumulado', align: 'right', className: 'font-medium', render: (r) => formatBRL(r.saldoAcumulado) },
              ]}
              renderCard={(r) => (
                <>
                  <CardRow title={formatBrDate(r.dia)} right={<span className={r.saldoDia >= 0 ? 'text-emerald-700 font-semibold' : 'text-red-700 font-semibold'}>{formatBRL(r.saldoDia)}</span>} />
                  <CardMeta left={`+ ${formatBRL(r.entradas)}`} right={`− ${formatBRL(r.saidas)}`} muted />
                  <CardMeta left="acumulado" right={formatBRL(r.saldoAcumulado)} muted />
                </>
              )}
            />
          </QueryState>
        </>
      )}

      {diaAberto && <DiaDrilldown dia={diaAberto} onClose={() => setDiaAberto(null)} />}
    </PageContainer>
  );
}

// Toque no dia abre o extrato daquele dia (GET /cashflow/day) num painel por cima — padrao
// do painel: nunca troca de tela, sobrepoe.
function DiaDrilldown({ dia, onClose }: { dia: string; onClose: () => void }): JSX.Element {
  const q = useQuery({ queryKey: ['cashflow-day', dia], queryFn: () => api<CashflowDayResponse>(`/api/reports/cashflow/day?date=${dia}`) });
  const d = q.data;
  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-lg max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-xl shadow-xl p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">{formatBrDate(dia)}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none" aria-label="Fechar">×</button>
        </div>
        <QueryState query={q} empty={d && d.entradas.length === 0 && d.saidas.length === 0 ? 'Sem movimento neste dia.' : undefined}>
          {d && (
            <div className="space-y-4 text-sm">
              <div>
                <div className="text-xs uppercase text-slate-500 mb-1">Entradas · {formatBRL(d.totals.entradas)}</div>
                <ul className="divide-y">
                  {d.entradas.map((e, i) => (
                    <li key={i} className="py-1.5 flex justify-between gap-2">
                      <span className="text-slate-600 truncate">{e.tipo === 'payment' ? `Venda · ${e.forma}` : `Crediário · ${e.counterparty ?? '—'}`}</span>
                      <span className="text-emerald-700 shrink-0">{formatBRL(e.value)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="text-xs uppercase text-slate-500 mb-1">Saídas · {formatBRL(d.totals.saidas)}</div>
                <ul className="divide-y">
                  {d.saidas.map((s, i) => (
                    <li key={i} className="py-1.5 flex justify-between gap-2">
                      <span className="text-slate-600 truncate">{s.counterparty ?? '—'}{s.description ? ` · ${s.description}` : ''}</span>
                      <span className="text-red-700 shrink-0">{formatBRL(s.value)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </QueryState>
      </div>
    </div>
  );
}

// Nao utilizado diretamente, mas mantem o tipo importado "vivo" pro tsc nao reclamar se
// o CashflowForecast mudar de assinatura no futuro.
export type { CashflowForecastResponse };
