import { redis } from '../db/redis.js';
import { logger } from '../logger.js';

// Registry de conexoes WS dos agentes.
// Local: in-memory para resposta rapida.
// Cross-instance: Redis pub/sub para enrutar RPCs entre instancias do backend.

// Interface minima — evita importar 'ws' como dep transitiva.
export interface WsSocket {
  readonly readyState: number;
  close(code?: number, reason?: string | Buffer): void;
  on(event: 'message', listener: (data: Buffer) => void | Promise<void>): WsSocket;
  on(event: 'close', listener: (code: number, reason: Buffer) => void): WsSocket;
  on(event: string, listener: (...args: never[]) => void): WsSocket;
  send(data: Uint8Array | string): void;
}

const localConnections = new Map<string, WsSocket>();
const INSTANCE_ID = `inst_${process.pid}_${Date.now()}`;

export function registerAgent(agentId: string, ws: WsSocket): void {
  const existing = localConnections.get(agentId);
  if (existing && existing !== ws) {
    existing.close(4403, 'replaced_by_new_session');
  }
  localConnections.set(agentId, ws);
  void redis.set(`agent:owner:${agentId}`, INSTANCE_ID, 'EX', 60);

  ws.on('close', () => {
    if (localConnections.get(agentId) === ws) {
      localConnections.delete(agentId);
      void redis.del(`agent:owner:${agentId}`);
    }
  });

  logger.info({ agentId }, 'agent registered');
}

export function getLocalAgent(agentId: string): WsSocket | undefined {
  return localConnections.get(agentId);
}

export async function getAgentOwnerInstance(agentId: string): Promise<string | null> {
  return redis.get(`agent:owner:${agentId}`);
}

export function getInstanceId(): string {
  return INSTANCE_ID;
}

// Heartbeat: renova TTL para conexoes vivas.
setInterval(() => {
  for (const agentId of localConnections.keys()) {
    void redis.expire(`agent:owner:${agentId}`, 60);
  }
}, 30_000).unref();
