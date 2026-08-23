import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useToast } from '../components/Toast';
import { MaskedInput } from '../components/MaskedInput';
import { applyCurrency, parseCurrency, formatBRL } from '../lib/masks';

interface MetaResp {
  year: number;
  month: number;
  goal: number;
  achieved: number;
  remaining: number;
  progressPct: number;
  pacePct: number;
  sales: number;
  totalDays: number;
  elapsedDays: number;
}

interface SettingsResp {
  settings: {
    monthlyGoal?: number;
    commissionRules?: Array<{ operator: string; percent: number }>;
  };
}

export function MetaMensalPage(): JSX.Element {
  const today = useMemo(() => new Date(), []);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const queryClient = useQueryClient();
  const toast = useToast();

  const meta = useQuery({
    queryKey: ['monthly-goal', year, month],
    queryFn: () => api<MetaResp>(`/api/reports/monthly-goal?year=${year}&month=${month}`),
  });

  const settings = useQuery({
    queryKey: ['tenant-settings'],
    queryFn: () => api<SettingsResp>('/api/tenant/settings'),
  });

  const [goalInput, setGoalInput] = useState('');

  const saveMutation = useMutation({
    mutationFn: (newGoal: number) =>
      api<SettingsResp>('/api/tenant/settings', {
        method: 'PATCH',
        body: JSON.stringify({ monthlyGoal: newGoal }),
      }),
    onSuccess: () => {
      toast.push({ type: 'success', message: 'Meta salva!' });
      queryClient.invalidateQueries({ queryKey: ['tenant-settings'] });
      queryClient.invalidateQueries({ queryKey: ['monthly-goal'] });
      setGoalInput('');
    },
    onError: (err: Error) => toast.push({ type: 'error', message: err.message }),
  });

  const currentGoal = settings.data?.settings.monthlyGoal ?? 0;
  const m = meta.data;

  const onSave = (): void => {
    const v = parseCurrency(goalInput);
    if (v >= 0) saveMutation.mutate(v);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div>
        <h2 className="text-2xl font-bold">Meta Mensal</h2>
        <p className="text-sm text-slate-500 mt-1">
          Defina sua meta de faturamento do mês e acompanhe o progresso em tempo real.
        </p>
      </div>

      <div className="bg-white rounded-lg shadow p-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs uppercase text-slate-500 mb-1">Ano</label>
          <select value={year} onChange={(e) => setYear(parseInt(e.target.value))} className="border rounded px-2 py-1 text-sm">
            {[year - 1, year, year + 1].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs uppercase text-slate-500 mb-1">Mês</label>
          <select value={month} onChange={(e) => setMonth(parseInt(e.target.value))} className="border rounded px-2 py-1 text-sm">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => (
              <option key={m} value={m}>
                {monthName(m)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1" />
        <div className="text-sm text-slate-600">
          Meta atual configurada: <strong>{formatBRL(currentGoal)}</strong>
        </div>
      </div>

      {meta.isLoading || !m ? (
        <div className="bg-white rounded-lg shadow p-12 text-center text-slate-400">Carregando...</div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            <Kpi label="Meta" value={formatBRL(m.goal)} />
            <Kpi label="Realizado" value={formatBRL(m.achieved)} color="text-blue-700" />
            <Kpi label="Falta atingir" value={formatBRL(m.remaining)} color={m.remaining > 0 ? 'text-amber-700' : 'text-emerald-700'} />
            <Kpi label="Vendas" value={m.sales.toLocaleString('pt-BR')} />
          </div>

          <div className="bg-white rounded-lg shadow p-5 space-y-4">
            <div>
              <div className="flex justify-between mb-2">
                <span className="font-semibold">Progresso da Meta</span>
                <span className="text-sm text-slate-600">
                  {m.progressPct.toFixed(1)}% atingido
                </span>
              </div>
              <ProgressBar pct={m.progressPct} color={progressColor(m.progressPct, m.pacePct)} />
            </div>

            <div>
              <div className="flex justify-between mb-2">
                <span className="font-semibold">Ritmo esperado (tempo decorrido)</span>
                <span className="text-sm text-slate-600">
                  {m.pacePct.toFixed(1)}% do mês ({m.elapsedDays}/{m.totalDays} dias)
                </span>
              </div>
              <ProgressBar pct={m.pacePct} color="bg-slate-400" />
            </div>

            <div className="border-t pt-3 text-sm">
              {m.goal === 0 ? (
                <div className="text-slate-500">Configure uma meta abaixo para começar a acompanhar.</div>
              ) : m.progressPct >= m.pacePct ? (
                <div className="text-emerald-700">
                  ✓ No ritmo! Você está {(m.progressPct - m.pacePct).toFixed(1)} pontos à frente do esperado.
                </div>
              ) : (
                <div className="text-amber-700">
                  ⚠️ Atrasado: faltam {(m.pacePct - m.progressPct).toFixed(1)} pontos pra alcançar o ritmo do mês.
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-5">
            <h3 className="font-semibold mb-3">Configurar meta mensal</h3>
            <p className="text-sm text-slate-500 mb-3">
              A meta é o mesmo valor para todos os meses (configuração da empresa). Para metas diferentes por mês, ajuste no início de cada mês.
            </p>
            <div className="flex gap-2 items-center">
              <MaskedInput
                mask="currency"
                prefix="R$"
                placeholder={currentGoal > 0 ? applyCurrency(String(Math.round(currentGoal * 100))) : '50.000,00'}
                value={goalInput}
                onChange={setGoalInput}
                className="w-full border rounded py-2 text-sm pr-3"
              />
              <button
                onClick={onSave}
                disabled={saveMutation.isPending || !goalInput}
                className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
              >
                {saveMutation.isPending ? 'Salvando...' : 'Salvar meta'}
              </button>
            </div>
          </div>
        </>
      )}
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

function ProgressBar({ pct, color }: { pct: number; color: string }): JSX.Element {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div className="w-full h-3 bg-slate-100 rounded overflow-hidden">
      <div className={`h-full ${color} transition-all`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

function progressColor(progress: number, pace: number): string {
  if (progress >= pace) return 'bg-emerald-500';
  if (progress >= pace * 0.8) return 'bg-amber-500';
  return 'bg-red-500';
}

function monthName(m: number): string {
  return ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'][m - 1];
}
