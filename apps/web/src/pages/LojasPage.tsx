import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useRoute } from '../lib/router';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';

interface Store {
  id: string;
  name: string;
  externalId: string;
  timezone: string;
  createdAt: string;
  _count: { agents: number };
}

interface TenantDetail {
  id: string;
  name: string;
}

export function LojasPage({ tenantId }: { tenantId: string }): JSX.Element {
  const queryClient = useQueryClient();
  const { navigate } = useRoute();
  const toast = useToast();
  const confirm = useConfirm();
  const [openModal, setOpenModal] = useState(false);

  // Pega nome da empresa pra mostrar no cabeçalho
  const tenants = useQuery({
    queryKey: ['admin', 'tenants'],
    queryFn: () => api<{ tenants: TenantDetail[] }>('/api/admin/tenants'),
  });
  const tenant = tenants.data?.tenants.find((t) => t.id === tenantId);

  const stores = useQuery({
    queryKey: ['admin', 'tenants', tenantId, 'stores'],
    queryFn: () => api<{ stores: Store[] }>(`/api/admin/tenants/${tenantId}/stores`),
  });

  const create = useMutation({
    mutationFn: (input: { name: string; externalId: string }) =>
      api<{ store: Store }>(`/api/admin/tenants/${tenantId}/stores`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'tenants', tenantId, 'stores'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'tenants'] });
      setOpenModal(false);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api<{ ok: boolean }>(`/api/admin/stores/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'tenants', tenantId, 'stores'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'tenants'] });
      toast.push({ type: 'success', message: 'Loja excluída.' });
    },
    onError: (e: Error) => toast.push({ type: 'error', message: `Erro ao excluir: ${e.message}` }),
  });

  const handleDelete = (s: Store): void => {
    confirm.ask({
      title: `Excluir loja "${s.name}"?`,
      message: 'A loja vai ser desativada. Os agentes vinculados continuam, mas vendas novas não entram mais nessa loja.',
      confirmLabel: 'Sim, excluir',
      destructive: true,
      onConfirm: async () => { await remove.mutateAsync(s.id); },
    });
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <button onClick={() => navigate('/empresas')} className="text-sm text-blue-600 hover:underline mb-3">
        ← Voltar para Empresas
      </button>
      <div className="flex justify-between items-end mb-6">
        <div>
          <h2 className="text-2xl font-bold">Lojas de {tenant?.name ?? '...'}</h2>
          <p className="text-sm text-slate-500 mt-1">Cada loja tem um agente instalado no PC servidor (1 só, não em todos os PDVs).</p>
        </div>
        <button
          onClick={() => setOpenModal(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm font-medium"
        >
          + Nova Loja
        </button>
      </div>

      {stores.isLoading && <div className="text-slate-400">Carregando...</div>}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
            <tr>
              <th className="px-4 py-3 text-left">Nome</th>
              <th className="px-4 py-3 text-left">Código Interno</th>
              <th className="px-4 py-3 text-left">Fuso Horário</th>
              <th className="px-4 py-3 text-center">Agente</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {(stores.data?.stores ?? []).map((s) => (
              <tr key={s.id} className="border-t hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">
                  <button
                    onClick={() => navigate(`/empresas/${tenantId}/lojas/${s.id}`)}
                    className="text-blue-700 hover:underline"
                  >
                    {s.name}
                  </button>
                </td>
                <td className="px-4 py-3 font-mono text-xs">{s.externalId}</td>
                <td className="px-4 py-3 text-slate-600">{s.timezone}</td>
                <td className="px-4 py-3 text-center">{s._count.agents}</td>
                <td className="px-4 py-3 text-right space-x-2">
                  <button
                    onClick={() => navigate(`/empresas/${tenantId}/lojas/${s.id}`)}
                    className="text-blue-600 hover:underline text-xs"
                  >
                    Agente
                  </button>
                  <button
                    onClick={() => handleDelete(s)}
                    disabled={remove.isPending}
                    className="text-red-600 hover:underline text-xs disabled:opacity-50"
                  >
                    {remove.isPending && remove.variables === s.id ? 'Excluindo...' : 'Excluir'}
                  </button>
                </td>
              </tr>
            ))}
            {stores.data?.stores.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  Nenhuma loja cadastrada nesta empresa.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {openModal && (
        <NewStoreModal
          onClose={() => setOpenModal(false)}
          onCreate={(input) => create.mutate(input)}
          loading={create.isPending}
          error={create.error?.message}
        />
      )}
    </div>
  );
}

function NewStoreModal({
  onClose,
  onCreate,
  loading,
  error,
}: {
  onClose(): void;
  onCreate(input: { name: string; externalId: string }): void;
  loading: boolean;
  error?: string | undefined;
}): JSX.Element {
  const [name, setName] = useState('');
  const [externalId, setExternalId] = useState('');

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    onCreate({ name, externalId });
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <form onSubmit={submit} className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
        <h3 className="text-lg font-bold mb-4">Nova Loja</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs uppercase text-slate-500 mb-1">Nome da loja *</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              className="w-full border rounded px-3 py-2 text-sm"
              placeholder="Loja Matriz, Filial Centro, etc"
            />
          </div>
          <div>
            <label className="block text-xs uppercase text-slate-500 mb-1">Código interno *</label>
            <input
              value={externalId}
              onChange={(e) => setExternalId(e.target.value)}
              required
              className="w-full border rounded px-3 py-2 text-sm font-mono"
              placeholder="MATRIZ, FILIAL01, etc"
            />
            <p className="text-xs text-slate-400 mt-1">Identificador único interno (sem espaços).</p>
          </div>
        </div>
        {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
          >
            {loading ? 'Criando...' : 'Criar loja'}
          </button>
        </div>
      </form>
    </div>
  );
}
