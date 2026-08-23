import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

interface ProductRow {
  productCode: string | null;
  description: string | null;
  qtd: number;
  value: number;
}

interface Resp {
  top: ProductRow[];
  bottom: ProductRow[];
}

export function RankingProdutos(): JSX.Element {
  const today = useMemo(() => new Date(), []);
  const [from, setFrom] = useState(() => {
    const d = new Date(today);
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(today.toISOString().slice(0, 10));

  const r = useQuery({
    queryKey: ['top-bottom-products', from, to],
    queryFn: () => api<Resp>(`/api/reports/dashboard/top-bottom-products?from=${from}&to=${to}&limit=10`),
  });

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <div>
          <h3 className="font-semibold text-lg">Ranking de Produtos</h3>
          <p className="text-xs text-slate-500">Mais e Menos Vendidos</p>
        </div>
        <div className="flex gap-2 items-end">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border rounded px-2 py-1 text-sm" />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border rounded px-2 py-1 text-sm" />
        </div>
      </div>

      {r.isLoading ? (
        <div className="text-center py-8 text-slate-400">Carregando...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ProductList title="Mais Vendidos" rows={r.data?.top ?? []} color="emerald" />
          <ProductList title="Menos Vendidos" rows={r.data?.bottom ?? []} color="red" />
        </div>
      )}
    </div>
  );
}

function ProductList({ title, rows, color }: { title: string; rows: ProductRow[]; color: 'emerald' | 'red' }): JSX.Element {
  const colors = color === 'emerald' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800';
  return (
    <div>
      <h4 className="font-semibold mb-2">{title}</h4>
      {rows.length === 0 ? (
        <div className="text-center text-slate-400 py-6 text-sm">
          Sem dados. Itens de venda dependem do sync (v0.5.0+).
        </div>
      ) : (
        <ol className="divide-y border rounded-lg">
          {rows.map((p, i) => (
            <li key={`${p.productCode}-${i}`} className="px-3 py-2 flex justify-between gap-2">
              <div className="flex gap-2 items-center min-w-0 flex-1">
                <span className={`text-xs font-bold rounded w-6 h-6 flex items-center justify-center ${colors}`}>{i + 1}</span>
                <div className="min-w-0">
                  <div className="font-medium truncate text-sm" title={p.description ?? ''}>{p.description ?? '-'}</div>
                  <div className="text-xs text-slate-500">{p.qtd.toLocaleString('pt-BR')} un · {formatBRL(p.value)}</div>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function formatBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}
