import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

interface Sale {
  id: string;
  sourceId: string;
  saleDate: string;
  modelo: string | null;
  operatorName: string | null;
  caixa: string | null;
  natureza: string | null;
  totalValue: number;
  cancelled: boolean;
  customerSourceId: string | null;
}

interface SalesResponse {
  data: Sale[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  summary: { total: number; cancelled: number; revenue: number; ticket: number };
  meta: { lastSyncedAt: string | null };
}

type StatusFilter = 'todos' | 'ok' | 'cancelada';
type ModeloFilter = 'todos' | '65' | '55' | 'PV';

export function VendasPage(): JSX.Element {
  const today = useMemo(() => new Date(), []);
  const defaultFrom = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  }, [today]);
  const defaultTo = useMemo(() => today.toISOString().slice(0, 10), [today]);

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [status, setStatus] = useState<StatusFilter>('todos');
  const [modelo, setModelo] = useState<ModeloFilter>('todos');
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // debounce manual da busca
  useMemo(() => {
    const t = setTimeout(() => setSearchDebounced(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  const qs = new URLSearchParams({
    from,
    to,
    page: String(page),
    pageSize: String(pageSize),
  });
  if (status !== 'todos') qs.set('status', status);
  if (modelo !== 'todos') qs.set('modelo', modelo);
  if (searchDebounced) qs.set('search', searchDebounced);

  const sales = useQuery({
    queryKey: ['vendas', from, to, status, modelo, searchDebounced, page, pageSize],
    queryFn: () => api<SalesResponse>(`/api/reports/sales?${qs.toString()}`),
  });

  const data = sales.data;
  const rows = data?.data ?? [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex justify-between items-end gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold">Vendas</h2>
          <p className="text-sm text-slate-500 mt-1">Listagem detalhada com filtros e busca por número.</p>
        </div>
        <div className="flex gap-3 items-end flex-wrap">
          <div>
            <label className="block text-xs uppercase text-slate-500 mb-1">De</label>
            <input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
              className="border rounded px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs uppercase text-slate-500 mb-1">Até</label>
            <input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
              className="border rounded px-2 py-1 text-sm"
            />
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Total de vendas" value={(data?.summary.total ?? 0).toLocaleString('pt-BR')} />
        <KpiCard label="Faturamento" value={formatBRL(data?.summary.revenue ?? 0)} accent="emerald" />
        <KpiCard label="Ticket Médio" value={formatBRL(data?.summary.ticket ?? 0)} />
        <KpiCard label="Canceladas" value={(data?.summary.cancelled ?? 0).toLocaleString('pt-BR')} accent="red" />
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-lg shadow p-3 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs uppercase text-slate-500 mb-1">Buscar por número</label>
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Ex: 12345"
            className="w-full border rounded px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs uppercase text-slate-500 mb-1">Tipo</label>
          <select
            value={modelo}
            onChange={(e) => {
              setModelo(e.target.value as ModeloFilter);
              setPage(1);
            }}
            className="border rounded px-2 py-1 text-sm bg-white"
          >
            <option value="todos">Todos</option>
            <option value="65">NFC-e</option>
            <option value="55">NF-e</option>
            <option value="PV">Pré-venda</option>
          </select>
        </div>
        <div>
          <label className="block text-xs uppercase text-slate-500 mb-1">Situação</label>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as StatusFilter);
              setPage(1);
            }}
            className="border rounded px-2 py-1 text-sm bg-white"
          >
            <option value="todos">Todas</option>
            <option value="ok">Concluídas</option>
            <option value="cancelada">Canceladas</option>
          </select>
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

      {/* Tabela */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {sales.isLoading ? (
          <div className="p-12 text-center text-slate-400">Carregando...</div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-slate-400">Nenhuma venda encontrada com esses filtros.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                <tr>
                  <th className="px-4 py-2 text-left">Nº</th>
                  <th className="px-4 py-2 text-left">Data</th>
                  <th className="px-4 py-2 text-left">Tipo</th>
                  <th className="px-4 py-2 text-left">Operador</th>
                  <th className="px-4 py-2 text-left">Caixa</th>
                  <th className="px-4 py-2 text-left">Cliente</th>
                  <th className="px-4 py-2 text-right">Valor</th>
                  <th className="px-4 py-2 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={`border-t hover:bg-slate-50 ${r.cancelled ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-2 font-mono">{r.sourceId}</td>
                    <td className="px-4 py-2">{new Date(r.saleDate).toLocaleString('pt-BR')}</td>
                    <td className="px-4 py-2">{modeloLabel(r.modelo)}</td>
                    <td className="px-4 py-2">{r.operatorName ?? '-'}</td>
                    <td className="px-4 py-2">{r.caixa ?? '-'}</td>
                    <td className="px-4 py-2 text-slate-600">{r.customerSourceId ?? 'Consumidor'}</td>
                    <td className="px-4 py-2 text-right font-medium">{formatBRL(r.totalValue)}</td>
                    <td className="px-4 py-2 text-center">
                      {r.cancelled ? (
                        <span className="text-red-600 text-xs">Cancelada</span>
                      ) : (
                        <span className="text-emerald-600 text-xs">OK</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Paginação */}
        {data && data.pagination.totalPages > 1 && (
          <div className="border-t px-4 py-3 flex justify-between items-center text-sm">
            <div className="text-slate-500">
              Mostrando {(data.pagination.page - 1) * data.pagination.pageSize + 1} -{' '}
              {Math.min(data.pagination.page * data.pagination.pageSize, data.pagination.total)} de{' '}
              {data.pagination.total.toLocaleString('pt-BR')}
            </div>
            <div className="flex gap-2 items-center">
              <button
                onClick={() => setPage(1)}
                disabled={page === 1}
                className="px-2 py-1 border rounded text-xs disabled:opacity-50 hover:bg-slate-50"
              >
                ⏮ Primeira
              </button>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-2 py-1 border rounded text-xs disabled:opacity-50 hover:bg-slate-50"
              >
                ← Anterior
              </button>
              <span className="text-slate-600">
                Página {data.pagination.page} de {data.pagination.totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(data.pagination.totalPages, p + 1))}
                disabled={page >= data.pagination.totalPages}
                className="px-2 py-1 border rounded text-xs disabled:opacity-50 hover:bg-slate-50"
              >
                Próxima →
              </button>
              <button
                onClick={() => setPage(data.pagination.totalPages)}
                disabled={page >= data.pagination.totalPages}
                className="px-2 py-1 border rounded text-xs disabled:opacity-50 hover:bg-slate-50"
              >
                Última ⏭
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function KpiCard({ label, value, accent }: { label: string; value: string; accent?: 'emerald' | 'red' }): JSX.Element {
  const accentClass = accent === 'emerald' ? 'text-emerald-700' : accent === 'red' ? 'text-red-700' : '';
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="text-xs text-slate-500 uppercase">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${accentClass}`}>{value}</div>
    </div>
  );
}

function formatBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}

function modeloLabel(m: string | null | undefined): string {
  if (!m) return '-';
  const map: Record<string, string> = {
    '55': 'NF-e',
    '65': 'NFC-e',
    PV: 'Pré-venda',
    CF: 'Cupom',
  };
  return map[m] ?? m;
}
