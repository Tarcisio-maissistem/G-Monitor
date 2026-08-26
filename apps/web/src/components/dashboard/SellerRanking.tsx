import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { formatBRL, formatInt, formatPct } from '../../lib/masks';
import type { SellerRankingResponse, SellerRow2 } from '../../lib/reports';

// Ranking por VENDEDOR (VENDAS.VENDEDOR), não pelo operador de caixa — decisão do dono
// 25/08. cobertura avisa quanto do faturamento tem vendedor identificado (64% na prod).
export function SellerRanking({ from, to, storeId }: { from: string; to: string; storeId?: string }): JSX.Element {
  const [todos, setTodos] = useState(false);
  const q = useQuery({
    queryKey: ['seller-ranking', from, to, storeId],
    queryFn: () => api<Omit<SellerRankingResponse, 'data'> & { data: SellerRow2[] }>(`/api/reports/dashboard/seller-ranking?from=${from}&to=${to}${storeId ? `&storeId=${storeId}` : ''}`),
  });
  const rows = q.data?.data ?? [];
  const maxTotal = rows[0]?.total ?? 0;

  return (
    <section className="bg-white rounded-xl shadow-sm border p-5">
      <div className="flex items-baseline justify-between mb-4 gap-2">
        <h3 className="font-semibold text-slate-700">Ranking de Vendedores</h3>
        {q.data && q.data.cobertura < 0.95 && (
          <span className="text-[11px] text-slate-400">{formatPct(q.data.cobertura * 100, 0)} com vendedor</span>
        )}
      </div>

      {q.isLoading ? (
        <div className="text-slate-400 text-sm py-4">Carregando...</div>
      ) : rows.length === 0 ? (
        <div className="text-slate-400 text-sm py-4 text-center">Nenhuma venda com vendedor no período.</div>
      ) : (
        <div className="space-y-3">
          {rows.slice(0, todos ? 100 : 8).map((r, i) => (
            <div key={r.seller ?? i}>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-xs text-slate-400 w-5 shrink-0">{i + 1}º</span>
                <span className="flex-1 min-w-0 truncate text-slate-700 font-medium">{r.seller}</span>
                {/* variacao vs periodo anterior de mesmo tamanho (doc do dono, Parte 4) */}
                {r.variacaoPct !== null && (
                  <span className={`text-[11px] shrink-0 ${r.variacaoPct >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{r.variacaoPct >= 0 ? '▲' : '▼'}{Math.abs(r.variacaoPct).toFixed(0)}%</span>
                )}
                <span className="text-slate-800 font-semibold w-24 text-right shrink-0">{formatBRL(r.total)}</span>
              </div>
              <div className="ml-7 text-[11px] text-slate-400 flex gap-3">
                <span>{formatInt(r.vendas)} vendas</span><span>ticket {formatBRL(r.ticket)}</span><span>{formatPct(r.pct * 100, 0)} do total</span>
              </div>
              {/* barra proporcional ao 1º colocado — leitura rápida de quem puxa a venda */}
              <div className="mt-1 ml-7 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                <div className="bg-blue-500 h-full rounded-full" style={{ width: `${maxTotal > 0 ? (r.total / maxTotal) * 100 : 0}%` }} />
              </div>
            </div>
          ))}
          {rows.length > 8 && (
            <button onClick={() => setTodos((v) => !v)} className="w-full text-center text-xs text-blue-600 hover:text-blue-800 pt-1">
              {todos ? 'ver menos' : `ver todos (${rows.length})`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
