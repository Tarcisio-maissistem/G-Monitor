import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

interface CaixaDetalhado {
  data: string;
  caixa: {
    entradas: number;
    saidas: number;
    saldo: number;
    saldoFisico: number;
    troco: number;
  };
  vendasPorDocumento: {
    nfce: { qtd: number; valor: number };
    nfe: { qtd: number; valor: number };
    prevenda: { qtd: number; valor: number };
  };
  movimentacoes: {
    recebimentos: { entrada: number; saida: number; qtd: number };
    suprimentos: { entrada: number; saida: number; qtd: number };
    sangrias: { entrada: number; saida: number; qtd: number };
    troco: { entrada: number; saida: number; qtd: number };
  };
  pagamentosVenda: Array<{ especie: string; valor: number; qtd: number }>;
  porCaixa: Array<{ caixa: string; entradas: number; saidas: number; saldo: number }>;
}

export function CaixaDetalhadoCard(): JSX.Element {
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10));
  const r = useQuery({
    queryKey: ['caixa-detalhado', data],
    queryFn: () => api<CaixaDetalhado>(`/api/reports/dashboard/cash-today-detailed?data=${data}`),
    refetchInterval: 30000,
  });

  const c = r.data;

  return (
    <div className="bg-white rounded-lg shadow p-5">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <h3 className="text-lg font-bold">Caixa Detalhado</h3>
          <p className="text-sm text-slate-500">Resumo operacional do dia ({c?.data ?? data})</p>
        </div>
        <input
          type="date"
          value={data}
          onChange={(e) => setData(e.target.value)}
          className="border rounded px-2 py-1 text-sm"
        />
      </div>

      {r.isLoading || !c ? (
        <div className="text-center py-12 text-slate-400">Carregando...</div>
      ) : (
        <div className="space-y-5">
          {/* Caixa */}
          <Section title="Caixa">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <MiniBox label="Entradas" value={formatBRL(c.caixa.entradas)} color="text-emerald-700" />
              <MiniBox label="Saídas" value={formatBRL(c.caixa.saidas)} color="text-red-700" />
              <MiniBox label="Saldo" value={formatBRL(c.caixa.saldo)} color={c.caixa.saldo >= 0 ? 'text-emerald-700' : 'text-red-700'} />
              <MiniBox label="Saldo Físico" value={formatBRL(c.caixa.saldoFisico)} sub="Saldo - Troco" />
              <MiniBox label="Troco" value={formatBRL(c.caixa.troco)} sub="Não compõe saída real" />
            </div>
          </Section>

          {/* Vendas por documento */}
          <Section title="Vendas por documento">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <DocBox label="NFC-e" qtd={c.vendasPorDocumento.nfce.qtd} valor={c.vendasPorDocumento.nfce.valor} />
              <DocBox label="NF-e" qtd={c.vendasPorDocumento.nfe.qtd} valor={c.vendasPorDocumento.nfe.valor} />
              <DocBox label="Pré-venda" qtd={c.vendasPorDocumento.prevenda.qtd} valor={c.vendasPorDocumento.prevenda.valor} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
              <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
                <div className="text-xs uppercase text-blue-700">Total Fiscal (NF-e + NFC-e)</div>
                <div className="text-xl font-bold text-blue-900">{formatBRL(c.vendasPorDocumento.nfce.valor + c.vendasPorDocumento.nfe.valor)}</div>
                <div className="text-xs text-blue-700">{c.vendasPorDocumento.nfce.qtd + c.vendasPorDocumento.nfe.qtd} documentos</div>
              </div>
              <div className="bg-purple-50 rounded-lg p-3 border border-purple-200">
                <div className="text-xs uppercase text-purple-700">Total de Pré-vendas</div>
                <div className="text-xl font-bold text-purple-900">{formatBRL(c.vendasPorDocumento.prevenda.valor)}</div>
                <div className="text-xs text-purple-700">{c.vendasPorDocumento.prevenda.qtd} vendas</div>
              </div>
            </div>
          </Section>

          {/* Movimentações do caixa */}
          <Section title="Movimentações do caixa">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <MovBox label="Recebimentos" valor={c.movimentacoes.recebimentos.entrada} qtd={c.movimentacoes.recebimentos.qtd} />
              <MovBox label="Suprimentos" valor={c.movimentacoes.suprimentos.entrada} qtd={c.movimentacoes.suprimentos.qtd} />
              <MovBox label="Sangrias" valor={c.movimentacoes.sangrias.saida} qtd={c.movimentacoes.sangrias.qtd} negative />
              <MovBox label="Troco" valor={c.movimentacoes.troco.entrada + c.movimentacoes.troco.saida} qtd={c.movimentacoes.troco.qtd} sub="Não compõe saída real" />
            </div>
          </Section>

          {/* Pagamentos de vendas */}
          <Section title="Pagamentos de vendas">
            {c.pagamentosVenda.length === 0 ? (
              <div className="text-sm text-slate-400">Sem pagamentos registrados.</div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
                {c.pagamentosVenda.map((p) => (
                  <div key={p.especie} className="bg-slate-50 rounded p-3 border">
                    <div className="text-xs uppercase text-slate-500 truncate" title={p.especie}>{p.especie}</div>
                    <div className="text-lg font-bold mt-1">{formatBRL(p.valor)}</div>
                    <div className="text-xs text-slate-500">{p.qtd} mov.</div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Resumo por caixa */}
          <Section title="Resumo por caixa">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">Caixa</th>
                    <th className="px-3 py-2 text-right">Entradas</th>
                    <th className="px-3 py-2 text-right">Saídas</th>
                    <th className="px-3 py-2 text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {c.porCaixa.length === 0 ? (
                    <tr><td colSpan={4} className="text-center text-slate-400 py-4">Sem movimentações por caixa.</td></tr>
                  ) : c.porCaixa.map((row, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-2 font-mono">{row.caixa}</td>
                      <td className="px-3 py-2 text-right text-emerald-700">{formatBRL(row.entradas)}</td>
                      <td className="px-3 py-2 text-right text-red-700">{formatBRL(row.saidas)}</td>
                      <td className={`px-3 py-2 text-right font-bold ${row.saldo >= 0 ? '' : 'text-red-700'}`}>{formatBRL(row.saldo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <h4 className="text-sm font-semibold text-slate-700 mb-2 uppercase tracking-wide">{title}</h4>
      {children}
    </div>
  );
}

function MiniBox({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }): JSX.Element {
  return (
    <div className="bg-slate-50 rounded-lg p-3 border">
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className={`text-lg font-bold mt-1 ${color ?? ''}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function DocBox({ label, qtd, valor }: { label: string; qtd: number; valor: number }): JSX.Element {
  return (
    <div className="bg-slate-50 rounded-lg p-3 border">
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className="text-lg font-bold mt-1">{formatBRL(valor)}</div>
      <div className="text-xs text-slate-500">{qtd} doc.</div>
    </div>
  );
}

function MovBox({ label, valor, qtd, negative, sub }: { label: string; valor: number; qtd: number; negative?: boolean; sub?: string }): JSX.Element {
  return (
    <div className="bg-slate-50 rounded-lg p-3 border">
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className={`text-lg font-bold mt-1 ${negative ? 'text-red-700' : valor > 0 ? 'text-emerald-700' : ''}`}>{formatBRL(valor)}</div>
      <div className="text-xs text-slate-500">{qtd} mov.</div>
      {sub && <div className="text-xs text-slate-400 italic mt-0.5">{sub}</div>}
    </div>
  );
}

function formatBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}
