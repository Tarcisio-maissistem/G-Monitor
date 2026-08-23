import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useRoute } from '../lib/router';

interface Agent {
  id: string;
  channel: string;
  agentVersion: string | null;
  firebirdVersion: string | null;
  os: string | null;
  lastSeenAt: string | null;
  createdAt: string;
}

interface NewTokenResponse {
  agentId: string;
  token: string;
  message: string;
}

export function PdvsPage({ tenantId, storeId }: { tenantId: string; storeId: string }): JSX.Element {
  const queryClient = useQueryClient();
  const { navigate } = useRoute();
  const [showNewToken, setShowNewToken] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const agents = useQuery({
    queryKey: ['admin', 'stores', storeId, 'agents'],
    queryFn: () => api<{ agents: Agent[] }>(`/api/admin/stores/${storeId}/agents`),
  });

  const create = useMutation({
    mutationFn: () =>
      api<NewTokenResponse>(`/api/admin/stores/${storeId}/agents`, {
        method: 'POST',
        body: JSON.stringify({ channel: 'stable' }),
      }),
    onSuccess: (data) => {
      setShowNewToken(data.token);
      setCreating(false);
      queryClient.invalidateQueries({ queryKey: ['admin', 'stores', storeId, 'agents'] });
    },
    onError: () => setCreating(false),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api<{ ok: boolean }>(`/api/admin/agents/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'stores', storeId, 'agents'] }),
  });

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <button onClick={() => navigate(`/empresas/${tenantId}`)} className="text-sm text-blue-600 hover:underline mb-3">
        ← Voltar para Lojas
      </button>
      <div className="flex justify-between items-end mb-6">
        <div>
          <h2 className="text-2xl font-bold">Agente do Servidor</h2>
          <p className="text-sm text-slate-500 mt-1">
            Software instalado no PC da loja que tem o banco do GDOOR. Sincroniza as vendas com o painel.
          </p>
        </div>
        <button
          onClick={() => {
            if (confirm('Gerar um novo token de instalação? Use esse token só uma vez, no PC servidor da loja.')) {
              setCreating(true);
              create.mutate();
            }
          }}
          disabled={creating}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
        >
          + Gerar Token de Instalação
        </button>
      </div>

      {agents.isLoading && <div className="text-slate-400">Carregando...</div>}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
            <tr>
              <th className="px-4 py-3 text-left">ID do Agente</th>
              <th className="px-4 py-3 text-left">Versão</th>
              <th className="px-4 py-3 text-left">Sistema</th>
              <th className="px-4 py-3 text-left">Última conexão</th>
              <th className="px-4 py-3 text-center">Status</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {(agents.data?.agents ?? []).map((a) => (
              <tr key={a.id} className="border-t hover:bg-slate-50">
                <td className="px-4 py-3 font-mono text-xs">{a.id.slice(0, 12)}...</td>
                <td className="px-4 py-3">{a.agentVersion ?? '-'}</td>
                <td className="px-4 py-3 text-slate-600">{a.os ?? '-'}</td>
                <td className="px-4 py-3 text-slate-600">
                  {a.lastSeenAt ? new Date(a.lastSeenAt).toLocaleString('pt-BR') : 'Nunca'}
                </td>
                <td className="px-4 py-3 text-center">
                  <OnlineBadge lastSeenAt={a.lastSeenAt} />
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => {
                      if (confirm('Revogar este agente? O PDV vai parar de sincronizar imediatamente.')) {
                        remove.mutate(a.id);
                      }
                    }}
                    className="text-red-600 hover:underline text-xs"
                  >
                    Revogar
                  </button>
                </td>
              </tr>
            ))}
            {agents.data?.agents.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  Nenhum PDV configurado nesta loja. Clique em "Gerar Token" pra instalar o primeiro.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showNewToken && <TokenModal token={showNewToken} onClose={() => setShowNewToken(null)} />}
    </div>
  );
}

function OnlineBadge({ lastSeenAt }: { lastSeenAt: string | null }): JSX.Element {
  if (!lastSeenAt) return <span className="px-2 py-0.5 rounded text-xs bg-slate-200 text-slate-700">Nunca conectou</span>;
  const minutesAgo = (Date.now() - new Date(lastSeenAt).getTime()) / 60000;
  if (minutesAgo < 5) return <span className="px-2 py-0.5 rounded text-xs bg-emerald-100 text-emerald-800">Online</span>;
  if (minutesAgo < 60)
    return <span className="px-2 py-0.5 rounded text-xs bg-amber-100 text-amber-800">{Math.round(minutesAgo)}m atrás</span>;
  return <span className="px-2 py-0.5 rounded text-xs bg-red-100 text-red-800">Offline</span>;
}

function TokenModal({ token, onClose }: { token: string; onClose(): void }): JSX.Element {
  const [copied, setCopied] = useState(false);

  const copy = (): void => {
    navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl">
        <h3 className="text-lg font-bold mb-2">Token gerado</h3>
        <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm p-3 rounded mb-4">
          ⚠️ <strong>Este token só será mostrado UMA VEZ.</strong> Copie agora e guarde em local seguro. Depois de fechar esta
          janela, não tem como ver ele de novo (precisa gerar outro).
        </div>

        <label className="block text-xs uppercase text-slate-500 mb-1">Token de instalação</label>
        <div className="flex gap-2">
          <input
            readOnly
            value={token}
            onClick={(e) => (e.target as HTMLInputElement).select()}
            className="flex-1 border rounded px-3 py-2 text-xs font-mono bg-slate-50"
          />
          <button onClick={copy} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm">
            {copied ? 'Copiado!' : 'Copiar'}
          </button>
        </div>

        <h4 className="font-semibold text-sm mt-5 mb-2">Como instalar:</h4>
        <ol className="text-sm text-slate-600 space-y-1 list-decimal list-inside">
          <li>
            No PC <strong>servidor da loja</strong> (o que tem o banco do GDOOR), abra <strong>PowerShell como Administrador</strong>
          </li>
          <li>Cole o comando abaixo e responda as perguntas</li>
          <li>Pronto — o agente é instalado como serviço do Windows e começa a sincronizar sozinho</li>
        </ol>

        <pre className="text-xs bg-slate-900 text-slate-100 p-3 rounded mt-3 overflow-x-auto">
{`$Token = "${token}"
iex (irm http://192.168.100.200:8088/install.ps1)`}
        </pre>

        <p className="text-xs text-slate-500 mt-2">
          O instalador detecta o banco automaticamente, registra como serviço do Windows (liga sozinho com o PC) e roda em segundo plano sem janela aberta.
        </p>

        <div className="mt-5 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm bg-slate-700 hover:bg-slate-800 text-white rounded">
            Já copiei, pode fechar
          </button>
        </div>
      </div>
    </div>
  );
}
