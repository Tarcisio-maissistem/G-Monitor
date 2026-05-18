import { v4 as uuid } from 'uuid';
import { pack } from 'msgpackr';
import { DEFAULT_RPC_TIMEOUT_MS } from '@gmonitor/rpc-contracts';
import { Errors } from '@gmonitor/shared';
import { getLocalAgent } from './registry.js';
import { logger } from '../logger.js';

// Despacha RPC para um agente local e aguarda resposta correlacionada.
// Cross-instance (futuro): publicar em Redis e aguardar resposta via pub/sub.

interface PendingRpc {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

const pending = new Map<string, PendingRpc>();

export function resolvePendingRpc(
  requestId: string,
  envelope: { ok: boolean; result?: unknown; error?: { code: string; message: string } },
): void {
  const p = pending.get(requestId);
  if (!p) return;
  pending.delete(requestId);
  clearTimeout(p.timer);
  if (envelope.ok) {
    p.resolve(envelope.result);
  } else {
    p.reject(new Error(envelope.error?.message ?? 'rpc_error'));
  }
}

export async function callAgent<T = unknown>(
  agentId: string,
  op: string,
  params: unknown,
  timeoutMs = DEFAULT_RPC_TIMEOUT_MS,
): Promise<T> {
  const ws = getLocalAgent(agentId);
  if (!ws || ws.readyState !== ws.OPEN) {
    throw Errors.serviceUnavailable('Agente offline');
  }

  const requestId = uuid();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(Errors.serviceUnavailable('timeout'));
    }, timeoutMs);

    pending.set(requestId, {
      resolve: (r) => resolve(r as T),
      reject,
      timer,
    });

    try {
      ws.send(pack({ type: 'request', requestId, op, params, timeoutMs }));
    } catch (err) {
      pending.delete(requestId);
      clearTimeout(timer);
      logger.error({ err, agentId, op }, 'failed to send rpc');
      reject(Errors.serviceUnavailable('send_failed'));
    }
  });
}
