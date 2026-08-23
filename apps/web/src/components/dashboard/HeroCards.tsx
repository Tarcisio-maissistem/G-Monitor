import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useRoute } from '../../lib/router';

interface TodaySummary {
  vendasHoje: { total: number; qtd: number; growthPct: number };
  vendasOntem: { total: number; qtd: number };
  caixaHoje: { entrada: number; saida: number; saldo: number };
  totais: { produtos: number; clientes: number };
}

interface MonthlyGoal {
  goal: number;
  achieved: number;
  progressPct: number;
  pacePct: number;
  sales: number;
}

interface StockSummary {
  critico: number;
  baixo: number;
  alerta: number;
  total: number;
}

export function HeroCards(): JSX.Element {
  const today = useQuery({
    queryKey: ['today-summary'],
    queryFn: () => api<TodaySummary>('/api/reports/dashboard/today-summary'),
    refetchInterval: 30000,
  });

  const now = new Date();
  const goal = useQuery({
    queryKey: ['monthly-goal-card', now.getFullYear(), now.getMonth() + 1],
    queryFn: () => api<MonthlyGoal>(`/api/reports/monthly-goal?year=${now.getFullYear()}&month=${now.getMonth() + 1}`),
  });

  const stockSummary = useQuery({
    queryKey: ['stock-alerts-summary'],
    queryFn: () => api<StockSummary>('/api/reports/dashboard/stock-alerts-summary'),
  });

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <VendasHojeCard data={today.data} loading={today.isLoading} />
      <MetaMensalHeroCard data={goal.data} loading={goal.isLoading} />
      <CaixaHojeCard data={today.data} loading={today.isLoading} />
      <AlertasEstoqueHeroCard data={stockSummary.data} loading={stockSummary.isLoading} />
    </div>
  );
}

function VendasHojeCard({ data, loading }: { data: TodaySummary | undefined; loading: boolean }): JSX.Element {
  const v = data?.vendasHoje;
  const o = data?.vendasOntem;
  return (
    <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl shadow p-5 border border-blue-200">
      <div className="flex justify-between items-start">
        <div className="text-xs uppercase text-blue-700 font-semibold">Vendas Hoje</div>
        <span className="text-2xl">🛒</span>
      </div>
      <div className="text-3xl font-bold mt-2 text-blue-900">
        {loading ? '...' : formatBRL(v?.total ?? 0)}
      </div>
      {v && (
        <>
          <div className={`text-sm font-semibold mt-1 ${v.growthPct >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
            {v.growthPct >= 0 ? '▲' : '▼'} {v.growthPct.toFixed(1)}% vs ontem
          </div>
          <div className="text-xs text-blue-700 mt-1">{v.qtd} vendas</div>
        </>
      )}
      {o && (
        <div className="text-xs text-slate-600 mt-2 border-t border-blue-200 pt-2">
          Ontem: {formatBRL(o.total)} ({o.qtd} vendas)
        </div>
      )}
    </div>
  );
}

function MetaMensalHeroCard({ data, loading }: { data: MonthlyGoal | undefined; loading: boolean }): JSX.Element {
  const { navigate } = useRoute();
  const m = data;
  const hasGoal = m && m.goal > 0;
  const atingida = hasGoal && m.progressPct >= 100;
  const color = !hasGoal ? 'bg-slate-300' : atingida ? 'bg-emerald-500' : m.progressPct >= m.pacePct ? 'bg-emerald-500' : m.progressPct >= m.pacePct * 0.8 ? 'bg-amber-500' : 'bg-red-500';

  return (
    <button
      onClick={() => navigate('/meta-mensal')}
      className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl shadow p-5 border border-purple-200 text-left hover:shadow-md transition"
    >
      <div className="flex justify-between items-start">
        <div className="text-xs uppercase text-purple-700 font-semibold">Meta Mensal</div>
        <span className="text-2xl">🎯</span>
      </div>
      {loading ? (
        <div className="text-3xl font-bold mt-2 text-purple-900">...</div>
      ) : !hasGoal ? (
        <div className="text-lg font-semibold mt-2 text-purple-900">Configurar meta</div>
      ) : (
        <>
          {atingida && <div className="text-emerald-700 font-bold text-lg mt-1">ATINGIDA! 🎉</div>}
          <div className="text-3xl font-bold mt-1 text-purple-900">{m.progressPct.toFixed(0)}%</div>
          <div className="text-xs text-purple-700 mt-1">
            {formatBRL(m.achieved)} / {formatBRL(m.goal)}
          </div>
          <div className="w-full h-2 bg-white rounded mt-2 overflow-hidden">
            <div className={`h-full ${color}`} style={{ width: `${Math.min(100, m.progressPct)}%` }} />
          </div>
          <div className="text-xs text-slate-600 mt-2 border-t border-purple-200 pt-2">{m.sales} vendas no mês</div>
        </>
      )}
    </button>
  );
}

function CaixaHojeCard({ data, loading }: { data: TodaySummary | undefined; loading: boolean }): JSX.Element {
  const c = data?.caixaHoje;
  const saldo = c?.saldo ?? 0;
  const positivo = saldo >= 0;
  return (
    <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-xl shadow p-5 border border-emerald-200">
      <div className="flex justify-between items-start">
        <div className="text-xs uppercase text-emerald-700 font-semibold">Caixa Hoje</div>
        <span className="text-2xl">💼</span>
      </div>
      <div className={`text-3xl font-bold mt-2 ${positivo ? 'text-emerald-900' : 'text-red-900'}`}>
        {loading ? '...' : formatBRL(saldo)}
      </div>
      <div className={`text-xs font-semibold mt-1 ${positivo ? 'text-emerald-700' : 'text-red-700'}`}>
        {positivo ? 'POSITIVO' : 'NEGATIVO'}
      </div>
      {c && (
        <div className="grid grid-cols-2 gap-2 mt-3 border-t border-emerald-200 pt-2 text-xs">
          <div>
            <div className="text-slate-500">Entradas</div>
            <div className="font-semibold text-emerald-700">{formatBRL(c.entrada)}</div>
          </div>
          <div>
            <div className="text-slate-500">Saídas</div>
            <div className="font-semibold text-red-700">{formatBRL(c.saida)}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function AlertasEstoqueHeroCard({ data, loading }: { data: StockSummary | undefined; loading: boolean }): JSX.Element {
  const { navigate } = useRoute();
  const total = data?.total ?? 0;
  const tudoOk = !loading && total === 0;
  return (
    <button
      onClick={() => navigate('/alertas-estoque')}
      className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-xl shadow p-5 border border-amber-200 text-left hover:shadow-md transition"
    >
      <div className="flex justify-between items-start">
        <div className="text-xs uppercase text-amber-700 font-semibold">Alertas de Estoque</div>
        <span className="text-2xl">⚠️</span>
      </div>
      {tudoOk ? (
        <>
          <div className="text-xl font-bold mt-2 text-emerald-700">Tudo em ordem!</div>
          <div className="text-xs text-slate-600 mt-1">Nenhum produto com estoque crítico</div>
        </>
      ) : (
        <>
          <div className="text-3xl font-bold mt-2 text-amber-900">{loading ? '...' : total}</div>
          {data && (
            <div className="text-xs text-amber-800 mt-2">
              <div className="text-red-700 font-medium">🔴 {data.critico} crítico (zerado ou negativo)</div>
              <div className="text-orange-700">🟠 {data.baixo} baixo (até 50% do ideal)</div>
              <div className="text-amber-700">🟡 {data.alerta} em alerta</div>
            </div>
          )}
        </>
      )}
    </button>
  );
}

function formatBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}
