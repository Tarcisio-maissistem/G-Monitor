import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { api } from '../lib/api';
import { isoDate, currentMonthRange } from '../lib/period';
import { exportToCsv, todayStamp } from '../lib/exportCsv';

interface CashRow {
  dia: string;
  entradas: number;
  saidas: number;
  saldoDia: number;
  saldoAcumulado: number;
  movimentos: number;
}

interface CashResp {
  data: CashRow[];
  totals: {
    entradas: number;
    saidas: number;
    saldoFinal: number;
  };
}

export function CaixaDetalhadoPage(): JSX.Element {
  const today = useMemo(() => new Date(), []);
  const [from, setFrom] = useState(() => {
    return currentMonthRange(today).from;
  });
  const [to, setTo] = useState(isoDate(today));

  const r = useQuery({
    queryKey: ['cash-detailed', from, to],
    queryFn: () => api<CashResp>(`/api/reports/cash-detailed?from=${from}&to=${to}`),
  });

  const rows = r.data?.data ?? [];
  const totals = r.data?.totals;

  const chartData = useMemo(
    () => rows.map((r) => ({ ...r, dia: r.dia.slice(5) })),
    [rows],
  );

  const onExport = (): void => {
    exportToCsv(`caixa_${from}_a_${to}_${todayStamp()}`, [
      { header: 'Data', value: (r) => new Date(r.dia).toLocaleDateString('pt-BR') },
      { header: 'Movimentos', value: (r) => r.movimentos, number: true },
      { header: 'Entradas', value: (r) => r.entradas, money: true },
      { header: 'Saídas', value: (r) => r.saidas, money: true },
      { header: 'Saldo do dia', value: (r) => r.saldoDia, money: true },
      { header: 'Saldo acumulado', value: (r) => r.saldoAcumulado, money: true },
    ], rows);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold">Caixa Detalhado</h2>
          <p className="text-sm text-slate-500 mt-1">
            Movimentação diária com saldo acumulado. Entradas e saídas do caixa do PDV.
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
        <Kpi label="Entradas" value={formatBRL(totals?.entradas ?? 0)} color="text-emerald-700" />
        <Kpi label="Saídas" value={formatBRL(totals?.saidas ?? 0)} color="text-red-700" />
        <Kpi
          label="Saldo final"
          value={formatBRL(totals?.saldoFinal ?? 0)}
          color={(totals?.saldoFinal ?? 0) >= 0 ? 'text-emerald-700' : 'text-red-700'}
        />
      </div>

      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="font-semibold mb-3">Evolução do saldo acumulado</h3>
        {r.isLoading ? (
          <div className="text-center py-12 text-slate-400">Carregando...</div>
        ) : chartData.length === 0 ? (
          <div className="text-center py-12 text-slate-400">Sem movimentações no período.</div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="dia" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `R$ ${Math.round(v / 1000)}k`} />
              <Tooltip formatter={(v: number) => formatBRL(v)} />
              <Legend />
              <Line type="monotone" dataKey="saldoAcumulado" name="Saldo acumulado" stroke="#3b82f6" strokeWidth={2} />
              <Line type="monotone" dataKey="entradas" name="Entradas" stroke="#10b981" strokeWidth={1} dot={false} />
              <Line type="monotone" dataKey="saidas" name="Saídas" stroke="#ef4444" strokeWidth={1} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-4 py-3 border-b">
          <h3 className="font-semibold">Movimentação dia a dia</h3>
        </div>
        {r.isLoading ? (
          <div className="p-12 text-center text-slate-400">Carregando...</div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            Sem dados.
            <span className="block text-xs mt-2">
              Os movimentos de caixa são sincronizados a partir da v0.5.0 do agente.
            </span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Data</th>
                  <th className="px-3 py-2 text-right">Movimentos</th>
                  <th className="px-3 py-2 text-right">Entradas</th>
                  <th className="px-3 py-2 text-right">Saídas</th>
                  <th className="px-3 py-2 text-right">Saldo do dia</th>
                  <th className="px-3 py-2 text-right">Saldo acumulado</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.dia} className="border-t hover:bg-slate-50">
                    <td className="px-3 py-2">{new Date(r.dia).toLocaleDateString('pt-BR')}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{r.movimentos.toLocaleString('pt-BR')}</td>
                    <td className="px-3 py-2 text-right text-emerald-700">{formatBRL(r.entradas)}</td>
                    <td className="px-3 py-2 text-right text-red-700">{formatBRL(r.saidas)}</td>
                    <td className={`px-3 py-2 text-right font-medium ${r.saldoDia >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                      {formatBRL(r.saldoDia)}
                    </td>
                    <td className={`px-3 py-2 text-right font-bold ${r.saldoAcumulado >= 0 ? 'text-slate-900' : 'text-red-700'}`}>
                      {formatBRL(r.saldoAcumulado)}
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
