import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

interface DayRow {
  dia: string;
  qtd: number;
  canceladas: number;
  total: number;
  ticket: number;
  dinheiro: number;
  cartao: number;
  pix: number;
  crediario: number;
  outros: number;
}

interface MonthlyClosingResponse {
  period: { year: number; month: number };
  data: DayRow[];
  totals: DayRow;
  meta: { lastSyncedAt: string | null };
}

const MONTHS = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

export function FechamentoMensalPage(): JSX.Element {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const data = useQuery({
    queryKey: ['monthly-closing', year, month],
    queryFn: () => api<MonthlyClosingResponse>(`/api/reports/monthly-closing?year=${year}&month=${month}`),
  });

  const rows = data.data?.data ?? [];
  const totals = data.data?.totals;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex justify-between items-end gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold">Fechamento Mensal</h2>
          <p className="text-sm text-slate-500 mt-1">Resumo completo das vendas dia a dia, com totais por forma de pagamento.</p>
        </div>
        <div className="flex gap-3 items-end">
          <div>
            <label className="block text-xs uppercase text-slate-500 mb-1">Mês</label>
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="border rounded px-2 py-1 text-sm bg-white"
            >
              {MONTHS.map((m, i) => (
                <option key={i} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs uppercase text-slate-500 mb-1">Ano</label>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="border rounded px-2 py-1 text-sm bg-white"
            >
              {Array.from({ length: 5 }).map((_, i) => {
                const y = today.getFullYear() - i;
                return (
                  <option key={y} value={y}>
                    {y}
                  </option>
                );
              })}
            </select>
          </div>
        </div>
      </div>

      {totals && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <KpiCard label="Vendas no mês" value={totals.qtd.toLocaleString('pt-BR')} />
          <KpiCard label="Faturamento" value={formatBRL(totals.total)} accent="emerald" />
          <KpiCard label="Ticket Médio" value={formatBRL(totals.ticket)} />
          <KpiCard label="Canceladas" value={totals.canceladas.toLocaleString('pt-BR')} accent="red" />
          <KpiCard label="Dias com venda" value={rows.length.toLocaleString('pt-BR')} />
        </div>
      )}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        {data.isLoading ? (
          <div className="p-12 text-center text-slate-400">Carregando...</div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-slate-400">Sem vendas neste mês.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Dia</th>
                  <th className="px-3 py-2 text-right">Vendas</th>
                  <th className="px-3 py-2 text-right">Faturamento</th>
                  <th className="px-3 py-2 text-right">Ticket</th>
                  <th className="px-3 py-2 text-right text-emerald-700">Dinheiro</th>
                  <th className="px-3 py-2 text-right text-blue-700">Cartão</th>
                  <th className="px-3 py-2 text-right text-amber-700">PIX</th>
                  <th className="px-3 py-2 text-right text-red-700">Crediário</th>
                  <th className="px-3 py-2 text-right text-slate-500">Canc.</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.dia} className="border-t hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium">{formatDate(r.dia)}</td>
                    <td className="px-3 py-2 text-right">{r.qtd}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatBRL(r.total)}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{formatBRL(r.ticket)}</td>
                    <td className="px-3 py-2 text-right text-emerald-700">{formatBRL(r.dinheiro)}</td>
                    <td className="px-3 py-2 text-right text-blue-700">{formatBRL(r.cartao)}</td>
                    <td className="px-3 py-2 text-right text-amber-700">{formatBRL(r.pix)}</td>
                    <td className="px-3 py-2 text-right text-red-700">{formatBRL(r.crediario)}</td>
                    <td className="px-3 py-2 text-right text-slate-400">{r.canceladas || '-'}</td>
                  </tr>
                ))}
              </tbody>
              {totals && (
                <tfoot className="bg-slate-100 font-bold">
                  <tr className="border-t">
                    <td className="px-3 py-2">Total do mês</td>
                    <td className="px-3 py-2 text-right">{totals.qtd}</td>
                    <td className="px-3 py-2 text-right">{formatBRL(totals.total)}</td>
                    <td className="px-3 py-2 text-right">{formatBRL(totals.ticket)}</td>
                    <td className="px-3 py-2 text-right text-emerald-700">{formatBRL(totals.dinheiro)}</td>
                    <td className="px-3 py-2 text-right text-blue-700">{formatBRL(totals.cartao)}</td>
                    <td className="px-3 py-2 text-right text-amber-700">{formatBRL(totals.pix)}</td>
                    <td className="px-3 py-2 text-right text-red-700">{formatBRL(totals.crediario)}</td>
                    <td className="px-3 py-2 text-right text-slate-500">{totals.canceladas}</td>
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

function KpiCard({ label, value, accent }: { label: string; value: string; accent?: 'emerald' | 'red' }): JSX.Element {
  const accentClass = accent === 'emerald' ? 'text-emerald-700' : accent === 'red' ? 'text-red-700' : '';
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="text-xs text-slate-500 uppercase">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${accentClass}`}>{value}</div>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}
