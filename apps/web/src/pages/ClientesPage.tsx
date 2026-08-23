import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { applyCpfOrCnpj, applyPhone } from '../lib/masks';

interface Customer {
  id: string;
  sourceId: string;
  name: string | null;
  document: string | null;
  phone: string | null;
  totalCompras: number;
  valorTotal: number;
}

interface CustomersResponse {
  data: Customer[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  meta: { lastSyncedAt: string | null };
}

export function ClientesPage(): JSX.Element {
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

  const customers = useQuery({
    queryKey: ['clientes', searchDeb, page, pageSize],
    queryFn: () => api<CustomersResponse>(`/api/reports/customers?${qs.toString()}`),
  });

  const rows = customers.data?.data ?? [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div>
        <h2 className="text-2xl font-bold">Clientes</h2>
        <p className="text-sm text-slate-500 mt-1">
          Cadastro de clientes sincronizado do GDOOR. Mostra também total de compras de cada um.
        </p>
      </div>

      <div className="bg-white rounded-lg shadow p-3 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[260px]">
          <label className="block text-xs uppercase text-slate-500 mb-1">Buscar (nome, código ou CPF/CNPJ)</label>
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Digite parte do nome ou documento"
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
        {customers.isLoading ? (
          <div className="p-12 text-center text-slate-400">Carregando...</div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            Nenhum cliente encontrado.
            <span className="block text-xs mt-2">
              Os clientes aparecem conforme o agente sincroniza. Pode levar alguns minutos depois da instalação.
            </span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                <tr>
                  <th className="px-4 py-2 text-left">Código</th>
                  <th className="px-4 py-2 text-left">Nome</th>
                  <th className="px-4 py-2 text-left">CPF/CNPJ</th>
                  <th className="px-4 py-2 text-left">Telefone</th>
                  <th className="px-4 py-2 text-right">Compras</th>
                  <th className="px-4 py-2 text-right">Valor Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t hover:bg-slate-50">
                    <td className="px-4 py-2 font-mono">{r.sourceId}</td>
                    <td className="px-4 py-2 font-medium">{r.name ?? '-'}</td>
                    <td className="px-4 py-2 text-slate-600">{r.document ? applyCpfOrCnpj(r.document) : '-'}</td>
                    <td className="px-4 py-2 text-slate-600">{r.phone ? applyPhone(r.phone) : '-'}</td>
                    <td className="px-4 py-2 text-right">{r.totalCompras.toLocaleString('pt-BR')}</td>
                    <td className="px-4 py-2 text-right font-medium">{formatBRL(r.valorTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {customers.data && customers.data.pagination.totalPages > 1 && (
          <div className="border-t px-4 py-3 flex justify-between items-center text-sm">
            <div className="text-slate-500">
              {(customers.data.pagination.page - 1) * customers.data.pagination.pageSize + 1} -{' '}
              {Math.min(customers.data.pagination.page * customers.data.pagination.pageSize, customers.data.pagination.total)} de{' '}
              {customers.data.pagination.total.toLocaleString('pt-BR')}
            </div>
            <div className="flex gap-2 items-center">
              <button
                onClick={() => setPage(1)}
                disabled={page === 1}
                className="px-2 py-1 border rounded text-xs disabled:opacity-50 hover:bg-slate-50"
              >
                ⏮
              </button>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-2 py-1 border rounded text-xs disabled:opacity-50 hover:bg-slate-50"
              >
                ←
              </button>
              <span className="text-slate-600">
                {page} / {customers.data.pagination.totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(customers.data!.pagination.totalPages, p + 1))}
                disabled={page >= customers.data.pagination.totalPages}
                className="px-2 py-1 border rounded text-xs disabled:opacity-50 hover:bg-slate-50"
              >
                →
              </button>
              <button
                onClick={() => setPage(customers.data!.pagination.totalPages)}
                disabled={page >= customers.data.pagination.totalPages}
                className="px-2 py-1 border rounded text-xs disabled:opacity-50 hover:bg-slate-50"
              >
                ⏭
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function formatBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}
