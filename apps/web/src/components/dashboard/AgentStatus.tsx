import { useState } from 'react';
import { useQueryClient, useIsFetching, useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { FreshnessMeta, AgentManifest } from '../../lib/reports';
import { Spinner } from '../Spinner';

// Barra de status do agente no topo do dashboard (pedido do dono 26/08): em vez do alerta
// seco "1 agente offline", mostra a data/hora da ultima sincronizacao + botao "Atualizar".
// O botao mostra o loading enquanto re-le os dados e some ao concluir. (Sincronizacao viva
// empurrada pro agente = follow-up quando o agente novo estiver online.)
export function AgentStatus({ meta }: { meta?: FreshnessMeta | null | undefined }): JSX.Element {
  const qc = useQueryClient();
  const fetching = useIsFetching() > 0;
  // versao publicada (manifesto estatico no mesmo host) x versao que o agente reportou no sync
  const manifest = useQuery({ queryKey: ['agent-manifest'], queryFn: async () => (await fetch('/downloads/latest.json', { cache: 'no-store' })).json() as Promise<AgentManifest>, staleTime: 10 * 60_000, retry: 0 });
  const latest = manifest.data?.version ?? null;
  const atual = meta?.agentVersion ?? null;
  const cmp = (a: string, b: string) => { const pa = a.split('.').map(Number), pb = b.split('.').map(Number); for (let i = 0; i < 3; i++) { const d = (pa[i] ?? 0) - (pb[i] ?? 0); if (d) return d; } return 0; };
  const desatualizado = !!(latest && atual && cmp(latest, atual) > 0);

  const last = meta?.lastSyncedAt ? new Date(meta.lastSyncedAt) : null;
  const staleSec = meta?.stalenessSeconds ?? null;
  const offline = (meta?.agentsOffline ?? []).length > 0;

  // verde = fresco (< 5 min), ambar = defasado, cinza = sem info
  const dot = last == null ? 'bg-slate-400' : staleSec != null && staleSec > 300 ? 'bg-amber-500' : 'bg-emerald-500';
  const quando = last
    ? `${last.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${last.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
    : '—';
  const relativo = staleSec == null ? '' : staleSec < 90 ? 'agora há pouco' : staleSec < 3600 ? `há ${Math.round(staleSec / 60)} min` : `há ${Math.round(staleSec / 3600)} h`;

  // "Sincronizar": pede ao servidor pra liberar a trava e ACORDAR o agente da loja (dono 28/08:
  // sync de hora em hora pra custar o minimo; quem quer dado fresco clica). Os PCs desligam a
  // noite — se o agente estiver offline o painel diz isso, e o sync acontece quando ele ligar.
  const [aviso, setAviso] = useState<string | null>(null);
  const [pedindo, setPedindo] = useState(false);
  const atualizar = async (): Promise<void> => {
    setPedindo(true); setAviso(null);
    try {
      const r = await api<{ agentes: Array<{ loja: string; online: boolean; acordado: boolean }>; algumOnline: boolean }>('/api/agents/sync-now', { method: 'POST' });
      if (!r.algumOnline) {
        setAviso('O computador da loja está desligado — o agente sincroniza sozinho assim que ligar.');
      } else if (r.agentes.some((a) => a.online && !a.acordado)) {
        setAviso('Agente ligado (versão antiga): sincroniza em até 2 minutos.');
      } else {
        setAviso('Sincronização iniciada — os números atualizam em instantes.');
      }
      // da tempo do agente enviar e o servidor gravar; depois re-le tudo
      setTimeout(() => { void qc.invalidateQueries(); }, 25_000);
    } catch (e) {
      setAviso((e as Error).message);
    } finally { setPedindo(false); }
  };

  return (
    <>
    <div className="bg-white border rounded-xl px-4 py-2.5 flex items-center gap-3 text-sm">
      <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${dot}`} />
      <div className="flex-1 min-w-0">
        <span className="text-slate-600">Última sincronização: </span>
        <span className="text-slate-800 font-medium">{quando}</span>
        {relativo && <span className="text-slate-400"> · {relativo}</span>}
        {offline && <span className="text-amber-700"> · agente offline</span>}
        {atual && (
          <div className="text-xs text-slate-400">
            agente v{atual}
            {desatualizado && <span className="text-amber-700"> · v{latest} disponível — atualiza sozinho em até 1h (se o serviço estiver rodando)</span>}
            {!desatualizado && latest && <span> · atualizado</span>}
          </div>
        )}
      </div>
      <button
        onClick={() => void atualizar()}
        disabled={pedindo || fetching}
        className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-70"
      >
        {pedindo || fetching ? <><Spinner className="h-3.5 w-3.5" /> Sincronizando…</> : <>↻ Sincronizar</>}
      </button>
    </div>
    {aviso && <div className="text-xs text-slate-600 px-1 -mt-1">{aviso}</div>}
    </>
  );
}
