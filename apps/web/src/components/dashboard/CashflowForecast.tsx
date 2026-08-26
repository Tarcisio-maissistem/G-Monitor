import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { api } from '../../lib/api';
import { formatBRL, formatBrDayMonth } from '../../lib/masks';
import type { CashflowForecastResponse } from '../../lib/reports';
import { LoadingBox, ErrorBox, EmptyBox } from '../ui/QueryState';

export type ForecastDays = 7 | 15 | 30 | 60 | 90;
const DAY_OPTIONS: ForecastDays[] = [7, 15, 30, 60, 90];

export interface CashflowForecastProps {
  storeId?: string | undefined;
  defaultDays?: ForecastDays;
  height?: number;
  title?: string;
}

// Fluxo PROJETADO: contas a receber/pagar em aberto por vencimento nos proximos N dias
// (GET /api/reports/cashflow-forecast, D16) + bloco "Vencidos" (overdue) em vermelho —
// titulo vencido antes de hoje nao entra na serie futura, mas e o que mais importa pro dono.
export function CashflowForecast({ storeId, defaultDays = 30, height = 220, title = 'Projeção de Caixa' }: CashflowForecastProps): JSX.Element {
  const [days, setDays] = useState<ForecastDays>(defaultDays);
  const qs = new URLSearchParams({ days: String(days), ...(storeId ? { storeId } : {}) });
  const r = useQuery({
    queryKey: ['cashflow-forecast', days, storeId ?? null],
    queryFn: () => api<CashflowForecastResponse>(`/api/reports/cashflow-forecast?${qs}`),
  });

  const chartData = (r.data?.data ?? []).map((d) => ({ ...d, label: formatBrDayMonth(d.dia) }));
  const t = r.data?.totals;
  const overdue = r.data?.overdue;
  const hasOverdue = overdue && (overdue.entradas > 0 || overdue.saidas > 0);

  return (
    <div className="bg-white rounded-lg shadow p-3 sm:p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-base sm:text-lg">{title}</h3>
          <p className="text-xs text-slate-500">Próximos {days} dias (a receber / a pagar em aberto, por vencimento)</p>
        </div>
        <select value={days} onChange={(e) => setDays(parseInt(e.target.value, 10) as ForecastDays)} className="border rounded px-2 py-1 text-sm bg-white">
          {DAY_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d} dias
            </option>
          ))}
        </select>
      </div>

      {r.isLoading ? (
        <LoadingBox />
      ) : r.error ? (
        <ErrorBox error={r.error} />
      ) : chartData.length === 0 ? (
        <EmptyBox text="Sem contas a vencer no período." />
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={chartData} margin={{ left: 0, right: 4, top: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} width={44} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
            <Tooltip formatter={(v: number) => formatBRL(v)} />
            <Legend />
            <Bar dataKey="entradas" name="A receber" fill="#10b981" />
            <Bar dataKey="saidas" name="A pagar" fill="#ef4444" />
          </BarChart>
        </ResponsiveContainer>
      )}

      {t && (
        <div className="grid grid-cols-3 gap-2 sm:gap-3 mt-3 border-t pt-3">
          <div className="min-w-0">
            <div className="text-[11px] sm:text-xs uppercase text-slate-500 truncate">A receber</div>
            <div className="text-sm sm:text-lg font-bold text-emerald-700 break-words">{formatBRL(t.entradas)}</div>
          </div>
          <div className="min-w-0">
            <div className="text-[11px] sm:text-xs uppercase text-slate-500 truncate">A pagar</div>
            <div className="text-sm sm:text-lg font-bold text-red-700 break-words">{formatBRL(t.saidas)}</div>
          </div>
          <div className="min-w-0">
            <div className="text-[11px] sm:text-xs uppercase text-slate-500 truncate">Saldo previsto</div>
            <div className={`text-sm sm:text-lg font-bold break-words ${t.saldo >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{formatBRL(t.saldo)}</div>
          </div>
        </div>
      )}

      {/* Vencidos (antes de hoje) — fora da serie, em vermelho. So aparece se houver. */}
      {hasOverdue && (
        <div className="mt-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs sm:text-sm text-red-800 flex flex-wrap gap-x-4 gap-y-1">
          <span className="font-semibold">Vencidos:</span>
          <span>a receber <strong>{formatBRL(overdue.entradas)}</strong></span>
          <span>a pagar <strong>{formatBRL(overdue.saidas)}</strong></span>
        </div>
      )}
    </div>
  );
}
