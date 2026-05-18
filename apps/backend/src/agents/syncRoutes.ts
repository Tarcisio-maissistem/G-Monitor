import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors } from '@gmonitor/shared';
import { prisma } from '../db/prisma.js';
import { hashToken } from '../auth/tokens.js';

// Endpoint HTTP usado pelo AGENTE para empurrar lotes de sync.
// Auth: Bearer agent token (mesmo formato de WS).

const syncBatchSchema = z.object({
  table: z.enum([
    'sales',
    'saleItems',
    'payments',
    'customers',
    'products',
    'cashClosings',
  ]),
  rows: z.array(z.record(z.unknown())).max(1000),
  checkpoint: z.string(),
});

async function authenticateAgent(authHeader: string | undefined): Promise<{ tenantId: string; storeId: string; agentId: string }> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) throw Errors.unauthorized();
  const token = authHeader.substring(7);
  const agent = await prisma.agent.findFirst({
    where: { tokenHash: hashToken(token), revokedAt: null },
  });
  if (!agent) throw Errors.unauthorized('Token de agente invalido');
  return { tenantId: agent.tenantId, storeId: agent.storeId, agentId: agent.id };
}

export async function agentSyncRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/agent/sync  (chamado pelo agente)
  app.post('/api/agent/sync', async (req, _reply) => {
    const ctx = await authenticateAgent(req.headers.authorization);
    const body = syncBatchSchema.parse(req.body);

    let persisted = 0;

    await prisma.$transaction(async (tx) => {
      switch (body.table) {
        case 'sales':
          for (const r of body.rows) {
            await tx.sale.upsert({
              where: {
                tenantId_storeId_sourceId: {
                  tenantId: ctx.tenantId,
                  storeId: ctx.storeId,
                  sourceId: String(r.sourceId),
                },
              },
              create: {
                tenantId: ctx.tenantId,
                storeId: ctx.storeId,
                sourceId: String(r.sourceId),
                saleDate: new Date(String(r.saleDate)),
                customerSourceId: r.customerSourceId ? String(r.customerSourceId) : null,
                operatorName: r.operatorName ? String(r.operatorName) : null,
                caixa: r.caixa ? String(r.caixa) : null,
                modelo: r.modelo ? String(r.modelo) : null,
                natureza: r.natureza ? String(r.natureza) : null,
                totalValue: Number(r.totalValue ?? 0),
                cancelled: Boolean(r.cancelled),
                processed: Boolean(r.processed ?? true),
              },
              update: {
                saleDate: new Date(String(r.saleDate)),
                totalValue: Number(r.totalValue ?? 0),
                cancelled: Boolean(r.cancelled),
                processed: Boolean(r.processed ?? true),
              },
            });
            persisted++;
          }
          break;
        // Outras tabelas seguem padrao similar. Implementacao por iteracao.
        default:
          throw Errors.validation(`Tabela ${body.table} ainda nao implementada`);
      }

      await tx.syncState.upsert({
        where: {
          tenantId_storeId_tableName: {
            tenantId: ctx.tenantId,
            storeId: ctx.storeId,
            tableName: body.table,
          },
        },
        create: {
          tenantId: ctx.tenantId,
          storeId: ctx.storeId,
          tableName: body.table,
          checkpoint: body.checkpoint,
          rowsSynced: persisted,
        },
        update: { checkpoint: body.checkpoint, rowsSynced: { increment: persisted }, lastSyncedAt: new Date() },
      });

      await tx.agent.update({ where: { id: ctx.agentId }, data: { lastSeenAt: new Date() } });
    });

    return { persisted };
  });

  // GET /api/agent/sync/state — agente consulta seus checkpoints atuais.
  app.get('/api/agent/sync/state', async (req) => {
    const ctx = await authenticateAgent(req.headers.authorization);
    const states = await prisma.syncState.findMany({
      where: { tenantId: ctx.tenantId, storeId: ctx.storeId },
    });
    return { states };
  });
}
