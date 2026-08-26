// Sino de notificacoes — hoje so mostra autocadastro de empresa aguardando aprovacao
// (signup_pending), mas o backend ja devolve qualquer Notification do usuario/tenant.
// Pedido do dono 24/08: alerta pra ele aprovar uma empresa nova cadastrada pelo login.
import { useState, useRef, useEffect } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useToast } from './Toast';
import { Spinner } from './Spinner';

interface NotificationItem {
  id: string;
  tenantId: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
  tenant?: { name: string; pendingApproval: boolean } | null;
}

// align = lado em que o dropdown abre. 'right' quando o sino esta no canto direito da
// top bar do celular (w-80 alinhado a esquerda sairia da tela de 375px).
export function NotificationBell({ align = 'left' }: { align?: 'left' | 'right' } = {}): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const r = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ list: NotificationItem[]; unread: number }>('/api/notifications'),
    refetchInterval: 60_000,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api(`/api/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const approve = useMutation({
    mutationFn: (tenantId: string) => api(`/api/admin/tenants/${tenantId}/approve`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'tenants'] });
      toast.push({ type: 'success', message: 'Empresa aprovada — o agente já pode sincronizar.' });
    },
    onError: (e: Error) => toast.push({ type: 'error', message: `Erro ao aprovar: ${e.message}` }),
  });

  const unread = r.data?.unread ?? 0;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 rounded-lg hover:bg-slate-800 text-slate-300"
        aria-label="Notificações"
      >
        🔔
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] leading-none rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} mt-1 w-80 max-w-[calc(100vw-1.5rem)] bg-white border border-slate-200 rounded-xl shadow-lg z-50 text-slate-800`}>
          <div className="px-4 py-2.5 border-b font-semibold text-sm">Notificações</div>
          <div className="max-h-80 overflow-y-auto">
            {r.isLoading && (
              <div className="px-4 py-4 text-sm text-slate-400 flex items-center gap-2">
                <Spinner className="h-3.5 w-3.5" /> Carregando...
              </div>
            )}
            {!r.isLoading && (r.data?.list.length ?? 0) === 0 && (
              <div className="px-4 py-6 text-sm text-slate-400 text-center">Nenhuma notificação.</div>
            )}
            {(r.data?.list ?? []).map((n) => (
              <div key={n.id} className={`px-4 py-3 border-b last:border-b-0 ${!n.readAt ? 'bg-blue-50/50' : ''}`}>
                <div className="text-sm font-medium text-slate-800">{n.title}</div>
                <div className="text-xs text-slate-500 mt-0.5">{n.body}</div>
                {n.type === 'signup_pending' && n.tenant?.pendingApproval && (
                  <button
                    onClick={() => approve.mutate(n.tenantId)}
                    disabled={approve.isPending}
                    className="mt-2 text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1 rounded disabled:opacity-50 inline-flex items-center gap-1.5"
                  >
                    {approve.isPending && approve.variables === n.tenantId && <Spinner className="h-3 w-3" />}
                    Aprovar empresa
                  </button>
                )}
                {!n.readAt && !(n.type === 'signup_pending' && n.tenant?.pendingApproval) && (
                  <button onClick={() => markRead.mutate(n.id)} className="mt-1 text-xs text-blue-600 hover:underline">
                    Marcar como lida
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
