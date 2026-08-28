import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { formatBRL } from '../../lib/masks';
import type { TaxaAdquirente, Modalidade } from '../../lib/reports';
import { useToast } from '../Toast';
import { Spinner } from '../Spinner';

interface SettingsResp { settings: { taxasAdquirente?: TaxaAdquirente[] } }

const MODALIDADE_LABEL: Record<Modalidade, string> = { debito: 'Débito', credito: 'Crédito', pix: 'PIX' };

// Tabela de taxas do CONTRATO: adquirente + bandeira + modalidade. É assim que a operadora
// cobra — "cartão de crédito" em bloco não representa (na Cielo, Elo débito é 1,23% e Elo
// crédito 3,23%). A bandeira só existe no extrato do portal, então é lá que o custo sai exato.
export function TaxasContrato(): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['tenant-settings'], queryFn: () => api<SettingsResp>('/api/tenant/settings') });
  const [linhas, setLinhas] = useState<TaxaAdquirente[]>([]);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => { setLinhas(q.data?.settings.taxasAdquirente ?? []); }, [q.data]);

  const set = (i: number, campo: keyof TaxaAdquirente, v: string): void => {
    const novo = [...linhas];
    const linha = { ...novo[i]! };
    if (campo === 'percent' || campo === 'fixedValue') (linha[campo] as number) = Number(v.replace(',', '.')) || 0;
    else if (campo === 'daysToReceive') linha.daysToReceive = parseInt(v, 10) || 0;
    else if (campo === 'bandeira') linha.bandeira = v.trim() === '' ? null : v.toUpperCase();
    else if (campo === 'modalidade') linha.modalidade = v as Modalidade;
    else if (campo === 'acquirer') linha.acquirer = v.toUpperCase();
    novo[i] = linha;
    setLinhas(novo);
  };

  const salvar = async (): Promise<void> => {
    setSalvando(true);
    try {
      await api('/api/tenant/settings', { method: 'PATCH', body: JSON.stringify({ taxasAdquirente: linhas }) });
      await qc.invalidateQueries({ queryKey: ['tenant-settings'] });
      toast.push({ type: 'success', message: 'Taxas salvas.' });
    } catch (e) {
      toast.push({ type: 'error', message: (e as Error).message });
    } finally { setSalvando(false); }
  };

  return (
    <section className="bg-white rounded-xl shadow-sm border p-5">
      <h3 className="font-semibold text-slate-700">Taxas do contrato</h3>
      <p className="text-xs text-slate-500 mb-4">
        Uma linha por <strong>adquirente + bandeira + modalidade</strong>, como a operadora cobra.
        Use a taxa <strong>efetiva</strong> (se houver antecipação embutida, some: 1,65% + 1,24% = 2,89%).
        Deixe a bandeira em branco para valer em todas as outras daquele adquirente.
      </p>

      {q.isLoading ? (
        <div className="text-slate-400 text-sm flex items-center gap-2"><Spinner /> Carregando...</div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[42rem]">
              <thead>
                <tr className="text-[11px] uppercase text-slate-500 border-b">
                  <th className="text-left pb-2">Adquirente</th>
                  <th className="text-left pb-2">Bandeira</th>
                  <th className="text-left pb-2">Modalidade</th>
                  <th className="text-right pb-2">Taxa %</th>
                  <th className="text-right pb-2">Fixo R$</th>
                  <th className="text-right pb-2">Cai em (dias)</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l, i) => (
                  <tr key={i} className="border-b border-slate-50">
                    <td className="py-1.5 pr-2"><input value={l.acquirer} onChange={(e) => set(i, 'acquirer', e.target.value)} className="w-24 border rounded px-2 py-1" placeholder="REDE" /></td>
                    <td className="py-1.5 pr-2"><input value={l.bandeira ?? ''} onChange={(e) => set(i, 'bandeira', e.target.value)} className="w-32 border rounded px-2 py-1" placeholder="(todas)" /></td>
                    <td className="py-1.5 pr-2">
                      <select value={l.modalidade} onChange={(e) => set(i, 'modalidade', e.target.value)} className="border rounded px-2 py-1 bg-white">
                        {(['debito', 'credito', 'pix'] as Modalidade[]).map((m) => <option key={m} value={m}>{MODALIDADE_LABEL[m]}</option>)}
                      </select>
                    </td>
                    <td className="py-1.5 pr-2 text-right"><input inputMode="decimal" value={String(l.percent)} onChange={(e) => set(i, 'percent', e.target.value)} className="w-20 border rounded px-2 py-1 text-right" /></td>
                    <td className="py-1.5 pr-2 text-right"><input inputMode="decimal" value={String(l.fixedValue ?? 0)} onChange={(e) => set(i, 'fixedValue', e.target.value)} className="w-20 border rounded px-2 py-1 text-right" /></td>
                    <td className="py-1.5 pr-2 text-right"><input inputMode="numeric" value={String(l.daysToReceive ?? 1)} onChange={(e) => set(i, 'daysToReceive', e.target.value)} className="w-16 border rounded px-2 py-1 text-right" /></td>
                    <td className="py-1.5 text-right">
                      <button onClick={() => setLinhas(linhas.filter((_, k) => k !== i))} className="text-red-600 hover:underline text-xs">remover</button>
                    </td>
                  </tr>
                ))}
                {linhas.length === 0 && (
                  <tr><td colSpan={7} className="py-6 text-center text-slate-400 text-sm">Nenhuma taxa cadastrada. Adicione uma linha por bandeira do seu contrato.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex justify-between items-center gap-2 mt-3 flex-wrap">
            <button
              onClick={() => setLinhas([...linhas, { acquirer: 'REDE', bandeira: null, modalidade: 'debito', percent: 0, fixedValue: 0, daysToReceive: 1 }])}
              className="text-sm text-blue-600 hover:underline"
            >
              + adicionar linha
            </button>
            <button onClick={() => void salvar()} disabled={salvando} className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50 inline-flex items-center gap-2">
              {salvando && <Spinner className="h-3.5 w-3.5" />}{salvando ? 'Salvando...' : 'Salvar taxas'}
            </button>
          </div>
        </>
      )}
    </section>
  );
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
