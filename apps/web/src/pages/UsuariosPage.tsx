import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useRoute } from '../lib/router';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import { Spinner } from '../components/Spinner';

interface TenantAccess {
  tenantId: string;
  tenantName: string;
  role: string;
  grantedAt: string;
}

interface UserItem {
  id: string;
  email: string;
  name: string;
  role: string;
  isSuperAdmin?: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface TenantDetail {
  id: string;
  name: string;
}

const ROLE_LABEL: Record<string, string> = {
  owner: 'Dono',
  admin: 'Admin',
  gestor: 'Gestor',
  operador: 'Operador',
  leitor: 'Leitor',
};

export function UsuariosPage({ tenantId }: { tenantId: string }): JSX.Element {
  const queryClient = useQueryClient();
  const { navigate } = useRoute();
  const toast = useToast();
  const confirm = useConfirm();
  const [showCreate, setShowCreate] = useState(false);
  const [showAccess, setShowAccess] = useState<UserItem | null>(null);

  const tenants = useQuery({
    queryKey: ['admin', 'tenants'],
    queryFn: () => api<{ tenants: TenantDetail[] }>('/api/admin/tenants'),
  });
  const tenant = tenants.data?.tenants.find((t) => t.id === tenantId);

  const users = useQuery({
    queryKey: ['admin', 'tenants', tenantId, 'users'],
    queryFn: () => api<{ users: UserItem[] }>(`/api/admin/tenants/${tenantId}/users`),
  });

  const create = useMutation({
    mutationFn: (input: { email: string; name: string; password: string; role: string }) =>
      api<{ user: UserItem }>(`/api/admin/tenants/${tenantId}/users`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'tenants', tenantId, 'users'] });
      setShowCreate(false);
      toast.push({ type: 'success', message: 'Usuário criado.' });
    },
    onError: (e: Error) => toast.push({ type: 'error', message: `Erro: ${e.message}` }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api<{ ok: boolean }>(`/api/admin/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'tenants', tenantId, 'users'] });
      toast.push({ type: 'success', message: 'Usuário excluído.' });
    },
    onError: (e: Error) => toast.push({ type: 'error', message: `Erro: ${e.message}` }),
  });

  const askDelete = (u: UserItem): void => {
    confirm.ask({
      title: `Excluir usuário "${u.name}"?`,
      message: 'Esse login não vai mais funcionar.',
      destructive: true,
      confirmLabel: 'Sim, excluir',
      onConfirm: async () => {
        await remove.mutateAsync(u.id);
      },
    });
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <button onClick={() => navigate('/empresas')} className="text-sm text-blue-600 hover:underline mb-3">
        ← Voltar para Empresas
      </button>
      <div className="flex justify-between items-end mb-6">
        <div>
          <h2 className="text-2xl font-bold">Usuários de {tenant?.name ?? '...'}</h2>
          <p className="text-sm text-slate-500 mt-1">
            Logins que podem acessar o painel desta empresa. Cada usuário só vê os dados da empresa dele.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm font-medium"
        >
          + Novo Usuário
        </button>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        {users.isLoading ? (
          <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2">
            <Spinner /> Carregando...
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Nome</th>
                <th className="px-4 py-3 text-left">Email</th>
                <th className="px-4 py-3 text-left">Papel</th>
                <th className="px-4 py-3 text-left">Último acesso</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {(users.data?.users ?? []).map((u) => (
                <tr key={u.id} className="border-t hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">
                    {u.name}
                    {u.isSuperAdmin && (
                      <span className="ml-2 text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded">SUPER ADMIN</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{u.email}</td>
                  <td className="px-4 py-3">{ROLE_LABEL[u.role] ?? u.role}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('pt-BR') : 'Nunca'}
                  </td>
                  <td className="px-4 py-3 text-right space-x-3">
                    {!u.isSuperAdmin && (
                      <>
                        <button
                          onClick={() => setShowAccess(u)}
                          className="text-blue-600 hover:underline text-xs"
                          title="Conceder acesso a outras empresas (matriz/filial)"
                        >
                          Acessos
                        </button>
                        <button
                          onClick={() => askDelete(u)}
                          disabled={remove.isPending && remove.variables === u.id}
                          className="text-red-600 hover:underline text-xs disabled:opacity-50 inline-flex items-center gap-1"
                        >
                          {remove.isPending && remove.variables === u.id && <Spinner className="h-3 w-3" />}
                          {remove.isPending && remove.variables === u.id ? 'Excluindo...' : 'Excluir'}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {users.data?.users.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                    Nenhum usuário cadastrado. Crie o primeiro com o botão acima.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <NewUserModal
          onClose={() => setShowCreate(false)}
          onCreate={(input) => create.mutate(input)}
          loading={create.isPending}
        />
      )}
      {showAccess && (
        <AccessModal
          user={showAccess}
          primaryTenantId={tenantId}
          onClose={() => setShowAccess(null)}
        />
      )}
    </div>
  );
}

function AccessModal({
  user,
  primaryTenantId,
  onClose,
}: {
  user: UserItem;
  primaryTenantId: string;
  onClose(): void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const toast = useToast();

  const allTenants = useQuery({
    queryKey: ['admin', 'tenants'],
    queryFn: () => api<{ tenants: Array<{ id: string; name: string }> }>('/api/admin/tenants'),
  });
  const accesses = useQuery({
    queryKey: ['admin', 'users', user.id, 'tenant-access'],
    queryFn: () => api<{ accesses: TenantAccess[] }>(`/api/admin/users/${user.id}/tenant-access`),
  });

  const grant = useMutation({
    mutationFn: (tenantId: string) =>
      api(`/api/admin/users/${user.id}/tenant-access`, {
        method: 'POST',
        body: JSON.stringify({ tenantId, role: 'gestor' }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users', user.id, 'tenant-access'] });
      toast.push({ type: 'success', message: 'Acesso concedido.' });
    },
    onError: (e: Error) => toast.push({ type: 'error', message: `Erro: ${e.message}` }),
  });

  const revoke = useMutation({
    mutationFn: (tenantId: string) =>
      api(`/api/admin/users/${user.id}/tenant-access/${tenantId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users', user.id, 'tenant-access'] });
      toast.push({ type: 'success', message: 'Acesso removido.' });
    },
    onError: (e: Error) => toast.push({ type: 'error', message: `Erro: ${e.message}` }),
  });

  const tenants = (allTenants.data?.tenants ?? []).filter((t) => t.id !== primaryTenantId);
  const accessSet = new Set((accesses.data?.accesses ?? []).map((a) => a.tenantId));

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-lg">
        <h3 className="text-lg font-bold mb-2">Acessos de {user.name}</h3>
        <p className="text-sm text-slate-500 mb-4">
          Por padrão, este usuário só vê os dados da empresa dele. Marque outras empresas pra concedê-las
          (uso típico: matriz que precisa ver as filiais).
        </p>

        {allTenants.isLoading || accesses.isLoading ? (
          <p className="text-slate-400 text-sm py-6 text-center flex items-center justify-center gap-2">
            <Spinner /> Carregando...
          </p>
        ) : tenants.length === 0 ? (
          <p className="text-slate-400 text-sm py-6 text-center">
            Nenhuma outra empresa cadastrada. Cadastre mais empresas pra usar esse recurso.
          </p>
        ) : (
          <div className="max-h-72 overflow-y-auto border rounded divide-y">
            {tenants.map((t) => {
              const has = accessSet.has(t.id);
              const isPendingHere = (grant.isPending && grant.variables === t.id) || (revoke.isPending && revoke.variables === t.id);
              return (
                <label
                  key={t.id}
                  className="flex items-center justify-between px-4 py-2 hover:bg-slate-50 cursor-pointer"
                >
                  <span className="font-medium text-sm">{t.name}</span>
                  <span className="flex items-center gap-2">
                    {isPendingHere && <Spinner className="h-3.5 w-3.5 text-slate-400" />}
                    <input
                      type="checkbox"
                      checked={has}
                      disabled={grant.isPending || revoke.isPending}
                      onChange={(e) => {
                        if (e.target.checked) grant.mutate(t.id);
                        else revoke.mutate(t.id);
                      }}
                    />
                  </span>
                </label>
              );
            })}
          </div>
        )}

        <div className="mt-5 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm bg-slate-700 hover:bg-slate-800 text-white rounded">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

function NewUserModal({
  onClose,
  onCreate,
  loading,
}: {
  onClose(): void;
  onCreate(input: { email: string; name: string; password: string; role: string }): void;
  loading: boolean;
}): JSX.Element {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('gestor');

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    onCreate({ email, name, password, role });
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <form onSubmit={submit} className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
        <h3 className="text-lg font-bold mb-4">Novo Usuário</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs uppercase text-slate-500 mb-1">Nome *</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              className="w-full border rounded px-3 py-2 text-sm"
              placeholder="João da Silva"
            />
          </div>
          <div>
            <label className="block text-xs uppercase text-slate-500 mb-1">Email *</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full border rounded px-3 py-2 text-sm"
              placeholder="usuario@empresa.com"
            />
          </div>
          <div>
            <label className="block text-xs uppercase text-slate-500 mb-1">Senha *</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full border rounded px-3 py-2 text-sm"
              placeholder="Pelo menos 8 caracteres"
            />
          </div>
          <div>
            <label className="block text-xs uppercase text-slate-500 mb-1">Papel</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm bg-white"
            >
              <option value="owner">Dono — controle total</option>
              <option value="admin">Admin — gerencia loja/usuários</option>
              <option value="gestor">Gestor — vê tudo, edita config</option>
              <option value="operador">Operador — vê só sua loja</option>
              <option value="leitor">Leitor — só visualiza</option>
            </select>
          </div>
        </div>
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
            {loading ? 'Criando...' : 'Criar usuário'}
          </button>
        </div>
      </form>
    </div>
  );
}
