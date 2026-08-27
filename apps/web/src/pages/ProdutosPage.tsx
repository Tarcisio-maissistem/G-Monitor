import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Pagination } from '../components/ui';

interface Product {
  id: string;
  sourceCode: string;
  description: string;
  unit: string | null;
  stock: number | null;
  costPrice: number | null;
  salePrice: number | null;
}

interface ProductsResponse {
  data: Product[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  meta: { lastSyncedAt: string | null };
}

export function ProdutosPage(): JSX.Element {
  const [search, setSearch] = useState('');
  const [searchDeb, setSearchDeb] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  useMemo(() => {
    const t = setTimeout(() => setSearchDeb(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (searchDeb) qs.set('search', searchDeb);

  const products = useQuery({
    queryKey: ['produtos', searchDeb, page, pageSize],
    queryFn: () => api<ProductsResponse>(`/api/reports/products?${qs.toString()}`),
  });

  const rows = products.data?.data ?? [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div>
        <h2 className="text-2xl font-bold">Produtos</h2>
        <p className="text-sm text-slate-500 mt-1">Catálogo de produtos sincronizado do ESTOQUE do GDOOR.</p>
      </div>

      <div className="bg-white rounded-lg shadow p-3 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[260px]">
          <label className="block text-xs uppercase text-slate-500 mb-1">Buscar (código ou descrição)</label>
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Digite parte do nome ou código"
            className="w-full border rounded px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs uppercase text-slate-500 mb-1">Por página</label>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            className="border rounded px-2 py-1 text-sm bg-white"
          >
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={250}>250</option>
          </select>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        {products.isLoading ? (
          <div className="p-12 text-center text-slate-400">Carregando...</div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            Nenhum produto encontrado.{' '}
            <span className="block text-xs mt-2">
              Os produtos aparecem conforme o agente sincroniza. Pode levar alguns minutos depois da instalação.
            </span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                <tr>
                  <th className="px-4 py-2 text-left">Código</th>
                  <th className="px-4 py-2 text-left">Descrição</th>
                  <th className="px-4 py-2 text-left">Unidade</th>
                  <th className="px-4 py-2 text-right">Estoque</th>
                  <th className="px-4 py-2 text-right">Custo</th>
                  <th className="px-4 py-2 text-right">Preço</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t hover:bg-slate-50">
                    <td className="px-4 py-2 font-mono">{r.sourceCode}</td>
                    <td className="px-4 py-2">{r.description}</td>
                    <td className="px-4 py-2 text-slate-600">{r.unit ?? '-'}</td>
                    <td className="px-4 py-2 text-right">{r.stock != null ? r.stock.toLocaleString('pt-BR') : '-'}</td>
                    <td className="px-4 py-2 text-right text-slate-600">
                      {r.costPrice != null ? formatBRL(r.costPrice) : '-'}
                    </td>
                    <td className="px-4 py-2 text-right font-medium">
                      {r.salePrice != null ? formatBRL(r.salePrice) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {products.data && products.data.pagination.totalPages > 1 && (
          <Pagination
            page={products.data.pagination.page}
            totalPages={products.data.pagination.totalPages}
            total={products.data.pagination.total}
            pageSize={products.data.pagination.pageSize}
            onChange={setPage}
          />
        )}
      </div>
    </div>
  );
}

function formatBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}
