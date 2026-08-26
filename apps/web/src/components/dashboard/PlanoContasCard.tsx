import type { ReactNode } from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { formatBRL, formatPct } from '../../lib/masks';
import type { DistribuicaoItem } from '../../lib/reports';
import { LoadingBox, ErrorBox, EmptyBox } from '../ui/QueryState';

export interface PlanoContasCardProps {
  title: string;
  subtitle?: string | undefined;
  // percent em 0-100 (despesasPorFornecedor da DRE ja vem assim; payments-summary devolve
  // fracao 0-1 — multiplicar antes de passar).
  data: DistribuicaoItem[];
  total: number;
  loading?: boolean | undefined;
  error?: unknown;
  emptyText?: string;
  actions?: ReactNode; // ex: toggle de periodo, se a pagina quiser
  height?: number; // altura da pizza (padrao 200 — cabe em 375px sem empurrar a lista)
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1', '#94a3b8'];

// Pizza + lista com % pra QUALQUER distribuicao {label, value, percent}. Antes buscava
// sozinho /api/reports/dashboard/plano-contas (endpoint que nunca existiu); agora recebe
// os dados por props — a DRE alimenta com "Despesas por fornecedor" (D17), o Dashboard
// pode usar com formas de pagamento.
export function PlanoContasCard({ title, subtitle, data, total, loading, error, emptyText = 'Sem dados no período.', actions, height = 200 }: PlanoContasCardProps): JSX.Element {
  return (
    <div className="bg-white rounded-lg shadow p-3 sm:p-4">
      <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-base sm:text-lg">{title}</h3>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
        {actions}
      </div>

      {loading ? (
        <LoadingBox />
      ) : error ? (
        <ErrorBox error={error} />
      ) : data.length === 0 ? (
        <EmptyBox text={emptyText} />
      ) : (
        <>
          <ResponsiveContainer width="100%" height={height}>
            <PieChart>
              {/* Sem label externo: em 375px o texto saia do SVG. A lista abaixo faz esse papel. */}
              <Pie data={data} dataKey="value" nameKey="label" cx="50%" cy="50%" outerRadius="80%" innerRadius="45%" paddingAngle={1}>
                {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v: number) => formatBRL(v)} />
            </PieChart>
          </ResponsiveContainer>
          <div className="text-center text-sm text-slate-600 font-medium mt-1">Total: {formatBRL(total)}</div>
          <ol className="mt-3 space-y-1 max-h-48 overflow-y-auto">
            {data.map((d, i) => (
              <li key={i} className="flex items-center gap-2 text-xs">
                <span className="w-3 h-3 rounded shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                <span className="flex-1 truncate" title={d.label}>{d.label}</span>
                <span className="text-slate-500 tabular-nums">{formatBRL(d.value)}</span>
                <span className="font-medium w-12 text-right tabular-nums">{formatPct(d.percent)}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
