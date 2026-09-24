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

// Resultado do mes no formato do gestor da Casa J.Kastros (24/09) — ver backend fechamentoResumo.ts
interface ResumoFechamento {
  entradas: { bruto: number; porForma: Array<{ forma: string; label: string; valor: number; pct: number }>; aPrazo: number; liquidoVendas: number };
  recebidos: { valor: number; qtd: number };
  entradasEfetivas: number;
  saidas: { total: number; qtd: number; porGrupo: Array<{ nome: string; valor: number; pct: number }>; agrupadoPor: 'fornecedor' | 'plano_contas' };
  resultado: number;
  resultadoPct: number;
}

interface MonthlyClosingResponse {
  period: { year: number; month: number };
  data: DayRow[];
  totals: DayRow;
  resumo?: ResumoFechamento;
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

      {data.data?.resumo && <ResultadoDoMes r={data.data.resumo} />}

      <h3 className="font-semibold text-slate-700 pt-2">Vendas dia a dia</h3>
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

// Entradas -> a prazo -> recebidos -> saidas -> resultado, tudo numa tela (pedido do gestor 24/09)
function ResultadoDoMes({ r }: { r: ResumoFechamento }): JSX.Element {
  const Linha = ({ label, valor, forte, sinal, nota }: { label: string; valor: number; forte?: boolean; sinal?: string; nota?: string }): JSX.Element => (
    <div className={`flex justify-between gap-2 py-1 ${forte ? 'font-semibold border-t mt-1 pt-2' : ''}`}>
      <span className={forte ? 'text-slate-800' : 'text-slate-600'}>{sinal ? `${sinal} ` : ''}{label}{nota && <span className="text-xs text-slate-400"> · {nota}</span>}</span>
      <span>{formatBRL(valor)}</span>
    </div>
  );
  const positivo = r.resultado >= 0;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="bg-white rounded-lg shadow p-4 text-sm">
        <h3 className="font-semibold text-slate-700 mb-2">Entradas</h3>
        {r.entradas.porForma.map((f) => (
          <div key={f.forma} className="flex justify-between gap-2 py-1">
            <span className="text-slate-600">{f.label}</span>
            <span>{formatBRL(f.valor)} <span className="text-xs text-slate-400 w-12 inline-block text-right">{f.pct.toFixed(1)}%</span></span>
          </div>
        ))}
        <Linha label="Total bruto vendido" valor={r.entradas.bruto} forte />
        <Linha sinal="−" label="Vendido a prazo" valor={r.entradas.aPrazo} nota="ainda não é dinheiro" />
        <Linha label="Líquido de vendas" valor={r.entradas.liquidoVendas} forte />
        <Linha sinal="+" label="Recebidos" valor={r.recebidos.valor} nota={`${r.recebidos.qtd} título(s) baixado(s)`} />
        <Linha label="Entradas efetivas" valor={r.entradasEfetivas} forte />
      </section>

      <section className="bg-white rounded-lg shadow p-4 text-sm">
        <h3 className="font-semibold text-slate-700 mb-1">Saídas</h3>
        <p className="text-xs text-slate-400 mb-2">
          Contas pagas no mês ({r.saidas.qtd}), por {r.saidas.agrupadoPor === 'plano_contas' ? 'plano de contas' : 'fornecedor — o plano de contas entra com o agente novo'}.
        </p>
        <div className="max-h-72 overflow-y-auto">
          {r.saidas.porGrupo.map((g) => (
            <div key={g.nome} className="flex justify-between gap-2 py-1">
              <span className="text-slate-600 truncate">{g.nome}</span>
              <span className="shrink-0">{formatBRL(g.valor)} <span className="text-xs text-slate-400 w-12 inline-block text-right">{g.pct.toFixed(1)}%</span></span>
            </div>
          ))}
          {r.saidas.porGrupo.length === 0 && <p className="text-slate-400">Nenhuma conta paga no mês.</p>}
        </div>
        <Linha label="Total de saídas" valor={r.saidas.total} forte />
      </section>

      <section className={`rounded-lg shadow p-4 text-sm border ${positivo ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
        <h3 className="font-semibold text-slate-700 mb-2">Resultado do mês</h3>
        <Linha label="Entradas efetivas" valor={r.entradasEfetivas} />
        <Linha sinal="−" label="Saídas" valor={r.saidas.total} />
        <div className={`flex justify-between items-end border-t mt-2 pt-3 ${positivo ? 'text-emerald-800' : 'text-red-800'}`}>
          <span className="font-semibold">Resultado</span>
          <span className="text-2xl font-bold">{formatBRL(r.resultado)}</span>
        </div>
        <div className={`text-right text-sm ${positivo ? 'text-emerald-700' : 'text-red-700'}`}>{r.resultadoPct.toFixed(1)}% das entradas efetivas</div>
      </section>
    </div>
  );
}
