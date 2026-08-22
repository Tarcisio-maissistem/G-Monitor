import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

interface CalendarDay {
  date: string;
  total: number;
  paid: number;
  pending: number;
  overdue: number;
}

interface FinanceCalendarResponse {
  data: { days: CalendarDay[]; monthSummary: { total: number; paid: number; pending: number; overdue: number } };
  meta: { lastSyncedAt: string | null; stalenessSeconds: number | null; agentsOffline: string[] };
}

const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

// Calendario mensal de contas a pagar/receber. Cada dia mostra o total com vencimento
// naquele dia; o cabecalho mostra o resumo do mes (pago/a pagar/vencido).
export function FinanceCalendar({ kind }: { kind: 'payables' | 'receivables' }): JSX.Element {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [year, mon] = month.split('-').map(Number) as [number, number];

  const endpoint = kind === 'payables' ? '/api/reports/payables-calendar' : '/api/reports/receivables-calendar';
  const query = useQuery({
    queryKey: [endpoint, month],
    queryFn: () => api<FinanceCalendarResponse>(`${endpoint}?month=${month}`),
  });

  const dayMap = new Map((query.data?.data.days ?? []).map((d) => [d.date, d]));
  const firstWeekday = new Date(Date.UTC(year, mon - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();

  const cells: (CalendarDay | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => {
      const date = `${month}-${String(i + 1).padStart(2, '0')}`;
      return dayMap.get(date) ?? { date, total: 0, paid: 0, pending: 0, overdue: 0 };
    }),
  ];

  const summary = query.data?.data.monthSummary;
  const labelPaid = kind === 'payables' ? 'Pago' : 'Recebido';
  const labelPending = kind === 'payables' ? 'A pagar' : 'A receber';

  function shiftMonth(delta: number): void {
    const d = new Date(Date.UTC(year, mon - 1 + delta, 1));
    setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border p-3 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <button onClick={() => shiftMonth(-1)} className="px-2 py-1 text-slate-500 hover:bg-slate-100 rounded" aria-label="Mes anterior">
            ‹
          </button>
          <span className="font-semibold text-slate-700 w-36 text-center capitalize">
            {new Date(Date.UTC(year, mon - 1, 1)).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
          </span>
          <button onClick={() => shiftMonth(1)} className="px-2 py-1 text-slate-500 hover:bg-slate-100 rounded" aria-label="Proximo mes">
            ›
          </button>
        </div>
        {summary && (
          <div className="flex flex-wrap gap-2 text-sm">
            <SummaryChip label={labelPaid} value={summary.paid} color="text-green-700 bg-green-50" />
            <SummaryChip label={labelPending} value={summary.pending} color="text-blue-700 bg-blue-50" />
            <SummaryChip label="Vencido" value={summary.overdue} color="text-red-700 bg-red-50" />
            <SummaryChip label="Total do mes" value={summary.total} color="text-slate-700 bg-slate-100" />
          </div>
        )}
      </div>

      {query.isLoading && <div className="text-slate-400 text-sm">Carregando...</div>}
      {query.error && <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded p-3">{(query.error as Error).message}</div>}

      {query.data && (
        <div className="grid grid-cols-7 gap-1 text-xs">
          {WEEKDAYS.map((w, i) => (
            <div key={i} className="text-center text-slate-400 font-medium pb-1">
              {w}
            </div>
          ))}
          {cells.map((cell, i) =>
            cell ? (
              <div
                key={cell.date}
                title={cell.total > 0 ? formatBRL(cell.total) : undefined}
                className={`rounded-lg border p-1 sm:p-1.5 min-h-[52px] sm:min-h-[64px] ${
                  cell.overdue > 0 ? 'border-red-200 bg-red-50' : cell.total > 0 ? 'border-slate-200 bg-slate-50' : 'border-transparent'
                }`}
              >
                <div className="text-slate-500 text-[10px] sm:text-xs">{Number(cell.date.slice(-2))}</div>
                {cell.total > 0 && (
                  <div className="font-semibold text-slate-700 truncate text-[10px] sm:text-xs">{formatCompactBRL(cell.total)}</div>
                )}
                {cell.overdue > 0 && (
                  <div className="hidden sm:block text-red-600 truncate text-xs">venc. {formatBRL(cell.overdue)}</div>
                )}
              </div>
            ) : (
              <div key={`empty-${i}`} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function SummaryChip({ label, value, color }: { label: string; value: number; color: string }): JSX.Element {
  return (
    <div className={`px-3 py-1.5 rounded-lg ${color}`}>
      <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="font-bold">{formatBRL(value)}</div>
    </div>
  );
}

function formatBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}

// Versao curta pra caber na celula do calendario em tela de celular (ex: "R$1,2 mil").
function formatCompactBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 }).format(n);
}
