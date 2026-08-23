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

interface FinanceEntry {
  sourceId: string;
  dueDate: string;
  value: number;
  paidValue?: number;
  receivedValue?: number;
  counterparty: string | null;
  description: string | null;
  status: 'paid' | 'pending' | 'overdue';
}

interface FinanceListResponse {
  data: FinanceEntry[];
}

const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

// Calendario mensal de contas a pagar/receber. Cada dia mostra o total com vencimento
// naquele dia; o cabecalho mostra o resumo do mes (pago/a pagar/vencido).
export function FinanceCalendar({ kind }: { kind: 'payables' | 'receivables' }): JSX.Element {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
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
                onClick={() => cell.total > 0 && setSelectedDay(cell.date)}
                className={`rounded-lg border p-1 sm:p-1.5 min-h-[52px] sm:min-h-[64px] ${cell.total > 0 ? 'cursor-pointer hover:ring-2 hover:ring-blue-300' : ''} ${
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

      {selectedDay && <DayDrilldown kind={kind} date={selectedDay} onClose={() => setSelectedDay(null)} />}
    </div>
  );
}

const STATUS_LABEL: Record<FinanceEntry['status'], string> = { pending: 'a pagar', paid: 'pago', overdue: 'vencido' };

// Modal simples com a lista de lancamentos de um dia especifico (pagaveis ou recebiveis),
// reusando os mesmos endpoints /api/reports/{payables|receivables} com from=to=dia clicado.
function DayDrilldown({ kind, date, onClose }: { kind: 'payables' | 'receivables'; date: string; onClose: () => void }): JSX.Element {
  const endpoint = kind === 'payables' ? '/api/reports/payables' : '/api/reports/receivables';
  const label = kind === 'payables' ? 'Fornecedor' : 'Cliente';
  const settledLabel = kind === 'payables' ? 'Pago' : 'Recebido';
  const query = useQuery({
    queryKey: [endpoint, 'dia', date],
    queryFn: () => api<FinanceListResponse>(`${endpoint}?from=${date}&to=${date}`),
  });
  const rows = query.data?.data ?? [];
  const dateLabel = new Date(`${date}T12:00:00Z`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-lg max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold text-slate-700 capitalize">{dateLabel}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none" aria-label="Fechar">
            ×
          </button>
        </div>
        <div className="overflow-y-auto p-4">
          {query.isLoading && <div className="text-slate-400 text-sm">Carregando...</div>}
          {!query.isLoading && rows.length === 0 && <div className="text-slate-400 text-sm">Nada nesse dia.</div>}
          {rows.length > 0 && (
            <>
              {/* Celular: cards — 5 colunas nao cabem no modal (max-w-2xl com p-4 sobra
                  ~358px numa tela de 390px). */}
              <div className="sm:hidden divide-y">
                {rows.map((r) => (
                  <div key={r.sourceId} className="py-2 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-medium text-slate-700 text-sm">{r.counterparty ?? '-'}</div>
                        <div className="text-xs text-slate-500">{r.description ?? '-'}</div>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded text-xs shrink-0 ${
                          r.status === 'paid' ? 'bg-emerald-100 text-emerald-800' : r.status === 'overdue' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'
                        }`}
                      >
                        {STATUS_LABEL[r.status]}
                      </span>
                    </div>
                    <div className="text-sm font-medium text-right">{formatBRL(r.value)}</div>
                  </div>
                ))}
              </div>

              <table className="hidden sm:table w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 border-b">
                    <th className="text-left pb-2 font-medium">{label}</th>
                    <th className="text-left pb-2 font-medium">Histórico</th>
                    <th className="text-right pb-2 font-medium">Valor</th>
                    <th className="text-right pb-2 font-medium">{settledLabel}</th>
                    <th className="text-center pb-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.sourceId} className="border-b border-slate-50">
                      <td className="py-2 pr-2 text-slate-700">{r.counterparty ?? '-'}</td>
                      <td className="py-2 pr-2 text-slate-500">{r.description ?? '-'}</td>
                      <td className="py-2 text-right font-medium">{formatBRL(r.value)}</td>
                      <td className="py-2 text-right text-slate-600">{formatBRL(r.paidValue ?? r.receivedValue ?? 0)}</td>
                      <td className="py-2 text-center">
                        <span
                          className={`px-2 py-0.5 rounded text-xs ${
                            r.status === 'paid' ? 'bg-emerald-100 text-emerald-800' : r.status === 'overdue' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {STATUS_LABEL[r.status]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
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
