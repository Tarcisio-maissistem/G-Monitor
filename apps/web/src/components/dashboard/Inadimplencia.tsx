import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { formatBRL, formatCompactBRL, formatInt } from '../../lib/masks';
import type { InadimplenciaResponse, FaixaInad } from '../../lib/reports';
import { QueryState } from '../ui';

// Rótulo e cor por faixa de tempo vencido. Quanto mais velho, mais vermelho — o objetivo do
// dono (26/08) e enxergar o calote antigo, nao so o maior valor.
const FAIXA: Record<FaixaInad, { label: string; hint: string; tone: string }> = {
  mes: { label: 'Vencido no mês', hint: 'até 30 dias', tone: 'text-amber-700 bg-amber-50 border-amber-200' },
  tri: { label: 'Há 1–3 meses', hint: '31 a 90 dias', tone: 'text-orange-700 bg-orange-50 border-orange-200' },
  sem: { label: 'Há 3–6 meses', hint: '91 a 180 dias', tone: 'text-red-700 bg-red-50 border-red-200' },
  ano: { label: 'Há 6–12 meses', hint: '181 a 365 dias', tone: 'text-red-800 bg-red-50 border-red-300' },
  mais1ano: { label: 'Há mais de 1 ano', hint: '+365 dias', tone: 'text-red-900 bg-red-100 border-red-300' },
};

// Formata dias de atraso em algo legível: "2 anos", "8 meses", "20 dias".
function idade(dias: number): string {
  if (dias >= 365) { const a = Math.floor(dias / 365); return `${a} ano${a > 1 ? 's' : ''}`; }
  if (dias >= 30) { const m = Math.floor(dias / 30); return `${m} ${m > 1 ? 'meses' : 'mês'}`; }
  return `${dias} dias`;
}

// Inadimplencia por faixa de TEMPO + quem deve ha mais tempo (pedido do dono 26/08).
export function Inadimplencia({ storeId }: { storeId?: string }): JSX.Element {
  const [aberto, setAberto] = useState(false);
  const q = useQuery({
    queryKey: ['inadimplencia', storeId],
    queryFn: () => api<InadimplenciaResponse>(`/api/reports/dashboard/inadimplencia${storeId ? `?storeId=${storeId}` : ''}`),
  });
  const d = q.data;
  const piores = d?.piores ?? [];
  const mostrados = aberto ? piores : piores.slice(0, 8);

  return (
    <section className="bg-white rounded-xl shadow-sm border p-5">
      <div className="flex items-start justify-between gap-2 mb-4">
        <div>
          <h3 className="font-semibold text-slate-700">Inadimplência por tempo</h3>
          <p className="text-xs text-slate-500">Contas a receber vencidas, por há quanto tempo estão em aberto.</p>
        </div>
        {d && <div className="text-right shrink-0"><div className="text-lg font-bold text-red-700">{formatCompactBRL(d.total.valor)}</div><div className="text-[11px] text-slate-500">{formatInt(d.total.titulos)} títulos vencidos</div></div>}
      </div>

      <QueryState query={q} empty={d && d.total.titulos === 0 ? 'Nenhuma conta vencida em aberto. 🎉' : undefined}>
        {/* faixas de tempo */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
          {(d?.faixas ?? []).map((f) => (
            <div key={f.faixa} className={`rounded-lg border p-2.5 ${FAIXA[f.faixa].tone}`}>
              <div className="text-[11px] font-medium leading-tight">{FAIXA[f.faixa].label}</div>
              <div className="text-[10px] opacity-70 mb-1">{FAIXA[f.faixa].hint}</div>
              <div className="text-base font-bold leading-none">{formatCompactBRL(f.valor)}</div>
              <div className="text-[11px] opacity-80 mt-0.5">{formatInt(f.devedores)} devedor{f.devedores !== 1 ? 'es' : ''}</div>
            </div>
          ))}
        </div>

        {/* quem deve ha mais tempo */}
        {piores.length > 0 && (
          <>
            <div className="text-xs font-medium text-slate-600 mb-2">Quem deve há mais tempo</div>
            <div className="divide-y">
              {mostrados.map((p, i) => (
                <div key={i} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <div className="text-sm text-slate-800 truncate">{p.nome}</div>
                    <div className="text-[11px] text-slate-500">{formatInt(p.titulos)} título{p.titulos > 1 ? 's' : ''} · desde {p.vencimentoMaisAntigo.split('-').reverse().join('/')}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-semibold text-slate-800">{formatBRL(p.saldo)}</div>
                    <div className={`text-[11px] font-medium ${p.diasAtraso >= 180 ? 'text-red-700' : 'text-amber-700'}`}>{idade(p.diasAtraso)} de atraso</div>
                  </div>
                </div>
              ))}
            </div>
            {piores.length > 8 && (
              <button onClick={() => setAberto((v) => !v)} className="mt-2 text-xs text-blue-600 hover:underline">
                {aberto ? 'Ver menos' : `Ver todos os ${piores.length}`}
              </button>
            )}
          </>
        )}
      </QueryState>
    </section>
  );
}
