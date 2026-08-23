import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { exportToCsv, todayStamp } from '../lib/exportCsv';

interface Alert {
  sourceCode: string;
  description: string;
  unit: string | null;
  stock: number;
  idealStock: number;
  salePrice: number | null;
  falta: number;
  severity: 'critico' | 'baixo' | 'alerta';
}

const SEVERITY_LABEL: Record<string, string> = {
  critico: 'Crítico',
  baixo: 'Baixo',
  alerta: 'Alerta',
};
const SEVERITY_COLOR: Record<string, string> = {
  critico: 'bg-red-100 text-red-800',
  baixo: 'bg-orange-100 text-orange-800',
  alerta: 'bg-amber-100 text-amber-800',
};

export function EstoqueAlertasPage(): JSX.Element {
  const r = useQuery({
    queryKey: ['stock-alerts'],
    queryFn: () => api<{ data: Alert[] }>('/api/reports/stock-alerts'),
  });

  const rows = r.data?.data ?? [];
  const criticos = rows.filter((r) => r.severity === 'critico').length;
  const baixos = rows.filter((r) => r.severity === 'baixo').length;
  const alertas = rows.filter((r) => r.severity === 'alerta').length;

  const onExport = (): void => {
    exportToCsv(`alertas-estoque_${todayStamp()}`, [
      { header: 'Código', value: (r) => r.sourceCode },
      { header: 'Produto', value: (r) => r.description },
      { header: 'Unidade', value: (r) => r.unit ?? '' },
      { header: 'Estoque atual', value: (r) => r.stock, number: true },
      { header: 'Estoque ideal', value: (r) => r.idealStock, number: true },
      { header: 'Faltam', value: (r) => r.falta, number: true },
      { header: 'Preço venda', value: (r) => r.salePrice, money: true },
      { header: 'Severidade', value: (r) => SEVERITY_LABEL[r.severity] },
    ], rows);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold">Alertas de Estoque</h2>
          <p className="text-sm text-slate-500 mt-1">Produtos com estoque abaixo do ideal (`QTD &lt;= QTD_IDEAL` no GDOOR).</p>
        </div>
        <button
          onClick={onExport}
          disabled={rows.length === 0}
          className="bg-emerald-600 text-white px-4 py-2 rounded text-sm hover:bg-emerald-700 disabled:opacity-50"
        >
          📊 Exportar Excel
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Kpi label="Críticos (zerado ou negativo)" value={criticos.toString()} color="text-red-700" />
        <Kpi label="Baixos (até 50% do ideal)" value={baixos.toString()} color="text-orange-700" />
        <Kpi label="Em alerta" value={alertas.toString()} color="text-amber-700" />
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        {r.isLoading ? (
          <div className="p-12 text-center text-slate-400">Carregando...</div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            Tudo em ordem ou ainda sem dados.
            <span className="block text-xs mt-2">
              Pra ter alertas, os produtos do GDOOR precisam ter campo `QTD_IDEAL` preenchido. Sync na v0.5.0+.
            </span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Código</th>
                  <th className="px-3 py-2 text-left">Produto</th>
                  <th className="px-3 py-2 text-right">Unid.</th>
                  <th className="px-3 py-2 text-right">Estoque</th>
                  <th className="px-3 py-2 text-right">Ideal</th>
                  <th className="px-3 py-2 text-right">Faltam</th>
                  <th className="px-3 py-2 text-right">Custo de reposição</th>
                  <th className="px-3 py-2 text-center">Severidade</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.sourceCode} className="border-t hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono text-xs">{r.sourceCode}</td>
                    <td className="px-3 py-2">{r.description}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{r.unit ?? '-'}</td>
                    <td className={`px-3 py-2 text-right font-medium ${r.stock <= 0 ? 'text-red-700' : ''}`}>
                      {r.stock.toLocaleString('pt-BR')}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-600">{r.idealStock.toLocaleString('pt-BR')}</td>
                    <td className="px-3 py-2 text-right font-medium">{r.falta.toLocaleString('pt-BR')}</td>
                    <td className="px-3 py-2 text-right text-slate-600">
                      {r.salePrice != null ? formatBRL(r.falta * r.salePrice) : '-'}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`px-2 py-0.5 rounded text-xs ${SEVERITY_COLOR[r.severity]}`}>
                        {SEVERITY_LABEL[r.severity]}
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
