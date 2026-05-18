import type { FastifyInstance } from 'fastify';
import { pack, unpack } from 'msgpackr';
import { messageEnvelopeSchema, PROTOCOL_VERSION, WS_CLOSE_CODES } from '@gmonitor/rpc-contracts';
import { prisma } from '../db/prisma.js';
import { hashToken } from '../auth/tokens.js';
import { logger } from '../logger.js';
import { registerAgent } from './registry.js';
import { resolvePendingRpc } from './rpcDispatcher.js';

// WebSocket de agente: rota /ws/agent.
// Handshake: Bearer token no header Authorization. Token long-lived por agente.
export async function registerAgentWs(app: FastifyInstance): Promise<void> {
  app.get('/ws/agent', { websocket: true }, async (socket, req) => {
    const ws = socket as unknown as import('ws').WebSocket;
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      ws.close(WS_CLOSE_CODES.AUTH_FAILED, 'missing_token');
      return;
    }

    const token = auth.substring(7);
    const agent = await prisma.agent.findFirst({
      where: { tokenHash: hashToken(token), revokedAt: null },
      include: { tenant: true, store: true },
    });

    if (!agent) {
      ws.close(WS_CLOSE_CODES.AUTH_FAILED, 'invalid_token');
      return;
    }

    if (agent.tenant.subscriptionStatus === 'suspended') {
      ws.close(WS_CLOSE_CODES.TENANT_SUSPENDED, 'tenant_suspended');
      return;
    }

    const session = await prisma.agentSession.create({
      data: { agentId: agent.id, ip: req.ip, protocolVersion: PROTOCOL_VERSION },
    });

    registerAgent(agent.id, ws);
    logger.info({ agentId: agent.id, sessionId: session.id }, 'agent ws connected');

    ws.on('message', async (raw: Buffer) => {
      let envelope: unknown;
      try {
        envelope = unpack(raw);
      } catch (err) {
        logger.warn({ err, agentId: agent.id }, 'invalid msgpack');
        return;
      }

      const parsed = messageEnvelopeSchema.safeParse(envelope);
      if (!parsed.success) {
        logger.warn({ agentId: agent.id, issues: parsed.error.issues }, 'invalid envelope');
        return;
      }

      if (parsed.data.type === 'response') {
        resolvePendingRpc(parsed.data.requestId, parsed.data);
      } else if (parsed.data.type === 'event') {
        logger.info({ agentId: agent.id, event: parsed.data.name }, 'agent event');
      } else if (parsed.data.type === 'request') {
        // Agente nao deveria iniciar requests no MVP. Reservado p/ futuro (push de sync).
      }
    });

    ws.on('close', async () => {
      await prisma.agentSession.update({
        where: { id: session.id },
        data: { disconnectedAt: new Date() },
      }).catch(() => undefined);
      logger.info({ agentId: agent.id }, 'agent ws disconnected');
    });

    // Confirma handshake.
    ws.send(
      pack({
        type: 'event',
        name: 'handshake_ack',
        payload: { agentSessionId: session.id, protocolVersion: PROTOCOL_VERSION },
        ts: new Date().toISOString(),
      }),
    );
  });
}
