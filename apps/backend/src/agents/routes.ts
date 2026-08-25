import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors } from '@gmonitor/shared';
import { prisma } from '../db/prisma.js';
import { requireAuth, requireCapability } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';
import { generateAgentToken, hashToken } from '../auth/tokens.js';
import { v4 as uuid } from 'uuid';
import { callAgent } from '../ws/rpcDispatcher.js';

const createAgentSchema = z.object({
  storeId: z.string().cuid(),
  channel: z.enum(['stable', 'beta', 'canary']).default('stable'),
});

const registerByCnpjSchema = z.object({ cnpj: z.string().min(11) });

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  // PUBLICO (sem login) — o instalador generico pede o CNPJ na hora de instalar (pedido
  // do dono 24/08) em vez de precisar de um token gerado na mao pra cada loja. Sempre
  // emite um token (o agente ja fica configurado), mas se a empresa ainda estiver
  // pendingApproval o WS/sync recusam ate o super-admin aprovar (ver syncRoutes.ts e
  // ws/agentServer.ts) — o agente so fica esperando, sem quebrar nem vazar dado nenhum.
  app.post('/api/agents/register-by-cnpj', async (req, reply) => {
    const body = registerByCnpjSchema.parse(req.body);
    const tenant = await prisma.tenant.findFirst({ where: { cnpj: body.cnpj, deletedAt: null } });
    if (!tenant) throw Errors.notFound('CNPJ nao encontrado. Cadastre a empresa pelo login primeiro.');

    let store = await prisma.store.findFirst({ where: { tenantId: tenant.id, deletedAt: null }, orderBy: { createdAt: 'asc' } });
    if (!store) {
      store = await prisma.store.create({ data: { tenantId: tenant.id, name: tenant.name, externalId: 'loja-01' } });
    }

    const agentUuid = uuid();
    const rawToken = generateAgentToken(tenant.id, agentUuid);
    await prisma.agent.create({
      data: { tenantId: tenant.id, storeId: store.id, tokenHash: hashToken(rawToken), channel: 'stable' },
    });

    reply.status(201).send({
      token: rawToken,
      tenantName: tenant.name,
      pendingApproval: tenant.pendingApproval,
      message: tenant.pendingApproval
        ? 'Cadastro recebido. O agente vai aguardar a aprovacao do administrador antes de sincronizar.'
        : 'Empresa ja aprovada — o agente pode sincronizar normalmente.',
    });
  });

  // Lista agentes do tenant
  app.get('/api/agents', { preHandler: [requireAuth] }, async (req) => {
    const agents = await prisma.agent.findMany({
      where: { tenantId: req.user!.tenantId, revokedAt: null },
      include: { store: true },
      orderBy: { createdAt: 'desc' },
    });
    return { agents };
  });

  // Cria agente novo (gera token). Token aparece UMA UNICA VEZ na resposta.
  app.post('/api/agents', { preHandler: [requireAuth, requireCapability('agent.rotate'), audit({ action: 'agent.create', entity: 'agent', captureBody: true })] }, async (req, reply) => {
    const body = createAgentSchema.parse(req.body);
    const store = await prisma.store.findFirst({
      where: { id: body.storeId, tenantId: req.user!.tenantId, deletedAt: null },
    });
    if (!store) throw Errors.notFound('Loja nao encontrada');

    const agentUuid = uuid();
    const rawToken = generateAgentToken(req.user!.tenantId, agentUuid);

    const agent = await prisma.agent.create({
      data: {
        tenantId: req.user!.tenantId,
        storeId: body.storeId,
        tokenHash: hashToken(rawToken),
        channel: body.channel,
      },
    });

    reply.status(201).send({
      agentId: agent.id,
      token: rawToken, // exibir uma unica vez na UI
      message: 'Guarde o token agora. Ele nao sera exibido novamente.',
    });
  });

  // Revoga agente
  app.delete('/api/agents/:id', { preHandler: [requireAuth, requireCapability('agent.revoke'), audit({ action: 'agent.revoke', entity: 'agent' })] }, async (req) => {
    const { id } = req.params as { id: string };
    await prisma.agent.updateMany({
      where: { id, tenantId: req.user!.tenantId },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  });

  // RPC ad-hoc para diagnostico (admin only)
  app.post('/api/agents/:id/ping', { preHandler: [requireAuth, requireCapability('agent.rotate')] }, async (req) => {
    const { id } = req.params as { id: string };
    const agent = await prisma.agent.findFirst({
      where: { id, tenantId: req.user!.tenantId },
    });
    if (!agent) throw Errors.notFound();

    const result = await callAgent(agent.id, 'ping', { nonce: uuid() }, 5_000);
    return { result };
  });
}
