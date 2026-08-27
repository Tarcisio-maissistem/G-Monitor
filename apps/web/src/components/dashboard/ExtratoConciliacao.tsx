import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { formatBRL, formatCompactBRL, formatInt, formatBrDate } from '../../lib/masks';
import type { DateRange } from '../../lib/period';
import { rangeQuery } from '../../lib/period';
import type { ExtratoResponse, IntegracoesResponse } from '../../lib/reports';
import { KpiRow, KpiCard, Badge } from '../ui';
import { useToast } from '../Toast';
import { Spinner } from '../Spinner';

// Conciliação contra o extrato do portal da maquininha (Fase 3). A busca é SOB DEMANDA
// (botão), não automática: é raspagem autenticada no portal do fornecedor e uma coleta
// agendada quebraria calada. Ver openspec D25.
export function ExtratoConciliacao({ range }: { range: DateRange }): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [buscando, setBuscando] = useState(false);
  const [res, setRes] = useState<ExtratoResponse | null>(null);

  const integ = useQuery({ queryKey: ['integracoes'], queryFn: () => api<IntegracoesResponse>('/api/tenant/integracoes') });
  const cfg = integ.data?.getcard;

  const buscar = async (): Promise<void> => {
    setBuscando(true);
    try {
      setRes(await api<ExtratoResponse>(`/api/reports/conciliacao/extrato?${rangeQuery(range)}`));
    } catch (e) {
      toast.push({ type: 'error', message: (e as Error).message });
    } finally { setBuscando(false); }
  };

  return (
    <section className="bg-white rounded-xl shadow-sm border p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <h3 className="font-semibold text-slate-700">Extrato da maquininha</h3>
          <p className="text-xs text-slate-500">
            Compara, transação a transação, o que a adquirente registrou com o que entrou no sistema.
          </p>
        </div>
        <button
          onClick={() => void buscar()}
          disabled={buscando || !cfg?.temSenha}
          title={cfg?.temSenha ? '' : 'Cadastre a credencial do portal primeiro'}
          className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50 inline-flex items-center gap-2 shrink-0"
        >
          {buscando && <Spinner className="h-3.5 w-3.5" />}{buscando ? 'Buscando no portal...' : 'Buscar extrato'}
        </button>
      </div>

      <CredencialGetcard atual={cfg} onSaved={() => void qc.invalidateQueries({ queryKey: ['integracoes'] })} />

      {res && (
        <div className="mt-5 space-y-4">
          <KpiRow cols={3}>
            <KpiCard label="Conciliado" info="Transações que aparecem nos dois lados, com o mesmo valor no mesmo dia." value={formatInt(res.totais.conciliados)} tone="emerald" compact sub={`de ${formatInt(res.totais.extratoQtd)} no extrato`} />
            <KpiCard label="Cobrou, não virou venda" info="Passou na maquininha e foi aprovado, mas não existe venda correspondente no sistema. É o dinheiro que some." value={formatCompactBRL(res.totais.valorSoNoExtrato)} tone={res.totais.soNoExtrato > 0 ? 'red' : 'emerald'} compact sub={`${formatInt(res.totais.soNoExtrato)} transações`} />
            <KpiCard label="Só no sistema" info="Registrado como cartão no sistema, mas sem transação correspondente no extrato — pode ser outra maquininha ou erro de lançamento." value={formatCompactBRL(res.totais.valorSoNoSistema)} tone={res.totais.soNoSistema > 0 ? 'amber' : 'emerald'} compact sub={`${formatInt(res.totais.soNoSistema)} lançamentos`} />
          </KpiRow>

          {res.diasIgnorados.length > 0 && (
            <div className="bg-slate-50 border text-slate-600 px-4 py-2.5 rounded-lg text-xs">
              {res.diasIgnorados.length} dia(s) fora da comparação por ainda não terem sincronizado:{' '}
              {res.diasIgnorados.map((d) => formatBrDate(d)).join(', ')}. Sem isso, esses dias apareceriam como cobrança perdida.
            </div>
          )}

          {res.problemas.length === 0 ? (
            <p className="text-sm text-emerald-700">✓ Tudo casado no período — nenhuma transação sobrando de nenhum lado.</p>
          ) : (
            <div>
              <div className="text-xs font-medium text-slate-600 mb-2">O que não bateu</div>
              <div className="divide-y">
                {res.problemas.map((p, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <div className="text-sm text-slate-800">
                        {p.estado === 'so_no_extrato' ? 'Cobrou e não virou venda' : 'Só no sistema'}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {formatBrDate(p.data)}
                        {p.extrato ? ` · ${p.extrato.hora} · PDV ${p.extrato.pdv} · ${p.extrato.adquirente} · NSU ${p.extrato.nsu} · aut ${p.extrato.autorizacao}` : ''}
                        {p.sistema ? ` · ${p.sistema.hora} · ${p.sistema.forma}` : ''}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={`text-sm font-semibold ${p.estado === 'so_no_extrato' ? 'text-red-700' : 'text-amber-700'}`}>{formatBRL(p.valor)}</div>
                      <Badge tone={p.estado === 'so_no_extrato' ? 'red' : 'amber'}>{p.estado === 'so_no_extrato' ? 'no extrato' : 'no sistema'}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-[11px] text-slate-400">
            Extrato: {formatInt(res.extrato.autorizadas)} transações autorizadas ({formatInt(res.extrato.linhas)} lidas, {res.extrato.paginas} páginas) ·
            {' '}Sistema: {formatInt(res.totais.sistemaQtd)} pagamentos de cartão.
          </p>
        </div>
      )}
    </section>
  );
}

// Usuário/senha do portal. A senha SÓ vai daqui pra lá — a API nunca devolve, nem mascarada.
function CredencialGetcard({ atual, onSaved }: { atual: { user: string | null; temSenha: boolean } | undefined; onSaved(): void }): JSX.Element {
  const [aberto, setAberto] = useState(false);
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [salvando, setSalvando] = useState(false);
  const toast = useToast();

  const salvar = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setSalvando(true);
    try {
      await api('/api/tenant/integracoes/getcard', { method: 'PUT', body: JSON.stringify({ user, ...(pass ? { password: pass } : {}) }) });
      toast.push({ type: 'success', message: 'Credencial salva (senha guardada cifrada).' });
      setPass(''); setAberto(false); onSaved();
    } catch (err) {
      toast.push({ type: 'error', message: (err as Error).message });
    } finally { setSalvando(false); }
  };

  if (!aberto) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-500">
        {atual?.temSenha
          ? <>🔒 Portal conectado como <span className="font-medium text-slate-700">{atual.user}</span> · senha guardada cifrada</>
          : <>⚠ Portal ainda não conectado</>}
        <button onClick={() => { setUser(atual?.user ?? ''); setAberto(true); }} className="text-blue-600 hover:underline">
          {atual?.temSenha ? 'trocar' : 'conectar'}
        </button>
      </div>
    );
  }
  return (
    <form onSubmit={salvar} className="bg-slate-50 border rounded-lg p-3 space-y-2">
      <div className="grid sm:grid-cols-2 gap-2">
        <label className="block">
          <span className="block text-[11px] uppercase text-slate-500 mb-1">Usuário do portal</span>
          <input value={user} onChange={(e) => setUser(e.target.value)} required className="w-full border rounded px-2 py-1.5 text-sm" placeholder="CNPJ só números" />
        </label>
        <label className="block">
          <span className="block text-[11px] uppercase text-slate-500 mb-1">Senha {atual?.temSenha && '(em branco = mantém)'}</span>
          <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm" placeholder="••••••••" />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setAberto(false)} className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded">Cancelar</button>
        <button type="submit" disabled={salvando} className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50 inline-flex items-center gap-1.5">
          {salvando && <Spinner className="h-3 w-3" />}Salvar
        </button>
      </div>
    </form>
  );
}
