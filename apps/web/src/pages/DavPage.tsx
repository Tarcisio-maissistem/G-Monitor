import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

interface Dav {
  id: string;
  sourceId: string;
  davDate: string;
  customerSourceId: string | null;
  customerName: string | null;
  operatorName: string | null;
  totalValue: number;
  situacao: string | null;
  observacao: string | null;
}

interface DavResponse {
  data: Dav[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  summary: { count: number; total: number };
}

const SIT_LABEL: Record<string, string> = { P: 'Pendente', F: 'Faturado', C: 'Cancelado' };
const SIT_COLOR: Record<string, string> = {
  P: 'bg-amber-100 text-amber-800',
  F: 'bg-emerald-100 text-emerald-800',
  C: 'bg-red-100 text-red-800',
};

export function DavPage(): JSX.Element {
  const today = useMemo(() => new Date(), []);
  const defaultFrom = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() - 60);
    return d.toISOString().slice(0, 10);
  }, [today]);
  const defaultTo = useMemo(() => today.toISOString().slice(0, 10), [today]);

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [situacao, setSituacao] = useState('');
  const [page, setPage] = useState(1);

  const qs = new URLSearchParams({ from, to, page: String(page), pageSize: '50' });
  if (situacao) qs.set('situacao', situacao);

  const r = useQuery({
    queryKey: ['davs', from, to, situacao, page],
    queryFn: () => api<DavResponse>(`/api/reports/davs?${qs}`),
  });

  const rows = r.data?.data ?? [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex justify-between items-end gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold">DAV — Pré-vendas</h2>
          <p className="text-sm text-slate-500 mt-1">Documentos auxiliares de venda do GDOOR (pré-vendas em aberto, faturadas ou canceladas).</p>
        </div>
        <div className="flex gap-3 items-end">
          <div>
            <label className="block text-xs uppercase text-slate-500 mb-1">De</label>
            <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="border rounded px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="block text-xs uppercase text-slate-500 mb-1">Até</label>
            <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="border rounded px-2 py-1 text-sm" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Kpi label="Total de DAVs" value={(r.data?.summary.count ?? 0).toLocaleString('pt-BR')} />
        <Kpi label="Valor total" value={formatBRL(r.data?.summary.total ?? 0)} color="text-emerald-700" />
      </div>

      <div className="bg-white rounded-lg shadow p-3 flex gap-3 items-center flex-wrap">
        <span className="text-xs uppercase text-slate-500">Situação:</span>
        {[
          { key: '', label: 'Todas' },
          { key: 'P', label: 'Pendentes' },
          { key: 'F', label: 'Faturadas' },
          { key: 'C', label: 'Canceladas' },
        ].map((s) => (
          <button
            key={s.key}
            onClick={() => { setSituacao(s.key); setPage(1); }}
            className={`text-xs px-3 py-1 rounded-full ${situacao === s.key ? 'bg-blue-600 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        {r.isLoading ? (
          <div className="p-12 text-center text-slate-400">Carregando...</div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            Sem DAVs no período.
            <span className="block text-xs mt-2">Os DAVs aparecem quando o agente sincroniza (v0.4.0+).</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Nº</th>
                  <th className="px-3 py-2 text-left">Data</th>
                  <th className="px-3 py-2 text-left">Cliente</th>
                  <th className="px-3 py-2 text-left">Vendedor</th>
                  <th className="px-3 py-2 text-left">Observação</th>
                  <th className="px-3 py-2 text-right">Valor</th>
                  <th className="px-3 py-2 text-center">Situação</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id} className="border-t hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono text-xs">{d.sourceId}</td>
                    <td className="px-3 py-2">{new Date(d.davDate).toLocaleDateString('pt-BR')}</td>
                    <td className="px-3 py-2">{d.customerName ?? d.customerSourceId ?? 'Consumidor'}</td>
                    <td className="px-3 py-2">{d.operatorName ?? '-'}</td>
                    <td className="px-3 py-2 text-slate-600 max-w-xs truncate" title={d.observacao ?? ''}>{d.observacao ?? '-'}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatBRL(d.totalValue)}</td>
                    <td className="px-3 py-2 text-center">
                      {d.situacao ? (
                        <span className={`px-2 py-0.5 rounded text-xs ${SIT_COLOR[d.situacao] ?? 'bg-slate-100 text-slate-700'}`}>
                          {SIT_LABEL[d.situacao] ?? d.situacao}
                        </span>
                      ) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {r.data && r.data.pagination.totalPages > 1 && (
          <div className="border-t px-4 py-3 flex justify-between items-center text-sm">
            <div className="text-slate-500">
              {(r.data.pagination.page - 1) * r.data.pagination.pageSize + 1} -{' '}
              {Math.min(r.data.pagination.page * r.data.pagination.pageSize, r.data.pagination.total)} de {r.data.pagination.total}
            </div>
            <div className="flex gap-2 items-center">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-2 py-1 border rounded text-xs disabled:opacity-50">←</button>
              <span>{r.data.pagination.page} / {r.data.pagination.totalPages}</span>
              <button onClick={() => setPage((p) => Math.min(r.data!.pagination.totalPages, p + 1))} disabled={page >= r.data.pagination.totalPages} className="px-2 py-1 border rounded text-xs disabled:opacity-50">→</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, color }: { label: string; value: string; color?: string }): JSX.Element {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color ?? ''}`}>{value}</div>
    </div>
  );
}

function formatBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}
