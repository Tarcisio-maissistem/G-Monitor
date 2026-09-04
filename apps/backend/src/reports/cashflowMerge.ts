// Parte PURA do Fluxo de Caixa (design D16): tipos + merge/agregacao das 3 fontes por bucket.
// Nao importa Prisma de proposito — `db/prisma.ts` exige DATABASE_URL no import e isso aqui
// precisa rodar no vitest sem banco. As queries ficam em `cashflow.ts`.
import { normalizePaymentType, type PaymentKey } from './paymentType.js';

export type Granularity = 'day' | 'week' | 'month';

// Linha agregada de payments por dia x forma x (com/sem venda) — saida do $queryRaw.
export interface PaymentAgg {
  day: string; // YYYY-MM-DD
  paymentType: string;
  avulso: boolean; // saleId IS NULL
  // MOV_OPERADORES.TIPO normalizado (P5): venda|recebimento|sangria|suprimento|outro.
  // null/undefined = linha de agente antigo (tratada como venda).
  kind?: string | null;
  total: number;
  count: number;
}

// Linha agregada de receivables (por receivedDate) ou payables (por paidDate/dueDate).
export interface DayAgg {
  day: string; // YYYY-MM-DD
  total: number;
  count: number;
}

export interface CashflowDetail {
  vendas: Record<Exclude<PaymentKey, 'crediario'>, number>;
  avulsos: number;
  crediarioRecebido: number;
  contasPagas: number;
  // MOVIMENTO INTERNO (dono 04/09): a sangria tira da gaveta e leva pro cofre/banco da loja e o
  // suprimento devolve o troco na abertura do dia seguinte — o dinheiro nao entra nem sai da
  // EMPRESA. Nenhum dos dois conta em entradas/saidas; ficam aqui so pra conferencia da gaveta.
  // Antes a sangria entrava como saida e sumia R$ 45 mil do saldo de agosto que nunca saiu.
  sangrias: number;
  suprimentos: number;
}

export interface CashflowRow {
  dia: string; // YYYY-MM-DD (semana = segunda-feira; mes = dia 1)
  entradas: number;
  saidas: number;
  saldoDia: number;
  saldoAcumulado: number;
  movimentos: number; // qtd de lancamentos (payments + baixas) — CaixaDetalhadoPage ja exibe
  detalhe: CashflowDetail;
}

export interface CashflowTotals {
  entradas: number;
  saidas: number;
  variacao: number;
}

export interface ForecastRow {
  dia: string;
  entradas: number;
  saidas: number;
  saldo: number;
}

export const DAY_MS = 86_400_000;

export function toDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Soma de Decimal(14,2) convertida pra float acumula 0.00000001 de lixo — arredonda a cada
// passo pra o JSON nao sair com 1234.5600000001.
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Chave do bucket: dia = o proprio dia; semana = segunda-feira (ISO) daquele dia; mes = dia 1.
// Sempre YYYY-MM-DD completo pra `new Date(row.dia)` do FluxoCaixaChart funcionar sem adaptador.
export function bucketKey(day: string, granularity: Granularity): string {
  if (granularity === 'day') return day;
  if (granularity === 'month') return day.slice(0, 7) + '-01';
  const d = new Date(day + 'T00:00:00Z');
  const dow = d.getUTCDay(); // 0 = domingo
  const back = dow === 0 ? 6 : dow - 1;
  return toDayKey(new Date(d.getTime() - back * DAY_MS));
}

// Granularidade automatica quando o cliente nao pede: mais de 31 dias vira semana (regra D16).
export function pickGranularity(from: Date, to: Date, requested?: Granularity): Granularity {
  if (requested) return requested;
  // floor, nao round: `to` costuma ser 23:59:59 do ultimo dia (defaultPeriod), entao a
  // diferenca e 30.99 dias pra um mes de 31 — round dava 31+1=32 e um mes inteiro virava
  // semana (pego pelo teste).
  const days = Math.floor((to.getTime() - from.getTime()) / DAY_MS) + 1;
  return days > 31 ? 'week' : 'day';
}

function emptyRow(dia: string): CashflowRow {
  return {
    dia,
    entradas: 0,
    saidas: 0,
    saldoDia: 0,
    saldoAcumulado: 0,
    movimentos: 0,
    detalhe: { vendas: { dinheiro: 0, cartao: 0, pix: 0, outros: 0 }, avulsos: 0, crediarioRecebido: 0, contasPagas: 0, sangrias: 0, suprimentos: 0 },
  };
}

// Junta as 3 fontes por bucket, calcula saldo do dia e acumulado (em ordem de data), totais e
// a contagem de avulsos. A query ja descartou pagamento de venda cancelada (LEFT JOIN sales).
export function mergeCashflow(
  input: { payments: PaymentAgg[]; receivables: DayAgg[]; payables: DayAgg[] },
  granularity: Granularity,
): { data: CashflowRow[]; totals: CashflowTotals; avulsosNaoClassificados: number } {
  const rows = new Map<string, CashflowRow>();
  const rowFor = (day: string): CashflowRow => {
    const key = bucketKey(day, granularity);
    let row = rows.get(key);
    if (!row) {
      row = emptyRow(key);
      rows.set(key, row);
    }
    return row;
  };

  let avulsosNaoClassificados = 0;
  for (const p of input.payments) {
    // P5: sangria/suprimento antes caiam em "avulsos" (nao tem saleId). Agora tem lugar proprio.
    if (p.kind === 'sangria') {
      const row = rowFor(p.day);
      row.detalhe.sangrias += p.total;
      row.movimentos += p.count;
      continue;
    }
    if (p.kind === 'suprimento') {
      const row = rowFor(p.day);
      row.detalhe.suprimentos += p.total;
      row.movimentos += p.count;
      continue;
    }
    const key = normalizePaymentType(p.paymentType);
    // SEM PAGAMENTO (null) nao soma; crediario NUNCA entra por aqui (P1) — nem quando avulso,
    // senao contaria 2x com a baixa do Receivable.
    if (!key || key === 'crediario') continue;
    const row = rowFor(p.day);
    row.movimentos += p.count;
    if (p.avulso) {
      row.detalhe.avulsos += p.total;
      avulsosNaoClassificados += p.count;
    } else {
      row.detalhe.vendas[key] += p.total;
    }
  }
  for (const r of input.receivables) {
    const row = rowFor(r.day);
    row.detalhe.crediarioRecebido += r.total;
    row.movimentos += r.count;
  }
  for (const p of input.payables) {
    const row = rowFor(p.day);
    row.detalhe.contasPagas += p.total;
    row.movimentos += p.count;
  }

  const data = [...rows.values()].sort((a, b) => a.dia.localeCompare(b.dia));
  let acumulado = 0;
  for (const row of data) {
    const v = row.detalhe.vendas;
    row.entradas = round2(v.dinheiro + v.cartao + v.pix + v.outros + row.detalhe.avulsos + row.detalhe.crediarioRecebido);
    row.saidas = round2(row.detalhe.contasPagas); // sangria = movimento interno, nao saida
    row.saldoDia = round2(row.entradas - row.saidas);
    acumulado = round2(acumulado + row.saldoDia);
    row.saldoAcumulado = acumulado;
  }

  const entradas = round2(data.reduce((s, r) => s + r.entradas, 0));
  const saidas = round2(data.reduce((s, r) => s + r.saidas, 0));
  return { data, totals: { entradas, saidas, variacao: round2(entradas - saidas) }, avulsosNaoClassificados };
}

// Projecao: receber/pagar em aberto por dia de vencimento -> linhas do CashflowForecast.tsx.
export function mergeForecast(
  receivables: DayAgg[],
  payables: DayAgg[],
): { data: ForecastRow[]; totals: { entradas: number; saidas: number; saldo: number } } {
  const rows = new Map<string, ForecastRow>();
  const rowFor = (day: string): ForecastRow => {
    let row = rows.get(day);
    if (!row) {
      row = { dia: day, entradas: 0, saidas: 0, saldo: 0 };
      rows.set(day, row);
    }
    return row;
  };
  for (const r of receivables) rowFor(r.day).entradas += r.total;
  for (const p of payables) rowFor(p.day).saidas += p.total;

  const data = [...rows.values()].sort((a, b) => a.dia.localeCompare(b.dia));
  for (const row of data) {
    row.entradas = round2(row.entradas);
    row.saidas = round2(row.saidas);
    row.saldo = round2(row.entradas - row.saidas);
  }
  const entradas = round2(data.reduce((s, r) => s + r.entradas, 0));
  const saidas = round2(data.reduce((s, r) => s + r.saidas, 0));
  return { data, totals: { entradas, saidas, saldo: round2(entradas - saidas) } };
}
