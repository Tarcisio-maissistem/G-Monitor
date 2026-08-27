import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatBRL, formatCompactBRL, formatInt } from '../lib/masks';
import { currentMonthRange, rangeQuery, type DateRange } from '../lib/period';
import type { PrevistoResponse, FeeRule, FeeChannel } from '../lib/reports';
import { FEE_CHANNEL_LABEL, FEE_CHANNEL_COLOR, FEE_CHANNELS } from '../lib/feeChannels';
import { PageContainer, PageHeader, KpiRow, KpiCard, DateRangeFilter, DataQualityBanner, QueryState } from '../components/ui';
import { useToast } from '../components/Toast';
import { Spinner } from '../components/Spinner';

interface SettingsResp { settings: { feeRules?: FeeRule[] } }

// Conciliacao bancaria — Fase 2 (26/08): bruto x taxa x LIQUIDO PREVISTO por canal.
// A taxa NAO vem do GDOOR (TAXAS_CARTAO do cliente esta toda zerada, ver openspec D21) —
// o lojista cadastra aqui. Canal sem taxa cadastrada fica FORA do liquido, sinalizado, em vez
// de virar taxa zero (que inflaria o liquido). Fase 3 (extrato do portal TEF) ainda nao entrou.
export function ConciliacaoPage(): JSX.Element {
  const [range, setRange] = useState<DateRange>(() => currentMonthRange());
  const qc = useQueryClient();
  const toast = useToast();

  const prev = useQuery({
    queryKey: ['conciliacao-previsto', range.from, range.to],
    queryFn: () => api<PrevistoResponse>(`/api/reports/conciliacao/previsto?${rangeQuery(range)}`),
  });
  const settings = useQuery({ queryKey: ['tenant-settings'], queryFn: () => api<SettingsResp>('/api/tenant/settings') });

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

        <TaxasCard
          rules={settings.data?.settings.feeRules ?? []}
          loading={settings.isLoading}
          onSave={async (feeRules) => {
            await api('/api/tenant/settings', { method: 'PATCH', body: JSON.stringify({ feeRules }) });
            await qc.invalidateQueries({ queryKey: ['tenant-settings'] });
            await qc.invalidateQueries({ queryKey: ['conciliacao-previsto'] });
            toast.push({ type: 'success', message: 'Taxas salvas.' });
          }}
        />
      </QueryState>
    </PageContainer>
  );
}

// Cadastro de taxa por canal. Uma linha por canal (curinga: vale pra qualquer adquirente) —
// o detalhe por adquirente (Cielo x Rede) entra na Fase 1, quando MOVIMENTACAO_CARTAO for
// sincronizada e a transacao souber de qual maquininha veio.
function TaxasCard({ rules, loading, onSave }: { rules: FeeRule[]; loading: boolean; onSave(r: FeeRule[]): Promise<void> }): JSX.Element {
  const [draft, setDraft] = useState<Record<FeeChannel, { percent: string; fixedValue: string; daysToReceive: string }>>(() => blank());
  const [saving, setSaving] = useState(false);

  // recarrega o rascunho quando as regras chegam do servidor
  useEffect(() => {
    const next = blank();
    for (const r of rules) {
      if (!FEE_CHANNELS.includes(r.channel)) continue;
      next[r.channel] = { percent: String(r.percent), fixedValue: String(r.fixedValue ?? 0), daysToReceive: String(r.daysToReceive ?? 1) };
    }
    setDraft(next);
  }, [rules]);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    // linha em branco = canal sem taxa cadastrada (nao vira 0%)
    const out: FeeRule[] = FEE_CHANNELS.flatMap((ch) => {
      const v = draft[ch];
      if (v.percent.trim() === '') return [];
      return [{
        channel: ch, acquirer: null, installments: null,
        percent: Number(v.percent.replace(',', '.')) || 0,
        fixedValue: Number(v.fixedValue.replace(',', '.')) || 0,
        daysToReceive: parseInt(v.daysToReceive, 10) || 1,
      }];
    });
    setSaving(true);
    try { await onSave(out); } finally { setSaving(false); }
  };

  return (
    <section className="bg-white rounded-xl shadow-sm border p-5">
      <h3 className="font-semibold text-slate-700">Taxas por canal</h3>
      <p className="text-xs text-slate-500 mb-4">
        O GDOOR não guarda a taxa real (vem zerada), então cadastre aqui o que cada adquirente cobra.
        Deixe em branco o canal que você ainda não sabe — ele fica de fora do líquido, em vez de contar como taxa zero.
      </p>
      {loading ? (
        <div className="text-slate-400 text-sm flex items-center gap-2"><Spinner /> Carregando...</div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <div className="hidden sm:grid grid-cols-[1fr_5rem_6rem_6rem] gap-2 text-[11px] uppercase text-slate-500">
            <span>Canal</span><span className="text-right">Taxa %</span><span className="text-right">Fixo R$</span><span className="text-right">Cai em (dias)</span>
          </div>
          {FEE_CHANNELS.map((ch) => (
            <div key={ch} className="grid grid-cols-2 sm:grid-cols-[1fr_5rem_6rem_6rem] gap-2 items-center">
              <span className="col-span-2 sm:col-span-1 text-sm text-slate-700 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: FEE_CHANNEL_COLOR[ch] }} />
                {FEE_CHANNEL_LABEL[ch]}
              </span>
              <input inputMode="decimal" placeholder="—" value={draft[ch].percent}
                onChange={(e) => setDraft({ ...draft, [ch]: { ...draft[ch], percent: e.target.value } })}
                className="border rounded px-2 py-1.5 text-sm text-right" />
              <input inputMode="decimal" placeholder="0" value={draft[ch].fixedValue}
                onChange={(e) => setDraft({ ...draft, [ch]: { ...draft[ch], fixedValue: e.target.value } })}
                className="border rounded px-2 py-1.5 text-sm text-right" />
              <input inputMode="numeric" placeholder="1" value={draft[ch].daysToReceive}
                onChange={(e) => setDraft({ ...draft, [ch]: { ...draft[ch], daysToReceive: e.target.value } })}
                className="border rounded px-2 py-1.5 text-sm text-right" />
            </div>
          ))}
          <div className="flex justify-end pt-1">
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50 inline-flex items-center gap-2">
              {saving && <Spinner className="h-3.5 w-3.5" />}{saving ? 'Salvando...' : 'Salvar taxas'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function blank(): Record<FeeChannel, { percent: string; fixedValue: string; daysToReceive: string }> {
  return {
    pos_debito: { percent: '', fixedValue: '0', daysToReceive: '1' },
    pos_credito: { percent: '', fixedValue: '0', daysToReceive: '30' },
    pix_tef: { percent: '', fixedValue: '0', daysToReceive: '1' },
    pix_estatico: { percent: '', fixedValue: '0', daysToReceive: '1' },
  };
}
