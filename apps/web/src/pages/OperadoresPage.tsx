import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatBRL, formatBrDate } from '../lib/masks';
import { currentMonthRange, rangeQuery, type DateRange } from '../lib/period';
import { exportToCsv, todayStamp } from '../lib/exportCsv';
import type { OperadoresResponse, ResumoPessoa, OcorrenciaVenda, TipoOcorrencia } from '../lib/reports';
import { PageContainer, PageHeader, KpiRow, KpiCard, DateRangeFilter, DataQualityBanner, QueryState, Badge, FilterChip, CardList, CardRow, CardMeta, type BadgeTone } from '../components/ui';

// Operadores de caixa (dono 24/09, openspec/changes/operadores-caixa): tudo o que passou por
// cada operador e vendedor, e toda ocorrencia ("erro") mostrando QUEM lancou a venda.
const TIPO: Record<TipoOcorrencia, { label: string; tone: BadgeTone }> = {
  cancelada: { label: 'Cancelada', tone: 'red' },
  desconto: { label: 'Desconto', tone: 'amber' },
  pago_a_menor: { label: 'Pago a menor', tone: 'orange' },
  sem_itens: { label: 'Sem itens', tone: 'purple' },
  pre_venda_zerada: { label: 'Pré-venda zerada', tone: 'slate' },
};
const LIMITES = [5, 10, 20, 30];

export function OperadoresPage(): JSX.Element {
  const [range, setRange] = useState<DateRange>(() => currentMonthRange());
  const [operador, setOperador] = useState<string | null>(null);      // filtra as ocorrencias
  const [tipo, setTipo] = useState<TipoOcorrencia | null>(null);
  const [limite, setLimite] = useState(10);                            // % de desconto que vira ocorrencia

  const q = useQuery({
    queryKey: ['operadores', range.from, range.to, operador, limite],
    queryFn: () => api<OperadoresResponse>(`/api/reports/operadores?${rangeQuery(range, { operador: operador ?? undefined, limiteDesconto: limite })}`),
  });
  const d = q.data;
  const ocorrencias = (d?.ocorrencias ?? []).filter((o) => !tipo || o.tipo === tipo);
  const fech = new Map((d?.fechamentos ?? []).map((f) => [f.operador, f]));

  const exportar = (): void => {
    exportToCsv(`ocorrencias_${range.from}_a_${range.to}_${todayStamp()}`, [
      { header: 'Dia', value: (o: OcorrenciaVenda) => formatBrDate(o.dia) },
      { header: 'Hora', value: (o) => (o.hora != null ? `${o.hora}h` : '') },
      { header: 'Tipo', value: (o) => TIPO[o.tipo].label },
      { header: 'Venda nº', value: (o) => o.vendaNumero },
      { header: 'Operador', value: (o) => o.operador },
      { header: 'Vendedor', value: (o) => o.vendedor },
      { header: 'Caixa', value: (o) => o.caixa },
      { header: 'Valor da venda', value: (o) => o.valor, money: true },
      { header: 'Diferença', value: (o) => o.diferenca, money: true },
      { header: 'Detalhe', value: (o) => o.detalhe },
    ], ocorrencias);
  };

  return (
    <PageContainer>
      <PageHeader title="Operadores" subtitle="O que passou por cada operador de caixa e vendedor. Toda ocorrência mostra quem lançou a venda." />
      <DateRangeFilter value={range} onChange={setRange} />
      <DataQualityBanner items={d?.avisos?.map((a) => ({ label: a, kind: 'info' as const }))} />

      <QueryState query={q} empty={d && d.operadores.length === 0 ? 'Nenhuma venda no período.' : undefined}>
        <KpiRow cols={4}>
          <KpiCard label="Vendas" value={String(d?.totais.vendas ?? 0)} compact sub={formatBRL(d?.totais.total ?? 0)} />
          <KpiCard label="Operadores" value={String(d?.operadores.filter((o) => o.vendas > 0).length ?? 0)} compact sub={`${d?.vendedores.length ?? 0} vendedores`} />
          <KpiCard label="Canceladas" value={String(d?.totais.canceladas ?? 0)} tone={(d?.totais.canceladas ?? 0) > 0 ? 'red' : 'default'} compact sub={formatBRL(d?.totais.valorCancelado ?? 0)} />
          <KpiCard label="Ocorrências" info="Venda cancelada, sem itens, pré-venda zerada, desconto acima do limite ou pagamento menor que a venda. Cada uma mostra o operador e o vendedor que lançaram." value={String(d?.totais.ocorrencias ?? 0)} tone="amber" compact highlight />
        </KpiRow>

        {/* Por operador de caixa: tocar filtra as ocorrencias daquele operador */}
        <section className="bg-white rounded-xl shadow-sm border p-4">
          <h3 className="font-semibold text-slate-700 mb-1">Por operador de caixa</h3>
          <p className="text-xs text-slate-500 mb-3">Toque num operador para ver só as ocorrências dele.</p>
          <TabelaPessoas rows={d?.operadores ?? []} selecionado={operador} onSelect={(n) => setOperador(operador === n ? null : n)} extra={(r) => {
            const f = fech.get(r.nome);
            return f ? `${f.fechados} fechamento(s)${f.abertos ? ` · ${f.abertos} aberto(s)` : ''}` : '—';
          }} extraHeader="Caixas" />
        </section>

        <section className="bg-white rounded-xl shadow-sm border p-4">
          <h3 className="font-semibold text-slate-700 mb-3">Por vendedor</h3>
          <TabelaPessoas rows={d?.vendedores ?? []} />
        </section>

        <section className="bg-white rounded-xl shadow-sm border p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-slate-700">
              Ocorrências {operador && <span className="text-slate-500 font-normal">de {operador}</span>}
              <span className="text-slate-400 font-normal text-sm"> · {ocorrencias.length}{d?.ocorrenciasTruncadas ? ` (das ${d.totalOcorrencias} mais recentes)` : ''}</span>
            </h3>
            <button type="button" onClick={exportar} className="text-xs px-3 py-1.5 rounded border bg-white hover:bg-slate-50">Exportar CSV</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <FilterChip active={tipo === null} onClick={() => setTipo(null)}>Todas</FilterChip>
            {(Object.keys(TIPO) as TipoOcorrencia[]).map((t) => (
              <FilterChip key={t} active={tipo === t} onClick={() => setTipo(tipo === t ? null : t)}>{TIPO[t].label}</FilterChip>
            ))}
            {operador && <FilterChip active onClick={() => setOperador(null)}>✕ {operador}</FilterChip>}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <span>Desconto vira ocorrência acima de</span>
            {LIMITES.map((l) => <FilterChip key={l} active={limite === l} onClick={() => setLimite(l)}>{l}%</FilterChip>)}
          </div>
          <CardList<OcorrenciaVenda>
            rows={ocorrencias}
            keyOf={(o, i) => `${o.vendaId}-${o.tipo}-${i}`}
            columns={[
              { key: 'dia', header: 'Dia', render: (o) => `${formatBrDate(o.dia)}${o.hora != null ? ` ${o.hora}h` : ''}` },
              { key: 'tipo', header: 'Ocorrência', render: (o) => <Badge tone={TIPO[o.tipo].tone} title={o.detalhe}>{TIPO[o.tipo].label}</Badge> },
              { key: 'venda', header: 'Venda nº', render: (o) => o.vendaNumero, className: 'font-mono text-xs' },
              { key: 'op', header: 'Operador', render: (o) => o.operador, className: 'font-medium' },
              { key: 'vend', header: 'Vendedor', render: (o) => o.vendedor },
              { key: 'cx', header: 'Caixa', render: (o) => o.caixa ?? '—' },
              { key: 'valor', header: 'Valor', align: 'right', render: (o) => formatBRL(o.valor) },
              { key: 'dif', header: 'Diferença', align: 'right', className: 'font-semibold', render: (o) => formatBRL(o.diferenca) },
            ]}
            renderCard={(o) => (
              <>
                <CardRow title={<span><Badge tone={TIPO[o.tipo].tone}>{TIPO[o.tipo].label}</Badge> venda {o.vendaNumero}</span>} sub={`${o.operador} · vendedor ${o.vendedor}`} right={formatBRL(o.diferenca)} />
                <CardMeta left={`${formatBrDate(o.dia)}${o.hora != null ? ` ${o.hora}h` : ''} · caixa ${o.caixa ?? '—'}`} right={`venda ${formatBRL(o.valor)}`} muted />
              </>
            )}
          />
        </section>
      </QueryState>
    </PageContainer>
  );
}

// Tabela/cards de operadores ou vendedores
function TabelaPessoas({ rows, selecionado, onSelect, extra, extraHeader }: {
  rows: ResumoPessoa[]; selecionado?: string | null; onSelect?: (nome: string) => void;
  extra?: (r: ResumoPessoa) => string; extraHeader?: string;
}): JSX.Element {
  return (
    <CardList<ResumoPessoa>
      rows={rows}
      keyOf={(r) => r.nome}
      onRowTap={onSelect ? (r) => onSelect(r.nome) : undefined}
      columns={[
        { key: 'nome', header: 'Nome', render: (r) => <span className={selecionado === r.nome ? 'font-semibold text-blue-700' : 'font-medium'}>{r.nome}</span> },
        { key: 'vendas', header: 'Vendas', align: 'right', render: (r) => r.vendas },
        { key: 'total', header: 'Total', align: 'right', render: (r) => formatBRL(r.total) },
        { key: 'ticket', header: 'Ticket médio', align: 'right', render: (r) => formatBRL(r.ticketMedio) },
        { key: 'canc', header: 'Canceladas', align: 'right', render: (r) => (r.canceladas ? <span className="text-red-700">{r.canceladas} · {formatBRL(r.valorCancelado)}</span> : '—') },
        { key: 'desc', header: 'Descontos', align: 'right', render: (r) => (r.descontos ? <span className="text-amber-700">{r.descontos} · {formatBRL(r.valorDesconto)}</span> : '—') },
        { key: 'oc', header: 'Ocorrências', align: 'right', className: 'font-semibold', render: (r) => r.ocorrencias || '—' },
        ...(extra ? [{ key: 'extra', header: extraHeader ?? '', render: (r: ResumoPessoa) => <span className="text-slate-500 text-xs">{extra(r)}</span> }] : []),
      ]}
      renderCard={(r) => (
        <>
          <CardRow title={<span className={selecionado === r.nome ? 'text-blue-700' : ''}>{r.nome}</span>} sub={`${r.vendas} vendas · ticket ${formatBRL(r.ticketMedio)}`} right={formatBRL(r.total)} />
          <CardMeta
            left={`${r.canceladas} cancel. · ${r.descontos} desc.${extra ? ` · ${extra(r)}` : ''}`}
            right={r.ocorrencias ? `${r.ocorrencias} ocorrência(s)` : 'sem ocorrência'}
            muted
          />
        </>
      )}
    />
  );
}
