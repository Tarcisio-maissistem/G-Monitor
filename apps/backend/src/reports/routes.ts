import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { Errors } from '@gmonitor/shared';
import { prisma } from '../db/prisma.js';
import { redis } from '../db/redis.js';
import { logger } from '../logger.js';
import { requireAuth, requireCapability } from '../middleware/auth.js';
import { buildCashflow, buildForecast, pickGranularity, type Granularity } from './cashflow.js';
import { normalizePaymentType } from './paymentType.js';

// P4 (26/08, confirmado no Firebird do piloto): a venda de REGISTRO e o PV (pre-venda) e a
// NF-e 55. A NFC-e 65 e gerada A PARTIR do PV e nao tem pagamento proprio — somar os dois
// dobrava a receita. Toda query de venda usa este filtro; NFC-e direta (sem PV, tem pagamento
// proprio) e anomalia exposta a parte em /dashboard/today (nfceSemPv).
const SALE_OF_RECORD = { cancelled: false as const, modelo: { not: '65' } };


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
      ...SALE_OF_RECORD, // P4: NFC-e 65 e copia fiscal do PV — nao conta 2x
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
          sale: { saleDate: { gte: from, lte: to }, ...SALE_OF_RECORD },
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
        where: { ...where, ...SALE_OF_RECORD },
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
          where: { tenantId: req.user!.tenantId, ...SALE_OF_RECORD, customerSourceId: { in: sourceIds } },
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
              WHERE "tenantId" = ${req.user!.tenantId} AND "cancelled" = false AND ("modelo" IS NULL OR "modelo" <> '65') AND "storeId" = ${storeId}
                AND "saleDate" >= ${rangeFrom} AND "saleDate" <= ${rangeTo}
              GROUP BY 1`
          : Prisma.sql`SELECT date_trunc(${truncUnit}, "saleDate") AS bucket, SUM("totalValue") AS total
              FROM sales
              WHERE "tenantId" = ${req.user!.tenantId} AND "cancelled" = false AND ("modelo" IS NULL OR "modelo" <> '65')
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

  // DRE v1 (D17, 25/08): extrato vertical com selo por linha (real|estimate|nd). Corrige o
  // erro antigo (cancelamento subtraido de uma receita que ja nao o continha). Receita bruta
  // = venda nao cancelada SEM filtrar processed (P2: PV/65/55 contam), excluindo naturezas que
  // nao sao venda (Devolucao de compra, Complementar). Nunca a palavra "lucro".
  const dreFilters = baseFilters.extend({ regime: z.enum(['caixa', 'vencimento']).default('caixa') });

  app.get('/api/reports/dre-simplified', { preHandler: [requireAuth, requireCapability('reports.view')] }, cached('dre-simplified', async (req) => {
    const query = dreFilters.parse(req.query);
    const { from, to } = defaultPeriod(query.from, query.to);
    const storeId = resolveStoreScope(req, query.storeId);
    const tenantId = req.user!.tenantId;
    const baseWhere = { tenantId, ...(storeId ? { storeId } : {}) };

    const [naturezas, cancelled, naoProc, payments, cmvRows, despesasFornecedor, despesasAgg, meta] = await Promise.all([
      prisma.sale.groupBy({
        by: ['natureza', 'modelo'],
        where: { ...baseWhere, saleDate: { gte: from, lte: to }, ...SALE_OF_RECORD },
        _sum: { totalValue: true },
        _count: true,
      }),
      prisma.sale.aggregate({ where: { ...baseWhere, saleDate: { gte: from, lte: to }, cancelled: true }, _sum: { totalValue: true }, _count: true }),
      prisma.sale.aggregate({ where: { ...baseWhere, saleDate: { gte: from, lte: to }, ...SALE_OF_RECORD, processed: false }, _sum: { totalValue: true }, _count: true }),
      prisma.payment.groupBy({
        by: ['paymentType'],
        where: { ...baseWhere, paymentDate: { gte: from, lte: to } },
        _sum: { value: true },
        _count: true,
        orderBy: { _sum: { value: 'desc' } },
      }),
      // CMV aproximado = qtd x custo ATUAL do produto (products hoje esta vazio — agente nao
      // sincroniza). coverage = % da qtd vendida que tem custo cadastrado; UI so mostra >= 50%.
      prisma.$queryRaw<{ cmv: unknown; qtd_com_custo: unknown; qtd_total: unknown }[]>(Prisma.sql`
        SELECT COALESCE(SUM(CASE WHEN p."costPrice" IS NOT NULL THEN i."quantity" * p."costPrice" END), 0) AS cmv,
               COALESCE(SUM(CASE WHEN p."costPrice" IS NOT NULL THEN i."quantity" END), 0) AS qtd_com_custo,
               COALESCE(SUM(i."quantity"), 0) AS qtd_total
        FROM sale_items i
        JOIN sales s ON s.id = i."saleId"
        LEFT JOIN products p ON p."tenantId" = i."tenantId" AND p."storeId" = i."storeId" AND p."sourceCode" = i."productCode"
        WHERE i."tenantId" = ${tenantId} ${storeId ? Prisma.sql`AND i."storeId" = ${storeId}` : Prisma.empty}
          AND s."cancelled" = false AND (s."modelo" IS NULL OR s."modelo" <> '65') AND s."saleDate" >= ${from} AND s."saleDate" <= ${to}`),
      prisma.payable.groupBy({
        by: ['counterparty'],
        where: query.regime === 'caixa'
          ? { ...baseWhere, cancelled: false, paidDate: { gte: from, lte: to }, paidValue: { gt: 0 } }
          : { ...baseWhere, cancelled: false, dueDate: { gte: from, lte: to } },
        // soma os dois sempre (o tipo do groupBy vira uniao se o _sum for condicional) e
        // escolhe em JS conforme o regime
        _sum: { paidValue: true, value: true },
        orderBy: query.regime === 'caixa' ? { _sum: { paidValue: 'desc' } } : { _sum: { value: 'desc' } },
        take: 10,
      }),
      prisma.payable.aggregate({
        where: query.regime === 'caixa'
          ? { ...baseWhere, cancelled: false, paidDate: { gte: from, lte: to }, paidValue: { gt: 0 } }
          : { ...baseWhere, cancelled: false, dueDate: { gte: from, lte: to } },
        _sum: { paidValue: true, value: true },
      }),
      getFreshnessMeta(tenantId, storeId),
    ]);

    const isVenda = (n: string | null) => !(n ?? '').startsWith('Devolu') && !(n ?? '').startsWith('Complementar');
    const receitaBruta = naturezas.filter((g) => isVenda(g.natureza)).reduce((s, g) => s + Number(g._sum.totalValue ?? 0), 0);
    const receitaPorModelo: Record<string, number> = {};
    for (const g of naturezas) {
      if (!isVenda(g.natureza)) continue;
      const m = g.modelo ?? '?';
      receitaPorModelo[m] = (receitaPorModelo[m] ?? 0) + Number(g._sum.totalValue ?? 0);
    }
    const despesas = query.regime === 'caixa' ? Number(despesasAgg._sum.paidValue ?? 0) : Number(despesasAgg._sum.value ?? 0);
    const cmvRow = cmvRows[0];
    const qtdTotal = Number(cmvRow?.qtd_total ?? 0);
    const cmvCoverage = qtdTotal > 0 ? (Number(cmvRow?.qtd_com_custo ?? 0) / qtdTotal) * 100 : null;
    const cmvOk = cmvCoverage !== null && cmvCoverage >= 50;
    const cmv = cmvOk ? Number(cmvRow?.cmv ?? 0) : null;
    const receitaLiquida = receitaBruta; // descontos/devolucoes N/D
    const margemBruta = cmv !== null ? receitaLiquida - cmv : null;
    const resultado = receitaLiquida - despesas - (cmv ?? 0);
    const pct = (v: number | null) => (v === null || receitaBruta <= 0 ? null : (v / receitaBruta) * 100);
    const despesaNote = query.regime === 'caixa' ? 'so contas a pagar baixadas no periodo (sangria/despesa de caixa nao sincronizam)' : 'contas a pagar por vencimento no periodo (nao e competencia: sem data de emissao)';

    const lines = [
      { key: 'receita_bruta', label: 'Receita bruta', value: receitaBruta, pct: pct(receitaBruta), status: 'real', note: 'vendas nao canceladas (PV, NFC-e e NF-e)' },
      { key: 'descontos', label: '(-) Descontos', value: null, pct: null, status: 'nd', note: 'nao sincronizado' },
      { key: 'devolucoes', label: '(-) Devolucoes', value: null, pct: null, status: 'nd', note: 'nao mapeado' },
      { key: 'receita_liquida', label: '= Receita liquida', value: receitaLiquida, pct: pct(receitaLiquida), status: 'estimate', note: 'igual a bruta (descontos/devolucoes N/D)' },
      { key: 'cmv', label: '(-) CMV', value: cmv, pct: pct(cmv), status: cmvOk ? 'estimate' : 'nd', note: cmvOk ? `custo atual x qtd (${cmvCoverage!.toFixed(0)}% dos itens com custo)` : 'custo de produto nao sincronizado' },
      { key: 'margem_bruta', label: '= Margem bruta', value: margemBruta, pct: pct(margemBruta), status: cmvOk ? 'estimate' : 'nd', note: cmvOk ? null : 'depende do CMV' },
      { key: 'despesas', label: '(-) Despesas', value: despesas, pct: pct(despesas), status: 'estimate', note: despesaNote },
      { key: 'impostos', label: '(-) Impostos', value: null, pct: null, status: 'nd', note: 'nao sincronizado' },
      { key: 'resultado', label: '= Resultado aproximado', value: resultado, pct: pct(resultado), status: 'estimate', note: 'receita - despesas' + (cmvOk ? ' - CMV' : ' (sem CMV, sem impostos)') },
    ];

    const despTotal = despesasFornecedor.reduce((s, g) => s + Number((query.regime === 'caixa' ? g._sum.paidValue : g._sum.value) ?? 0), 0);
    return {
      regime: query.regime,
      lines,
      memo: {
        cancelamentos: { value: Number(cancelled._sum.totalValue ?? 0), count: cancelled._count },
        naoProcessadas: { value: Number(naoProc._sum.totalValue ?? 0), count: naoProc._count },
        naturezas: naturezas.map((g) => ({ natureza: g.natureza, modelo: g.modelo, count: g._count, value: Number(g._sum.totalValue ?? 0) })),
        cmvCoverage,
        receitaPorModelo,
      },
      despesasPorFornecedor: despesasFornecedor.map((g) => {
        const v = Number((query.regime === 'caixa' ? g._sum.paidValue : g._sum.value) ?? 0);
        return { label: g.counterparty ?? '(sem fornecedor)', value: v, percent: despTotal > 0 ? (v / despTotal) * 100 : 0 };
      }),
      payments: payments.map((p) => ({ type: p.paymentType, total: Number(p._sum.value ?? 0), count: p._count })),
      meta,
    };
  }));

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
          ...SALE_OF_RECORD,
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
          ...SALE_OF_RECORD,
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
          ...SALE_OF_RECORD,
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

  // ─── Meta Mensal, Financeiro, Comissão, Caixa, Fechamento, Relatórios (24/08) ──────────
  // 10 paginas resgatadas 23/08 sem backend correspondente — endpoints implementados agora.
  // NOTA (Alertas Estoque / Sugestão Compras): o agente ainda NAO sincroniza produto/estoque
  // do GDOOR (so sales/saleItems/payments/payables/receivables) — Product fica vazio, entao
  // esses 2 endpoints sempre voltam [] ate essa sync existir. idealStock tambem e estimado
  // por velocidade de venda (GDOOR tem QTD_IDEAL real, mas isso nao chega aqui ainda).
  // NOTA (Caixa/Caixa Detalhado): so ha dado de ENTRADA sincronizado (Payment). Nao existe
  // sync de sangria/despesa/saida de caixa — "saida" sempre 0, nao e caixa zerado de verdade.

  const yearMonthFilters = z.object({
    year: z.coerce.number().int(),
    month: z.coerce.number().int().min(1).max(12),
    storeId: z.string().optional(),
  });

  app.get('/api/reports/monthly-goal', { preHandler: [requireAuth, requireCapability('reports.view')] }, async (req) => {
    const query = yearMonthFilters.parse(req.query);
    const storeId = resolveStoreScope(req, query.storeId);
    const from = new Date(Date.UTC(query.year, query.month - 1, 1));
    const to = new Date(Date.UTC(query.year, query.month, 0, 23, 59, 59));

    const [tenant, agg] = await Promise.all([
      prisma.tenant.findUnique({ where: { id: req.user!.tenantId }, select: { meta: true } }),
      prisma.sale.aggregate({
        where: { tenantId: req.user!.tenantId, ...SALE_OF_RECORD, saleDate: { gte: from, lte: to }, ...(storeId ? { storeId } : {}) },
        _sum: { totalValue: true },
        _count: true,
      }),
    ]);

    const goal = Number((tenant?.meta as Record<string, unknown> | undefined)?.monthlyGoal ?? 0);
    const achieved = Number(agg._sum.totalValue ?? 0);
    const totalDays = new Date(Date.UTC(query.year, query.month, 0)).getUTCDate();
    const now = new Date();
    const isCurrentMonth = now.getUTCFullYear() === query.year && now.getUTCMonth() + 1 === query.month;
    const isPastMonth = Date.UTC(query.year, query.month - 1, 1) < Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const elapsedDays = isCurrentMonth ? now.getUTCDate() : isPastMonth ? totalDays : 0;
    const expectedByNow = goal > 0 && totalDays > 0 ? (goal * elapsedDays) / totalDays : 0;

    return {
      year: query.year,
      month: query.month,
      goal,
      achieved,
      remaining: Math.max(0, goal - achieved),
      progressPct: goal > 0 ? (achieved / goal) * 100 : 0,
      pacePct: expectedByNow > 0 ? (achieved / expectedByNow) * 100 : 0,
      sales: agg._count,
      totalDays,
      elapsedDays,
    };
  });

  app.get('/api/reports/financial', { preHandler: [requireAuth, requireCapability('reports.view')] }, cached('financial', async (req) => {
    const query = baseFilters.parse(req.query);
    const { from, to } = defaultPeriod(query.from, query.to);
    const storeId = resolveStoreScope(req, query.storeId);
    const scope = { tenantId: req.user!.tenantId, ...(storeId ? { storeId } : {}) };

    const [salesAgg, paymentGroups, receivablesAgg, receivablesCount, meta] = await Promise.all([
      prisma.sale.aggregate({ where: { ...scope, ...SALE_OF_RECORD, saleDate: { gte: from, lte: to } }, _sum: { totalValue: true }, _count: true }),
      prisma.payment.groupBy({ by: ['paymentType'], where: { ...scope, paymentDate: { gte: from, lte: to } }, _sum: { value: true } }),
      prisma.receivable.aggregate({ where: { ...scope, cancelled: false, dueDate: { gte: from, lte: to } }, _sum: { value: true, receivedValue: true } }),
      prisma.receivable.count({ where: { ...scope, cancelled: false, dueDate: { gte: from, lte: to } } }),
      getFreshnessMeta(req.user!.tenantId, storeId),
    ]);

    const breakdown = { dinheiro: 0, cartao: 0, pix: 0, crediario: 0, outros: 0 };
    // normalizePaymentType (Fase 0, 25/08): o mapa antigo de 4 literais exatos jogava
    // 'CARTãO CRéDITO', 'PAGAMENTO INSTANTâNEO (PIX)' e crediario reais em 'outros'.
    for (const g of paymentGroups) {
      const key = normalizePaymentType(g.paymentType);
      if (!key) continue; // 'SEM PAGAMENTO'
      breakdown[key] += Number(g._sum.value ?? 0);
    }

    return {
      data: {
        revenue: Number(salesAgg._sum.totalValue ?? 0),
        salesCount: salesAgg._count,
        receivablesEstimate: Math.max(0, Number(receivablesAgg._sum.value ?? 0) - Number(receivablesAgg._sum.receivedValue ?? 0)),
        receivablesCount,
        paymentBreakdown: breakdown,
      },
      meta,
    };
  }));

  app.get('/api/reports/commissions', { preHandler: [requireAuth, requireCapability('reports.view')] }, cached('commissions', async (req) => {
    const query = baseFilters.parse(req.query);
    const { from, to } = defaultPeriod(query.from, query.to);
    const storeId = resolveStoreScope(req, query.storeId);

    const [groups, tenant] = await Promise.all([
      prisma.sale.groupBy({
        by: ['operatorName'],
        where: { tenantId: req.user!.tenantId, ...SALE_OF_RECORD, saleDate: { gte: from, lte: to }, ...(storeId ? { storeId } : {}) },
        _sum: { totalValue: true },
        _count: true,
        orderBy: { _sum: { totalValue: 'desc' } },
      }),
      prisma.tenant.findUnique({ where: { id: req.user!.tenantId }, select: { meta: true } }),
    ]);

    const rules = ((tenant?.meta as Record<string, unknown> | undefined)?.commissionRules as Array<{ operator: string; percent: number }> | undefined) ?? [];
    const ruleMap = new Map(rules.map((r) => [r.operator, r.percent]));

    const data = groups.map((g) => {
      const operator = g.operatorName ?? '(sem operador)';
      const faturamento = Number(g._sum.totalValue ?? 0);
      const vendas = g._count;
      const percent = ruleMap.get(operator) ?? 0;
      return { operator, vendas, faturamento, ticketMedio: vendas > 0 ? faturamento / vendas : 0, percent, comissao: faturamento * (percent / 100) };
    });

    const totals = data.reduce((acc, r) => ({ faturamento: acc.faturamento + r.faturamento, comissao: acc.comissao + r.comissao }), { faturamento: 0, comissao: 0 });
    return { data, totals };
  }));

  // Velocidade de venda recente por produto (SaleItem) — usada pra estimar idealStock ate a
  // sync real de produto/estoque existir (ver nota no topo desta secao).
  async function productSalesVelocity(tenantId: string, storeId: string | null, days: number): Promise<Map<string, number>> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const groups = await prisma.saleItem.groupBy({
      by: ['productCode'],
      where: { tenantId, ...(storeId ? { storeId } : {}), sale: { saleDate: { gte: since }, ...SALE_OF_RECORD }, productCode: { not: null } },
      _sum: { quantity: true },
    });
    return new Map(groups.filter((g) => g.productCode).map((g) => [g.productCode as string, Number(g._sum.quantity ?? 0)]));
  }

  app.get('/api/reports/stock-alerts', { preHandler: [requireAuth, requireCapability('reports.view')] }, async (req) => {
    const storeId = resolveStoreScope(req, (req.query as { storeId?: string }).storeId);
    const [products, velocity] = await Promise.all([
      prisma.product.findMany({ where: { tenantId: req.user!.tenantId, ...(storeId ? { storeId } : {}) }, take: 1000 }),
      productSalesVelocity(req.user!.tenantId, storeId, 30),
    ]);

    const data = products
      .map((p) => {
        const stock = p.stock ? Number(p.stock) : 0;
        const soldLast30 = velocity.get(p.sourceCode) ?? 0;
        const idealStock = Math.ceil((soldLast30 / 30) * 15);
        return { p, stock, idealStock };
      })
      .filter(({ stock, idealStock }) => idealStock > 0 && stock <= idealStock)
      .map(({ p, stock, idealStock }) => {
        const falta = idealStock - stock;
        const severity: 'critico' | 'baixo' | 'alerta' = stock <= 0 ? 'critico' : falta > idealStock * 0.5 ? 'baixo' : 'alerta';
        return { sourceCode: p.sourceCode, description: p.description, unit: p.unit, stock, idealStock, salePrice: p.salePrice ? Number(p.salePrice) : null, falta, severity };
      })
      .sort((a, b) => b.falta - a.falta);

    return { data };
  });

  const suggestionFilters = z.object({ days: z.coerce.number().int().min(1).max(180).default(30), cover: z.coerce.number().int().min(1).max(180).default(15), storeId: z.string().optional() });

  app.get('/api/reports/purchase-suggestions', { preHandler: [requireAuth, requireCapability('reports.view')] }, async (req) => {
    const query = suggestionFilters.parse(req.query);
    const storeId = resolveStoreScope(req, query.storeId);
    const [products, velocity] = await Promise.all([
      prisma.product.findMany({ where: { tenantId: req.user!.tenantId, ...(storeId ? { storeId } : {}) }, take: 1000 }),
      productSalesVelocity(req.user!.tenantId, storeId, query.days),
    ]);

    const data = products
      .map((p) => {
        const currentStock = p.stock ? Number(p.stock) : 0;
        const soldQty = velocity.get(p.sourceCode) ?? 0;
        const dailyVelocity = soldQty / query.days;
        const idealStock = Math.ceil(dailyVelocity * query.cover);
        const daysOfCover = dailyVelocity > 0 ? currentStock / dailyVelocity : null;
        const suggestedQty = Math.max(0, Math.ceil(idealStock - currentStock));
        const cost = p.costPrice ? Number(p.costPrice) : null;
        const priority: 'urgente' | 'recomendado' | 'opcional' =
          daysOfCover !== null && daysOfCover < 3 ? 'urgente' : daysOfCover !== null && daysOfCover < query.cover ? 'recomendado' : 'opcional';
        return {
          sourceCode: p.sourceCode, description: p.description, unit: p.unit, currentStock, idealStock, soldQty, dailyVelocity,
          daysOfCover, suggestedQty, cost, estimatedCost: suggestedQty * (cost ?? 0), priority,
        };
      })
      .filter((r) => r.suggestedQty > 0)
      .sort((a, b) => b.estimatedCost - a.estimatedCost);

    return { data };
  });

  app.get('/api/reports/monthly-closing', { preHandler: [requireAuth, requireCapability('reports.view')] }, cached('monthly-closing', async (req) => {
    const query = yearMonthFilters.parse(req.query);
    const storeId = resolveStoreScope(req, query.storeId);
    const from = new Date(Date.UTC(query.year, query.month - 1, 1));
    const to = new Date(Date.UTC(query.year, query.month, 0, 23, 59, 59));

    const [saleRows, paymentRows, meta] = await Promise.all([
      prisma.$queryRaw<{ day: Date; qtd: bigint; canceladas: bigint; total: unknown }[]>(
        storeId
          ? Prisma.sql`SELECT date_trunc('day', "saleDate") AS day, COUNT(*) FILTER (WHERE "cancelled" = false AND ("modelo" IS NULL OR "modelo" <> '65')) AS qtd,
                COUNT(*) FILTER (WHERE "cancelled" = true) AS canceladas, COALESCE(SUM("totalValue") FILTER (WHERE "cancelled" = false AND ("modelo" IS NULL OR "modelo" <> '65')), 0) AS total
              FROM sales WHERE "tenantId" = ${req.user!.tenantId} AND "storeId" = ${storeId} AND "saleDate" >= ${from} AND "saleDate" <= ${to} GROUP BY 1`
          : Prisma.sql`SELECT date_trunc('day', "saleDate") AS day, COUNT(*) FILTER (WHERE "cancelled" = false AND ("modelo" IS NULL OR "modelo" <> '65')) AS qtd,
                COUNT(*) FILTER (WHERE "cancelled" = true) AS canceladas, COALESCE(SUM("totalValue") FILTER (WHERE "cancelled" = false AND ("modelo" IS NULL OR "modelo" <> '65')), 0) AS total
              FROM sales WHERE "tenantId" = ${req.user!.tenantId} AND "saleDate" >= ${from} AND "saleDate" <= ${to} GROUP BY 1`,
      ),
      prisma.$queryRaw<{ day: Date; paymentType: string; total: unknown }[]>(
        storeId
          ? Prisma.sql`SELECT date_trunc('day', "paymentDate") AS day, "paymentType", SUM("value") AS total
              FROM payments WHERE "tenantId" = ${req.user!.tenantId} AND "storeId" = ${storeId} AND "paymentDate" >= ${from} AND "paymentDate" <= ${to} GROUP BY 1, 2`
          : Prisma.sql`SELECT date_trunc('day', "paymentDate") AS day, "paymentType", SUM("value") AS total
              FROM payments WHERE "tenantId" = ${req.user!.tenantId} AND "paymentDate" >= ${from} AND "paymentDate" <= ${to} GROUP BY 1, 2`,
      ),
      getFreshnessMeta(req.user!.tenantId, storeId),
    ]);

    type DayRow = { dia: string; qtd: number; canceladas: number; total: number; ticket: number; dinheiro: number; cartao: number; pix: number; crediario: number; outros: number };
    const dayKey = (d: Date) => d.toISOString().slice(0, 10);
    const dayMap = new Map<string, DayRow>();
    const emptyDay = (dia: string): DayRow => ({ dia, qtd: 0, canceladas: 0, total: 0, ticket: 0, dinheiro: 0, cartao: 0, pix: 0, crediario: 0, outros: 0 });

    for (const r of saleRows) {
      const key = dayKey(r.day);
      const qtd = Number(r.qtd);
      const total = Number(r.total);
      dayMap.set(key, { ...emptyDay(key), qtd, canceladas: Number(r.canceladas), total, ticket: qtd > 0 ? total / qtd : 0 });
    }
    for (const r of paymentRows) {
      const key = dayKey(r.day);
      if (!dayMap.has(key)) dayMap.set(key, emptyDay(key));
      const row = dayMap.get(key)!;
      const field: keyof DayRow = normalizePaymentType(r.paymentType) ?? 'outros';
      (row[field] as number) += Number(r.total);
    }

    const data = [...dayMap.values()].sort((a, b) => a.dia.localeCompare(b.dia));
    const totals = data.reduce<DayRow>(
      (acc, d) => ({
        dia: 'total', qtd: acc.qtd + d.qtd, canceladas: acc.canceladas + d.canceladas, total: acc.total + d.total, ticket: 0,
        dinheiro: acc.dinheiro + d.dinheiro, cartao: acc.cartao + d.cartao, pix: acc.pix + d.pix, crediario: acc.crediario + d.crediario, outros: acc.outros + d.outros,
      }),
      emptyDay('total'),
    );
    totals.ticket = totals.qtd > 0 ? totals.total / totals.qtd : 0;

    return { period: { year: query.year, month: query.month }, data, totals, meta };
  }));

  app.get('/api/reports/cash-movements', { preHandler: [requireAuth, requireCapability('reports.view')] }, cached('cash-movements', async (req) => {
    const query = listPageFilters.parse(req.query);
    const { from, to } = defaultPeriod(query.from, query.to);
    const storeId = resolveStoreScope(req, query.storeId);
    const where = { tenantId: req.user!.tenantId, paymentDate: { gte: from, lte: to }, ...(storeId ? { storeId } : {}) };

    const [rows, total, agg] = await Promise.all([
      prisma.payment.findMany({ where, orderBy: { paymentDate: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      prisma.payment.count({ where }),
      prisma.payment.aggregate({ where, _sum: { value: true } }),
    ]);

    const entrada = Number(agg._sum.value ?? 0);
    return {
      data: rows.map((r) => ({
        id: r.id,
        sourceId: r.sourceId,
        movementDate: r.paymentDate,
        entrada: Number(r.value),
        saida: 0,
        historico: r.paymentType,
      })),
      pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) },
      summary: { entrada, saida: 0, saldo: entrada },
    };
  }));

  app.get('/api/reports/cash-detailed', { preHandler: [requireAuth, requireCapability('reports.view')] }, cached('cash-detailed', async (req) => {
    const query = baseFilters.parse(req.query);
    const { from, to } = defaultPeriod(query.from, query.to);
    const storeId = resolveStoreScope(req, query.storeId);

    // D16 (25/08): passa a usar buildCashflow — saidas deixam de ser 0 hardcoded (viram contas
    // a pagar baixadas) e crediario sai das entradas de venda (P1). MUDA os numeros que a tela
    // Caixa Detalhado ja mostrava; release note obrigatoria.
    const cf = await buildCashflow(req.user!.tenantId, storeId, from, to, 'day');
    const data = cf.data.map((r) => ({ dia: r.dia, entradas: r.entradas, saidas: r.saidas, movimentos: r.movimentos, saldoDia: r.saldoDia, saldoAcumulado: r.saldoAcumulado }));
    return { data, totals: { entradas: cf.totals.entradas, saidas: cf.totals.saidas, saldoFinal: cf.totals.variacao }, quality: cf.quality };
  }));

  // ─── Fluxo de Caixa (D16, 25/08) ───────────────────────────────────────────
  const cashflowFilters = baseFilters.extend({ granularity: z.enum(['day', 'week', 'month']).optional() });

  app.get('/api/reports/cashflow', { preHandler: [requireAuth, requireCapability('reports.view')] }, cached('cashflow', async (req) => {
    const query = cashflowFilters.parse(req.query);
    const { from, to } = defaultPeriod(query.from, query.to);
    const storeId = resolveStoreScope(req, query.storeId);
    const granularity: Granularity = pickGranularity(from, to, query.granularity);
    const [cf, meta] = await Promise.all([buildCashflow(req.user!.tenantId, storeId, from, to, granularity), getFreshnessMeta(req.user!.tenantId, storeId)]);
    return { data: cf.data, totals: cf.totals, quality: cf.quality, meta: { ...meta, granularity, from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) } };
  }));

  // Drill-down de UM dia: cada entrada/saida individual (toque no card do dia na tela).
  app.get('/api/reports/cashflow/day', { preHandler: [requireAuth, requireCapability('reports.view')] }, async (req) => {
    const query = z.object({ date: z.string().date(), storeId: z.string().optional() }).parse(req.query);
    const storeId = resolveStoreScope(req, query.storeId);
    const from = new Date(query.date + 'T00:00:00Z');
    const to = new Date(query.date + 'T23:59:59Z');
    const scope = { tenantId: req.user!.tenantId, ...(storeId ? { storeId } : {}) };

    const [pays, recs, payables, meta] = await Promise.all([
      prisma.payment.findMany({ where: { ...scope, paymentDate: { gte: from, lte: to }, OR: [{ saleId: null }, { sale: { cancelled: false } }] }, select: { saleId: true, paymentType: true, value: true }, take: 200 }),
      prisma.receivable.findMany({ where: { ...scope, cancelled: false, receivedValue: { gt: 0 }, receivedDate: { gte: from, lte: to } }, select: { counterparty: true, description: true, receivedValue: true }, take: 200 }),
      prisma.payable.findMany({ where: { ...scope, cancelled: false, paidValue: { gt: 0 }, paidDate: { gte: from, lte: to } }, select: { counterparty: true, description: true, paidValue: true }, take: 200 }),
      getFreshnessMeta(req.user!.tenantId, storeId),
    ]);

    const entradas = [
      // P1: crediario nao entra como pagamento de venda — entra pela baixa do titulo (abaixo)
      ...pays.map((p) => ({ tipo: 'payment' as const, forma: normalizePaymentType(p.paymentType) ?? 'outros', saleId: p.saleId, value: Number(p.value) })).filter((p) => p.forma !== 'crediario'),
      ...recs.map((r) => ({ tipo: 'receivable' as const, counterparty: r.counterparty, description: r.description, value: Number(r.receivedValue) })),
    ];
    const saidas = payables.map((p) => ({ counterparty: p.counterparty, description: p.description, value: Number(p.paidValue) }));
    return { date: query.date, entradas, saidas, totals: { entradas: entradas.reduce((s, e) => s + e.value, 0), saidas: saidas.reduce((s, e) => s + e.value, 0) }, meta };
  });

  app.get('/api/reports/cashflow-forecast', { preHandler: [requireAuth, requireCapability('reports.view')] }, cached('cashflow-forecast', async (req) => {
    const query = z.object({ days: z.coerce.number().int().refine((d) => [7, 15, 30, 60, 90].includes(d)).default(30), storeId: z.string().optional() }).parse(req.query);
    const storeId = resolveStoreScope(req, query.storeId);
    const [fc, meta] = await Promise.all([buildForecast(req.user!.tenantId, storeId, query.days), getFreshnessMeta(req.user!.tenantId, storeId)]);
    return { ...fc, meta };
  }));

  app.get('/api/reports/sales-comparison', { preHandler: [requireAuth, requireCapability('reports.view')] }, cached('sales-comparison', async (req) => {
    const query = baseFilters.parse(req.query);
    const { from, to } = defaultPeriod(query.from, query.to);
    const storeId = resolveStoreScope(req, query.storeId);
    const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1);
    const prevTo = new Date(from.getTime() - 1);
    const prevFrom = new Date(prevTo.getTime() - (days - 1) * 86_400_000);
    const scopedWhere = (f: Date, t: Date) => ({ tenantId: req.user!.tenantId, ...SALE_OF_RECORD, saleDate: { gte: f, lte: t }, ...(storeId ? { storeId } : {}) });

    const [curAgg, prevAgg] = await Promise.all([
      prisma.sale.aggregate({ where: scopedWhere(from, to), _sum: { totalValue: true }, _count: true }),
      prisma.sale.aggregate({ where: scopedWhere(prevFrom, prevTo), _sum: { totalValue: true }, _count: true }),
    ]);

    const build = (f: Date, t: Date, agg: typeof curAgg) => ({
      from: f.toISOString().slice(0, 10),
      to: t.toISOString().slice(0, 10),
      sales: agg._count,
      revenue: Number(agg._sum.totalValue ?? 0),
      ticket: agg._count > 0 ? Number(agg._sum.totalValue ?? 0) / agg._count : 0,
    });
    const cur = build(from, to, curAgg);
    const prev = build(prevFrom, prevTo, prevAgg);
    const pct = (c: number, p: number) => (p > 0 ? ((c - p) / p) * 100 : c > 0 ? 100 : 0);

    return { current: cur, previous: prev, growth: { sales: pct(cur.sales, prev.sales), revenue: pct(cur.revenue, prev.revenue), ticket: pct(cur.ticket, prev.ticket) } };
  }));

  app.get('/api/reports/sales-by-weekday', { preHandler: [requireAuth, requireCapability('reports.view')] }, cached('sales-by-weekday', async (req) => {
    const query = baseFilters.parse(req.query);
    const { from, to } = defaultPeriod(query.from, query.to);
    const storeId = resolveStoreScope(req, query.storeId);

    const rows = await prisma.$queryRaw<{ dow: number; total: unknown; qtd: bigint }[]>(
      storeId
        ? Prisma.sql`SELECT EXTRACT(DOW FROM "saleDate")::int AS dow, SUM("totalValue") AS total, COUNT(*) AS qtd
            FROM sales WHERE "tenantId" = ${req.user!.tenantId} AND "storeId" = ${storeId} AND "cancelled" = false AND ("modelo" IS NULL OR "modelo" <> '65') AND "saleDate" >= ${from} AND "saleDate" <= ${to} GROUP BY 1`
        : Prisma.sql`SELECT EXTRACT(DOW FROM "saleDate")::int AS dow, SUM("totalValue") AS total, COUNT(*) AS qtd
            FROM sales WHERE "tenantId" = ${req.user!.tenantId} AND "cancelled" = false AND ("modelo" IS NULL OR "modelo" <> '65') AND "saleDate" >= ${from} AND "saleDate" <= ${to} GROUP BY 1`,
    );

    // Conta quantos de cada dia-da-semana existem no periodo (independente de ter venda),
    // pra tirar media por dia de verdade — nao so media sobre dias com venda.
    const diasPorDow = [0, 0, 0, 0, 0, 0, 0];
    for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 86_400_000)) {
      diasPorDow[d.getUTCDay()]!++;
    }

    const LABELS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const byDow = new Map(rows.map((r) => [r.dow, r]));
    const data = LABELS.map((label, dia) => {
      const r = byDow.get(dia);
      const totalQtd = r ? Number(r.qtd) : 0;
      const totalRevenue = r ? Number(r.total) : 0;
      const diasObservados = diasPorDow[dia]!;
      return { dia, label, diasObservados, totalQtd, totalRevenue, mediaQtdPorDia: diasObservados > 0 ? totalQtd / diasObservados : 0, mediaRevenuePorDia: diasObservados > 0 ? totalRevenue / diasObservados : 0 };
    });

    return { data };
  }));

  app.get('/api/reports/product-margin', { preHandler: [requireAuth, requireCapability('reports.view')] }, cached('product-margin', async (req) => {
    const query = z.object({ from: z.string().date().optional(), to: z.string().date().optional(), storeId: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
    const { from, to } = defaultPeriod(query.from, query.to);
    const storeId = resolveStoreScope(req, query.storeId);

    const items = await prisma.saleItem.groupBy({
      by: ['productCode', 'description'],
      where: { tenantId: req.user!.tenantId, sale: { saleDate: { gte: from, lte: to }, ...SALE_OF_RECORD }, ...(storeId ? { storeId } : {}) },
      _sum: { totalValue: true, quantity: true },
      orderBy: { _sum: { totalValue: 'desc' } },
      take: query.limit,
    });

    const codes = items.map((i) => i.productCode).filter((c): c is string => !!c);
    const products = codes.length
      ? await prisma.product.findMany({ where: { tenantId: req.user!.tenantId, sourceCode: { in: codes } }, select: { sourceCode: true, costPrice: true } })
      : [];
    const costByCode = new Map(products.map((p) => [p.sourceCode, p.costPrice ? Number(p.costPrice) : null]));

    const data = items.map((i) => {
      const receita = Number(i._sum.totalValue ?? 0);
      const qtd = Number(i._sum.quantity ?? 0);
      const cost = i.productCode ? costByCode.get(i.productCode) : null;
      const custoTotal = cost != null ? cost * qtd : 0;
      const margem = receita - custoTotal;
      return { productCode: i.productCode, description: i.description, qtdVendida: qtd, receita, custoTotal, margem, margemPct: receita > 0 ? (margem / receita) * 100 : 0 };
    });

    return { data };
  }));

  app.get('/api/reports/dashboard/top-operators', { preHandler: [requireAuth, requireCapability('reports.view')] }, cached('top-operators', async (req) => {
    const query = z.object({ from: z.string().date().optional(), to: z.string().date().optional(), storeId: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
    const { from, to } = defaultPeriod(query.from, query.to);
    const storeId = resolveStoreScope(req, query.storeId);

    const groups = await prisma.sale.groupBy({
      by: ['operatorName'],
      where: { tenantId: req.user!.tenantId, ...SALE_OF_RECORD, saleDate: { gte: from, lte: to }, ...(storeId ? { storeId } : {}) },
      _sum: { totalValue: true },
      _count: true,
      orderBy: { _sum: { totalValue: 'desc' } },
      take: query.limit,
    });

    return { data: groups.map((g) => ({ operator: g.operatorName, qtd: g._count, value: Number(g._sum.totalValue ?? 0) })) };
  }));

  // ─── Dashboard novo (26/08): totais do dia, pico por hora, ranking por VENDEDOR ──────────

  // Totais do "dia" (default = mes atual dia 1..hoje; aceita from/to). Numeros que o dono pediu:
  // vendido (Sale), recebido em caixa (fluxo realizado), a receber baixado, contas pagas.
  app.get('/api/reports/dashboard/today', { preHandler: [requireAuth, requireCapability('reports.view')] }, cached('dash-today', async (req) => {
    const query = baseFilters.parse(req.query);
    const { from, to } = defaultPeriod(query.from, query.to);
    const storeId = resolveStoreScope(req, query.storeId);
    const scope = { tenantId: req.user!.tenantId, ...(storeId ? { storeId } : {}) };

    // P4: NFC-e com pagamento proprio = venda direta sem passar pelo PV (anomalia que o dono
    // quer ver, nao esconder). Entra na receita (tem pagamento) e aparece como alerta.
    const nfceSemPvQ = prisma.$queryRaw<{ n: bigint; total: unknown }[]>(Prisma.sql`
      SELECT COUNT(DISTINCT s.id) AS n, COALESCE(SUM(DISTINCT s."totalValue"), 0) AS total
      FROM sales s JOIN payments p ON p."saleId" = s.id
      WHERE s."tenantId" = ${req.user!.tenantId} ${storeId ? Prisma.sql`AND s."storeId" = ${storeId}` : Prisma.empty}
        AND s."modelo" = '65' AND s."cancelled" = false AND s."saleDate" >= ${from} AND s."saleDate" <= ${to}`);
    // Cards da onda 1 (26/08, copiados do Gdoor Relatorios antigo): hoje x ontem sao dias de
    // CALENDARIO (nao dependem do filtro), dias trabalhados = dias distintos com venda no periodo.
    const hojeIni = new Date(); hojeIni.setUTCHours(0, 0, 0, 0);
    const ontemIni = new Date(hojeIni.getTime() - 86_400_000);
    const ontemFim = new Date(hojeIni.getTime() - 1);
    const [vendas, recebidoAgg, contasReceber, contasPagar, meta, nfceSemPv, vHoje, vOntem, diasDistintos, conferencia] = await Promise.all([
      prisma.sale.aggregate({ where: { ...scope, ...SALE_OF_RECORD, saleDate: { gte: from, lte: to } }, _sum: { totalValue: true }, _count: true }),
      // recebido de verdade em caixa no periodo = fluxo realizado (entradas), reaproveita buildCashflow
      buildCashflow(req.user!.tenantId, storeId, from, to, 'day'),
      prisma.receivable.aggregate({ where: { ...scope, cancelled: false, receivedValue: { gt: 0 }, receivedDate: { gte: from, lte: to } }, _sum: { receivedValue: true }, _count: true }),
      prisma.payable.aggregate({ where: { ...scope, cancelled: false, paidValue: { gt: 0 }, paidDate: { gte: from, lte: to } }, _sum: { paidValue: true }, _count: true }),
      getFreshnessMeta(req.user!.tenantId, storeId),
      nfceSemPvQ,
      prisma.sale.aggregate({ where: { ...scope, ...SALE_OF_RECORD, saleDate: { gte: hojeIni } }, _sum: { totalValue: true }, _count: true }),
      prisma.sale.aggregate({ where: { ...scope, ...SALE_OF_RECORD, saleDate: { gte: ontemIni, lte: ontemFim } }, _sum: { totalValue: true }, _count: true }),
      prisma.sale.findMany({ where: { ...scope, ...SALE_OF_RECORD, saleDate: { gte: from, lte: to } }, distinct: ['saleDate'], select: { saleDate: true } }),
      buildCashConference(req.user!.tenantId, storeId, from, to),
    ]);
    const nfceDireta = { count: Number(nfceSemPv[0]?.n ?? 0), total: Number(nfceSemPv[0]?.total ?? 0) };
    const hoje = { total: Number(vHoje._sum.totalValue ?? 0), count: vHoje._count };
    const ontem = { total: Number(vOntem._sum.totalValue ?? 0), count: vOntem._count };
    // variacao ja calculada (card entrega a conta pronta, como no relatorio antigo); null = sem base
    const variacaoPct = ontem.total > 0 ? ((hoje.total - ontem.total) / ontem.total) * 100 : null;
    const diasTrabalhados = diasDistintos.length;
    const totalPeriodo = Number(vendas._sum.totalValue ?? 0) + nfceDireta.total;

    return {
      periodo: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
      // vendido = PV + NF-e (SALE_OF_RECORD) + NFC-e diretas (tem pagamento proprio, nao vieram de PV)
      vendido: { total: Number(vendas._sum.totalValue ?? 0) + nfceDireta.total, count: vendas._count + nfceDireta.count },
      nfceSemPv: nfceDireta,
      recebidoCaixa: { total: recebidoAgg.totals.entradas },
      contasRecebidas: { total: Number(contasReceber._sum.receivedValue ?? 0), count: contasReceber._count },
      contasPagas: { total: Number(contasPagar._sum.paidValue ?? 0), count: contasPagar._count },
      hojeOntem: { hoje, ontem, variacaoPct },
      // faturamento do mes sozinho engana quando teve feriado — media por dia trabalhado corrige
      diasTrabalhados,
      mediaDiaria: diasTrabalhados > 0 ? totalPeriodo / diasTrabalhados : 0,
      // saldo CONTABIL (recebidoCaixa, registrado no expediente) x FISICO (contado no fechamento)
      caixaFisico: { ...conferencia.totals, fechamentos: conferencia.closings.length, comQuebra: conferencia.fechamentosComQuebra },
      quality: recebidoAgg.quality,
      meta,
    };
  }));

  // Horario de pico: vendas por hora do dia (0-23) nos ultimos N dias. Usa saleHour
  // (VENDAS.HORA_SAIDA) — so tem valor pra venda sincronizada apos 26/08; agente antigo = null.
  app.get('/api/reports/dashboard/peak-hours', { preHandler: [requireAuth, requireCapability('reports.view')] }, cached('peak-hours', async (req) => {
    const query = z.object({ days: z.coerce.number().int().min(1).max(90).default(7), storeId: z.string().optional() }).parse(req.query);
    const storeId = resolveStoreScope(req, query.storeId);
    const since = new Date(Date.now() - query.days * 86_400_000);

    const rows = await prisma.$queryRaw<{ h: number; qtd: bigint; total: unknown }[]>(
      storeId
        ? Prisma.sql`SELECT "saleHour" AS h, COUNT(*) AS qtd, SUM("totalValue") AS total FROM sales
            WHERE "tenantId" = ${req.user!.tenantId} AND "storeId" = ${storeId} AND "cancelled" = false AND ("modelo" IS NULL OR "modelo" <> '65') AND "saleHour" IS NOT NULL AND "saleDate" >= ${since} GROUP BY 1`
        : Prisma.sql`SELECT "saleHour" AS h, COUNT(*) AS qtd, SUM("totalValue") AS total FROM sales
            WHERE "tenantId" = ${req.user!.tenantId} AND "cancelled" = false AND ("modelo" IS NULL OR "modelo" <> '65') AND "saleHour" IS NOT NULL AND "saleDate" >= ${since} GROUP BY 1`,
    );
    const byHour = new Map(rows.map((r) => [Number(r.h), r]));
    // preenche 0-23 (horas sem venda viram 0) pro grafico ter o dia inteiro; corta as pontas
    // vazias no front. cobertura = quantas vendas tem hora (agente novo) vs total.
    const data = Array.from({ length: 24 }, (_, h) => {
      const r = byHour.get(h);
      return { hora: h, qtd: r ? Number(r.qtd) : 0, total: r ? Number(r.total) : 0 };
    });
    const comHora = data.reduce((s, d) => s + d.qtd, 0);
    const pico = data.reduce((best, d) => (d.qtd > best.qtd ? d : best), data[0]!);
    return { data, dias: query.days, picoHora: comHora > 0 ? pico.hora : null, semDado: comHora === 0 };
  }));

  // Ranking por VENDEDOR (sellerName, != operador de caixa) — pedido do dono 25/08. 26/08:
  // agrupa por UPPER(TRIM()) (texto livre no GDOOR — variacao de digitacao duplicava linha),
  // ordena por VALOR (nunca por qtd), ticket medio e variacao vs periodo anterior de mesmo tamanho.
  app.get('/api/reports/dashboard/seller-ranking', { preHandler: [requireAuth, requireCapability('reports.view')] }, cached('seller-ranking', async (req) => {
    const query = z.object({ from: z.string().date().optional(), to: z.string().date().optional(), storeId: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(20) }).parse(req.query);
    const { from, to } = defaultPeriod(query.from, query.to);
    const storeId = resolveStoreScope(req, query.storeId);
    const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1);
    const prevTo = new Date(from.getTime() - 1);
    const prevFrom = new Date(prevTo.getTime() - (days - 1) * 86_400_000);
    const scopeSql = storeId ? Prisma.sql`AND "storeId" = ${storeId}` : Prisma.empty;

    const rows = await prisma.$queryRaw<{ seller: string; vendas: bigint; total: unknown; total_ant: unknown; total_geral: unknown }[]>(Prisma.sql`
      WITH base AS (
        SELECT UPPER(TRIM("sellerName")) AS seller,
               COUNT(*) FILTER (WHERE "saleDate" >= ${from}) AS vendas,
               COALESCE(SUM("totalValue") FILTER (WHERE "saleDate" >= ${from}), 0) AS total,
               COALESCE(SUM("totalValue") FILTER (WHERE "saleDate" < ${from}), 0) AS total_ant
        FROM sales
        WHERE "tenantId" = ${req.user!.tenantId} ${scopeSql}
          AND "cancelled" = false AND ("modelo" IS NULL OR "modelo" <> '65')
          AND "sellerName" IS NOT NULL AND TRIM("sellerName") <> ''
          AND "saleDate" >= ${prevFrom} AND "saleDate" <= ${to}
        GROUP BY 1
      )
      SELECT seller, vendas, total, total_ant, SUM(total) OVER () AS total_geral
      FROM base WHERE vendas > 0 OR total_ant > 0
      ORDER BY total DESC LIMIT ${query.limit}`);
    const totalPeriodo = await prisma.sale.aggregate({ where: { tenantId: req.user!.tenantId, ...SALE_OF_RECORD, saleDate: { gte: from, lte: to }, ...(storeId ? { storeId } : {}) }, _sum: { totalValue: true } });
    const grand = Number(rows[0]?.total_geral ?? 0);
    const totalGeral = Number(totalPeriodo._sum.totalValue ?? 0);
    return {
      data: rows.map((r) => {
        const total = Number(r.total), ant = Number(r.total_ant), vendas = Number(r.vendas);
        return { seller: r.seller, vendas, total, totalAnterior: ant, ticket: vendas > 0 ? total / vendas : 0, pct: grand > 0 ? total / grand : 0, variacaoPct: ant > 0 ? ((total - ant) / ant) * 100 : null };
      }),
      cobertura: totalGeral > 0 ? grand / totalGeral : 0,
      periodoAnterior: { from: prevFrom.toISOString().slice(0, 10), to: prevTo.toISOString().slice(0, 10) },
    };
  }));

  // Posicao financeira (doc do dono, Parte 3): aging de receber/pagar, realizado no mes,
  // maiores devedores, % fiado e saldo projetado ate o fim do mes.
  app.get('/api/reports/dashboard/financial-position', { preHandler: [requireAuth, requireCapability('reports.view')] }, cached('financial-position', async (req) => {
    const query = baseFilters.parse(req.query);
    const { from, to } = defaultPeriod(query.from, query.to);
    const storeId = resolveStoreScope(req, query.storeId);
    const tenantId = req.user!.tenantId;
    const scope = { tenantId, ...(storeId ? { storeId } : {}) };
    const hoje = new Date(); hoje.setUTCHours(0, 0, 0, 0);
    const fimMes = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + 1, 0, 23, 59, 59));
    const diasAteFim = Math.max(1, Math.ceil((fimMes.getTime() - hoje.getTime()) / 86_400_000));
    const scopeSql = (a: string) => storeId ? Prisma.sql`AND ${Prisma.raw(a)}."storeId" = ${storeId}` : Prisma.empty;
    const agingSql = (table: 'receivables' | 'payables', settled: 'receivedValue' | 'paidValue') => Prisma.sql`
      SELECT CASE WHEN "dueDate" >= ${hoje} THEN 'a_vencer'
                  WHEN ${hoje}::date - "dueDate"::date <= 30 THEN 'ate_30'
                  WHEN ${hoje}::date - "dueDate"::date <= 60 THEN '31_60' ELSE 'acima_60' END AS faixa,
             COUNT(*) AS qtd, COALESCE(SUM("value" - ${Prisma.raw(`"${settled}"`)}), 0) AS valor,
             COALESCE(SUM("value" - ${Prisma.raw(`"${settled}"`)}) FILTER (WHERE "dueDate" >= ${hoje} AND "dueDate" <= ${fimMes}), 0) AS a_vencer_mes
      FROM ${Prisma.raw(table)} t
      WHERE t."tenantId" = ${tenantId} ${scopeSql('t')} AND t."cancelled" = false AND t."value" > ${Prisma.raw(`t."${settled}"`)}
      GROUP BY 1`;
    type AgingRow = { faixa: string; qtd: bigint; valor: unknown; a_vencer_mes: unknown };
    const [agR, agP, recMes, pagMes, inad, payGroups, forecast, meta] = await Promise.all([
      prisma.$queryRaw<AgingRow[]>(agingSql('receivables', 'receivedValue')),
      prisma.$queryRaw<AgingRow[]>(agingSql('payables', 'paidValue')),
      prisma.receivable.aggregate({ where: { ...scope, cancelled: false, receivedValue: { gt: 0 }, receivedDate: { gte: from, lte: to } }, _sum: { receivedValue: true }, _count: true }),
      prisma.payable.aggregate({ where: { ...scope, cancelled: false, paidValue: { gt: 0 }, paidDate: { gte: from, lte: to } }, _sum: { paidValue: true }, _count: true }),
      prisma.$queryRaw<{ nome: string | null; titulos: bigint; saldo: unknown; dias: number; ultimo: Date }[]>(Prisma.sql`
        SELECT COALESCE(NULLIF(TRIM("counterparty"), ''), '(sem nome)') AS nome, COUNT(*) AS titulos,
               COALESCE(SUM("value" - "receivedValue"), 0) AS saldo,
               (${hoje}::date - MIN("dueDate")::date) AS dias, MAX("dueDate") AS ultimo
        FROM receivables r WHERE r."tenantId" = ${tenantId} ${scopeSql('r')} AND r."cancelled" = false
          AND r."value" > r."receivedValue" AND r."dueDate" < ${hoje}
        GROUP BY 1 ORDER BY saldo DESC LIMIT 20`),
      prisma.payment.groupBy({ by: ['paymentType'], where: { ...scope, paymentDate: { gte: from, lte: to }, OR: [{ kind: null }, { kind: { in: ['venda', 'recebimento'] } }] }, _sum: { value: true } }),
      buildForecast(tenantId, storeId, diasAteFim),
      getFreshnessMeta(tenantId, storeId),
    ]);
    const side = (rows: AgingRow[], realizado: { qtd: number; valor: number }) => {
      const faixas = ['a_vencer', 'ate_30', '31_60', 'acima_60'] as const;
      const aging = faixas.map((f) => { const r = rows.find((x) => x.faixa === f); return { faixa: f, qtd: r ? Number(r.qtd) : 0, valor: r ? Number(r.valor) : 0 }; });
      return { realizadoMes: realizado, aVencerMes: rows.reduce((s, r) => s + Number(r.a_vencer_mes), 0), aging, atrasadoTotal: aging.filter((a) => a.faixa !== 'a_vencer').reduce((s, a) => s + a.valor, 0) };
    };
    const totalPag = payGroups.reduce((s, g) => s + Number(g._sum.value ?? 0), 0);
    const fiadoValor = payGroups.filter((g) => normalizePaymentType(g.paymentType) === 'crediario').reduce((s, g) => s + Number(g._sum.value ?? 0), 0);
    return {
      receber: side(agR, { qtd: recMes._count, valor: Number(recMes._sum.receivedValue ?? 0) }),
      pagar: side(agP, { qtd: pagMes._count, valor: Number(pagMes._sum.paidValue ?? 0) }),
      inadimplentes: inad.map((i) => ({ nome: i.nome ?? '(sem nome)', titulos: Number(i.titulos), saldo: Number(i.saldo), diasAtrasoMaior: Number(i.dias), ultimoVencimento: i.ultimo.toISOString().slice(0, 10) })),
      fiado: { valor: fiadoValor, pct: totalPag > 0 ? (fiadoValor / totalPag) * 100 : 0, totalPagamentos: totalPag },
      saldoProjetado: { ...forecast.totals, ate: fimMes.toISOString().slice(0, 10) },
      meta,
    };
  }));

  // Inadimplencia por FAIXA DE TEMPO vencido (pedido do dono 26/08: "quem deve e nao paga ha
  // muito tempo"). Diferente do aging de financial-position (que para em "acima de 60 dias"):
  // aqui as faixas sao mes atual / 3 / 6 meses / 1 ano / +1 ano, NAO sobrepostas, e o ranking
  // e por TEMPO de atraso (nao por valor) - o objetivo e achar o caloteiro antigo, nao o maior.
  app.get('/api/reports/dashboard/inadimplencia', { preHandler: [requireAuth, requireCapability('reports.view')] }, cached('inadimplencia', async (req) => {
    const query = baseFilters.parse(req.query);
    const storeId = resolveStoreScope(req, query.storeId);
    const tenantId = req.user!.tenantId;
    const hoje = new Date(); hoje.setUTCHours(0, 0, 0, 0);
    const scopeSql = storeId ? Prisma.sql`AND r."storeId" = ${storeId}` : Prisma.empty;
    // so titulo VENCIDO e ainda em aberto (value > recebido, dueDate < hoje)
    const whereVencido = Prisma.sql`r."tenantId" = ${tenantId} ${scopeSql} AND r."cancelled" = false AND r."value" > r."receivedValue" AND r."dueDate" < ${hoje}`;
    const [faixasRows, piores, meta] = await Promise.all([
      prisma.$queryRaw<{ faixa: string; titulos: bigint; devedores: bigint; valor: unknown }[]>(Prisma.sql`
        SELECT CASE
                 WHEN ${hoje}::date - r."dueDate"::date <= 30  THEN 'mes'
                 WHEN ${hoje}::date - r."dueDate"::date <= 90  THEN 'tri'
                 WHEN ${hoje}::date - r."dueDate"::date <= 180 THEN 'sem'
                 WHEN ${hoje}::date - r."dueDate"::date <= 365 THEN 'ano'
                 ELSE 'mais1ano' END AS faixa,
               COUNT(*) AS titulos,
               COUNT(DISTINCT COALESCE(NULLIF(TRIM(r."counterparty"), ''), '(sem nome)')) AS devedores,
               COALESCE(SUM(r."value" - r."receivedValue"), 0) AS valor
        FROM receivables r WHERE ${whereVencido} GROUP BY 1`),
      // ranking por TEMPO de atraso: MIN(dueDate) = titulo mais antigo do devedor
      prisma.$queryRaw<{ nome: string | null; titulos: bigint; saldo: unknown; dias: number; desde: Date }[]>(Prisma.sql`
        SELECT COALESCE(NULLIF(TRIM(r."counterparty"), ''), '(sem nome)') AS nome,
               COUNT(*) AS titulos, COALESCE(SUM(r."value" - r."receivedValue"), 0) AS saldo,
               (${hoje}::date - MIN(r."dueDate")::date) AS dias, MIN(r."dueDate") AS desde
        FROM receivables r WHERE ${whereVencido}
        GROUP BY 1 ORDER BY dias DESC, saldo DESC LIMIT 25`),
      getFreshnessMeta(tenantId, storeId),
    ]);
    const ORDEM = ['mes', 'tri', 'sem', 'ano', 'mais1ano'] as const;
    const faixas = ORDEM.map((f) => {
      const r = faixasRows.find((x) => x.faixa === f);
      return { faixa: f, titulos: r ? Number(r.titulos) : 0, devedores: r ? Number(r.devedores) : 0, valor: r ? Number(r.valor) : 0 };
    });
    const total = faixas.reduce((a, f) => ({ titulos: a.titulos + f.titulos, valor: a.valor + f.valor }), { titulos: 0, valor: 0 });
    return {
      faixas,
      total,
      piores: piores.map((p) => ({ nome: p.nome ?? '(sem nome)', titulos: Number(p.titulos), saldo: Number(p.saldo), diasAtraso: Number(p.dias), vencimentoMaisAntigo: p.desde.toISOString().slice(0, 10) })),
      meta,
    };
  }));

  // ─── Conferencia de Caixa (D20, 26/08) ─────────────────────────────────────────────
  // ESPERADO = registrado no expediente (payments kind venda/recebimento do PDV + fundo de
  // troco + suprimento - sangria). CONTADO = FECHAMENTO_CAIXA_ESPECIES (operador). QUEBRA =
  // contado - esperado, por forma. Faturamento NUNCA e afetado — a quebra e conferencia.
  // Sangria/suprimento nao tem PDV no GDOOR: so entram quando ha UM fechamento no dia; com
  // varios caixas no mesmo dia ficam fora e viram aviso.
  app.get('/api/reports/cash-conference', { preHandler: [requireAuth, requireCapability('reports.view')] }, cached('cash-conference', async (req) => {
    const query = baseFilters.parse(req.query);
    const { from, to } = defaultPeriod(query.from, query.to);
    const storeId = resolveStoreScope(req, query.storeId);
    return buildCashConference(req.user!.tenantId, storeId, from, to);
  }));

  registerFinanceRoutes(app);
}


// Conferencia de caixa (D20): esperado (GDOOR no expediente) x contado (operador no fechamento).
// Extraido do handler em 26/08 pra o Dashboard mostrar o card "saldo contabil x fisico" (onda 1
// dos cards do Gdoor Relatorios antigo) sem duplicar a regra.
async function buildCashConference(tenantId: string, storeId: string | null, from: Date, to: Date) {
  const scope = { tenantId, ...(storeId ? { storeId } : {}) };

    const [closings, payRows, movRows, meta] = await Promise.all([
    prisma.cashClosing.findMany({
      where: { ...scope, closedAt: { not: null }, openedAt: { gte: from, lte: to } },
      include: { species: true },
      orderBy: [{ openedAt: 'desc' }, { pdv: 'asc' }],
      take: 300,
    }),
    // pagamentos de venda por dia x caixa (sales.caixa) x forma
    prisma.$queryRaw<{ day: Date; caixa: string | null; paymentType: string; total: unknown }[]>(Prisma.sql`
      SELECT date_trunc('day', p."paymentDate") AS day, s."caixa", p."paymentType", SUM(p."value") AS total
      FROM payments p JOIN sales s ON s.id = p."saleId"
      WHERE p."tenantId" = ${tenantId} ${storeId ? Prisma.sql`AND p."storeId" = ${storeId}` : Prisma.empty}
        AND s."cancelled" = false AND (p."kind" IS NULL OR p."kind" IN ('venda', 'recebimento'))
        AND p."paymentDate" >= ${from} AND p."paymentDate" <= ${to}
      GROUP BY 1, 2, 3`),
    // sangria/suprimento por dia (sem PDV no GDOOR)
    prisma.$queryRaw<{ day: Date; kind: string; total: unknown }[]>(Prisma.sql`
      SELECT date_trunc('day', p."paymentDate") AS day, p."kind", SUM(p."value") AS total
      FROM payments p
      WHERE p."tenantId" = ${tenantId} ${storeId ? Prisma.sql`AND p."storeId" = ${storeId}` : Prisma.empty}
        AND p."kind" IN ('sangria', 'suprimento') AND p."paymentDate" >= ${from} AND p."paymentDate" <= ${to}
      GROUP BY 1, 2`),
    getFreshnessMeta(tenantId, storeId),
  ]);

  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const pdvNum = (v: string | null | undefined) => { const n = parseInt(String(v ?? ''), 10); return Number.isNaN(n) ? null : n; };
  // esperado[day|pdv] -> { forma -> valor }
  const esperado = new Map<string, Map<string, number>>();
  for (const r of payRows) {
    const k = `${dayKey(r.day)}|${pdvNum(r.caixa)}`;
    const forma = normalizePaymentType(r.paymentType) ?? 'outros';
    const m = esperado.get(k) ?? new Map<string, number>();
    m.set(forma, (m.get(forma) ?? 0) + Number(r.total));
    esperado.set(k, m);
  }
  const movByDay = new Map<string, { sangria: number; suprimento: number }>();
  for (const r of movRows) {
    const k = dayKey(r.day);
    const m = movByDay.get(k) ?? { sangria: 0, suprimento: 0 };
    if (r.kind === 'sangria') m.sangria += Number(r.total); else m.suprimento += Number(r.total);
    movByDay.set(k, m);
  }
  const closingsPerDay = new Map<string, number>();
  for (const c of closings) { const k = dayKey(c.openedAt); closingsPerDay.set(k, (closingsPerDay.get(k) ?? 0) + 1); }

  const avisos = new Set<string>();
  const out = closings.map((c) => {
    const dia = dayKey(c.openedAt);
    const esp = esperado.get(`${dia}|${pdvNum(c.pdv)}`) ?? new Map<string, number>();
    const mov = movByDay.get(dia);
    const unico = (closingsPerDay.get(dia) ?? 0) === 1;
    const sangrias = mov && unico ? mov.sangria : 0;
    const suprimentos = mov && unico ? mov.suprimento : 0;
    if (mov && !unico && (mov.sangria > 0 || mov.suprimento > 0)) avisos.add(`Em ${dia} há sangria/suprimento e mais de um caixa — o GDOOR não diz de qual caixa, ficaram fora do esperado.`);
    const fundo = c.openingAmount != null ? Number(c.openingAmount) : null;
    // dinheiro fisico esperado na gaveta = fundo + vendas em dinheiro + suprimento - sangria
    const espDinheiro = (esp.get('dinheiro') ?? 0) + (fundo ?? 0) + suprimentos - sangrias;
    const contadoPorForma = new Map<string, number>();
    for (const sp of c.species) {
      const forma = normalizePaymentType(sp.especie) ?? 'outros';
      contadoPorForma.set(forma, (contadoPorForma.get(forma) ?? 0) + Number(sp.counted));
    }
    const formas = [...new Set([...esp.keys(), ...contadoPorForma.keys(), 'dinheiro'])];
    const porForma = formas.map((forma) => {
      const e = forma === 'dinheiro' ? espDinheiro : (esp.get(forma) ?? 0);
      const ct = contadoPorForma.get(forma) ?? 0;
      return { forma, esperado: e, contado: ct, quebra: ct - e };
    }).sort((a, b) => Math.abs(b.quebra) - Math.abs(a.quebra));
    const esperadoTot = porForma.reduce((s, f) => s + f.esperado, 0);
    const contadoTot = porForma.reduce((s, f) => s + f.contado, 0);
    return {
      id: c.id, dia, pdv: c.pdv, operador: c.operatorName,
      abertura: c.openedAt, fechamento: c.closedAt,
      fundoTroco: fundo, sangrias, suprimentos,
      esperado: esperadoTot, contado: contadoTot, quebra: contadoTot - esperadoTot,
      porForma,
    };
  });
  if (closings.some((c) => c.species.length === 0)) avisos.add('Alguns fechamentos vieram sem contagem por forma (operador fechou sem informar) — contado = 0 nesses.');

  const totals = out.reduce((a, c) => ({ esperado: a.esperado + c.esperado, contado: a.contado + c.contado, quebra: a.quebra + c.quebra }), { esperado: 0, contado: 0, quebra: 0 });
  return { closings: out, totals, fechamentosComQuebra: out.filter((c) => Math.abs(c.quebra) >= 0.005).length, avisos: [...avisos], meta };
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
  agentVersion: string | null;
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
    select: { storeId: true, lastSeenAt: true, agentVersion: true },
  });
  const agentVersion = agents.map((a) => a.agentVersion).filter((v): v is string => !!v).sort()[0] ?? null;
  const mostRecentSeen = agents.reduce<Date | null>(
    (acc, a) => (a.lastSeenAt && (!acc || a.lastSeenAt > acc) ? a.lastSeenAt : acc),
    null,
  );
  const offline = agents.filter((a) => !a.lastSeenAt || a.lastSeenAt < new Date(Date.now() - 5 * 60 * 1000));
  return {
    lastSyncedAt: mostRecentSeen?.toISOString() ?? null,
    stalenessSeconds: mostRecentSeen ? Math.round((Date.now() - mostRecentSeen.getTime()) / 1000) : null,
    agentsOffline: offline.map((a) => a.storeId),
    agentVersion,
  };
}
