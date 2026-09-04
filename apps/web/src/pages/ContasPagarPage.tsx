import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { isoDate, currentMonthRange } from '../lib/period';
import { FinanceCalendar } from '../components/FinanceCalendar';
import { copyToClipboard } from '../lib/clipboard';
import { useToast } from '../components/Toast';
import { Spinner } from '../components/Spinner';
import { Pagination } from '../components/ui';

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
  totalCount: number;
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  meta: { lastSyncedAt: string | null };
}

type StatusFilter = 'todos' | 'pending' | 'paid' | 'overdue';

const STATUS_LABEL: Record<Payable['status'], string> = { pending: 'a pagar', paid: 'pago', overdue: 'vencido' };

export function ContasPagarPage(): JSX.Element {
  // Padrao: mes atual, do dia 1 ate hoje (nao "ultimos 30 dias" — pedido do dono 23/08).
  const today = useMemo(() => new Date(), []);
  const defaultFrom = useMemo(() => currentMonthRange(today).from, [today]);
  const defaultTo = useMemo(() => isoDate(today), [today]);

  const [from, setFromRaw] = useState(defaultFrom);
  const [to, setToRaw] = useState(defaultTo);
  const [status, setStatusRaw] = useState<StatusFilter>('todos');
  const [page, setPage] = useState(1);
  // qualquer mudança de filtro volta pra página 1 (senão fica numa página que não existe mais)
  const setFrom = (v: string): void => { setFromRaw(v); setPage(1); };
  const setTo = (v: string): void => { setToRaw(v); setPage(1); };
  const setStatus = (v: StatusFilter): void => { setStatusRaw(v); setPage(1); };

  const qs = new URLSearchParams({ from, to, page: String(page), pageSize: '50', ...(status !== 'todos' ? { status } : {}) });
  const r = useQuery({
    queryKey: ['payables', from, to, status, page],
    queryFn: () => api<PayablesResponse>(`/api/reports/payables?${qs}`),
  });

  const rows = r.data?.data ?? [];
  const toast = useToast();

  const handleCopyResumo = async (): Promise<void> => {
    const text = buildWhatsAppResumo(from, to, r.data?.summary, rows);
    const ok = await copyToClipboard(text);
    toast.push(ok ? { type: 'success', message: 'Resumo copiado — cole no WhatsApp.' } : { type: 'error', message: 'Não consegui copiar. Tente selecionar o texto manualmente.' });
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex justify-between items-end gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold">Contas a Pagar</h2>
          <p className="text-sm text-slate-500 mt-1">Duplicatas pendentes e pagas do GDOOR.</p>
        </div>
        <div className="flex gap-3 items-end flex-wrap">
          <div>
            <label className="block text-xs uppercase text-slate-500 mb-1">Vencimento de</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border rounded px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="block text-xs uppercase text-slate-500 mb-1">Até</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border rounded px-2 py-1 text-sm" />
          </div>
          <button
            onClick={() => void handleCopyResumo()}
            disabled={!r.data}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed h-fit"
            title="Copiar resumo formatado pra colar no WhatsApp"
          >
            <span>📋</span> Copiar p/ WhatsApp
          </button>
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
          <div className="p-12 text-center text-slate-400 flex items-center gap-2">
            <Spinner className="h-3.5 w-3.5" /> Carregando...
          </div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-slate-400">Sem contas a pagar no período.</div>
        ) : (
          <>
            {/* Celular: cards empilhados — 7 colunas de tabela nao cabem em ~390px sem
                cortar Valor/Status (achado com screenshot real, nao só leitura de codigo). */}
            <div className="sm:hidden divide-y">
              {rows.map((row) => (
                <div key={row.sourceId} className="p-3 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium text-slate-800">{row.counterparty ?? '-'}</div>
                      <div className="text-xs text-slate-500">{row.description ?? '-'}</div>
                    </div>
                    <StatusBadge status={row.status} />
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">{new Date(row.dueDate).toLocaleDateString('pt-BR')} · #{row.sourceId}</span>
                    <span className="font-medium">{formatBRL(row.value)}</span>
                  </div>
                  {row.paidValue > 0 && <div className="text-xs text-slate-500 text-right">pago {formatBRL(row.paidValue)}</div>}
                </div>
              ))}
            </div>

            <div className="hidden sm:block overflow-x-auto">
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
            {r.data && r.data.pagination.totalPages > 1 && (
              <Pagination page={r.data.pagination.page} totalPages={r.data.pagination.totalPages} total={r.data.pagination.total} pageSize={r.data.pagination.pageSize} onChange={setPage} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Texto no formato do WhatsApp (*negrito*) — pedido do dono 24/08. Lista as primeiras 15
// pra nao virar uma mensagem gigante; o total/pendente/vencido sempre reflete o periodo
// inteiro (vem do backend, nao so das linhas listadas).
function buildWhatsAppResumo(from: string, to: string, summary: PayablesResponse['summary'] | undefined, rows: Payable[]): string {
  const fmtDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
  const lines: string[] = [`📤 *Contas a Pagar* — ${fmtDate(from)} a ${fmtDate(to)}`, ''];

  if (summary) {
    lines.push(`Total do período: *${formatBRL(summary.total)}*`);
    lines.push(`A pagar: ${formatBRL(summary.pending)}`);
    lines.push(`Vencido: ${formatBRL(summary.overdue)}`);
  }

  if (rows.length > 0) {
    lines.push('', '*Lançamentos:*');
    for (const row of rows.slice(0, 15)) {
      lines.push(`${new Date(row.dueDate).toLocaleDateString('pt-BR')} — ${row.counterparty ?? '-'}: ${formatBRL(row.value)} (${STATUS_LABEL[row.status]})`);
    }
    if (rows.length > 15) lines.push(`_...e mais ${rows.length - 15} lançamento(s)_`);
  }

  lines.push('', '_Gerado pelo G-Monitor_');
  return lines.join('\n');
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
