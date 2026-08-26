import { useQueryClient, useIsFetching } from '@tanstack/react-query';
import type { FreshnessMeta } from '../../lib/reports';
import { Spinner } from '../Spinner';

// Barra de status do agente no topo do dashboard (pedido do dono 26/08): em vez do alerta
// seco "1 agente offline", mostra a data/hora da ultima sincronizacao + botao "Atualizar".
// O botao mostra o loading enquanto re-le os dados e some ao concluir. (Sincronizacao viva
// empurrada pro agente = follow-up quando o agente novo estiver online.)
export function AgentStatus({ meta }: { meta?: FreshnessMeta | null | undefined }): JSX.Element {
  const qc = useQueryClient();
  const fetching = useIsFetching() > 0;

  const last = meta?.lastSyncedAt ? new Date(meta.lastSyncedAt) : null;
  const staleSec = meta?.stalenessSeconds ?? null;
  const offline = (meta?.agentsOffline ?? []).length > 0;

  // verde = fresco (< 5 min), ambar = defasado, cinza = sem info
  const dot = last == null ? 'bg-slate-400' : staleSec != null && staleSec > 300 ? 'bg-amber-500' : 'bg-emerald-500';
  const quando = last
    ? `${last.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${last.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
    : '—';
  const relativo = staleSec == null ? '' : staleSec < 90 ? 'agora há pouco' : staleSec < 3600 ? `há ${Math.round(staleSec / 60)} min` : `há ${Math.round(staleSec / 3600)} h`;

  const atualizar = (): void => {
    void qc.invalidateQueries(); // re-le tudo do SaaS (o agente alimenta a cada ~90s)
  };

  return (
    <div className="bg-white border rounded-xl px-4 py-2.5 flex items-center gap-3 text-sm">
      <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${dot}`} />
      <div className="flex-1 min-w-0">
        <span className="text-slate-600">Última sincronização: </span>
        <span className="text-slate-800 font-medium">{quando}</span>
        {relativo && <span className="text-slate-400"> · {relativo}</span>}
        {offline && <span className="text-amber-700"> · agente offline</span>}
      </div>
      <button
        onClick={atualizar}
        disabled={fetching}
        className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-70"
      >
        {fetching ? <><Spinner className="h-3.5 w-3.5" /> Sincronizando…</> : <>↻ Atualizar</>}
      </button>
    </div>
  );
}
