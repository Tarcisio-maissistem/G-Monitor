import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Errors } from '@gmonitor/shared';
import { prisma } from '../db/prisma.js';
import { redis } from '../db/redis.js';
import { logger } from '../logger.js';
import { requireAuth, requireCapability } from '../middleware/auth.js';

// Cache curto (cache-aside) pros relatorios: cada request bate no Supabase (~180ms de RTT
// so na ida-e-volta, sa-east-1) e a maioria dos handlers faz 2-4 chamadas Prisma sequenciais
// — por isso ~1.3s por relatorio mesmo sem query pesada nem indice faltando (medido 23/08).
// TTL curto (45s) porque o agente sincroniza a cada 30s; nao precisa de precisao ao segundo.
const REPORT_CACHE_TTL_SECONDS = 45;

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

    const result = await handler(req);

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
  }));

  app.get('/api/reports/abc-products', { preHandler: [requireAuth, requireCapability('reports.view')] }, cached('abc-products', async (req) => {
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
  }));

  app.get('/api/reports/sales-by-payment', { preHandler: [requireAuth, requireCapability('reports.view')] }, cached('sales-by-payment', async (req) => {
    const query = baseFilters.parse(req.query);
    const { from, to } = defaultPeriod(query.from, query.to);
    const storeId = resolveStoreScope(req, query.storeId);

    const groups = await prisma.payment.groupBy({
      by: ['paymentType'],
      where: {
        tenantId: req.user!.tenantId,
        paymentDate: { gte: from, lte: to },
        ...(storeId ? { storeId } : {}),
      },
      _sum: { value: true },
      _count: true,
      orderBy: { _sum: { value: 'desc' } },
    });

    const grandTotal = groups.reduce((s, g) => s + Number(g._sum.value ?? 0), 0);
    const rows = groups.map((g) => ({
      paymentType: g.paymentType,
      total: Number(g._sum.value ?? 0),
      count: g._count,
      pct: grandTotal > 0 ? Number(g._sum.value ?? 0) / grandTotal : 0,
    }));

    const meta = await getFreshnessMeta(req.user!.tenantId, storeId);
    return { data: { rows, grandTotal }, meta };
  }));

  app.get('/api/reports/dre-simplified', { preHandler: [requireAuth, requireCapability('reports.view')] }, async (req) => {
    const query = baseFilters.parse(req.query);
    const { from, to } = defaultPeriod(query.from, query.to);
    const storeId = resolveStoreScope(req, query.storeId);

    const dateWhere = { saleDate: { gte: from, lte: to } };
    const baseWhere = { tenantId: req.user!.tenantId, ...(storeId ? { storeId } : {}) };

    const [active, cancelled, payments] = await Promise.all([
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
    ]);

    const gross = Number(active._sum.totalValue ?? 0);
    const cancellations = Number(cancelled._sum.totalValue ?? 0);

    const meta = await getFreshnessMeta(req.user!.tenantId, storeId);
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

    const rows = await prisma.product.findMany({
      where: {
        tenantId: req.user!.tenantId,
        ...(storeId ? { storeId } : {}),
        OR: [{ stock: { lte: 0 } }, { stock: null }],
      },
      select: { sourceCode: true, description: true, unit: true, stock: true, salePrice: true },
      orderBy: { description: 'asc' },
      take: 500,
    });

    const meta = await getFreshnessMeta(req.user!.tenantId, storeId);
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
    const unpaid = await prisma.sale.findMany({
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
    });

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
    const meta = await getFreshnessMeta(req.user!.tenantId, storeId);
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

    const groups = await prisma.sale.groupBy({
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
    });

    const grandTotal = groups.reduce((s, g) => s + Number(g._sum.totalValue ?? 0), 0);
    const rows = groups.map((g) => ({
      operator: g.operatorName ?? '(sem operador)',
      count: g._count,
      total: Number(g._sum.totalValue ?? 0),
      pct: grandTotal > 0 ? Number(g._sum.totalValue ?? 0) / grandTotal : 0,
    }));

    const meta = await getFreshnessMeta(req.user!.tenantId, storeId);
    return { data: { rows, grandTotal }, meta };
  }));

  app.get('/api/reports/customer-cohort', { preHandler: [requireAuth, requireCapability('reports.view')] }, async (req) => {
    const query = baseFilters.parse(req.query);
    const storeId = resolveStoreScope(req, query.storeId);

    // Mes da primeira compra por cliente (cohort de aquisicao)
    const firstPurchases = await prisma.sale.groupBy({
      by: ['customerSourceId'],
      where: {
        tenantId: req.user!.tenantId,
        cancelled: false,
        customerSourceId: { not: null },
        ...(storeId ? { storeId } : {}),
      },
      _min: { saleDate: true },
    });

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

    const meta = await getFreshnessMeta(req.user!.tenantId, storeId);
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

    const rows = await prisma.payable.findMany({
      where: { tenantId: req.user!.tenantId, ...(storeId ? { storeId } : {}), cancelled: false, dueDate: { gte: from, lte: to } },
      select: { dueDate: true, value: true, paidValue: true, paidDate: true },
    });

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

    const meta = await getFreshnessMeta(req.user!.tenantId, storeId);
    return { data: { days: daysArr, monthSummary }, meta };
  }));

  app.get('/api/reports/receivables-calendar', { preHandler: [requireAuth, requireCapability('reports.view')] }, cached('receivables-calendar', async (req) => {
    const query = monthFilter.parse(req.query);
    const storeId = resolveStoreScope(req, query.storeId);
    const { from, to } = monthBounds(query.month);

    const rows = await prisma.receivable.findMany({
      where: { tenantId: req.user!.tenantId, ...(storeId ? { storeId } : {}), cancelled: false, dueDate: { gte: from, lte: to } },
      select: { dueDate: true, value: true, receivedValue: true, receivedDate: true },
    });

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

    const meta = await getFreshnessMeta(req.user!.tenantId, storeId);
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
    const [rows, allForSummary, totalCount] = await Promise.all([
      prisma.payable.findMany({ where, orderBy: { dueDate: 'desc' }, take: 500 }),
      prisma.payable.findMany({ where, select: { value: true, paidValue: true, paidDate: true, dueDate: true } }),
      prisma.payable.count({ where }),
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

    const meta = await getFreshnessMeta(req.user!.tenantId, storeId);
    return { data, summary, count: data.length, totalCount, truncated: rows.length === 500 && totalCount > 500, meta };
  }));

  app.get('/api/reports/receivables', { preHandler: [requireAuth, requireCapability('reports.view')] }, cached('receivables', async (req) => {
    const query = listFilters.parse(req.query);
    const { from, to } = defaultPeriod(query.from, query.to);
    const storeId = resolveStoreScope(req, query.storeId);
    const where = { tenantId: req.user!.tenantId, ...(storeId ? { storeId } : {}), cancelled: false, dueDate: { gte: from, lte: to } };

    // Mesma logica do payables: summary sobre o total real, nao so as 500 exibidas.
    const [rows, allForSummary, totalCount] = await Promise.all([
      prisma.receivable.findMany({ where, orderBy: { dueDate: 'desc' }, take: 500 }),
      prisma.receivable.findMany({ where, select: { value: true, receivedValue: true, receivedDate: true, dueDate: true } }),
      prisma.receivable.count({ where }),
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

    const meta = await getFreshnessMeta(req.user!.tenantId, storeId);
    return { data, summary, count: data.length, totalCount, truncated: rows.length === 500 && totalCount > 500, meta };
  }));
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
