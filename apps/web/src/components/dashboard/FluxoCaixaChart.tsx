import { useQuery } from '@tanstack/react-query';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { api } from '../../lib/api';
import { formatBRL, formatBrDayMonth } from '../../lib/masks';
import { rangeQuery, type DateRange } from '../../lib/period';
import type { CashflowGranularity, CashflowResponse } from '../../lib/reports';
import { LoadingBox, ErrorBox, EmptyBox } from '../ui/QueryState';

export interface FluxoCaixaChartProps extends DateRange {
  storeId?: string | undefined;
  granularity?: CashflowGranularity | undefined; // omitido = backend decide (>31 dias = semana)
  height?: number; // padrao 220 (cabe em 375x667 junto com a KpiRow)
  title?: string;
  // Dado ja carregado pela pagina (evita 2a chamada quando a pagina tambem consome /cashflow).
  // Se vier, o componente nao busca.
  data?: CashflowResponse | undefined;
}

// Barras Entradas x Saidas por dia — consome GET /api/reports/cashflow (D16). O shape e
// flat por linha (dia/entradas/saidas), entao o BarChart le direto, sem adaptador.
export function FluxoCaixaChart({ from, to, storeId, granularity, height = 220, title = 'Fluxo de Caixa', data }: FluxoCaixaChartProps): JSX.Element {
  const range: DateRange = { from, to };
  const qs = rangeQuery(range, { storeId, granularity });
  const r = useQuery({
    queryKey: ['cashflow', from, to, storeId ?? null, granularity ?? null],
    queryFn: () => api<CashflowResponse>(`/api/reports/cashflow?${qs}`),
    enabled: !data,
  });

  const resp = data ?? r.data;
  const rows = (resp?.data ?? []).map((row) => ({ ...row, label: formatBrDayMonth(row.dia) }));

  return (
    <div className="bg-white rounded-lg shadow p-3 sm:p-4">
      <h3 className="font-semibold mb-3">{title}</h3>
      {!data && r.isLoading ? (
        <LoadingBox />
      ) : !data && r.error ? (
        <ErrorBox error={r.error} />
      ) : rows.length === 0 ? (
        <EmptyBox text="Sem movimentações no período." />
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={rows} margin={{ left: 0, right: 4, top: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} width={44} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
            <Tooltip formatter={(v: number) => formatBRL(v)} />
            <Legend />
            <Bar dataKey="entradas" name="Entradas" fill="#10b981" />
            <Bar dataKey="saidas" name="Saídas" fill="#ef4444" />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
