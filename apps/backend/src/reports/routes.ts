import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { Errors } from '@gmonitor/shared';
import { prisma } from '../db/prisma.js';
import { redis } from '../db/redis.js';
import { logger } from '../logger.js';
import { requireAuth, requireCapability } from '../middleware/auth.js';

// Cache curto (cache-aside) pros relatorios: cada request bate no Supabase (~180ms de RTT
// so na ida-e-volta, sa-east-1). Achado 24/08: quase todo handler fazia a query principal
// + getFreshnessMeta em 2 awaits SEQUENCIAIS (2x RTT por report) — agora e Promise.all em
// TODOS os handlers (1x RTT). TTL 90s (era 45s) pra casar com o syncIntervalMs padrao novo
// do agente (tambem 90s, ver installer) — nao precisa de cache mais curto que o proprio
// intervalo de sincronizacao.
const REPORT_CACHE_TTL_SECONDS = 90;

// Retry curto pra P1001 ("Can't reach database server") — visto ao vivo 24/08 como blip
// raro e transitorio (~1 em 120 chamadas, sem relacao com carga do proprio app), tipico de
// conexao de nuvem sobre a internet. Uma unica tentativa extra depois de 300ms resolve sem
// o usuario nem perceber, sem mascarar erro persistente (so retenta esse codigo especifico).
async function withDbRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if ((err as { code?: string }).code === 'P1001') {
      logger.warn({ err }, 'P1001 (pooler inalcancavel), tentando de novo em 300ms');
      await new Promise((resolve) => setTimeout(resolve, 300));
      return fn();
    }
    throw err;
  }
}

function cached<Req extends FastifyRequest>(reportId: string, handler: (req: Req) => Promise<unknown>) {
  return async (req: Req): Promise<unknown> => {
    const tenantId = (req as unknown as { user?: { tenantId?: string } }).user?.tenantId ?? 'anon';
    const key = `report:${tenantId}:${reportId}:${JSON.stringify(req.query)}`;
    try {
      const hit = await redis.get(key);
      if (hit) return JSON.parse(hit);
    } catch (err) {
      logger.error({ err }, 'redis cache read failed, seguindo sem cache');
    }

    const result = await withDbRetry(() => handler(req));

    try {
      await redis.setex(key, REPORT_CACHE_TTL_SECONDS, JSON.stringify(result));
    } catch (err) {
      logger.error({ err }, 'redis cache write failed, seguindo sem cache');
    }

    return result;
  };
}

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

// Sem from/to explicitos, o padrao e o mes atual (dia 1 ate hoje) — nao "ultimos 30 dias".
function startOfCurrentMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function defaultPeriod(from?: string, to?: string): { from: Date; to: Date } {
  const toDate = to ? new Date(to + 'T23:59:59Z') : new Date();
  const fromDate = from ? new Date(from + 'T00:00:00Z') : startOfCurrentMonth();
  return { from: fromDate, to: toDate };
}

const MONTH_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

// Semana do mes por posicao do dia (1-7 -> 0, 8-14 -> 1, ..., 29-31 -> 4) — simples e igual
// nos dois anos comparados, sem precisar alinhar dia-da-semana (ISO week seria mais preciso
// mas exigiria janeiro/dezembro cruzando ano — nao vale a complexidade pro caso de uso).
function weekOfMonth(date: Date): number {
  return Math.min(4, Math.floor((date.getUTCDate() - 1) / 7));
}

interface RevenueBucket {
  label: string;
  current: number;
  previous: number;
}

function buildRevenueBuckets(
  granularity: 'annual' | 'semiannual' | 'monthly',
  year: number,
  currentMonth: number,
  rows: { saleDate: Date; totalValue: unknown }[],
): RevenueBucket[] {
  const val = (v: unknown): number => Number(v ?? 0);

  if (granularity === 'monthly') {
    const buckets: RevenueBucket[] = Array.from({ length: 5 }, (_, w) => ({ label: `Semana ${w + 1}`, current: 0, previous: 0 }));
    for (const r of rows) {
      const d = r.saleDate;
      if (d.getUTCMonth() !== currentMonth) continue;
      const w = weekOfMonth(d);
      if (d.getUTCFullYear() === year) buckets[w]!.current += val(r.totalValue);
      else if (d.getUTCFullYear() === year - 1) buckets[w]!.previous += val(r.totalValue);
    }
    return buckets;
  }

  const months = granularity === 'annual' ? Array.from({ length: 12 }, (_, i) => i) : Array.from({ length: 6 }, (_, i) => ((currentMonth < 6 ? 0 : 6) + i));
  const buckets: RevenueBucket[] = months.map((m) => ({ label: MONTH_LABELS[m]!, current: 0, previous: 0 }));
  const monthIndex = new Map(months.map((m, i) => [m, i]));
  for (const r of rows) {
    const d = r.saleDate;
    const idx = monthIndex.get(d.getUTCMonth());
    if (idx === undefined) continue;
    if (d.getUTCFullYear() === year) buckets[idx]!.current += val(r.totalValue);
    else if (d.getUTCFullYear() === year - 1) buckets[idx]!.previous += val(r.totalValue);
  }
  return buckets;
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
        { id: 'payables-calendar', name: 'Calendario de Contas a Pagar' },
        { id: 'receivables-calendar', name: 'Calendario de Contas a Receber' },
      ],
    };
  });

  app.get('/api/reports/sales-summary', { preHandler: [requireAuth, requireCapability('reports.view')] }, cached('sales-summary', async (req) => {
    const query = baseFilters.parse(req.query);
    const { from, to } = defaultPeriod(query.from, query.to);
    const storeId = resolveStoreScope(req, query.storeId);

    const where = {
      tenantId: req.user!.tenantId,
      cancelled: false,
      saleDate: { gte: from, lte: to },
      ...(storeId ? { storeId } : {}),
    };

    const [agg, distinctDays, distinctCustomers, meta] = await Promise.all([
      prisma.sale.aggregate({
        where,
        _sum: { totalValue: true },
        _avg: { totalValue: true },
        _count: true,
      }),
      prisma.sale.findMany({ where, distinct: ['saleDate'], select: { saleDate: true } }),
      prisma.sale.findMany({ where, distinct: ['customerSourceId'], select: { customerSourceId: true } }),
      getFreshnessMeta(req.user!.tenantId, storeId),
    ]);

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
  }));

  app.get('/api/reports/abc-products', { preHandler: [requireAuth, requireCapability('reports.view')] }, cached('abc-products', async (req) => {
    const query = baseFilters.parse(req.query);
    const { from, to } = defaultPeriod(query.from, query.to);
    const storeId = resolveStoreScope(req, query.storeId);
    if (!storeId && req.user!.role === 'operador') throw Errors.forbidden();

    const [items, meta] = await Promise.all([
      prisma.saleItem.groupBy({
        by: ['productCode', 'description'],
        where: {
          tenantId: req.user!.tenantId,
          sale: { saleDate: { gte: from, lte: to }, cancelled: false },
          ...(storeId ? { storeId } : {}),
        },
        _sum: { totalValue: true, quantity: true },
        orderBy: { _sum: { totalValue: 'desc' } },
        take: 500,
      }),
      getFreshnessMeta(req.user!.tenantId, storeId),
    ]);

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

    return { data: { rows, grandTotal: grand }, meta };
  }));

  app.get('/api/reports/sales-by-payment', { preHandler: [requireAuth, requireCapability('reports.view')] }, cached('sales-by-payment', async (req) => {
    const query = baseFilters.parse(req.query);
    const { from, to } = defaultPeriod(query.from, query.to);
    const storeId = resolveStoreScope(req, query.storeId);

    const [groups, meta] = await Promise.all([
      prisma.payment.groupBy({
        by: ['paymentType'],
        where: {
          tenantId: req.user!.tenantId,
          paymentDate: { gte: from, lte: to },
          ...(storeId ? { storeId } : {}),
        },
        _sum: { value: true },
        _count: true,
        orderBy: { _sum: { value: 'desc' } },
      }),
      getFreshnessMeta(req.user!.tenantId, storeId),
    ]);

    const grandTotal = groups.reduce((s, g) => s + Number(g._sum.value ?? 0), 0);
    const rows = groups.map((g) => ({
      paymentType: g.paymentType,
      total: Number(g._sum.value ?? 0),
      count: g._count,
      pct: grandTotal > 0 ? Number(g._sum.value ?? 0) / grandTotal : 0,
    }));

    return { data: { rows, grandTotal }, meta };
  }));

  // Mesmo agregado do sales-by-payment, so que no formato que PagamentosPage.tsx espera
  // (value/percent em vez de total/pct, total no nivel raiz em vez de grandTotal aninhado).
  app.get('/api/reports/payments-summary', { preHandler: [requireAuth, requireCapability('reports.view')] }, cached('payments-summary', async (req) => {
    const query = baseFilters.parse(req.query);
    const { from, to } = defaultPeriod(query.from, query.to);
    const storeId = resolveStoreScope(req, query.storeId);

    const [groups, meta] = await Promise.all([
      prisma.payment.groupBy({
        by: ['paymentType'],
        where: { tenantId: req.user!.tenantId, paymentDate: { gte: from, lte: to }, ...(storeId ? { storeId } : {}) },
        _sum: { value: true },
        _count: true,
        orderBy: { _sum: { value: 'desc' } },
      }),
      getFreshnessMeta(req.user!.tenantId, storeId),
    ]);

    const total = groups.reduce((s, g) => s + Number(g._sum.value ?? 0), 0);
    const data = groups.map((g) => ({
      paymentType: g.paymentType,
      count: g._count,
      value: Number(g._sum.value ?? 0),
      percent: total > 0 ? Number(g._sum.value ?? 0) / total : 0,
    }));

    return { data, total, meta };
  }));

  // Listagem paginada de vendas — pedido do dono 24/08: pagina de Vendas estava 404 (o
  // frontend ja tinha paginacao pronta, so faltava esse endpoint).
  const listPageFilters = z.object({
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    storeId: z.string().optional(),
    status: z.enum(['ok', 'cancelada']).optional(),
    modelo: z.string().optional(),
    search: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(250).default(50),
  });

  app.get('/api/reports/sales', { preHandler: [requireAuth, requireCapability('reports.view')] }, cached('sales', async (req) => {
    const query = listPageFilters.parse(req.query);
    const { from, to } = defaultPeriod(query.from, query.to);
    const storeId = resolveStoreScope(req, query.storeId);

    const where = {
      tenantId: req.user!.tenantId,
      saleDate: { gte: from, lte: to },
      ...(storeId ? { storeId } : {}),
      ...(query.status ? { cancelled: query.status === 'cancelada' } : {}),
      ...(query.modelo ? { modelo: query.modelo } : {}),
      ...(query.search ? { sourceId: { contains: query.search } } : {}),
    };

    const [rows, total, activeAgg, cancelledCount, meta] = await Promise.all([
      prisma.sale.findMany({
        where,
        orderBy: { saleDate: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.sale.count({ where }),
      prisma.sale.aggregate({
        where: { ...where, cancelled: false },
        _sum: { totalValue: true },
        _count: true,
        _avg: { totalValue: true },
      }),
      prisma.sale.count({ where: { ...where, cancelled: true } }),
      getFreshnessMeta(req.user!.tenantId, storeId),
    ]);

    return {
      data: rows.map((r) => ({
        id: r.id,
        sourceId: r.sourceId,
        saleDate: r.saleDate,
        modelo: r.modelo,
        operatorName: r.operatorName,
        caixa: r.caixa,
        natureza: r.natureza,
        totalValue: Number(r.totalValue),
        cancelled: r.cancelled,
        customerSourceId: r.customerSourceId,
      })),
      pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) },
      summary: {
        total: activeAgg._count + cancelledCount,
        cancelled: cancelledCount,
        revenue: Number(activeAgg._sum.totalValue ?? 0),
        ticket: Number(activeAgg._avg.totalValue ?? 0),
      },
      meta,
    };
  }));

  // Catalogo de produtos paginado — mesma causa do /sales (endpoint nunca existiu).
  const catalogPageFilters = z.object({
    storeId: z.string().optional(),
    search: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(250).default(50),
  });

  app.get('/api/reports/products', { preHandler: [requireAuth, requireCapability('reports.view')] }, cached('products', async (req) => {
    const query = catalogPageFilters.parse(req.query);
    const storeId = resolveStoreScope(req, query.storeId);

    const where = {
      tenantId: req.user!.tenantId,
      ...(storeId ? { storeId } : {}),
      ...(query.search
        ? { OR: [{ sourceCode: { contains: query.search } }, { description: { contains: query.search, mode: 'insensitive' as const } }] }
        : {}),
    };

    const [rows, total, meta] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: { description: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.product.count({ where }),
      getFreshnessMeta(req.user!.tenantId, storeId),
    ]);

    return {
      data: rows.map((r) => ({
        id: r.id,
        sourceCode: r.sourceCode,
        description: r.description,
        unit: r.unit,
        stock: r.stock ? Number(r.stock) : null,
        costPrice: r.costPrice ? Number(r.costPrice) : null,
        salePrice: r.salePrice ? Number(r.salePrice) : null,
      })),
      pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) },
      meta,
    };
  }));

  // Clientes paginados, com total de compras/valor gasto agregado so pra pagina atual (nao
  // pro cadastro inteiro) — mesma causa do /sales.
  app.get('/api/reports/customers', { preHandler: [requireAuth, requireCapability('reports.view')] }, cached('customers', async (req) => {
    const query = catalogPageFilters.parse(req.query);
    const storeId = resolveStoreScope(req, query.storeId);

    const where = {
      tenantId: req.user!.tenantId,
      ...(storeId ? { storeId } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { document: { contains: query.search } },
              { phone: { contains: query.search } },
            ],
          }
        : {}),
    };

    const [rows, total, meta] = await Promise.all([
      prisma.customer.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.customer.count({ where }),
      getFreshnessMeta(req.user!.tenantId, storeId),
    ]);

    // Agregado de compras so das linhas desta pagina (nao do cadastro inteiro).
    const sourceIds = rows.map((r) => r.sourceId);
    const salesAgg = sourceIds.length
      ? await prisma.sale.groupBy({
          by: ['customerSourceId'],
          where: { tenantId: req.user!.tenantId, cancelled: false, customerSourceId: { in: sourceIds } },
          _count: true,
          _sum: { totalValue: true },
        })
      : [];
    const salesBySourceId = new Map(salesAgg.map((s) => [s.customerSourceId, s]));

    return {
      data: rows.map((r) => {
        const agg = salesBySourceId.get(r.sourceId);
        return {
          id: r.id,
          sourceId: r.sourceId,
          name: r.name,
          document: r.document,
          phone: r.phone,
          totalCompras: agg?._count ?? 0,
          valorTotal: Number(agg?._sum.totalValue ?? 0),
        };
      }),
      pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) },
      meta,
    };
  }));

  // Faturamento bruto sempre vs o mesmo periodo do ANO PASSADO (nao periodo anterior
  // rolante) — pedido do dono 24/08. 3 granularidades:
  // - annual: 12 meses do ano corrente vs 12 meses do ano anterior
  // - semiannual: os 6 meses do semestre corrente (Jan-Jun ou Jul-Dez) vs mesmo semestre ano passado
  // - monthly: as semanas do mes corrente vs as mesmas semanas do mesmo mes ano passado
  const revenueComparisonFilters = z.object({
    granularity: z.enum(['annual', 'semiannual', 'monthly']).default('annual'),
    storeId: z.string().optional(),
  });

  app.get('/api/reports/dashboard/revenue-comparison', { preHandler: [requireAuth, requireCapability('reports.view')] }, cached('revenue-comparison', async (req) => {
    const query = revenueComparisonFilters.parse(req.query);
    const storeId = resolveStoreScope(req, query.storeId);
    const now = new Date();
    const year = now.getUTCFullYear();

    let rangeFrom: Date;
    let rangeTo: Date;
    if (query.granularity === 'annual') {
      rangeFrom = new Date(Date.UTC(year - 1, 0, 1));
      rangeTo = new Date(Date.UTC(year, 11, 31, 23, 59, 59));
    } else if (query.granularity === 'semiannual') {
      const semesterStartMonth = now.getUTCMonth() < 6 ? 0 : 6;
      rangeFrom = new Date(Date.UTC(year - 1, semesterStartMonth, 1));
      rangeTo = new Date(Date.UTC(year, semesterStartMonth + 5, 31, 23, 59, 59));
    } else {
      const month = now.getUTCMonth();
      rangeFrom = new Date(Date.UTC(year - 1, month, 1));
      rangeTo = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59));
    }

    // Agrega no Postgres (GROUP BY mes ou dia), nunca traz linha-a-linha pro Node — achado
    // 24/08: um SELECT sem agregacao pra 2 anos inteiros de vendas reais estourou o timeout
    // de 60s do Cloudflare (504). Granularidade do bucket: dia pra "monthly" (poucas semanas
    // pra montar em JS), mes pros outros dois (no maximo 24 linhas voltam do banco).
    const truncUnit = query.granularity === 'monthly' ? 'day' : 'month';
    const [rows, meta] = await Promise.all([
      prisma.$queryRaw<{ bucket: Date; total: unknown }[]>(
        storeId
          ? Prisma.sql`SELECT date_trunc(${truncUnit}, "saleDate") AS bucket, SUM("totalValue") AS total
              FROM sales
              WHERE "tenantId" = ${req.user!.tenantId} AND "cancelled" = false AND "storeId" = ${storeId}
                AND "saleDate" >= ${rangeFrom} AND "saleDate" <= ${rangeTo}
              GROUP BY 1`
          : Prisma.sql`SELECT date_trunc(${truncUnit}, "saleDate") AS bucket, SUM("totalValue") AS total
              FROM sales
              WHERE "tenantId" = ${req.user!.tenantId} AND "cancelled" = false
                AND "saleDate" >= ${rangeFrom} AND "saleDate" <= ${rangeTo}
              GROUP BY 1`,
      ),
      getFreshnessMeta(req.user!.tenantId, storeId),
    ]);

    const buckets = buildRevenueBuckets(query.granularity, year, now.getUTCMonth(), rows.map((r) => ({ saleDate: r.bucket, totalValue: r.total })));
    const currentTotal = buckets.reduce((s, b) => s + b.current, 0);
    const previousTotal = buckets.reduce((s, b) => s + b.previous, 0);
    const growthPct = previousTotal > 0 ? ((currentTotal - previousTotal) / previousTotal) * 100 : 0;

    return {
      data: { granularity: query.granularity, buckets, totals: { current: currentTotal, previous: previousTotal, growthPct } },
      meta,
    };
  }));

  app.get('/api/reports/dre-simplified', { preHandler: [requireAuth, requireCapability('reports.view')] }, async (req) => {
    const query = baseFilters.parse(req.query);
    const { from, to } = defaultPeriod(query.from, query.to);
    const storeId = resolveStoreScope(req, query.storeId);

    const dateWhere = { saleDate: { gte: from, lte: to } };
    const baseWhere = { tenantId: req.user!.tenantId, ...(storeId ? { storeId } : {}) };

    const [active, cancelled, payments, meta] = await Promise.all([
      prisma.sale.aggregate({
        where: { ...baseWhere, ...dateWhere, cancelled: false },
        _sum: { totalValue: true },
        _count: true,
      }),
      prisma.sale.aggregate({
        where: { ...baseWhere, ...dateWhere, cancelled: true },
        _sum: { totalValue: true },
        _count: true,
      }),
      prisma.payment.groupBy({
        by: ['paymentType'],
        where: { tenantId: req.user!.tenantId, paymentDate: { gte: from, lte: to }, ...(storeId ? { storeId } : {}) },
        _sum: { value: true },
        _count: true,
        orderBy: { _sum: { value: 'desc' } },
      }),
      getFreshnessMeta(req.user!.tenantId, storeId),
    ]);

    const gross = Number(active._sum.totalValue ?? 0);
    const cancellations = Number(cancelled._sum.totalValue ?? 0);

    return {
      data: {
        grossRevenue: gross,
        cancellations,
        netRevenue: gross - cancellations,
        salesCount: active._count,
        cancelledCount: cancelled._count,
        payments: payments.map((p) => ({
          type: p.paymentType,
          total: Number(p._sum.value ?? 0),
          count: p._count,
        })),
      },
      meta,
    };
  });

  app.get('/api/reports/stockout', { preHandler: [requireAuth, requireCapability('reports.view')] }, async (req) => {
    const query = baseFilters.parse(req.query);
    const storeId = resolveStoreScope(req, query.storeId);

    const [rows, meta] = await Promise.all([
      prisma.product.findMany({
        where: {
          tenantId: req.user!.tenantId,
          ...(storeId ? { storeId } : {}),
          OR: [{ stock: { lte: 0 } }, { stock: null }],
        },
        select: { sourceCode: true, description: true, unit: true, stock: true, salePrice: true },
        orderBy: { description: 'asc' },
        take: 500,
      }),
      getFreshnessMeta(req.user!.tenantId, storeId),
    ]);

    return {
      data: {
        rows: rows.map((r) => ({ ...r, stock: r.stock ? Number(r.stock) : null, salePrice: r.salePrice ? Number(r.salePrice) : null })),
        total: rows.length,
      },
      meta,
    };
  });

  app.get('/api/reports/inadimplencia-aging', { preHandler: [requireAuth, requireCapability('reports.view')] }, async (req) => {
    const query = baseFilters.parse(req.query);
    const storeId = resolveStoreScope(req, query.storeId);

    // Vendas sem nenhum pagamento associado = possiveis creditos nao liquidados
    const [unpaid, meta] = await Promise.all([
      prisma.sale.findMany({
        where: {
          tenantId: req.user!.tenantId,
          ...(storeId ? { storeId } : {}),
          cancelled: false,
          saleDate: { gte: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000) },
          payments: { none: {} },
        },
        select: { sourceId: true, saleDate: true, totalValue: true, operatorName: true, customerSourceId: true },
        orderBy: { saleDate: 'asc' },
        take: 500,
      }),
      getFreshnessMeta(req.user!.tenantId, storeId),
    ]);

    const now = Date.now();
    const buckets: Record<string, { count: number; total: number }> = {
      '0-30': { count: 0, total: 0 },
      '31-60': { count: 0, total: 0 },
      '61-90': { count: 0, total: 0 },
      '91+': { count: 0, total: 0 },
    };

    for (const s of unpaid) {
      const days = Math.floor((now - s.saleDate.getTime()) / 86_400_000);
      const key = days <= 30 ? '0-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '91+';
      buckets[key].count++;
      buckets[key].total += Number(s.totalValue);
    }

    const grandTotal = unpaid.reduce((sum, s) => sum + Number(s.totalValue), 0);
    return {
      data: {
        aging: Object.entries(buckets).map(([range, v]) => ({ range, ...v })),
        grandTotal,
        count: unpaid.length,
        rows: unpaid.map((s) => ({ ...s, totalValue: Number(s.totalValue) })),
      },
      meta,
    };
  });

  app.get('/api/reports/operator-commission', { preHandler: [requireAuth, requireCapability('reports.view')] }, cached('operator-commission', async (req) => {
    const query = baseFilters.parse(req.query);
    const { from, to } = defaultPeriod(query.from, query.to);
    const storeId = resolveStoreScope(req, query.storeId);

    const [groups, meta] = await Promise.all([
      prisma.sale.groupBy({
        by: ['operatorName'],
        where: {
          tenantId: req.user!.tenantId,
          cancelled: false,
          saleDate: { gte: from, lte: to },
          ...(storeId ? { storeId } : {}),
        },
        _sum: { totalValue: true },
        _count: true,
        orderBy: { _sum: { totalValue: 'desc' } },
        take: 100,
      }),
      getFreshnessMeta(req.user!.tenantId, storeId),
    ]);

    const grandTotal = groups.reduce((s, g) => s + Number(g._sum.totalValue ?? 0), 0);
    const rows = groups.map((g) => ({
      operator: g.operatorName ?? '(sem operador)',
      count: g._count,
      total: Number(g._sum.totalValue ?? 0),
      pct: grandTotal > 0 ? Number(g._sum.totalValue ?? 0) / grandTotal : 0,
    }));

    return { data: { rows, grandTotal }, meta };
  }));

  app.get('/api/reports/customer-cohort', { preHandler: [requireAuth, requireCapability('reports.view')] }, async (req) => {
    const query = baseFilters.parse(req.query);
    const storeId = resolveStoreScope(req, query.storeId);

    // Mes da primeira compra por cliente (cohort de aquisicao)
    const [firstPurchases, meta] = await Promise.all([
      prisma.sale.groupBy({
        by: ['customerSourceId'],
        where: {
          tenantId: req.user!.tenantId,
          cancelled: false,
          customerSourceId: { not: null },
          ...(storeId ? { storeId } : {}),
        },
        _min: { saleDate: true },
      }),
      getFreshnessMeta(req.user!.tenantId, storeId),
    ]);

    const cohortMap = new Map<string, number>();
    for (const s of firstPurchases) {
      if (!s._min.saleDate) continue;
      const d = s._min.saleDate;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      cohortMap.set(key, (cohortMap.get(key) ?? 0) + 1);
    }

    const rows = [...cohortMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, newCustomers]) => ({ month, newCustomers }));

    return { data: { rows, totalCustomers: firstPurchases.length }, meta };
  });

  registerFinanceRoutes(app);
}

// ─── Contas a pagar / contas a receber ──────────────────────────────────────
// Status (paid/pending/overdue) e sempre derivado em runtime a partir de
// value/paidValue(ou receivedValue)/paidDate(ou receivedDate)/dueDate — nunca armazenado,
// para nao ficar defasado quando o agente sincroniza um pagamento novo.

type FinanceStatus = 'paid' | 'pending' | 'overdue';

function classifyFinanceStatus(value: number, settledValue: number, settledDate: Date | null, dueDate: Date, today: Date): FinanceStatus {
  if (settledValue >= value) return 'paid';
  if (!settledDate && dueDate < today) return 'overdue';
  return 'pending';
}

const monthFilter = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  storeId: z.string().optional(),
});

function monthBounds(month: string): { from: Date; to: Date } {
  const [year, mon] = month.split('-').map(Number);
  const from = new Date(Date.UTC(year!, mon! - 1, 1));
  const to = new Date(Date.UTC(year!, mon!, 0, 23, 59, 59, 999));
  return { from, to };
}

function registerFinanceRoutes(app: FastifyInstance): void {
  app.get('/api/reports/payables-calendar', { preHandler: [requireAuth, requireCapability('reports.view')] }, cached('payables-calendar', async (req) => {
    const query = monthFilter.parse(req.query);
    const storeId = resolveStoreScope(req, query.storeId);
    const { from, to } = monthBounds(query.month);

    const [rows, meta] = await Promise.all([
      prisma.payable.findMany({
        where: { tenantId: req.user!.tenantId, ...(storeId ? { storeId } : {}), cancelled: false, dueDate: { gte: from, lte: to } },
        select: { dueDate: true, value: true, paidValue: true, paidDate: true },
      }),
      getFreshnessMeta(req.user!.tenantId, storeId),
    ]);

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const days = new Map<string, { date: string; total: number; paid: number; pending: number; overdue: number }>();
    for (const r of rows) {
      const key = r.dueDate.toISOString().slice(0, 10);
      if (!days.has(key)) days.set(key, { date: key, total: 0, paid: 0, pending: 0, overdue: 0 });
      const bucket = days.get(key)!;
      const value = Number(r.value);
      const status = classifyFinanceStatus(value, Number(r.paidValue), r.paidDate, r.dueDate, today);
      bucket.total += value;
      bucket[status] += value;
    }

    const daysArr = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
    const monthSummary = daysArr.reduce(
      (acc, d) => ({ total: acc.total + d.total, paid: acc.paid + d.paid, pending: acc.pending + d.pending, overdue: acc.overdue + d.overdue }),
      { total: 0, paid: 0, pending: 0, overdue: 0 },
    );

    return { data: { days: daysArr, monthSummary }, meta };
  }));

  app.get('/api/reports/receivables-calendar', { preHandler: [requireAuth, requireCapability('reports.view')] }, cached('receivables-calendar', async (req) => {
    const query = monthFilter.parse(req.query);
    const storeId = resolveStoreScope(req, query.storeId);
    const { from, to } = monthBounds(query.month);

    const [rows, meta] = await Promise.all([
      prisma.receivable.findMany({
        where: { tenantId: req.user!.tenantId, ...(storeId ? { storeId } : {}), cancelled: false, dueDate: { gte: from, lte: to } },
        select: { dueDate: true, value: true, receivedValue: true, receivedDate: true },
      }),
      getFreshnessMeta(req.user!.tenantId, storeId),
    ]);

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const days = new Map<string, { date: string; total: number; paid: number; pending: number; overdue: number }>();
    for (const r of rows) {
      const key = r.dueDate.toISOString().slice(0, 10);
      if (!days.has(key)) days.set(key, { date: key, total: 0, paid: 0, pending: 0, overdue: 0 });
      const bucket = days.get(key)!;
      const value = Number(r.value);
      const status = classifyFinanceStatus(value, Number(r.receivedValue), r.receivedDate, r.dueDate, today);
      bucket.total += value;
      bucket[status] += value;
    }

    const daysArr = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
    const monthSummary = daysArr.reduce(
      (acc, d) => ({ total: acc.total + d.total, paid: acc.paid + d.paid, pending: acc.pending + d.pending, overdue: acc.overdue + d.overdue }),
      { total: 0, paid: 0, pending: 0, overdue: 0 },
    );

    return { data: { days: daysArr, monthSummary }, meta };
  }));

  const listFilters = z.object({
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    storeId: z.string().optional(),
    status: z.enum(['paid', 'pending', 'overdue']).optional(),
  });

  app.get('/api/reports/payables', { preHandler: [requireAuth, requireCapability('reports.view')] }, cached('payables', async (req) => {
    const query = listFilters.parse(req.query);
    const { from, to } = defaultPeriod(query.from, query.to);
    const storeId = resolveStoreScope(req, query.storeId);
    const where = { tenantId: req.user!.tenantId, ...(storeId ? { storeId } : {}), cancelled: false, dueDate: { gte: from, lte: to } };

    // Resumo (summary) sempre sobre o total real (nao so as 500 exibidas), senao pending/
    // overdue somam errado quando a janela de datas tem mais de 500 lancamentos.
    const [rows, allForSummary, totalCount, meta] = await Promise.all([
      prisma.payable.findMany({ where, orderBy: { dueDate: 'desc' }, take: 500 }),
      prisma.payable.findMany({ where, select: { value: true, paidValue: true, paidDate: true, dueDate: true } }),
      prisma.payable.count({ where }),
      getFreshnessMeta(req.user!.tenantId, storeId),
    ]);

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const data = rows
      .map((r) => {
        const value = Number(r.value);
        const paidValue = Number(r.paidValue);
        return {
          sourceId: r.sourceId,
          dueDate: r.dueDate,
          value,
          paidValue,
          paidDate: r.paidDate,
          counterparty: r.counterparty,
          description: r.description,
          balance: value - paidValue,
          status: classifyFinanceStatus(value, paidValue, r.paidDate, r.dueDate, today),
        };
      })
      .filter((r) => !query.status || r.status === query.status);

    const summary = allForSummary.reduce(
      (acc, r) => {
        const value = Number(r.value);
        const paidValue = Number(r.paidValue);
        const balance = value - paidValue;
        const status = classifyFinanceStatus(value, paidValue, r.paidDate, r.dueDate, today);
        return {
          total: acc.total + value,
          pending: acc.pending + (status !== 'paid' ? balance : 0),
          overdue: acc.overdue + (status === 'overdue' ? balance : 0),
        };
      },
      { total: 0, pending: 0, overdue: 0 },
    );

    return { data, summary, count: data.length, totalCount, truncated: rows.length === 500 && totalCount > 500, meta };
  }));

  app.get('/api/reports/receivables', { preHandler: [requireAuth, requireCapability('reports.view')] }, cached('receivables', async (req) => {
    const query = listFilters.parse(req.query);
    const { from, to } = defaultPeriod(query.from, query.to);
    const storeId = resolveStoreScope(req, query.storeId);
    const where = { tenantId: req.user!.tenantId, ...(storeId ? { storeId } : {}), cancelled: false, dueDate: { gte: from, lte: to } };

    // Mesma logica do payables: summary sobre o total real, nao so as 500 exibidas.
    const [rows, allForSummary, totalCount, meta] = await Promise.all([
      prisma.receivable.findMany({ where, orderBy: { dueDate: 'desc' }, take: 500 }),
      prisma.receivable.findMany({ where, select: { value: true, receivedValue: true, receivedDate: true, dueDate: true } }),
      prisma.receivable.count({ where }),
      getFreshnessMeta(req.user!.tenantId, storeId),
    ]);

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const data = rows
      .map((r) => {
        const value = Number(r.value);
        const receivedValue = Number(r.receivedValue);
        return {
          sourceId: r.sourceId,
          dueDate: r.dueDate,
          value,
          receivedValue,
          receivedDate: r.receivedDate,
          counterparty: r.counterparty,
          description: r.description,
          balance: value - receivedValue,
          status: classifyFinanceStatus(value, receivedValue, r.receivedDate, r.dueDate, today),
        };
      })
      .filter((r) => !query.status || r.status === query.status);

    const summary = allForSummary.reduce(
      (acc, r) => {
        const value = Number(r.value);
        const receivedValue = Number(r.receivedValue);
        const balance = value - receivedValue;
        const status = classifyFinanceStatus(value, receivedValue, r.receivedDate, r.dueDate, today);
        return {
          total: acc.total + value,
          pending: acc.pending + (status !== 'paid' ? balance : 0),
          overdue: acc.overdue + (status === 'overdue' ? balance : 0),
        };
      },
      { total: 0, pending: 0, overdue: 0 },
    );

    return { data, summary, count: data.length, totalCount, truncated: rows.length === 500 && totalCount > 500, meta };
  }));
}

async function getFreshnessMeta(tenantId: string, storeId: string | null): Promise<{
  lastSyncedAt: string | null;
  stalenessSeconds: number | null;
  agentsOffline: string[];
}> {
  // "Frescor" usa o heartbeat do agente (Agent.lastSeenAt), nao SyncState.lastSyncedAt.
  // SyncState so atualiza quando ha linha NOVA pra persistir — uma tabela que ja pegou
  // todo o backlog (ex: payables sem lancamento novo desde ontem) fica com lastSyncedAt
  // congelado pra sempre, mesmo com o agente vivo e verificando a cada 30s. Usar o
  // heartbeat reflete "o agente esta rodando e checando", que e o que "defasagem" deveria
  // significar — nao "achamos dado novo recentemente" (achado testando a UI de verdade
  // 24/08: alerta de "939 min de defasagem" com o agente sincronizando ha segundos).
  const agents = await prisma.agent.findMany({
    where: { tenantId, revokedAt: null, ...(storeId ? { storeId } : {}) },
    select: { storeId: true, lastSeenAt: true },
  });
  const mostRecentSeen = agents.reduce<Date | null>(
    (acc, a) => (a.lastSeenAt && (!acc || a.lastSeenAt > acc) ? a.lastSeenAt : acc),
    null,
  );
  const offline = agents.filter((a) => !a.lastSeenAt || a.lastSeenAt < new Date(Date.now() - 5 * 60 * 1000));
  return {
    lastSyncedAt: mostRecentSeen?.toISOString() ?? null,
    stalenessSeconds: mostRecentSeen ? Math.round((Date.now() - mostRecentSeen.getTime()) / 1000) : null,
    agentsOffline: offline.map((a) => a.storeId),
  };
}
