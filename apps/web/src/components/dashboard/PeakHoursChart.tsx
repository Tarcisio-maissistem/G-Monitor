import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from 'recharts';
import { api } from '../../lib/api';
import type { PeakHoursResponse } from '../../lib/reports';
import { FilterChip } from '../ui';

// Horario de pico (VENDAS.HORA_SAIDA) — pedido do dono 25/08. Barra por hora do dia; a hora
// de pico fica destacada. So tem dado pra venda sincronizada apos 26/08 (agente novo).
export function PeakHoursChart({ storeId }: { storeId?: string }): JSX.Element {
  const [dias, setDias] = useState(7);
  const q = useQuery({
    queryKey: ['peak-hours', dias, storeId],
    queryFn: () => api<PeakHoursResponse>(`/api/reports/dashboard/peak-hours?days=${dias}${storeId ? `&storeId=${storeId}` : ''}`),
  });

  // corta as horas vazias das pontas (loja nao abre 0-6h) pra barra nao ficar espremida
  const full = q.data?.data ?? [];
  const comVenda = full.filter((d) => d.qtd > 0);
  const min = comVenda.length ? Math.min(...comVenda.map((d) => d.hora)) : 0;
  const max = comVenda.length ? Math.max(...comVenda.map((d) => d.hora)) : 23;
  const data = full.filter((d) => d.hora >= min && d.hora <= max);
  const pico = q.data?.picoHora ?? null;

  return (
    <section className="bg-white rounded-xl shadow-sm border p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <div>
          <h3 className="font-semibold text-slate-700">Horário de Pico</h3>
          <p className="text-xs text-slate-500">
            {pico !== null ? `Maior movimento às ${String(pico).padStart(2, '0')}h` : 'Vendas por hora do dia'}
          </p>
        </div>
        <div className="flex gap-1">
          {[7, 15, 30].map((d) => (
            <FilterChip key={d} active={dias === d} onClick={() => setDias(d)}>{d}d</FilterChip>
          ))}
        </div>
      </div>

      {q.isLoading ? (
        <div className="h-56 flex items-center justify-center text-slate-400 text-sm">Carregando...</div>
      ) : q.data?.semDado ? (
        <div className="h-56 flex flex-col items-center justify-center text-center text-slate-400 text-sm px-4">
          <span className="text-2xl mb-2">⏱️</span>
          Ainda sem hora nas vendas. O gráfico enche conforme o agente novo sincroniza (a partir de hoje).
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={224}>
          <BarChart data={data}>
            <XAxis dataKey="hora" tick={{ fontSize: 11 }} tickFormatter={(h: number) => `${h}h`} />
            <YAxis tick={{ fontSize: 11 }} width={32} />
            <Tooltip
              formatter={(v: number) => [`${v.toLocaleString('pt-BR')} vendas`, '']}
              labelFormatter={(h: number) => `${String(h).padStart(2, '0')}h`}
            />
            <Bar dataKey="qtd" radius={[3, 3, 0, 0]}>
              {data.map((d) => (
                <Cell key={d.hora} fill={d.hora === pico ? '#3b82f6' : '#93c5fd'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </section>
  );
}
