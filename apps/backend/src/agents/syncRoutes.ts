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
    'payables',
    'receivables',
  ]),
  rows: z.array(z.record(z.unknown())).max(1000),
  checkpoint: z.string(),
});

// Roda `fn` sobre `items` com no maximo `limit` chamadas em voo ao mesmo tempo.
// Sem isso, Promise.all(rows.map(...)) num lote de 1000 estoura o pool de conexoes do Prisma
// (default 9) — achado ao vivo no piloto 22/08, junto com o timeout de $transaction sequencial.
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

// Deixa uma boa folga do connection_limit do DATABASE_URL pro resto do app (login, dashboard,
// relatorios) nao passar fome enquanto o sync de um backlog grande roda em segundo plano —
// achado ao vivo no piloto 22/08 (login e telas ficando lentos com concorrencia = quase o limite).
const SYNC_CONCURRENCY = 6;

async function authenticateAgent(
  authHeader: string | undefined,
): Promise<{ tenantId: string; storeId: string; agentId: string }> {
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

    // Upserts rodam em paralelo (Promise.all), fora de uma transacao interativa: um lote de
    // ate 1000 linhas sequenciais contra o Supabase (rede, nao localhost) estourava o timeout
    // do Prisma e nunca terminava (achado ao vivo no piloto 22/08). Cada upsert ja e idempotente
    // sozinho, entao nao perde correcao por rodar fora de uma transacao — só perde o "tudo ou
    // nada" do lote inteiro, que aqui nao e necessario (proximo tick reenvia o que faltou).
    let persisted = 0;

    switch (body.table) {
      case 'sales':
        persisted = (
          await mapWithConcurrency(body.rows, SYNC_CONCURRENCY, (r) =>
            prisma.sale.upsert({
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
            }),
          )
        ).length;
        break;
      case 'saleItems': {
        // Monta mapa saleSourceId -> sale.id para resolver FK em batch
        const saleSourceIds = [
          ...new Set(body.rows.map((r) => String(r.saleSourceId)).filter(Boolean)),
        ];
        const parentSales = await prisma.sale.findMany({
          where: { tenantId: ctx.tenantId, storeId: ctx.storeId, sourceId: { in: saleSourceIds } },
          select: { id: true, sourceId: true },
        });
        const saleMap = new Map(parentSales.map((s) => [s.sourceId, s.id]));

        const results = await mapWithConcurrency(body.rows, SYNC_CONCURRENCY, (r) => {
          const saleId = saleMap.get(String(r.saleSourceId));
          if (!saleId) return Promise.resolve(null); // venda pai ainda nao sincronizada
          return prisma.saleItem.upsert({
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
              saleId,
              sourceId: String(r.sourceId),
              productCode: r.productCode ? String(r.productCode) : null,
              description: r.description ? String(r.description) : null,
              quantity: Number(r.quantity ?? 0),
              unitValue: Number(r.unitValue ?? 0),
              totalValue: Number(r.totalValue ?? 0),
            },
            update: {
              quantity: Number(r.quantity ?? 0),
              unitValue: Number(r.unitValue ?? 0),
              totalValue: Number(r.totalValue ?? 0),
            },
          });
        });
        persisted = results.filter(Boolean).length;
        break;
      }

      case 'payments': {
        // saleId e opcional; tenta resolver pelo sourceId da venda se enviado
        const saleSourceIds = [
          ...new Set(
            body.rows.map((r) => (r.saleSourceId ? String(r.saleSourceId) : null)).filter(Boolean),
          ),
        ] as string[];
        const parentSales = saleSourceIds.length
          ? await prisma.sale.findMany({
              where: {
                tenantId: ctx.tenantId,
                storeId: ctx.storeId,
                sourceId: { in: saleSourceIds },
              },
              select: { id: true, sourceId: true },
            })
          : [];
        const saleMap = new Map(parentSales.map((s) => [s.sourceId, s.id]));

        persisted = (
          await mapWithConcurrency(body.rows, SYNC_CONCURRENCY, (r) => {
            const saleId = r.saleSourceId ? (saleMap.get(String(r.saleSourceId)) ?? null) : null;
            return prisma.payment.upsert({
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
                saleId,
                paymentDate: new Date(String(r.paymentDate)),
                paymentType: String(r.paymentType ?? 'OUTROS'),
                especie: r.especie ? String(r.especie) : null,
                value: Number(r.value ?? 0),
              },
              update: {
                paymentDate: new Date(String(r.paymentDate)),
                paymentType: String(r.paymentType ?? 'OUTROS'),
                value: Number(r.value ?? 0),
              },
            });
          })
        ).length;
        break;
      }

      case 'customers':
        persisted = (
          await mapWithConcurrency(body.rows, SYNC_CONCURRENCY, (r) =>
            prisma.customer.upsert({
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
                name: r.name ? String(r.name) : null,
                document: r.document ? String(r.document) : null,
                phone: r.phone ? String(r.phone) : null,
                email: r.email ? String(r.email) : null,
              },
              update: {
                name: r.name ? String(r.name) : null,
                document: r.document ? String(r.document) : null,
                phone: r.phone ? String(r.phone) : null,
                email: r.email ? String(r.email) : null,
              },
            }),
          )
        ).length;
        break;

      case 'products':
        persisted = (
          await mapWithConcurrency(body.rows, SYNC_CONCURRENCY, (r) =>
            prisma.product.upsert({
              where: {
                tenantId_storeId_sourceCode: {
                  tenantId: ctx.tenantId,
                  storeId: ctx.storeId,
                  sourceCode: String(r.sourceCode),
                },
              },
              create: {
                tenantId: ctx.tenantId,
                storeId: ctx.storeId,
                sourceCode: String(r.sourceCode),
                description: String(r.description ?? ''),
                unit: r.unit ? String(r.unit) : null,
                stock: r.stock != null ? Number(r.stock) : null,
                costPrice: r.costPrice != null ? Number(r.costPrice) : null,
                salePrice: r.salePrice != null ? Number(r.salePrice) : null,
              },
              update: {
                description: String(r.description ?? ''),
                unit: r.unit ? String(r.unit) : null,
                stock: r.stock != null ? Number(r.stock) : null,
                costPrice: r.costPrice != null ? Number(r.costPrice) : null,
                salePrice: r.salePrice != null ? Number(r.salePrice) : null,
              },
            }),
          )
        ).length;
        break;

      case 'cashClosings':
        persisted = (
          await mapWithConcurrency(body.rows, SYNC_CONCURRENCY, (r) =>
            prisma.cashClosing.upsert({
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
                openedAt: new Date(String(r.openedAt)),
                closedAt: r.closedAt ? new Date(String(r.closedAt)) : null,
                operatorName: r.operatorName ? String(r.operatorName) : null,
                totalExpected: r.totalExpected != null ? Number(r.totalExpected) : null,
                totalCounted: r.totalCounted != null ? Number(r.totalCounted) : null,
                difference: r.difference != null ? Number(r.difference) : null,
              },
              update: {
                closedAt: r.closedAt ? new Date(String(r.closedAt)) : null,
                totalExpected: r.totalExpected != null ? Number(r.totalExpected) : null,
                totalCounted: r.totalCounted != null ? Number(r.totalCounted) : null,
                difference: r.difference != null ? Number(r.difference) : null,
              },
            }),
          )
        ).length;
        break;

      case 'payables':
        persisted = (
          await mapWithConcurrency(body.rows, SYNC_CONCURRENCY, (r) =>
            prisma.payable.upsert({
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
                dueDate: new Date(String(r.dueDate)),
                value: Number(r.value ?? 0),
                paidValue: Number(r.paidValue ?? 0),
                paidDate: r.paidDate ? new Date(String(r.paidDate)) : null,
                counterparty: r.counterparty ? String(r.counterparty) : null,
                description: r.description ? String(r.description) : null,
                cancelled: Boolean(r.cancelled),
              },
              update: {
                dueDate: new Date(String(r.dueDate)),
                value: Number(r.value ?? 0),
                paidValue: Number(r.paidValue ?? 0),
                paidDate: r.paidDate ? new Date(String(r.paidDate)) : null,
                cancelled: Boolean(r.cancelled),
              },
            }),
          )
        ).length;
        break;

      case 'receivables':
        persisted = (
          await mapWithConcurrency(body.rows, SYNC_CONCURRENCY, (r) =>
            prisma.receivable.upsert({
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
                dueDate: new Date(String(r.dueDate)),
                value: Number(r.value ?? 0),
                receivedValue: Number(r.receivedValue ?? 0),
                receivedDate: r.receivedDate ? new Date(String(r.receivedDate)) : null,
                counterparty: r.counterparty ? String(r.counterparty) : null,
                description: r.description ? String(r.description) : null,
                cancelled: Boolean(r.cancelled),
              },
              update: {
                dueDate: new Date(String(r.dueDate)),
                value: Number(r.value ?? 0),
                receivedValue: Number(r.receivedValue ?? 0),
                receivedDate: r.receivedDate ? new Date(String(r.receivedDate)) : null,
                cancelled: Boolean(r.cancelled),
              },
            }),
          )
        ).length;
        break;

      default:
        throw Errors.validation(`Tabela desconhecida`);
    }

    await prisma.syncState.upsert({
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
      update: {
        checkpoint: body.checkpoint,
        rowsSynced: { increment: persisted },
        lastSyncedAt: new Date(),
      },
    });

    await prisma.agent.update({ where: { id: ctx.agentId }, data: { lastSeenAt: new Date() } });

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
