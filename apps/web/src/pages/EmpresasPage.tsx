import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useRoute } from '../lib/router';
import { useToast } from '../components/Toast';
import { MaskedInput } from '../components/MaskedInput';
import { applyCpfOrCnpj, parseCurrency } from '../lib/masks';
import { useConfirm } from '../components/ConfirmDialog';
import { Spinner } from '../components/Spinner';

interface Tenant {
  id: string;
  name: string;
  cnpj: string | null;
  phone: string | null;
  plan: string;
  subscriptionStatus: string;
  pendingApproval: boolean;
  createdAt: string;
  monthlyGoal: number;
  _count: { stores: number; users: number; agents: number };
}

interface Store {
  id: string;
  name: string;
}

export function EmpresasPage(): JSX.Element {
  const queryClient = useQueryClient();
  const { navigate } = useRoute();
  const toast = useToast();
  const confirm = useConfirm();
  const [openModal, setOpenModal] = useState(false);
  const [loadingAgentFor, setLoadingAgentFor] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'tenants'],
    queryFn: () => api<{ tenants: Tenant[] }>('/api/admin/tenants'),
  });

  const create = useMutation({
    mutationFn: (input: { name: string; cnpj?: string; phone?: string }) =>
      api<{ tenant: Tenant }>('/api/admin/tenants', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'tenants'] });
      setOpenModal(false);
      toast.push({ type: 'success', message: `Empresa "${data.tenant.name}" criada.` });
    },
    onError: (e: Error) => toast.push({ type: 'error', message: `Erro ao criar: ${e.message}` }),
  });

  const approve = useMutation({
    mutationFn: (id: string) => api<{ ok: boolean }>(`/api/admin/tenants/${id}/approve`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'tenants'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast.push({ type: 'success', message: 'Empresa aprovada — o agente já pode sincronizar.' });
    },
    onError: (e: Error) => toast.push({ type: 'error', message: `Erro ao aprovar: ${e.message}` }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api<{ ok: boolean }>(`/api/admin/tenants/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'tenants'] });
      toast.push({ type: 'success', message: 'Empresa excluída.' });
    },
    onError: (e: Error) => toast.push({ type: 'error', message: `Erro ao excluir: ${e.message}` }),
  });

  const handleDelete = (t: Tenant): void => {
    confirm.ask({
      title: `Excluir "${t.name}"?`,
      message: `Esta ação vai desativar a empresa e seus agentes serão revogados. Tem certeza?`,
      confirmLabel: 'Sim, excluir',
      destructive: true,
      onConfirm: async () => { await remove.mutateAsync(t.id); },
    });
  };

  // Navega direto pra pagina do agente da loja principal (modelo simplificado)
  const goToAgent = async (tenantId: string): Promise<void> => {
    setLoadingAgentFor(tenantId);
    try {
      const r = await api<{ store: Store | null }>(`/api/admin/tenants/${tenantId}/primary-store`);
      if (r.store) {
        navigate(`/empresas/${tenantId}/lojas/${r.store.id}`);
      } else {
        toast.push({ type: 'error', message: 'Empresa sem loja principal. Use a opção "Lojas".' });
      }
    } catch (e) {
      toast.push({ type: 'error', message: `Erro: ${(e as Error).message}` });
    } finally {
      setLoadingAgentFor(null);
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex justify-between items-end mb-6">
        <div>
          <h2 className="text-2xl font-bold">Empresas</h2>
          <p className="text-sm text-slate-500 mt-1">Cada empresa tem seus próprios dados, separados das demais.</p>
        </div>
        <button
          onClick={() => setOpenModal(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm font-medium"
        >
          + Nova Empresa
        </button>
      </div>

      {isLoading && (
        <div className="text-slate-400 flex items-center gap-2 py-4">
          <Spinner /> Carregando...
        </div>
      )}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
            <tr>
              <th className="px-4 py-3 text-left">Empresa</th>
              <th className="px-4 py-3 text-left">CNPJ</th>
              <th className="px-4 py-3 text-left">Plano</th>
              <th className="px-4 py-3 text-left">Situação</th>
              <th className="px-4 py-3 text-right">Meta mensal</th>
              <th className="px-4 py-3 text-center">Servidor</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {(data?.tenants ?? []).map((t) => (
              <tr key={t.id} className="border-t hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">
                  <button onClick={() => void goToAgent(t.id)} disabled={loadingAgentFor === t.id} className="text-blue-700 hover:underline inline-flex items-center gap-1.5 disabled:opacity-60">
                    {loadingAgentFor === t.id && <Spinner className="h-3 w-3" />}
                    {t.name}
                  </button>
                </td>
                <td className="px-4 py-3 text-slate-600">{t.cnpj ? applyCpfOrCnpj(t.cnpj) : '-'}</td>
                <td className="px-4 py-3 capitalize">{t.plan}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={t.subscriptionStatus} />
                  {t.pendingApproval && (
                    <span className="ml-1.5 px-2 py-0.5 rounded text-xs bg-amber-100 text-amber-800">Pendente aprovação</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <MetaCell tenant={t} />
                </td>
                <td className="px-4 py-3 text-center">
                  {t._count.agents > 0 ? (
                    <span className="px-2 py-0.5 rounded text-xs bg-emerald-100 text-emerald-800">{t._count.agents} ativo</span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-600">sem agente</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right space-x-2">
                  {t.pendingApproval && (
                    <button
                      onClick={() => approve.mutate(t.id)}
                      disabled={approve.isPending}
                      className="text-emerald-700 hover:underline text-xs disabled:opacity-50 inline-flex items-center gap-1 font-medium"
                    >
                      {approve.isPending && approve.variables === t.id && <Spinner className="h-3 w-3" />}
                      Aprovar
                    </button>
                  )}
                  <button
                    onClick={() => navigate(`/empresas/${t.id}/usuarios`)}
                    className="text-blue-600 hover:underline text-xs"
                  >
                    Usuários
                  </button>
                  <button
                    onClick={() => void goToAgent(t.id)}
                    disabled={loadingAgentFor === t.id}
                    className="text-blue-600 hover:underline text-xs disabled:opacity-60 inline-flex items-center gap-1"
                  >
                    {loadingAgentFor === t.id && <Spinner className="h-3 w-3" />}
                    Servidor
                  </button>
                  <button
                    onClick={() => handleDelete(t)}
                    disabled={remove.isPending}
                    className="text-red-600 hover:underline text-xs disabled:opacity-50 inline-flex items-center gap-1"
                  >
                    {remove.isPending && remove.variables === t.id && <Spinner className="h-3 w-3" />}
                    {remove.isPending && remove.variables === t.id ? 'Excluindo...' : 'Excluir'}
                  </button>
                </td>
              </tr>
            ))}
            {data?.tenants.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  Nenhuma empresa cadastrada. Clique em "Nova Empresa" pra começar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {openModal && (
        <NewTenantModal
          onClose={() => setOpenModal(false)}
          onCreate={(input) => create.mutate(input)}
          loading={create.isPending}
          error={create.error?.message}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }): JSX.Element {
  const labels: Record<string, { txt: string; color: string }> = {
    trialing: { txt: 'Em teste', color: 'bg-amber-100 text-amber-800' },
    active: { txt: 'Ativa', color: 'bg-emerald-100 text-emerald-800' },
    past_due: { txt: 'Atrasada', color: 'bg-orange-100 text-orange-800' },
    suspended: { txt: 'Suspensa', color: 'bg-red-100 text-red-800' },
    cancelled: { txt: 'Cancelada', color: 'bg-slate-200 text-slate-700' },
  };
  const s = labels[status] ?? { txt: status, color: 'bg-slate-100 text-slate-700' };
  return <span className={`px-2 py-0.5 rounded text-xs ${s.color}`}>{s.txt}</span>;
}

function NewTenantModal({
  onClose,
  onCreate,
  loading,
  error,
}: {
  onClose(): void;
  onCreate(input: { name: string; cnpj?: string; phone?: string }): void;
  loading: boolean;
  error?: string | undefined;
}): JSX.Element {
  const [name, setName] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [phone, setPhone] = useState('');

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    const payload: { name: string; cnpj?: string; phone?: string } = { name };
    if (cnpj) payload.cnpj = cnpj;
    if (phone) payload.phone = phone;
    onCreate(payload);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <form onSubmit={submit} className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
        <h3 className="text-lg font-bold mb-4">Nova Empresa</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs uppercase text-slate-500 mb-1">Nome da empresa *</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              className="w-full border rounded px-3 py-2 text-sm"
              placeholder="Mercado São João Ltda"
            />
          </div>
          <div>
            <label className="block text-xs uppercase text-slate-500 mb-1">CNPJ (opcional)</label>
            <MaskedInput
              mask="cnpj"
              value={cnpj}
              onChange={setCnpj}
              className="w-full border rounded px-3 py-2 text-sm"
              placeholder="00.000.000/0001-00"
            />
          </div>
          <div>
            <label className="block text-xs uppercase text-slate-500 mb-1">Telefone (opcional)</label>
            <MaskedInput
              mask="phone"
              value={phone}
              onChange={setPhone}
              className="w-full border rounded px-3 py-2 text-sm"
              placeholder="(11) 99999-9999"
            />
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
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50 inline-flex items-center gap-2"
          >
            {loading && <Spinner className="h-3.5 w-3.5" />}
            {loading ? 'Criando...' : 'Criar empresa'}
          </button>
        </div>
      </form>
    </div>
  );
}


// Meta mensal no CADASTRO da empresa (dono 01/09): a guia "Meta Mensal" saiu do menu; a
// barra vive no dashboard e o valor e definido aqui pelo admin.
function MetaCell({ tenant }: { tenant: Tenant }): JSX.Element {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState('');
  const salvar = useMutation({
    mutationFn: (monthlyGoal: number) =>
      api<{ ok: boolean }>(`/api/admin/tenants/${tenant.id}/monthly-goal`, { method: 'PATCH', body: JSON.stringify({ monthlyGoal }) }),
    onSuccess: () => {
      toast.push({ type: 'success', message: 'Meta salva!' });
      queryClient.invalidateQueries({ queryKey: ['admin', 'tenants'] });
      queryClient.invalidateQueries({ queryKey: ['monthly-goal'] });
      setEditando(false);
      setValor('');
    },
    onError: (err: Error) => toast.push({ type: 'error', message: err.message }),
  });
  if (!editando) {
    return (
      <button onClick={() => setEditando(true)} className="text-slate-700 hover:text-blue-700 inline-flex items-center gap-1" title="Editar meta mensal">
        {tenant.monthlyGoal > 0 ? tenant.monthlyGoal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : <span className="text-slate-400">definir</span>}
        <span aria-hidden>✎</span>
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <MaskedInput mask="currency" prefix="R$" placeholder="50.000,00" value={valor} onChange={setValor} className="w-28 border rounded px-2 py-1 text-xs" />
      <button
        onClick={() => { const v = parseCurrency(valor); if (v >= 0) salvar.mutate(v); }}
        disabled={salvar.isPending || !valor}
        className="bg-blue-600 text-white px-2 py-1 rounded text-xs disabled:opacity-50"
      >
        {salvar.isPending ? '...' : 'OK'}
      </button>
      <button onClick={() => setEditando(false)} className="text-slate-400 px-1" aria-label="Cancelar">×</button>
    </span>
  );
}
