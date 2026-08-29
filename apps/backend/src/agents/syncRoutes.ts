import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { Errors } from '@gmonitor/shared';
import { logger } from '../logger.js';
import { prisma, prismaSync } from '../db/prisma.js';
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
    'cashClosingSpecies',
    'cardTransactions',
    'payables',
    'receivables',
  ]),
  rows: z.array(z.record(z.unknown())).max(1000),
  checkpoint: z.string(),
});

// Bulk upsert multi-linha (decisao D14, openspec/changes/create-saas-platform/design.md) —
// substitui N upserts individuais (N round-trips de rede) por 1 statement so, INSERT ...
// VALUES (...), (...) ON CONFLICT DO UPDATE. Achado no incidente de 24/08: com ITEVENDAS
// (652 mil linhas) e MOV_OPERADORES (195 mil), mesmo com concorrencia/lote pequenos, o custo
// de N round-trips (~180ms cada, Supabase sa-east-1) sozinho ja levava horas E estourava o
// connection_limit do pooler compartilhado com os relatorios do dono (P1001 ao vivo). Com
// bulk upsert, o backlog inteiro de uma tabela vira 1 statement por lote (ate 1000 linhas),
// nao 1000 round-trips — o gargalo deixa de ser rede e vira throughput de escrita do
// Postgres, que aguenta bem mais. Roda no prismaSync (pool isolado, ver db/prisma.ts) pra
// nao competir por conexao com as leituras normais do dashboard.
async function bulkUpsert(
  table: string,
  columns: string[],
  conflictColumns: string[],
  rows: Record<string, unknown>[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const updateColumns = columns.filter((c) => !conflictColumns.includes(c));
  const allColumns = ['id', ...columns];

  const valueRows = rows.map((r) => Prisma.sql`(${Prisma.join(allColumns.map((c) => (c === 'id' ? randomUUID() : (r[c] ?? null))))})`);

  const tableIdent = Prisma.raw(`"${table}"`);
  const colIdent = Prisma.raw(allColumns.map((c) => `"${c}"`).join(', '));
  const conflictIdent = Prisma.raw(conflictColumns.map((c) => `"${c}"`).join(', '));
  const updateSet = Prisma.raw(updateColumns.map((c) => `"${c}" = EXCLUDED."${c}"`).join(', '));

  try {
    await prismaSync.$executeRaw`
      INSERT INTO ${tableIdent} (${colIdent}) VALUES ${Prisma.join(valueRows)}
      ON CONFLICT (${conflictIdent}) DO UPDATE SET ${updateSet}
    `;
    return rows.length;
  } catch (err) {
    // INCIDENTE 28/08: UMA linha com valor absurdo (>= 10^12, estoura Decimal(14,2)) derrubava o
    // INSERT das 1000 e o agente reenviava o MESMO lote a cada 90s, pra sempre — checkpoint
    // parado, sync "travado", e o pool sufocado pelas tentativas. Uma linha ruim nao pode
    // travar a loja inteira: cai pra insercao linha a linha, PULA so a que falha e registra
    // (tabela + sourceId + valores) pra ser tratada. Dinheiro nunca e "arredondado" em
    // silencio — a linha fica de fora e aparece no log.
    if (!isRowLevelError(err)) throw err;
    logger.warn({ table, rows: rows.length, err: String((err as Error).message).slice(0, 160) }, 'bulk upsert falhou — tentando linha a linha');
    let ok = 0;
    for (const r of rows) {
      const vals = allColumns.map((c) => (c === 'id' ? randomUUID() : (r[c] ?? null)));
      try {
        await prismaSync.$executeRaw`
          INSERT INTO ${tableIdent} (${colIdent}) VALUES (${Prisma.join(vals)})
          ON CONFLICT (${conflictIdent}) DO UPDATE SET ${updateSet}
        `;
        ok++;
      } catch (rowErr) {
        if (!isRowLevelError(rowErr)) throw rowErr;
        logger.error({
          table, sourceId: r['sourceId'], linha: resumoNumerico(r),
          err: String((rowErr as Error).message).slice(0, 200),
        }, 'LINHA PULADA no sync — valor invalido vindo do GDOOR');
      }
    }
    return ok;
  }
}

// Erros que sao da LINHA (dado invalido), nao do banco/infra: so nesses vale pular e seguir.
// 22003 = numeric overflow, 22P02 = texto invalido, 22007/22008 = data invalida, 23502 = null
// em NOT NULL. Timeout, pool, conexao caida (P1001, 57014...) continuam estourando o lote —
// pular linha nesses casos esconderia um problema de infra como se fosse dado ruim.
function isRowLevelError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? '');
  return /Code: `(22003|22P02|22007|22008|23502)`/.test(msg) || /numeric field overflow|invalid input syntax/.test(msg);
}

// So os campos numericos da linha, pra o log dizer QUAL valor veio absurdo.
function resumoNumerico(r: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) if (typeof v === 'number') out[k] = v;
  return out;
}

async function authenticateAgent(
  authHeader: string | undefined,
): Promise<{ tenantId: string; storeId: string; agentId: string }> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) throw Errors.unauthorized();
  const token = authHeader.substring(7);
  const agent = await prisma.agent.findFirst({
    where: { tokenHash: hashToken(token), revokedAt: null },
    include: { tenant: true },
  });
  if (!agent) throw Errors.unauthorized('Token de agente invalido');
  // Autocadastro pelo login (24/08): empresa pendente de aprovacao nao sincroniza —
  // o agente fica tentando de novo sozinho ate o super-admin aprovar.
  if (agent.tenant.pendingApproval) throw Errors.forbidden('Empresa aguardando aprovacao do administrador');
  return { tenantId: agent.tenantId, storeId: agent.storeId, agentId: agent.id };
}

export async function agentSyncRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/agent/sync  (chamado pelo agente)
  app.post('/api/agent/sync', async (req, _reply) => {
    const ctx = await authenticateAgent(req.headers.authorization);
    const body = syncBatchSchema.parse(req.body);

    let persisted = 0;

    switch (body.table) {
      case 'sales':
        persisted = await bulkUpsert(
          'sales',
          ['tenantId', 'storeId', 'sourceId', 'saleDate', 'saleHour', 'customerSourceId', 'operatorName', 'sellerName', 'caixa', 'modelo', 'natureza', 'totalValue', 'cancelled', 'processed', 'createdAt', 'updatedAt'],
          ['tenantId', 'storeId', 'sourceId'],
          body.rows.map((r) => ({
            tenantId: ctx.tenantId,
            storeId: ctx.storeId,
            sourceId: String(r.sourceId),
            saleDate: new Date(String(r.saleDate)),
            // saleHour so aceita 0-23; qualquer coisa fora (ou ausente de agente antigo) vira null.
            saleHour: r.saleHour == null || Number.isNaN(Number(r.saleHour)) ? null : Math.trunc(Number(r.saleHour)),
            customerSourceId: r.customerSourceId ? String(r.customerSourceId) : null,
            operatorName: r.operatorName ? String(r.operatorName) : null,
            sellerName: r.sellerName ? String(r.sellerName) : null,
            caixa: r.caixa ? String(r.caixa) : null,
            modelo: r.modelo ? String(r.modelo) : null,
            natureza: r.natureza ? String(r.natureza) : null,
            totalValue: Number(r.totalValue ?? 0),
            cancelled: Boolean(r.cancelled),
            processed: Boolean(r.processed ?? true),
            createdAt: new Date(),
            updatedAt: new Date(),
          })),
        );
        break;

      case 'saleItems': {
        // Monta mapa saleSourceId -> sale.id para resolver FK em batch
        const saleSourceIds = [...new Set(body.rows.map((r) => String(r.saleSourceId)).filter(Boolean))];
        const parentSales = await prismaSync.sale.findMany({
          where: { tenantId: ctx.tenantId, storeId: ctx.storeId, sourceId: { in: saleSourceIds } },
          select: { id: true, sourceId: true },
        });
        const saleMap = new Map(parentSales.map((s) => [s.sourceId, s.id]));

        const rows = body.rows
          .map((r) => {
            const saleId = saleMap.get(String(r.saleSourceId));
            if (!saleId) return null; // venda pai ainda nao sincronizada — proximo tick reenvia
            return {
              tenantId: ctx.tenantId,
              storeId: ctx.storeId,
              saleId,
              sourceId: String(r.sourceId),
              productCode: r.productCode ? String(r.productCode) : null,
              description: r.description ? String(r.description) : null,
              quantity: Number(r.quantity ?? 0),
              unitValue: Number(r.unitValue ?? 0),
              totalValue: Number(r.totalValue ?? 0),
              createdAt: new Date(),
            };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null);

        persisted = await bulkUpsert(
          'sale_items',
          ['tenantId', 'storeId', 'saleId', 'sourceId', 'productCode', 'description', 'quantity', 'unitValue', 'totalValue', 'createdAt'],
          ['tenantId', 'storeId', 'sourceId'],
          rows,
        );
        break;
      }

      case 'payments': {
        const saleSourceIds = [...new Set(body.rows.map((r) => (r.saleSourceId ? String(r.saleSourceId) : null)).filter(Boolean))] as string[];
        const parentSales = saleSourceIds.length
          ? await prismaSync.sale.findMany({
              where: { tenantId: ctx.tenantId, storeId: ctx.storeId, sourceId: { in: saleSourceIds } },
              select: { id: true, sourceId: true },
            })
          : [];
        const saleMap = new Map(parentSales.map((s) => [s.sourceId, s.id]));

        persisted = await bulkUpsert(
          'payments',
          ['tenantId', 'storeId', 'sourceId', 'saleId', 'paymentDate', 'paymentType', 'especie', 'value', 'kind', 'createdAt'],
          ['tenantId', 'storeId', 'sourceId'],
          body.rows.map((r) => ({
            tenantId: ctx.tenantId,
            storeId: ctx.storeId,
            sourceId: String(r.sourceId),
            saleId: r.saleSourceId ? (saleMap.get(String(r.saleSourceId)) ?? null) : null,
            paymentDate: new Date(String(r.paymentDate)),
            paymentType: String(r.paymentType ?? 'OUTROS'),
            especie: r.especie ? String(r.especie) : null,
            value: Number(r.value ?? 0),
            kind: r.kind ? String(r.kind) : null, // null = agente antigo (tratar como venda)
            createdAt: new Date(),
          })),
        );
        break;
      }

      case 'customers':
        persisted = await bulkUpsert(
          'customers',
          ['tenantId', 'storeId', 'sourceId', 'name', 'document', 'phone', 'email', 'createdAt', 'updatedAt'],
          ['tenantId', 'storeId', 'sourceId'],
          body.rows.map((r) => ({
            tenantId: ctx.tenantId,
            storeId: ctx.storeId,
            sourceId: String(r.sourceId),
            name: r.name ? String(r.name) : null,
            document: r.document ? String(r.document) : null,
            phone: r.phone ? String(r.phone) : null,
            email: r.email ? String(r.email) : null,
            createdAt: new Date(),
            updatedAt: new Date(),
          })),
        );
        break;

      case 'products':
        persisted = await bulkUpsert(
          'products',
          ['tenantId', 'storeId', 'sourceCode', 'description', 'unit', 'stock', 'costPrice', 'salePrice', 'createdAt', 'updatedAt'],
          ['tenantId', 'storeId', 'sourceCode'],
          body.rows.map((r) => ({
            tenantId: ctx.tenantId,
            storeId: ctx.storeId,
            sourceCode: String(r.sourceCode),
            description: String(r.description ?? ''),
            unit: r.unit ? String(r.unit) : null,
            stock: r.stock != null ? Number(r.stock) : null,
            costPrice: r.costPrice != null ? Number(r.costPrice) : null,
            salePrice: r.salePrice != null ? Number(r.salePrice) : null,
            createdAt: new Date(),
            updatedAt: new Date(),
          })),
        );
        break;

      case 'cashClosings':
        persisted = await bulkUpsert(
          'cash_closings',
          ['tenantId', 'storeId', 'sourceId', 'openedAt', 'closedAt', 'operatorName', 'totalExpected', 'totalCounted', 'difference', 'pdv', 'openingAmount', 'createdAt'],
          ['tenantId', 'storeId', 'sourceId'],
          body.rows.map((r) => ({
            tenantId: ctx.tenantId,
            storeId: ctx.storeId,
            sourceId: String(r.sourceId),
            openedAt: new Date(String(r.openedAt)),
            closedAt: r.closedAt ? new Date(String(r.closedAt)) : null,
            operatorName: r.operatorName ? String(r.operatorName) : null,
            totalExpected: r.totalExpected != null ? Number(r.totalExpected) : null,
            totalCounted: r.totalCounted != null ? Number(r.totalCounted) : null,
            difference: r.difference != null ? Number(r.difference) : null,
            pdv: r.pdv != null ? String(r.pdv) : null,
            openingAmount: r.openingAmount != null ? Number(r.openingAmount) : null,
            createdAt: new Date(),
          })),
        );
        break;

      case 'cashClosingSpecies': {
        // resolve FK pro fechamento pai (mesmo padrao de saleItems -> sales)
        const closingSourceIds = [...new Set(body.rows.map((r) => String(r.closingSourceId)).filter(Boolean))];
        const parents = await prismaSync.cashClosing.findMany({
          where: { tenantId: ctx.tenantId, storeId: ctx.storeId, sourceId: { in: closingSourceIds } },
          select: { id: true, sourceId: true },
        });
        const closingMap = new Map(parents.map((c) => [c.sourceId, c.id]));
        const rows = body.rows
          .map((r) => {
            const closingId = closingMap.get(String(r.closingSourceId));
            if (!closingId) return null; // pai ainda nao sincronizado — proximo tick reenvia
            return {
              tenantId: ctx.tenantId,
              storeId: ctx.storeId,
              closingId,
              closingSourceId: String(r.closingSourceId),
              sourceId: String(r.sourceId),
              especie: String(r.especie ?? ''),
              counted: Number(r.counted ?? 0),
            };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null);
        persisted = await bulkUpsert(
          'cash_closing_species',
          ['tenantId', 'storeId', 'closingId', 'closingSourceId', 'sourceId', 'especie', 'counted'],
          ['tenantId', 'storeId', 'sourceId'],
          rows,
        );
        break;
      }

      case 'cardTransactions':
        persisted = await bulkUpsert(
          'card_transactions',
          ['tenantId', 'storeId', 'sourceId', 'acquirer', 'nsu', 'authCode', 'value', 'installments', 'transactionAt', 'processed', 'paymentSourceId', 'createdAt'],
          ['tenantId', 'storeId', 'sourceId'],
          body.rows.map((r) => ({
            tenantId: ctx.tenantId,
            storeId: ctx.storeId,
            sourceId: String(r.sourceId),
            acquirer: r.acquirer ? String(r.acquirer) : null,
            nsu: r.nsu ? String(r.nsu) : null,
            authCode: r.authCode ? String(r.authCode) : null,
            value: Number(r.value ?? 0),
            installments: r.installments != null ? Number(r.installments) : null,
            transactionAt: r.transactionAt ? new Date(String(r.transactionAt)) : new Date(),
            processed: r.processed !== false,
            paymentSourceId: r.paymentSourceId ? String(r.paymentSourceId) : null,
            createdAt: new Date(),
          })),
        );
        break;

      case 'payables':
        persisted = await bulkUpsert(
          'payables',
          ['tenantId', 'storeId', 'sourceId', 'dueDate', 'value', 'paidValue', 'paidDate', 'counterparty', 'description', 'cancelled', 'createdAt', 'updatedAt'],
          ['tenantId', 'storeId', 'sourceId'],
          body.rows.map((r) => ({
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
            createdAt: new Date(),
            updatedAt: new Date(),
          })),
        );
        break;

      case 'receivables':
        persisted = await bulkUpsert(
          'receivables',
          ['tenantId', 'storeId', 'sourceId', 'dueDate', 'value', 'receivedValue', 'receivedDate', 'counterparty', 'description', 'cancelled', 'createdAt', 'updatedAt'],
          ['tenantId', 'storeId', 'sourceId'],
          body.rows.map((r) => ({
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
            createdAt: new Date(),
            updatedAt: new Date(),
          })),
        );
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

    const agentVersion = typeof req.headers['x-agent-version'] === 'string' ? req.headers['x-agent-version'].slice(0, 32) : undefined;
    await prisma.agent.update({ where: { id: ctx.agentId }, data: { lastSeenAt: new Date(), ...(agentVersion ? { agentVersion } : {}) } });

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
