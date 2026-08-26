// Fluxo de Caixa v1 (design D16) — so com dado JA sincronizado, honesto sobre o que falta.
//
// Entradas = pagamentos de venda (Payment, sem crediario — decisao P1: crediario entra no
// caixa so quando o titulo e baixado) + crediario recebido (Receivable.receivedDate) + avulsos
// (Payment sem venda vinculada, marcado como estimativa). Saidas = contas a pagar baixadas
// (Payable.paidDate). Resultado e VARIACAO do periodo, nunca "saldo em caixa": nao existe
// saldo inicial (CashClosing nao sincroniza).
//
// A agregacao por dia e feita no Postgres (date_trunc em UTC — Fase 0 confirmou que todas as
// datas sao DATE gravadas como 03:00Z, entao o dia UTC e o dia certo). O merge das 3 fontes
// e a parte pura em `cashflowMerge.ts` (testada no vitest sem banco).
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import {
  DAY_MS,
  mergeCashflow,
  mergeForecast,
  round2,
  toDayKey,
  type CashflowRow,
  type CashflowTotals,
  type DayAgg,
  type ForecastRow,
  type Granularity,
  type PaymentAgg,
} from './cashflowMerge.js';

export { pickGranularity, type Granularity, type CashflowRow } from './cashflowMerge.js';

export interface CashflowQuality {
  saidasParciais: true; // so Payable baixado — sangria/despesa de caixa nao sincronizam
  crediarioExcluidoDasVendas: true; // P1: crediario conta na baixa do titulo
  avulsosNaoClassificados: number; // qtd de Payment sem venda (linha "avulsos", estimativa)
  baixaParcialUnicaData: true; // titulo tem 1 data + 1 valor acumulado; baixa parcial nao aparece
  semSaldoInicial: true; // resultado = variacao do periodo, nao saldo em caixa
  paymentsRecentes: boolean; // false = agente online mas nenhum Payment nos ultimos 2 dias
}

export interface CashflowResult {
  granularity: Granularity;
  data: CashflowRow[];
  totals: CashflowTotals;
  quality: CashflowQuality;
}

export interface ForecastResult {
  data: ForecastRow[];
  totals: { entradas: number; saidas: number; saldo: number };
  overdue: { entradas: number; saidas: number };
}

// Risco registrado no design: SYNC_SALE_ITEMS_AND_PAYMENTS_ENABLED voltar a false zera Payment
// em silencio. Sinal: agente online (heartbeat < 5 min) e nenhum Payment nos ultimos 2 dias.
// Sem agente online nao da pra afirmar nada -> true (nao alarma a toa).
export async function checkPaymentsRecentes(tenantId: string, storeId: string | null): Promise<boolean> {
  const scope = { tenantId, ...(storeId ? { storeId } : {}) };
  const [recentPayment, onlineAgent] = await Promise.all([
    prisma.payment.findFirst({ where: { ...scope, paymentDate: { gte: new Date(Date.now() - 2 * DAY_MS) } }, select: { id: true } }),
    prisma.agent.findFirst({ where: { ...scope, revokedAt: null, lastSeenAt: { gte: new Date(Date.now() - 5 * 60 * 1000) } }, select: { id: true } }),
  ]);
  return !!recentPayment || !onlineAgent;
}

// Fragmento SQL do filtro de loja — evita duplicar a query inteira com/sem storeId. `alias` e
// constante do codigo (nunca input), por isso Prisma.raw e seguro aqui.
function storeSql(alias: string, storeId: string | null): Prisma.Sql {
  return storeId ? Prisma.sql`AND ${Prisma.raw(alias)}."storeId" = ${storeId}` : Prisma.empty;
}

type RawDayAgg = { day: Date; total: unknown; count: bigint };
const toDayAgg = (r: RawDayAgg): DayAgg => ({ day: toDayKey(r.day), total: Number(r.total), count: Number(r.count) });

// 3 agregados por dia no Postgres. payments faz LEFT JOIN em sales pra descartar pagamento de
// venda cancelada (Payment nao tem flag propria) e separar avulso (saleId NULL).
export async function fetchCashflowSources(
  tenantId: string,
  storeId: string | null,
  from: Date,
  to: Date,
): Promise<{ payments: PaymentAgg[]; receivables: DayAgg[]; payables: DayAgg[] }> {
  const [paymentRows, receivableRows, payableRows] = await Promise.all([
    // kind (P5, 26/08): sangria/suprimento sao movimento de caixa, nao venda — vem separados.
    prisma.$queryRaw<{ day: Date; paymentType: string; avulso: boolean; kind: string | null; total: unknown; count: bigint }[]>(Prisma.sql`
      SELECT date_trunc('day', p."paymentDate") AS day, p."paymentType", (p."saleId" IS NULL) AS avulso, p."kind",
             SUM(p."value") AS total, COUNT(*) AS count
      FROM payments p LEFT JOIN sales s ON s.id = p."saleId"
      WHERE p."tenantId" = ${tenantId} ${storeSql('p', storeId)}
        AND p."paymentDate" >= ${from} AND p."paymentDate" <= ${to}
        AND (p."saleId" IS NULL OR s."cancelled" = false)
      GROUP BY 1, 2, 3, 4`),
    prisma.$queryRaw<RawDayAgg[]>(Prisma.sql`
      SELECT date_trunc('day', r."receivedDate") AS day, SUM(r."receivedValue") AS total, COUNT(*) AS count
      FROM receivables r
      WHERE r."tenantId" = ${tenantId} ${storeSql('r', storeId)}
        AND r."cancelled" = false AND r."receivedValue" > 0
        AND r."receivedDate" >= ${from} AND r."receivedDate" <= ${to}
      GROUP BY 1`),
    prisma.$queryRaw<RawDayAgg[]>(Prisma.sql`
      SELECT date_trunc('day', p."paidDate") AS day, SUM(p."paidValue") AS total, COUNT(*) AS count
      FROM payables p
      WHERE p."tenantId" = ${tenantId} ${storeSql('p', storeId)}
        AND p."cancelled" = false AND p."paidValue" > 0
        AND p."paidDate" >= ${from} AND p."paidDate" <= ${to}
      GROUP BY 1`),
  ]);

  return {
    payments: paymentRows.map((r) => ({ day: toDayKey(r.day), paymentType: r.paymentType, avulso: r.avulso, kind: r.kind, total: Number(r.total), count: Number(r.count) })),
    receivables: receivableRows.map(toDayAgg),
    payables: payableRows.map(toDayAgg),
  };
}

// Ponto de entrada usado por /cashflow e /cash-detailed.
export async function buildCashflow(
  tenantId: string,
  storeId: string | null,
  from: Date,
  to: Date,
  granularity: Granularity,
): Promise<CashflowResult> {
  const [sources, paymentsRecentes] = await Promise.all([
    fetchCashflowSources(tenantId, storeId, from, to),
    checkPaymentsRecentes(tenantId, storeId),
  ]);
  const merged = mergeCashflow(sources, granularity);
  return {
    granularity,
    data: merged.data,
    totals: merged.totals,
    quality: {
      saidasParciais: true,
      crediarioExcluidoDasVendas: true,
      avulsosNaoClassificados: merged.avulsosNaoClassificados,
      baixaParcialUnicaData: true,
      semSaldoInicial: true,
      paymentsRecentes,
    },
  };
}

// RECEBER e PAGAR em aberto (value - recebido/pago > 0, nao cancelado) entre hoje e hoje+days
// por vencimento; `overdue` = em aberto vencido antes de hoje. "Hoje" e meia-noite UTC, igual
// ao classifyFinanceStatus dos calendarios (dado e DATE em 03:00Z, entao bate).
export async function buildForecast(tenantId: string, storeId: string | null, days: number): Promise<ForecastResult> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const to = new Date(today.getTime() + days * DAY_MS - 1);

  const [recRows, payRows, recOverdue, payOverdue] = await Promise.all([
    prisma.$queryRaw<RawDayAgg[]>(Prisma.sql`
      SELECT date_trunc('day', r."dueDate") AS day, SUM(r."value" - r."receivedValue") AS total, COUNT(*) AS count
      FROM receivables r
      WHERE r."tenantId" = ${tenantId} ${storeSql('r', storeId)}
        AND r."cancelled" = false AND r."value" > r."receivedValue"
        AND r."dueDate" >= ${today} AND r."dueDate" <= ${to}
      GROUP BY 1`),
    prisma.$queryRaw<RawDayAgg[]>(Prisma.sql`
      SELECT date_trunc('day', p."dueDate") AS day, SUM(p."value" - p."paidValue") AS total, COUNT(*) AS count
      FROM payables p
      WHERE p."tenantId" = ${tenantId} ${storeSql('p', storeId)}
        AND p."cancelled" = false AND p."value" > p."paidValue"
        AND p."dueDate" >= ${today} AND p."dueDate" <= ${to}
      GROUP BY 1`),
    prisma.$queryRaw<{ total: unknown }[]>(Prisma.sql`
      SELECT COALESCE(SUM(r."value" - r."receivedValue"), 0) AS total
      FROM receivables r
      WHERE r."tenantId" = ${tenantId} ${storeSql('r', storeId)}
        AND r."cancelled" = false AND r."value" > r."receivedValue" AND r."dueDate" < ${today}`),
    prisma.$queryRaw<{ total: unknown }[]>(Prisma.sql`
      SELECT COALESCE(SUM(p."value" - p."paidValue"), 0) AS total
      FROM payables p
      WHERE p."tenantId" = ${tenantId} ${storeSql('p', storeId)}
        AND p."cancelled" = false AND p."value" > p."paidValue" AND p."dueDate" < ${today}`),
  ]);

  const merged = mergeForecast(recRows.map(toDayAgg), payRows.map(toDayAgg));
  return {
    ...merged,
    overdue: { entradas: round2(Number(recOverdue[0]?.total ?? 0)), saidas: round2(Number(payOverdue[0]?.total ?? 0)) },
  };
}
