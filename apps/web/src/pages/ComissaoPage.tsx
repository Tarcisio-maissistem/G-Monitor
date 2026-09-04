import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { isoDate, currentMonthRange } from '../lib/period';
import { useToast } from '../components/Toast';
import { exportToCsv, todayStamp } from '../lib/exportCsv';
import { MaskedInput } from '../components/MaskedInput';
import { parsePercent } from '../lib/masks';

interface CommissionRow {
  operator: string;
  vendas: number;
  faturamento: number;
  ticketMedio: number;
  percent: number;
  comissao: number;
}

interface CommissionResp {
  data: CommissionRow[];
  totals: {
    faturamento: number;
    comissao: number;
  };
}

interface Rule {
  operator: string;
  percent: number;
}

interface SettingsResp {
  settings: {
    monthlyGoal?: number;
    commissionRules?: Rule[];
  };
}

export function ComissaoPage(): JSX.Element {
  const today = useMemo(() => new Date(), []);
  const [from, setFrom] = useState(() => {
    return currentMonthRange(today).from;
  });
  const [to, setTo] = useState(isoDate(today));
  const queryClient = useQueryClient();
  const toast = useToast();

  const r = useQuery({
    queryKey: ['commissions', from, to],
    queryFn: () => api<CommissionResp>(`/api/reports/commissions?from=${from}&to=${to}`),
  });

  const settings = useQuery({
    queryKey: ['tenant-settings'],
    queryFn: () => api<SettingsResp>('/api/tenant/settings'),
  });

  const [rules, setRules] = useState<Rule[]>([]);
  const [defaultPct, setDefaultPct] = useState<string>('');

  useEffect(() => {
    if (settings.data) {
      setRules(settings.data.settings.commissionRules ?? []);
      const def = settings.data.settings.commissionRules?.find((r) => r.operator === '*');
      if (def) setDefaultPct(def.percent.toString());
    }
  }, [settings.data]);

  const saveMutation = useMutation({
    mutationFn: (newRules: Rule[]) =>
      api<SettingsResp>('/api/tenant/settings', {
        method: 'PATCH',
        body: JSON.stringify({ commissionRules: newRules }),
      }),
    onSuccess: () => {
      toast.push({ type: 'success', message: 'Regras salvas!' });
      queryClient.invalidateQueries({ queryKey: ['tenant-settings'] });
      queryClient.invalidateQueries({ queryKey: ['commissions'] });
    },
    onError: (err: Error) => toast.push({ type: 'error', message: err.message }),
  });

  const rows = r.data?.data ?? [];
  const totals = r.data?.totals;

  const onExport = (): void => {
    exportToCsv(`comissoes_${from}_a_${to}_${todayStamp()}`, [
      { header: 'Operador', value: (r) => r.operator },
      { header: 'Vendas', value: (r) => r.vendas, number: true },
      { header: 'Faturamento', value: (r) => r.faturamento, money: true },
      { header: 'Ticket Médio', value: (r) => r.ticketMedio, money: true },
      { header: '% Comissão', value: (r) => r.percent, number: true },
      { header: 'Comissão R$', value: (r) => r.comissao, money: true },
    ], rows);
  };

  const addRule = (operator: string): void => {
    if (!operator || rules.find((r) => r.operator === operator)) return;
    setRules([...rules, { operator, percent: 0 }]);
  };

  const updateRule = (i: number, percent: number): void => {
    const next = [...rules];
    next[i] = { ...next[i], percent };
    setRules(next);
  };

  const removeRule = (i: number): void => {
    setRules(rules.filter((_, idx) => idx !== i));
  };

  const onSaveAll = (): void => {
    const finalRules = [...rules];
    const defPct = parsePercent(defaultPct);
    if (defPct >= 0) {
      const existing = finalRules.findIndex((r) => r.operator === '*');
      if (existing >= 0) finalRules[existing] = { operator: '*', percent: defPct };
      else finalRules.push({ operator: '*', percent: defPct });
    }
    saveMutation.mutate(finalRules);
  };

  const operatorsWithoutRule = rows
    .filter((row) => !rules.find((rl) => rl.operator === row.operator) && row.operator !== '*')
    .map((r) => r.operator);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold">Comissão de Operadores</h2>
          <p className="text-sm text-slate-500 mt-1">
            Calcula comissão de cada vendedor com base no faturamento e na regra configurada.
          </p>
        </div>
        <div className="flex gap-3 items-end">
          <div>
            <label className="block text-xs uppercase text-slate-500 mb-1">De</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border rounded px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="block text-xs uppercase text-slate-500 mb-1">Até</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border rounded px-2 py-1 text-sm" />
          </div>
          <button
            onClick={onExport}
            disabled={rows.length === 0}
            className="bg-emerald-600 text-white px-4 py-2 rounded text-sm hover:bg-emerald-700 disabled:opacity-50"
          >
            📊 Excel
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Kpi label="Faturamento total" value={formatBRL(totals?.faturamento ?? 0)} />
        <Kpi label="Comissão total a pagar" value={formatBRL(totals?.comissao ?? 0)} color="text-blue-700" />
        <Kpi label="Operadores ativos" value={rows.length.toString()} />
      </div>

      <div className="bg-white rounded-lg shadow p-5">
        <h3 className="font-semibold mb-1">Regras de comissão</h3>
        <p className="text-sm text-slate-500 mb-4">
          Configure o percentual de cada operador. Use a "regra padrão" para todos que não tiverem regra própria.
        </p>

        <div className="space-y-3">
          <div className="flex gap-2 items-center bg-slate-50 p-3 rounded">
            <label className="text-sm font-medium w-40">Regra padrão (todos)</label>
            <MaskedInput
              mask="percent"
              placeholder="0"
              value={defaultPct}
              onChange={setDefaultPct}
              className="border rounded px-2 py-1 text-sm w-24"
            />
            <span className="text-sm text-slate-600">% sobre faturamento</span>
          </div>

          {rules.filter((r) => r.operator !== '*').map((rule) => {
            const realIndex = rules.findIndex((rl) => rl.operator === rule.operator);
            return (
              <div key={rule.operator} className="flex gap-2 items-center">
                <label className="text-sm font-medium w-40 truncate" title={rule.operator}>
                  {rule.operator}
                </label>
                <MaskedInput
                  mask="percent"
                  value={String(rule.percent).replace('.', ',')}
                  onChange={(v) => updateRule(realIndex, parsePercent(v))}
                  className="border rounded px-2 py-1 text-sm w-24"
                />
                <span className="text-sm text-slate-600">%</span>
                <button
                  onClick={() => removeRule(realIndex)}
                  className="text-red-600 hover:text-red-800 text-sm ml-2"
                >
                  Remover
                </button>
              </div>
            );
          })}

          {operatorsWithoutRule.length > 0 && (
            <div className="border-t pt-3 mt-3">
              <div className="text-xs text-slate-500 mb-2">Adicionar regra específica:</div>
              <div className="flex flex-wrap gap-2">
                {operatorsWithoutRule.map((op) => (
                  <button
                    key={op}
                    onClick={() => addRule(op)}
                    className="text-xs bg-slate-100 hover:bg-slate-200 px-3 py-1 rounded"
                  >
                    + {op}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="border-t mt-4 pt-3">
          <button
            onClick={onSaveAll}
            disabled={saveMutation.isPending}
            className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {saveMutation.isPending ? 'Salvando...' : 'Salvar regras'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-4 py-3 border-b">
          <h3 className="font-semibold">Comissão por operador no período</h3>
        </div>
        {r.isLoading ? (
          <div className="p-12 text-center text-slate-400">Calculando...</div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-slate-400">Sem vendas no período selecionado.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Operador</th>
                  <th className="px-3 py-2 text-right">Vendas</th>
                  <th className="px-3 py-2 text-right">Faturamento</th>
                  <th className="px-3 py-2 text-right">Ticket médio</th>
                  <th className="px-3 py-2 text-right">% comissão</th>
                  <th className="px-3 py-2 text-right">Comissão</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={row.operator} className="border-t hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                    <td className="px-3 py-2 font-medium">{row.operator}</td>
                    <td className="px-3 py-2 text-right">{row.vendas.toLocaleString('pt-BR')}</td>
                    <td className="px-3 py-2 text-right">{formatBRL(row.faturamento)}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{formatBRL(row.ticketMedio)}</td>
                    <td className="px-3 py-2 text-right">{row.percent.toFixed(2)}%</td>
                    <td className="px-3 py-2 text-right font-bold text-blue-700">{formatBRL(row.comissao)}</td>
                  </tr>
                ))}
              </tbody>
              {totals && (
                <tfoot className="bg-slate-50 font-bold">
                  <tr>
                    <td colSpan={3} className="px-3 py-2 text-right">Total:</td>
                    <td className="px-3 py-2 text-right">{formatBRL(totals.faturamento)}</td>
                    <td />
                    <td />
                    <td className="px-3 py-2 text-right text-blue-700">{formatBRL(totals.comissao)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>
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

function formatBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}
