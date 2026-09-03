import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { formatBRL } from '../../lib/masks';
import type { TaxaAdquirente, Modalidade, Adquirente, Roteamento } from '../../lib/reports';
import { useToast } from '../Toast';
import { Spinner } from '../Spinner';

interface SettingsResp { settings: { taxasAdquirente?: TaxaAdquirente[]; adquirentes?: Adquirente[]; roteamento?: Roteamento } }

const MODALIDADE_LABEL: Record<Modalidade, string> = { debito: 'Débito', credito: 'Crédito', pix: 'PIX', beneficio: 'Benefício' };
const MODALIDADES: Modalidade[] = ['debito', 'credito', 'pix', 'beneficio'];

// Configuração de adquirentes + taxas (reorganizada 01/09 a pedido do dono):
// - separada POR ADQUIRENTE (cartão com banco de recebimento, número lógico, canais);
// - TEF e POS usam as MESMAS regras — não existe taxa duplicada por canal;
// - cada linha traz taxa base + antecipação D1 + EFETIVA (quem desconta é a efetiva);
// - roteamento define o adquirente PRINCIPAL de cada modalidade (débito→REDE etc.);
// - linha inativa (ex.: VR/Alelo sem taxa informada) fica cadastrada mas fora do cálculo.
export function TaxasContrato(): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['tenant-settings'], queryFn: () => api<SettingsResp>('/api/tenant/settings') });
  const [linhas, setLinhas] = useState<TaxaAdquirente[]>([]);
  const [adquirentes, setAdquirentes] = useState<Adquirente[]>([]);
  const [roteamento, setRoteamento] = useState<Roteamento>({});
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    setLinhas(q.data?.settings.taxasAdquirente ?? []);
    setAdquirentes(q.data?.settings.adquirentes ?? []);
    setRoteamento(q.data?.settings.roteamento ?? {});
  }, [q.data]);

  // Grupos: todo adquirente cadastrado + qualquer um que só exista nas linhas de taxa.
  const nomes = [...new Set([...adquirentes.map((a) => a.nome), ...linhas.map((l) => l.acquirer)])];

  const setLinha = (idx: number, patch: Partial<TaxaAdquirente>): void => {
    setLinhas(linhas.map((l, k) => (k === idx ? { ...l, ...patch } : l)));
  };
  const num = (v: string): number => Number(v.replace(',', '.')) || 0;
  const setAdq = (nome: string, patch: Partial<Adquirente>): void => {
    setAdquirentes(adquirentes.some((a) => a.nome === nome)
      ? adquirentes.map((a) => (a.nome === nome ? { ...a, ...patch } : a))
      : [...adquirentes, { nome, banco: '', numeroLogico: null, uso: ['tef', 'pos'], ativo: true, ...patch }]);
  };

  const salvar = async (): Promise<void> => {
    setSalvando(true);
    try {
      // adquirente que aparece nas linhas mas não tem ficha ganha uma ficha padrão ao salvar
      const fichas = nomes.map((n) => adquirentes.find((a) => a.nome === n) ?? { nome: n, banco: '', numeroLogico: null, uso: ['tef', 'pos'] as Array<'tef' | 'pos'>, ativo: true });
      await api('/api/tenant/settings', { method: 'PATCH', body: JSON.stringify({ taxasAdquirente: linhas, adquirentes: fichas, roteamento }) });
      await qc.invalidateQueries({ queryKey: ['tenant-settings'] });
      toast.push({ type: 'success', message: 'Configuração salva.' });
    } catch (e) {
      toast.push({ type: 'error', message: (e as Error).message });
    } finally { setSalvando(false); }
  };

  if (q.isLoading) {
    return <section className="bg-white rounded-xl shadow-sm border p-5 text-slate-400 text-sm flex items-center gap-2"><Spinner /> Carregando...</section>;
  }

  return (
    <section className="bg-white rounded-xl shadow-sm border p-5 space-y-5">
      <div>
        <h3 className="font-semibold text-slate-700">Adquirentes e taxas</h3>
        <p className="text-xs text-slate-500 mt-1">
          TEF e POS usam as <strong>mesmas taxas</strong>. Quem desconta é a taxa <strong>efetiva</strong> —
          se preencher base + D1, a efetiva soma sozinha. Linha desativada fica fora do cálculo.
        </p>
      </div>

      {/* Adquirente principal por modalidade (roteamento) */}
      <div className="border rounded-lg p-3 bg-slate-50">
        <div className="text-xs font-semibold uppercase text-slate-500 mb-2">Adquirente principal por modalidade</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {MODALIDADES.map((m) => (
            <label key={m} className="text-xs text-slate-600">
              {MODALIDADE_LABEL[m]}
              <select
                value={roteamento[m] ?? ''}
                onChange={(e) => setRoteamento({ ...roteamento, [m]: e.target.value || undefined })}
                className="mt-1 w-full border rounded px-2 py-1 bg-white text-sm"
              >
                <option value="">—</option>
                {nomes.map((n) => <option key={n} value={n}>{n}{bancoDe(adquirentes, n) ? ` → ${bancoDe(adquirentes, n)}` : ''}</option>)}
              </select>
            </label>
          ))}
        </div>
      </div>

      {/* Um cartão por adquirente */}
      {nomes.map((nome) => {
        const a = adquirentes.find((x) => x.nome === nome) ?? { nome, banco: '', numeroLogico: null, uso: ['tef', 'pos'] as Array<'tef' | 'pos'>, ativo: true };
        const doAdq = linhas.map((l, idx) => ({ l, idx })).filter(({ l }) => l.acquirer === nome);
        return (
          <div key={nome} className="border rounded-lg p-3">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="font-semibold text-slate-700">{nome}</span>
              <input value={a.banco} onChange={(e) => setAdq(nome, { banco: e.target.value })} placeholder="Banco de recebimento" className="border rounded px-2 py-1 text-xs w-40" />
              <input value={a.numeroLogico ?? ''} onChange={(e) => setAdq(nome, { numeroLogico: e.target.value || null })} placeholder="Nº lógico" className="border rounded px-2 py-1 text-xs w-28" />
              {(['tef', 'pos'] as const).map((c) => (
                <label key={c} className="text-xs text-slate-600 inline-flex items-center gap-1">
                  <input type="checkbox" checked={a.uso.includes(c)} onChange={(e) => setAdq(nome, { uso: e.target.checked ? [...new Set([...a.uso, c])] : a.uso.filter((u) => u !== c) })} />
                  {c.toUpperCase()}
                </label>
              ))}
              <label className="text-xs text-slate-600 inline-flex items-center gap-1 ml-auto">
                <input type="checkbox" checked={a.ativo} onChange={(e) => setAdq(nome, { ativo: e.target.checked })} /> ativo
              </label>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[46rem]">
                <thead>
                  <tr className="text-[11px] uppercase text-slate-500 border-b">
                    <th className="text-left pb-1">Bandeira</th>
                    <th className="text-left pb-1">Modalidade</th>
                    <th className="text-right pb-1">Base %</th>
                    <th className="text-right pb-1">D1 %</th>
                    <th className="text-right pb-1">Efetiva %</th>
                    <th className="text-right pb-1">Cai em (dias)</th>
                    <th className="text-center pb-1">Ativa</th>
                    <th className="pb-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {doAdq.map(({ l, idx }) => (
                    <tr key={idx} className={`border-b border-slate-50 ${l.ativo === false ? 'opacity-50' : ''}`}>
                      <td className="py-1.5 pr-2"><input value={l.bandeira ?? ''} onChange={(e) => setLinha(idx, { bandeira: e.target.value.trim() === '' ? null : e.target.value.toUpperCase() })} className="w-28 border rounded px-2 py-1" placeholder="(todas)" /></td>
                      <td className="py-1.5 pr-2">
                        <select value={l.modalidade} onChange={(e) => setLinha(idx, { modalidade: e.target.value as Modalidade })} className="border rounded px-2 py-1 bg-white">
                          {MODALIDADES.map((m) => <option key={m} value={m}>{MODALIDADE_LABEL[m]}</option>)}
                        </select>
                      </td>
                      {/* base/D1 informativos: preencher os dois recalcula a efetiva; editar só a efetiva também vale */}
                      <td className="py-1.5 pr-2 text-right"><input inputMode="decimal" value={l.taxaBase ?? ''} onChange={(e) => { const b = num(e.target.value); setLinha(idx, { taxaBase: e.target.value === '' ? null : b, percent: e.target.value !== '' && l.taxaD1 != null ? +(b + l.taxaD1).toFixed(4) : l.percent }); }} className="w-16 border rounded px-2 py-1 text-right" /></td>
                      <td className="py-1.5 pr-2 text-right"><input inputMode="decimal" value={l.taxaD1 ?? ''} onChange={(e) => { const d = num(e.target.value); setLinha(idx, { taxaD1: e.target.value === '' ? null : d, percent: e.target.value !== '' && l.taxaBase != null ? +(l.taxaBase + d).toFixed(4) : l.percent }); }} className="w-16 border rounded px-2 py-1 text-right" /></td>
                      <td className="py-1.5 pr-2 text-right"><input inputMode="decimal" value={String(l.percent)} onChange={(e) => setLinha(idx, { percent: num(e.target.value) })} className="w-16 border rounded px-2 py-1 text-right font-semibold" /></td>
                      <td className="py-1.5 pr-2 text-right"><input inputMode="numeric" value={String(l.daysToReceive ?? 1)} onChange={(e) => setLinha(idx, { daysToReceive: parseInt(e.target.value, 10) || 0 })} className="w-14 border rounded px-2 py-1 text-right" /></td>
                      <td className="py-1.5 text-center"><input type="checkbox" checked={l.ativo !== false} onChange={(e) => setLinha(idx, { ativo: e.target.checked })} /></td>
                      <td className="py-1.5 text-right"><button onClick={() => setLinhas(linhas.filter((_, k) => k !== idx))} className="text-red-600 hover:underline text-xs">remover</button></td>
                    </tr>
                  ))}
                  {doAdq.length === 0 && <tr><td colSpan={8} className="py-3 text-center text-slate-400 text-xs">Sem taxas neste adquirente.</td></tr>}
                </tbody>
              </table>
            </div>
            <button onClick={() => setLinhas([...linhas, { acquirer: nome, bandeira: null, modalidade: 'debito', percent: 0, fixedValue: 0, daysToReceive: 1, ativo: true }])} className="text-xs text-blue-600 hover:underline mt-1">
              + taxa em {nome}
            </button>
          </div>
        );
      })}

      <div className="flex justify-between items-center gap-2 flex-wrap">
        <button
          onClick={() => { const nome = prompt('Nome do adquirente (ex.: REDE, CIELO, SHIPAY):'); if (nome?.trim()) setAdq(nome.trim().toUpperCase(), {}); }}
          className="text-sm text-blue-600 hover:underline"
        >
          + adicionar adquirente
        </button>
        <button onClick={() => void salvar()} disabled={salvando} className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50 inline-flex items-center gap-2">
          {salvando && <Spinner className="h-3.5 w-3.5" />}{salvando ? 'Salvando...' : 'Salvar configuração'}
        </button>
      </div>
    </section>
  );
}

function bancoDe(adquirentes: Adquirente[], nome: string): string {
  return adquirentes.find((a) => a.nome === nome)?.banco ?? '';
}

// Custo real calculado sobre o extrato (por bandeira). Só aparece depois de buscar o extrato.
export function CustoPorBandeiraCard({ custo }: { custo: import('../../lib/reports').ResumoCusto }): JSX.Element | null {
  if (custo.porBandeira.length === 0) return null;
  return (
    <div className="mt-4">
      <div className="text-xs font-medium text-slate-600 mb-2">
        Custo por bandeira {custo.taxaEfetivaPct != null && <span className="text-slate-400">· taxa efetiva {custo.taxaEfetivaPct.toFixed(2)}%</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase text-slate-500 border-b">
              <th className="text-left pb-1">Adquirente / bandeira</th>
              <th className="text-right pb-1">Bruto</th>
              <th className="text-right pb-1">Taxa</th>
              <th className="text-right pb-1">Custo</th>
              <th className="text-right pb-1">Líquido</th>
            </tr>
          </thead>
          <tbody>
            {custo.porBandeira.map((b, i) => (
              <tr key={i} className="border-b border-slate-50">
                <td className="py-1.5 text-slate-700">{b.acquirer} · {b.bandeira}</td>
                <td className="py-1.5 text-right">{formatBRL(b.bruto)}</td>
                <td className="py-1.5 text-right text-slate-500">{b.percent != null ? `${b.percent}%` : <span className="text-amber-700">sem taxa</span>}</td>
                <td className="py-1.5 text-right text-red-700">{formatBRL(b.taxa)}</td>
                <td className="py-1.5 text-right font-medium text-emerald-700">{formatBRL(b.liquido)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="py-2">Total</td>
              <td className="py-2 text-right">{formatBRL(custo.bruto)}</td>
              <td></td>
              <td className="py-2 text-right text-red-700">{formatBRL(custo.taxa)}</td>
              <td className="py-2 text-right text-emerald-700">{formatBRL(custo.liquido)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {custo.semRegra.transacoes > 0 && (
        <p className="text-[11px] text-amber-700 mt-2">
          {custo.semRegra.transacoes} transação(ões) somando {formatBRL(custo.semRegra.bruto)} ficaram FORA da conta por não terem taxa cadastrada.
        </p>
      )}
    </div>
  );
}
