import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { FinanceCalendar } from '../components/FinanceCalendar';

// Lista de contas a pagar — complementa o calendario (FinanceCalendar) com uma visao
// tabular filtravel. Contrato adaptado ao que /api/reports/payables realmente devolve
// (ver apps/backend/src/reports/routes.ts): sem paginacao ainda, status em ingles.
interface Payable {
  sourceId: string;
  dueDate: string;
  value: number;
  paidValue: number;
  paidDate: string | null;
  counterparty: string | null;
  description: string | null;
  balance: number;
  status: 'paid' | 'pending' | 'overdue';
}

interface PayablesResponse {
  data: Payable[];
  summary: { total: number; pending: number; overdue: number };
  count: number;
  meta: { lastSyncedAt: string | null };
}

type StatusFilter = 'todos' | 'pending' | 'paid' | 'overdue';

const STATUS_LABEL: Record<Payable['status'], string> = { pending: 'a pagar', paid: 'pago', overdue: 'vencido' };

export function ContasPagarPage(): JSX.Element {
  // Padrao: mes atual, do dia 1 ate hoje (nao "ultimos 30 dias" — pedido do dono 23/08).
  const today = useMemo(() => new Date(), []);
  const defaultFrom = useMemo(() => new Date(Date.UTC(today.getFullYear(), today.getMonth(), 1)).toISOString().slice(0, 10), [today]);
  const defaultTo = useMemo(() => today.toISOString().slice(0, 10), [today]);

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [status, setStatus] = useState<StatusFilter>('todos');

  const qs = new URLSearchParams({ from, to, ...(status !== 'todos' ? { status } : {}) });
  const r = useQuery({
    queryKey: ['payables', from, to, status],
    queryFn: () => api<PayablesResponse>(`/api/reports/payables?${qs}`),
  });

  const rows = r.data?.data ?? [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex justify-between items-end gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold">Contas a Pagar</h2>
          <p className="text-sm text-slate-500 mt-1">Duplicatas pendentes e pagas do GDOOR.</p>
        </div>
        <div className="flex gap-3 items-end">
          <div>
            <label className="block text-xs uppercase text-slate-500 mb-1">Vencimento de</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border rounded px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="block text-xs uppercase text-slate-500 mb-1">Até</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border rounded px-2 py-1 text-sm" />
          </div>
        </div>
      </div>

      <FinanceCalendar kind="payables" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Kpi label="Total do período" value={formatBRL(r.data?.summary.total ?? 0)} />
        <Kpi label="A pagar" value={formatBRL(r.data?.summary.pending ?? 0)} color="text-blue-700" />
        <Kpi label="Vencido" value={formatBRL(r.data?.summary.overdue ?? 0)} color="text-red-700" />
      </div>

      <div className="bg-white rounded-lg shadow p-3 flex gap-3 items-center flex-wrap">
        <span className="text-xs uppercase text-slate-500">Status:</span>
        {(['todos', 'pending', 'paid', 'overdue'] as StatusFilter[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`text-xs px-3 py-1 rounded-full capitalize ${
              status === s ? 'bg-blue-600 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            {s === 'todos' ? 'todos' : STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        {r.isLoading ? (
          <div className="p-12 text-center text-slate-400">Carregando...</div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-slate-400">Sem contas a pagar no período.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Nº</th>
                  <th className="px-3 py-2 text-left">Vencimento</th>
                  <th className="px-3 py-2 text-left">Fornecedor</th>
                  <th className="px-3 py-2 text-left">Histórico</th>
                  <th className="px-3 py-2 text-right">Valor</th>
                  <th className="px-3 py-2 text-right">Pago</th>
                  <th className="px-3 py-2 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.sourceId} className="border-t hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono text-xs">{row.sourceId}</td>
                    <td className="px-3 py-2">{new Date(row.dueDate).toLocaleDateString('pt-BR')}</td>
                    <td className="px-3 py-2">{row.counterparty ?? '-'}</td>
                    <td className="px-3 py-2 text-slate-600">{row.description ?? '-'}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatBRL(row.value)}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{row.paidValue > 0 ? formatBRL(row.paidValue) : '-'}</td>
                    <td className="px-3 py-2 text-center"><StatusBadge status={row.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Payable['status'] }): JSX.Element {
  const map: Record<Payable['status'], string> = {
    pending: 'bg-blue-100 text-blue-800',
    paid: 'bg-emerald-100 text-emerald-800',
    overdue: 'bg-red-100 text-red-800',
  };
  return <span className={`px-2 py-0.5 rounded text-xs ${map[status]}`}>{STATUS_LABEL[status]}</span>;
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
