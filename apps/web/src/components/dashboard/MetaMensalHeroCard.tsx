import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useRoute } from '../../lib/router';
import { formatBRL, formatCompactBRL } from '../../lib/masks';
import type { MonthlyGoalResponse } from '../../lib/reports';

export interface MetaMensalHeroCardProps {
  year?: number; // padrao: mes corrente
  month?: number; // 1-12
  className?: string;
}

// Extraido de HeroCards.tsx: e a UNICA das 4 hero cards cujo endpoint existe
// (/api/reports/monthly-goal, resposta flat). Busca sozinha e navega pra /meta-mensal.
export function MetaMensalHeroCard({ year, month, className = '' }: MetaMensalHeroCardProps): JSX.Element {
  const { navigate } = useRoute();
  const now = new Date();
  const y = year ?? now.getFullYear();
  const m = month ?? now.getMonth() + 1;

  const goal = useQuery({
    queryKey: ['monthly-goal', y, m],
    queryFn: () => api<MonthlyGoalResponse>(`/api/reports/monthly-goal?year=${y}&month=${m}`),
  });

  const d = goal.data;
  const hasGoal = !!d && d.goal > 0;
  const atingida = hasGoal && d.progressPct >= 100;
  // Verde no ritmo, ambar ate 20% abaixo do ritmo esperado, vermelho abaixo disso.
  const barColor = !hasGoal ? 'bg-slate-300' : atingida || d.progressPct >= d.pacePct ? 'bg-emerald-500' : d.progressPct >= d.pacePct * 0.8 ? 'bg-amber-500' : 'bg-red-500';

  return (
    <button
      type="button"
      onClick={() => navigate('/meta-mensal')}
      className={`w-full bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl shadow p-4 sm:p-5 border border-purple-200 text-left hover:shadow-md transition ${className}`}
    >
      <div className="flex justify-between items-start">
        <div className="text-xs uppercase text-purple-700 font-semibold">Meta Mensal</div>
        <span className="text-xl sm:text-2xl">🎯</span>
      </div>
      {goal.isLoading ? (
        <div className="text-2xl sm:text-3xl font-bold mt-2 text-purple-900">...</div>
      ) : goal.error ? (
        <div className="text-sm text-red-700 mt-2">{(goal.error as Error).message}</div>
      ) : !hasGoal ? (
        <div className="text-lg font-semibold mt-2 text-purple-900">Configurar meta</div>
      ) : (
        <>
          {atingida && <div className="text-emerald-700 font-bold text-base sm:text-lg mt-1">ATINGIDA! 🎉</div>}
          <div className="text-2xl sm:text-3xl font-bold mt-1 text-purple-900">{d.progressPct.toFixed(0)}%</div>
          {/* Compacto no celular ("R$ 12 mil / R$ 50 mil"); inteiro a partir de sm */}
          <div className="text-xs text-purple-700 mt-1">
            <span className="sm:hidden">{formatCompactBRL(d.achieved)} / {formatCompactBRL(d.goal)}</span>
            <span className="hidden sm:inline">{formatBRL(d.achieved)} / {formatBRL(d.goal)}</span>
          </div>
          <div className="w-full h-2 bg-white rounded mt-2 overflow-hidden">
            <div className={`h-full ${barColor}`} style={{ width: `${Math.min(100, d.progressPct)}%` }} />
          </div>
          <div className="text-xs text-slate-600 mt-2 border-t border-purple-200 pt-2">{d.sales} vendas no mês</div>
        </>
      )}
    </button>
  );
}
