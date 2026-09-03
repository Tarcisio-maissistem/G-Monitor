import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { formatBRL } from '../../lib/masks';
import { Spinner } from '../Spinner';

interface BancoDiaResp {
  data: {
    dia: string;
    extratoOk: boolean;
    bancos: Array<{ banco: string; bruto: number; taxa: number; liquido: number; transacoes: number; adquirentes: string[] }>;
    totalLiquido: number;
    semRegra: { bruto: number; transacoes: number };
  };
}

// "Quanto deve CAIR no banco no dia" (dono 01/09): extrato da maquininha dos dias anteriores
// (débito/crédito D+1 útil, taxa por bandeira) + PIX do próprio dia, agrupado pelo banco de
// recebimento da ficha do adquirente (REDE→Itaú, CIELO→Bradesco, SHIPAY→Itaú).
export function BancoDia(): JSX.Element {
  const [dia, setDia] = useState(() => new Date().toISOString().slice(0, 10));
  const q = useQuery({
    queryKey: ['banco-dia', dia],
    queryFn: () => api<BancoDiaResp>(`/api/reports/conciliacao/banco-dia?date=${dia}`),
    staleTime: 5 * 60_000,
  });
  const d = q.data?.data;

  return (
    <section className="bg-white rounded-xl shadow-sm border p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h3 className="font-semibold text-slate-700">🏦 Deve cair no banco</h3>
        <input type="date" value={dia} onChange={(e) => setDia(e.target.value)} className="border rounded px-2 py-1 text-sm" />
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Líquido previsto para o dia: cartão dos dias anteriores (D+1 útil, taxa por bandeira do extrato) + PIX do próprio dia.
      </p>

      {q.isLoading && <div className="text-slate-400 text-sm flex items-center gap-2 py-4"><Spinner /> Consultando o extrato da maquininha...</div>}
      {q.isError && <div className="text-sm text-amber-700">{(q.error as Error).message}</div>}

      {d && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {d.bancos.map((b) => (
              <div key={b.banco} className="border rounded-lg p-3">
                <div className="text-xs uppercase text-slate-500">{b.banco}</div>
                <div className="text-xl font-bold text-emerald-700 mt-0.5">{formatBRL(b.liquido)}</div>
                <div className="text-[11px] text-slate-500 mt-1">
                  {b.adquirentes.join(' + ')} · {b.transacoes} transações
                  {b.taxa > 0 && <> · bruto {formatBRL(b.bruto)} − taxas {formatBRL(b.taxa)}</>}
                </div>
              </div>
            ))}
            {d.bancos.length > 0 && (
              <div className="border rounded-lg p-3 bg-slate-50">
                <div className="text-xs uppercase text-slate-500">Total do dia</div>
                <div className="text-xl font-bold text-slate-800 mt-0.5">{formatBRL(d.totalLiquido)}</div>
                <div className="text-[11px] text-slate-500 mt-1">soma de todos os bancos</div>
              </div>
            )}
          </div>
          {d.bancos.length === 0 && (
            <div className="text-sm text-slate-400 py-3">Nenhum depósito previsto para este dia{d.extratoOk ? '' : ' (extrato da maquininha indisponível — só PIX entraria)'}.</div>
          )}
          {!d.extratoOk && d.bancos.length > 0 && (
            <p className="text-[11px] text-amber-700 mt-2">⚠ Extrato da maquininha indisponível agora — mostrando só o PIX. Cartões entram quando o portal responder.</p>
          )}
          {d.semRegra.transacoes > 0 && (
            <p className="text-[11px] text-amber-700 mt-2">
              {d.semRegra.transacoes} transação(ões) somando {formatBRL(d.semRegra.bruto)} ficaram fora por não terem taxa cadastrada (ex.: VR/Alelo inativas).
            </p>
          )}
        </>
      )}
    </section>
  );
}
