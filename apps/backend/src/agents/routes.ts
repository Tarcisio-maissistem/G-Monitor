import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors } from '@gmonitor/shared';
import { liberarRitmo } from './syncRoutes.js';
import { prisma } from '../db/prisma.js';
import { requireAuth, requireCapability, requireSuperAdmin } from '../middleware/auth.js';
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
  // "Sincronizar agora" (dono 28/08): o agente so sincroniza de hora em hora; quem quiser o
  // dado fresco clica. Limpa a trava de ritmo das lojas da empresa e ACORDA os agentes online
  // via RPC (agente >= 0.9.7); agente antigo pega a liberacao no proximo tick de 90s. Limite
  // de 1 clique a cada 5 min por empresa — o objetivo e custo minimo, nao um botao de spam.
  const ultimoSyncNow = new Map<string, number>();
  // Reenvio completo de uma tabela (super-admin): zera o checkpoint no agente e ele manda tudo
  // de novo; o upsert religa pagamento->venda. Usado 1x apos a auditoria 04/09.
  app.post<{ Params: { id: string } }>('/api/admin/agents/:id/reset-checkpoint', { preHandler: [requireAuth, requireSuperAdmin] }, async (req) => {
    const body = z.object({ table: z.enum(['sales', 'saleItems', 'payments', 'payables', 'receivables', 'cashClosings', 'cashClosingSpecies', 'cardTransactions']) }).parse(req.body);
    const agent = await prisma.agent.findFirst({ where: { id: req.params.id, revokedAt: null } });
    if (!agent) throw Errors.notFound('Agente nao encontrado');
    liberarRitmo(agent.storeId);
    const r = await callAgent<{ ok: boolean; anterior: string | null }>(agent.id, 'resetCheckpoint', { table: body.table }, 8_000);
    return { ok: true, table: body.table, anterior: r?.anterior ?? null };
  });

  // Roda um report do catalogo no Firebird da loja e devolve as linhas (super-admin). Serve pra
  // diagnosticar o ERP sem entrar no PC — ex.: 'schema-columns' pra saber se MOV_OPERADORES
  // guarda o historico da sangria (cofre? banco? compra?), duvida aberta do dono em 04/09.
  app.post<{ Params: { id: string } }>('/api/admin/agents/:id/report', { preHandler: [requireAuth, requireSuperAdmin] }, async (req) => {
    const body = z.object({ reportId: z.string().min(2).max(60), params: z.record(z.unknown()).default({}) }).parse(req.body);
    const agent = await prisma.agent.findFirst({ where: { id: req.params.id, revokedAt: null } });
    if (!agent) throw Errors.notFound('Agente nao encontrado');
    return callAgent(agent.id, 'runReport', { reportId: body.reportId, params: body.params }, 25_000);
  });

  app.post('/api/agents/sync-now', { preHandler: [requireAuth, requireCapability('reports.view')] }, async (req, reply) => {
    const tenantId = req.user!.tenantId;
    const ultimo = ultimoSyncNow.get(tenantId) ?? 0;
    const faltam = 5 * 60 * 1000 - (Date.now() - ultimo);
    if (faltam > 0) {
      reply.header('Retry-After', String(Math.ceil(faltam / 1000)));
      return reply.status(429).send({ error: { code: 'sync_now_rate_limited', message: `Aguarde ${Math.ceil(faltam / 60000)} min para sincronizar de novo` } });
    }
    // Os PCs das lojas DESLIGAM a noite (dono, 28/08): so vale acordar quem esta ligado. Online =
    // heartbeat do WS nos ultimos 3 min. Offline: a trava fica liberada mesmo assim, entao no
    // momento em que o PC ligar o agente sincroniza no 1o tick — e o painel diz isso ao usuario.
    const LIMITE_ONLINE_MS = 3 * 60 * 1000;
    // Prazo TOTAL de 12s: no incidente de 28/08 a 1a chamada ficou presa esperando o banco
    // (pooler saturado) e o painel nunca recebeu resposta. Banco lento nao pode travar um
    // botao — devolve o que der e explica.
    const prazo = <T,>(pr: Promise<T>, ms: number, rotulo: string): Promise<T> =>
      Promise.race([pr, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${rotulo}: prazo de ${ms}ms`)), ms))]);
    let agents: Array<{ id: string; storeId: string; lastSeenAt: Date | null; agentVersion: string | null; store: { name: string } }>;
    try {
      agents = await prazo(prisma.agent.findMany({
        where: { tenantId, revokedAt: null },
        select: { id: true, storeId: true, lastSeenAt: true, agentVersion: true, store: { select: { name: true } } },
      }), 8_000, 'consulta de agentes');
    } catch {
      throw Errors.validation('O banco esta lento agora e nao consegui listar os agentes. Tente de novo em instantes.');
    }
    const status: Array<{ loja: string; online: boolean; acordado: boolean; versao: string | null; vistoHa: number | null }> = [];
    await Promise.all(agents.map(async (a) => {
      liberarRitmo(a.storeId);
      const vistoHa = a.lastSeenAt ? Date.now() - a.lastSeenAt.getTime() : null;
      const online = vistoHa != null && vistoHa < LIMITE_ONLINE_MS;
      let acordado = false;
      if (online) {
        // agente >= 0.9.7 responde ao syncNow; antigo (90s) pega a liberacao no proximo tick
        try { await prazo(callAgent(a.id, 'syncNow', {}, 4_000), 4_500, 'rpc'); acordado = true; } catch { /* versao antiga ou caiu agora */ }
      }
      status.push({ loja: a.store.name, online, acordado, versao: a.agentVersion, vistoHa: vistoHa != null ? Math.round(vistoHa / 1000) : null });
    }));
    // so conta o clique depois de ter funcionado: se o banco engasgar no meio, o usuario pode
    // tentar de novo sem esperar 5 min
    ultimoSyncNow.set(tenantId, Date.now());
    return { agentes: status, algumOnline: status.some((s) => s.online) };
  });

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
