// Tipos de resposta dos endpoints de relatorio novos (D16/D17 de fluxo-caixa-dre).
// Fonte unica pro front: componentes do kit e as paginas importam daqui, em vez de cada
// arquivo redeclarar a interface (como aconteceu com formatBRL em 27 lugares).

// meta padrao de todo relatorio (getFreshnessMeta em apps/backend/src/reports/routes.ts).
export interface FreshnessMeta {
  lastSyncedAt: string | null;
  stalenessSeconds: number | null;
  agentsOffline: string[];
}

// Selo de honestidade por linha/KPI (P3: liberar com selo visivel, nunca zero escondendo dado).
export type DataStatus = 'real' | 'estimate' | 'nd';

// ---------- GET /api/reports/cashflow ----------
export interface CashflowDetalhe {
  vendas: { dinheiro: number; cartao: number; pix: number; outros: number };
  avulsos: number; // Payment sem saleId — estimativa
  crediarioRecebido: number; // Receivable baixado (P1)
  contasPagas: number; // Payable baixado
}

export interface CashflowRow {
  dia: string; // 'YYYY-MM-DD' (ou inicio da semana/mes conforme granularity)
  entradas: number;
  saidas: number;
  saldoDia: number;
  saldoAcumulado: number;
  detalhe: CashflowDetalhe;
}

// Avisos que o backend liga conforme o dado; o DataQualityBanner transforma em texto.
export interface CashflowQuality {
  saidasParciais: boolean; // so contas a pagar — sangria/despesa de caixa nao sincronizam
  crediarioExcluidoDasVendas: boolean; // P1: crediario entra so na baixa
  avulsosNaoClassificados: number; // qtd de Payment sem venda vinculada
  baixaParcialUnicaData: boolean; // 1 data por titulo — baixa parcial nao e representada
  semSaldoInicial: boolean; // sem CashClosing: e variacao, nao saldo em caixa
  paymentsRecentes: boolean; // false = nenhum Payment nos ultimos 2 dias com agente online
}

export type CashflowGranularity = 'day' | 'week' | 'month';

export interface CashflowResponse {
  data: CashflowRow[];
  totals: { entradas: number; saidas: number; variacao: number };
  quality: CashflowQuality;
  meta: FreshnessMeta & { granularity?: CashflowGranularity; from?: string; to?: string };
}

// ---------- GET /api/reports/cashflow/day ----------
export interface CashflowDayEntrada {
  tipo: 'payment' | 'receivable';
  forma?: string; // forma normalizada (dinheiro/cartao/pix/outros) quando tipo=payment
  saleId?: string | null;
  counterparty?: string | null;
  description?: string | null;
  value: number;
}

export interface CashflowDaySaida {
  counterparty: string | null;
  description: string | null;
  value: number;
}

export interface CashflowDayResponse {
  date: string;
  entradas: CashflowDayEntrada[];
  saidas: CashflowDaySaida[];
  totals: { entradas: number; saidas: number };
  meta: FreshnessMeta;
}

// ---------- GET /api/reports/cashflow-forecast ----------
export interface CashflowForecastRow {
  dia: string;
  entradas: number; // a receber vencendo no dia
  saidas: number; // a pagar vencendo no dia
  saldo: number;
}

export interface CashflowForecastResponse {
  data: CashflowForecastRow[];
  totals: { entradas: number; saidas: number; saldo: number };
  overdue: { entradas: number; saidas: number }; // vencidos antes de hoje
  meta: FreshnessMeta;
}

// ---------- GET /api/reports/dre-simplified ----------
export type DreRegime = 'caixa' | 'vencimento';

export type DreLineKey =
  | 'receita_bruta'
  | 'descontos'
  | 'devolucoes'
  | 'receita_liquida'
  | 'cmv'
  | 'margem_bruta'
  | 'despesas'
  | 'impostos'
  | 'resultado';

export interface DreLine {
  key: DreLineKey;
  label: string;
  value: number | null; // null = N/D
  pct: number | null; // % da receita bruta, 0-100; null quando denominador = 0 ou N/D
  status: DataStatus;
  note?: string | null; // explicacao curta ("nao sincronizado", "so contas a pagar")
}

export interface DreNatureza {
  natureza: string | null;
  modelo: string | null;
  count: number;
  value: number;
}

export interface DreMemo {
  cancelamentos: { value: number; count: number };
  naoProcessadas: { value: number; count: number };
  naturezas: DreNatureza[];
  cmvCoverage: number | null; // % dos itens com custo (0-100)
  receitaPorModelo: Record<string, number>; // { PV, '65', '55' }
}

export interface DistribuicaoItem {
  label: string;
  value: number;
  percent: number; // 0-100
}

export interface DreResponse {
  regime: DreRegime;
  lines: DreLine[];
  memo: DreMemo;
  despesasPorFornecedor: DistribuicaoItem[]; // top 10 — alimenta PlanoContasCard
  payments: Array<{ type: string; total: number; count: number }>;
  meta: FreshnessMeta;
}

// "X de N linhas com dado real" (topo da DRE, P3).
export function countRealLines(lines: DreLine[]): { real: number; total: number } {
  return { real: lines.filter((l) => l.status === 'real').length, total: lines.length };
}

// ---------- GET /api/reports/monthly-goal (ja existe, resposta flat) ----------
export interface MonthlyGoalResponse {
  year: number;
  month: number;
  goal: number;
  achieved: number;
  remaining: number;
  progressPct: number;
  pacePct: number;
  sales: number;
  totalDays: number;
  elapsedDays: number;
}
