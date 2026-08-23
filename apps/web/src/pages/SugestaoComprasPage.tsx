import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { exportToCsv, todayStamp } from '../lib/exportCsv';

interface Suggestion {
  sourceCode: string;
  description: string;
  unit: string | null;
  currentStock: number;
  idealStock: number;
  soldQty: number;
  dailyVelocity: number;
  daysOfCover: number | null;
  suggestedQty: number;
  cost: number | null;
  estimatedCost: number;
  priority: 'urgente' | 'recomendado' | 'opcional';
}

const PRIORITY_LABEL: Record<string, string> = {
  urgente: 'Urgente',
  recomendado: 'Recomendado',
  opcional: 'Opcional',
};
const PRIORITY_COLOR: Record<string, string> = {
  urgente: 'bg-red-100 text-red-800',
  recomendado: 'bg-amber-100 text-amber-800',
  opcional: 'bg-slate-100 text-slate-700',
};

export function SugestaoComprasPage(): JSX.Element {
  const [days, setDays] = useState(30);
  const [cover, setCover] = useState(15);

  const r = useQuery({
    queryKey: ['purchase-suggestions', days, cover],
    queryFn: () =>
      api<{ data: Suggestion[] }>(`/api/reports/purchase-suggestions?days=${days}&cover=${cover}`),
  });

  const rows = r.data?.data ?? [];
  const totalCost = rows.reduce((s, r) => s + r.estimatedCost, 0);
  const urgentes = rows.filter((r) => r.priority === 'urgente').length;

  const onExport = (): void => {
    exportToCsv(`sugestao-compras_${todayStamp()}`, [
      { header: 'Código', value: (r) => r.sourceCode },
      { header: 'Produto', value: (r) => r.description },
      { header: 'Unidade', value: (r) => r.unit ?? '' },
      { header: 'Estoque atual', value: (r) => r.currentStock, number: true },
      { header: 'Estoque ideal', value: (r) => r.idealStock, number: true },
      { header: 'Vendido (qtd)', value: (r) => r.soldQty, number: true },
      { header: 'Velocidade diária', value: (r) => r.dailyVelocity, number: true },
      { header: 'Cobertura (dias)', value: (r) => r.daysOfCover, number: true },
      { header: 'Sugestão de compra', value: (r) => Math.ceil(r.suggestedQty), number: true },
      { header: 'Custo unitário', value: (r) => r.cost, money: true },
      { header: 'Custo estimado total', value: (r) => r.estimatedCost, money: true },
      { header: 'Prioridade', value: (r) => PRIORITY_LABEL[r.priority] },
    ], rows);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold">Sugestão de Compras</h2>
          <p className="text-sm text-slate-500 mt-1">
            Quanto comprar de cada produto, baseado na velocidade de venda dos últimos dias.
          </p>
        </div>
        <button
          onClick={onExport}
          disabled={rows.length === 0}
          className="bg-emerald-600 text-white px-4 py-2 rounded text-sm hover:bg-emerald-700 disabled:opacity-50"
        >
          📊 Exportar Excel
        </button>
      </div>

      <div className="bg-white rounded-lg shadow p-4 flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-xs uppercase text-slate-500 mb-1">Analisar vendas dos últimos</label>
          <div className="flex gap-2 items-center">
            <input
              type="number"
              min="7"
              max="180"
              value={days}
              onChange={(e) => setDays(parseInt(e.target.value) || 30)}
              className="border rounded px-2 py-1 text-sm w-20"
            />
            <span className="text-sm text-slate-600">dias</span>
          </div>
        </div>
        <div>
          <label className="block text-xs uppercase text-slate-500 mb-1">Estoque desejado para</label>
          <div className="flex gap-2 items-center">
            <input
              type="number"
              min="1"
              max="90"
              value={cover}
              onChange={(e) => setCover(parseInt(e.target.value) || 15)}
              className="border rounded px-2 py-1 text-sm w-20"
            />
            <span className="text-sm text-slate-600">dias de venda</span>
          </div>
        </div>
        <div className="flex-1" />
        <div className="text-sm text-slate-600">
          <div>Itens sugeridos: <strong>{rows.length}</strong></div>
          <div>Custo estimado: <strong>{formatBRL(totalCost)}</strong></div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Kpi label="Urgentes (estoque zerado/negativo)" value={urgentes.toString()} color="text-red-700" />
        <Kpi label="Total de itens a comprar" value={rows.length.toString()} />
        <Kpi label="Investimento estimado" value={formatBRL(totalCost)} color="text-blue-700" />
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        {r.isLoading ? (
          <div className="p-12 text-center text-slate-400">Calculando sugestões...</div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            Nenhuma sugestão. Seu estoque está em dia.
            <span className="block text-xs mt-2">
              Requer itens de venda sincronizados (a partir da v0.5.0 do agente).
            </span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Código</th>
                  <th className="px-3 py-2 text-left">Produto</th>
                  <th className="px-3 py-2 text-right">Estoque atual</th>
                  <th className="px-3 py-2 text-right">Vel. diária</th>
                  <th className="px-3 py-2 text-right">Cobertura</th>
                  <th className="px-3 py-2 text-right">Comprar</th>
                  <th className="px-3 py-2 text-right">Custo est.</th>
                  <th className="px-3 py-2 text-center">Prioridade</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.sourceCode} className="border-t hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono text-xs">{s.sourceCode}</td>
                    <td className="px-3 py-2">{s.description}</td>
                    <td className={`px-3 py-2 text-right ${s.currentStock <= 0 ? 'text-red-700 font-medium' : ''}`}>
                      {s.currentStock.toLocaleString('pt-BR')} {s.unit ?? ''}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-600">
                      {s.dailyVelocity.toFixed(2)}/dia
                    </td>
                    <td className="px-3 py-2 text-right text-slate-600">
                      {s.daysOfCover != null ? `${s.daysOfCover.toFixed(1)}d` : '∞'}
                    </td>
                    <td className="px-3 py-2 text-right font-bold">
                      {Math.ceil(s.suggestedQty).toLocaleString('pt-BR')} {s.unit ?? ''}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {s.cost != null ? formatBRL(s.estimatedCost) : <span className="text-slate-400 text-xs">sem custo</span>}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`px-2 py-0.5 rounded text-xs ${PRIORITY_COLOR[s.priority]}`}>
                        {PRIORITY_LABEL[s.priority]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
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
