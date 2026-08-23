import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

interface CashMovement {
  id: string;
  sourceId: string;
  movementDate: string;
  entrada: number;
  saida: number;
  historico: string | null;
}

interface Resp {
  data: CashMovement[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  summary: { entrada: number; saida: number; saldo: number };
}

export function MovimentoCaixaPage(): JSX.Element {
  const today = useMemo(() => new Date(), []);
  const defaultFrom = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  }, [today]);
  const defaultTo = useMemo(() => today.toISOString().slice(0, 10), [today]);

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [page, setPage] = useState(1);

  const r = useQuery({
    queryKey: ['cash-movements', from, to, page],
    queryFn: () => api<Resp>(`/api/reports/cash-movements?from=${from}&to=${to}&page=${page}&pageSize=100`),
  });

  const rows = r.data?.data ?? [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex justify-between items-end gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold">Movimentos de Caixa</h2>
          <p className="text-sm text-slate-500 mt-1">Lançamentos de entrada e saída do CAIXA do GDOOR.</p>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Kpi label="Entradas" value={formatBRL(r.data?.summary.entrada ?? 0)} color="text-emerald-700" />
        <Kpi label="Saídas" value={formatBRL(r.data?.summary.saida ?? 0)} color="text-red-700" />
        <Kpi label="Saldo do período" value={formatBRL(r.data?.summary.saldo ?? 0)} color={(r.data?.summary.saldo ?? 0) >= 0 ? 'text-emerald-700' : 'text-red-700'} />
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        {r.isLoading ? (
          <div className="p-12 text-center text-slate-400">Carregando...</div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            Sem movimentos de caixa.
            <span className="block text-xs mt-2">Os lançamentos aparecem quando o agente sincroniza (v0.5.0+).</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Data</th>
                  <th className="px-3 py-2 text-left">Histórico</th>
                  <th className="px-3 py-2 text-right">Entrada</th>
                  <th className="px-3 py-2 text-right">Saída</th>
                  <th className="px-3 py-2 text-right">Saldo do lançamento</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id} className="border-t hover:bg-slate-50">
                    <td className="px-3 py-2">{new Date(m.movementDate).toLocaleString('pt-BR')}</td>
                    <td className="px-3 py-2 text-slate-600 max-w-md truncate" title={m.historico ?? ''}>{m.historico ?? '-'}</td>
                    <td className="px-3 py-2 text-right text-emerald-700 font-medium">{m.entrada > 0 ? formatBRL(m.entrada) : '-'}</td>
                    <td className="px-3 py-2 text-right text-red-700 font-medium">{m.saida > 0 ? formatBRL(m.saida) : '-'}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatBRL(m.entrada - m.saida)}</td>
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
