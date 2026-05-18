import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors } from '@gmonitor/shared';
import { prisma } from '../db/prisma.js';
import { requireAuth, requireCapability } from '../middleware/auth.js';

// Filtros padrao reutilizados em todos os relatorios.
const baseFilters = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  storeId: z.string().optional(),
});

function resolveStoreScope(req: { user?: { storeId?: string; role: string } }, requestedStoreId?: string): string | null {
  // Operador é forçado para sua propria loja, ignorando o parametro.
  if (req.user?.role === 'operador') return req.user.storeId ?? null;
  if (!requestedStoreId || requestedStoreId === 'all') return null;
  return requestedStoreId;
}

function defaultPeriod(from?: string, to?: string): { from: Date; to: Date } {
  const toDate = to ? new Date(to + 'T23:59:59Z') : new Date();
  const fromDate = from ? new Date(from + 'T00:00:00Z') : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return { from: fromDate, to: toDate };
}

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/reports', { preHandler: [requireAuth, requireCapability('reports.view')] }, async () => {
    return {
      reports: [
        { id: 'sales-summary', name: 'Resumo de Vendas' },
        { id: 'sales-by-payment', name: 'Vendas por Forma de Pagamento' },
        { id: 'abc-products', name: 'Curva ABC de Produtos' },
        { id: 'dre-simplified', name: 'DRE Simplificado' },
        { id: 'stockout', name: 'Ruptura de Estoque' },
        { id: 'inadimplencia-aging', name: 'Inadimplencia (Aging)' },
        { id: 'operator-commission', name: 'Comissao por Operador' },
        { id: 'customer-cohort', name: 'Cohort de Clientes' },
      ],
    };
  });

  app.get('/api/reports/sales-summary', { preHandler: [requireAuth, requireCapability('reports.view')] }, async (req) => {
    const query = baseFilters.parse(req.query);
    const { from, to } = defaultPeriod(query.from, query.to);
    const storeId = resolveStoreScope(req, query.storeId);

    const where = {
      tenantId: req.user!.tenantId,
      cancelled: false,
      saleDate: { gte: from, lte: to },
      ...(storeId ? { storeId } : {}),
    };

    const [agg, distinctDays, distinctCustomers] = await Promise.all([
      prisma.sale.aggregate({
        where,
        _sum: { totalValue: true },
        _avg: { totalValue: true },
        _count: true,
      }),
      prisma.sale.findMany({ where, distinct: ['saleDate'], select: { saleDate: true } }),
      prisma.sale.findMany({ where, distinct: ['customerSourceId'], select: { customerSourceId: true } }),
    ]);

    const meta = await getFreshnessMeta(req.user!.tenantId, storeId);

    return {
      data: {
        quantity: agg._count,
        total: Number(agg._sum.totalValue ?? 0),
        ticket: Number(agg._avg.totalValue ?? 0),
        workingDays: distinctDays.length,
        uniqueCustomers: distinctCustomers.filter((c) => c.customerSourceId).length,
      },
      meta,
    };
  });

  app.get('/api/reports/abc-products', { preHandler: [requireAuth, requireCapability('reports.view')] }, async (req) => {
    const query = baseFilters.parse(req.query);
    const { from, to } = defaultPeriod(query.from, query.to);
    const storeId = resolveStoreScope(req, query.storeId);
    if (!storeId && req.user!.role === 'operador') throw Errors.forbidden();

    const items = await prisma.saleItem.groupBy({
      by: ['productCode', 'description'],
      where: {
        tenantId: req.user!.tenantId,
        sale: { saleDate: { gte: from, lte: to }, cancelled: false },
        ...(storeId ? { storeId } : {}),
      },
      _sum: { totalValue: true, quantity: true },
      orderBy: { _sum: { totalValue: 'desc' } },
      take: 500,
    });

    const grand = items.reduce((s, i) => s + Number(i._sum.totalValue ?? 0), 0);
    let acc = 0;
    const rows = items.map((i) => {
      const value = Number(i._sum.totalValue ?? 0);
      acc += value;
      const pct = grand > 0 ? acc / grand : 0;
      const klass = pct <= 0.8 ? 'A' : pct <= 0.95 ? 'B' : 'C';
      return {
        productCode: i.productCode,
        description: i.description,
        quantity: Number(i._sum.quantity ?? 0),
        value,
        accValue: acc,
        accPct: pct,
        klass,
      };
    });

    const meta = await getFreshnessMeta(req.user!.tenantId, storeId);
    return { data: { rows, grandTotal: grand }, meta };
  });

  // Outros relatorios (skeleton; calculo detalhado por iteracao).
  for (const id of ['sales-by-payment', 'dre-simplified', 'stockout', 'inadimplencia-aging', 'operator-commission', 'customer-cohort']) {
    app.get(`/api/reports/${id}`, { preHandler: [requireAuth, requireCapability('reports.view')] }, async (req) => {
      const query = baseFilters.parse(req.query);
      const { from, to } = defaultPeriod(query.from, query.to);
      const storeId = resolveStoreScope(req, query.storeId);
      const meta = await getFreshnessMeta(req.user!.tenantId, storeId);
      return { data: { id, from, to, storeId, rows: [] }, meta, note: 'TODO: implementar calculo' };
    });
  }
}

async function getFreshnessMeta(tenantId: string, storeId: string | null): Promise<{
  lastSyncedAt: string | null;
  stalenessSeconds: number | null;
  agentsOffline: string[];
}> {
  const states = await prisma.syncState.findMany({
    where: { tenantId, ...(storeId ? { storeId } : {}) },
    orderBy: { lastSyncedAt: 'asc' },
    take: 1,
  });
  const oldest = states[0]?.lastSyncedAt ?? null;
  const offline = await prisma.agent.findMany({
    where: {
      tenantId,
      revokedAt: null,
      OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(Date.now() - 5 * 60 * 1000) } }],
      ...(storeId ? { storeId } : {}),
    },
    select: { storeId: true },
  });
  return {
    lastSyncedAt: oldest?.toISOString() ?? null,
    stalenessSeconds: oldest ? Math.round((Date.now() - oldest.getTime()) / 1000) : null,
    agentsOffline: offline.map((a) => a.storeId),
  };
}
