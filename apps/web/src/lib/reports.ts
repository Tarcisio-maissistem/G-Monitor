// Tipos de resposta dos endpoints de relatorio novos (D16/D17 de fluxo-caixa-dre).
// Fonte unica pro front: componentes do kit e as paginas importam daqui, em vez de cada
// arquivo redeclarar a interface (como aconteceu com formatBRL em 27 lugares).

// meta padrao de todo relatorio (getFreshnessMeta em apps/backend/src/reports/routes.ts).
export interface FreshnessMeta {
  lastSyncedAt: string | null;
  stalenessSeconds: number | null;
  agentsOffline: string[];
  agentVersion?: string | null; // menor versao entre os agentes da loja (26/08)
}

// Selo de honestidade por linha/KPI (P3: liberar com selo visivel, nunca zero escondendo dado).
export type DataStatus = 'real' | 'estimate' | 'nd';

// ---------- GET /api/reports/cashflow ----------
export interface CashflowDetalhe {
  vendas: { dinheiro: number; cartao: number; pix: number; outros: number };
  avulsos: number; // Payment sem saleId — estimativa
  crediarioRecebido: number; // Receivable baixado (P1)
  contasPagas: number; // Payable baixado
  sangrias: number; // P5: retirada do caixa — saida
  suprimentos: number; // P5: aporte de troco — informativo, nao receita
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

// ---------- GET /api/reports/dashboard/today (26/08) ----------
export interface DashTodayResponse {
  periodo: { from: string; to: string };
  vendido: { total: number; count: number };
  recebidoCaixa: { total: number };
  contasRecebidas: { total: number; count: number };
  contasPagas: { total: number; count: number };
  nfceSemPv: { count: number; total: number }; // P4: NFC-e direta sem pre-venda (anomalia)
  // onda 1 dos cards do Gdoor Relatorios antigo (26/08)
  hojeOntem: { hoje: { total: number; count: number }; ontem: { total: number; count: number }; variacaoPct: number | null };
  canceladas: { total: number; count: number };
  diasTrabalhados: number;
  mediaDiaria: number;
  caixaFisico: { esperado: number; contado: number; quebra: number; fechamentos: number; comQuebra: number };
  quality: CashflowQuality;
  meta: FreshnessMeta;
}

// ---------- GET /api/reports/sales-by-weekday ----------
export interface WeekdayRow { dia: number; label: string; diasObservados: number; totalQtd: number; totalRevenue: number; mediaQtdPorDia: number; mediaRevenuePorDia: number }
export interface WeekdayResponse { data: WeekdayRow[] }

// ---------- GET /api/reports/dashboard/peak-hours ----------
export interface PeakHourRow { hora: number; qtd: number; total: number }
export interface PeakHoursResponse {
  data: PeakHourRow[]; // sempre 24 posicoes (0..23)
  dias: number;
  picoHora: number | null; // hora com mais vendas; null se sem dado
  semDado: boolean; // true = nenhuma venda tem hora ainda (agente antigo)
}

// ---------- GET /api/reports/dashboard/seller-ranking ----------
export interface SellerRow { seller: string | null; vendas: number; total: number; ticket: number; pct: number }
export interface SellerRankingResponse {
  data: SellerRow[];
  cobertura: number; // 0-1: fracao do faturamento com vendedor identificado
}

// ---------- GET /api/reports/cash-conference (D20) ----------
export interface CashConferenceForma { forma: string; esperado: number; contado: number; quebra: number }
export interface CashConferenceClosing {
  id: string; dia: string; pdv: string | null; operador: string | null;
  abertura: string; fechamento: string | null;
  fundoTroco: number | null; sangrias: number; suprimentos: number;
  esperado: number; contado: number; quebra: number; // quebra = contado - esperado (negativo = falta)
  porForma: CashConferenceForma[];
}
export interface CashConferenceResponse {
  closings: CashConferenceClosing[];
  totals: { esperado: number; contado: number; quebra: number };
  fechamentosComQuebra: number;
  avisos: string[];
  meta: FreshnessMeta;
}

// ---------- /downloads/latest.json (manifesto do agente, estatico no nginx) ----------
export interface AgentManifest { version: string; sha256: string; url: string; releasedAt?: string }

// ---------- GET /api/reports/dashboard/seller-ranking (26/08: + periodo anterior) ----------
export interface SellerRow2 extends SellerRow { totalAnterior: number; variacaoPct: number | null }

// ---------- GET /api/reports/dashboard/financial-position (26/08) ----------
export interface AgingBucket { faixa: 'a_vencer' | 'ate_30' | '31_60' | 'acima_60'; qtd: number; valor: number }
export interface FinancialSide { realizadoMes: { qtd: number; valor: number }; aVencerMes: number; aging: AgingBucket[]; atrasadoTotal: number }
export interface Inadimplente { nome: string; titulos: number; saldo: number; diasAtrasoMaior: number; ultimoVencimento: string }
export interface FinancialPositionResponse {
  receber: FinancialSide;
  pagar: FinancialSide;
  inadimplentes: Inadimplente[];
  fiado: { valor: number; pct: number; totalPagamentos: number }; // % do recebido em crediário/fiado no período
  saldoProjetado: { entradas: number; saidas: number; saldo: number; ate: string }; // até o fim do mês
  meta: FreshnessMeta;
}

// ---------- GET /api/reports/dashboard/inadimplencia (26/08) ----------
export type FaixaInad = 'mes' | 'tri' | 'sem' | 'ano' | 'mais1ano';
export interface InadFaixa { faixa: FaixaInad; titulos: number; devedores: number; valor: number }
export interface InadDevedor { nome: string; titulos: number; saldo: number; diasAtraso: number; vencimentoMaisAntigo: string }
export interface InadimplenciaResponse {
  faixas: InadFaixa[]; // mês / 3m / 6m / 1 ano / +1 ano — vencido, não sobreposto
  total: { titulos: number; valor: number };
  piores: InadDevedor[]; // ordenado por TEMPO de atraso (quem deve há mais tempo)
  meta: FreshnessMeta;
}

// ---------- GET /api/reports/conciliacao/previsto (26/08) ----------
export type FeeChannel = 'pos_debito' | 'pos_credito' | 'pix_tef' | 'pix_estatico';
export interface FeeRule {
  channel: FeeChannel;
  acquirer?: string | null;
  installments?: number | null;
  percent: number;
  fixedValue?: number;
  daysToReceive?: number;
}
export interface PrevistoCanal {
  channel: FeeChannel;
  bruto: number;
  transacoes: number;
  temRegra: boolean;
  percent: number | null;
  taxa: number | null;
  liquido: number | null;
  diasParaReceber: number | null;
}
export interface PrevistoResponse {
  periodo: { from: string; to: string };
  canais: PrevistoCanal[];
  totals: { bruto: number; taxa: number; liquido: number; brutoSemRegra: number };
  semTaxaAdquirente: number;
  regrasCadastradas: number;
  meta: FreshnessMeta;
}

// ---------- GET /api/reports/conciliacao/extrato (27/08) ----------
export interface ExtratoLinha { nsu: string; valor: number; data: string; hora: string; adquirente: string; bandeira: string; pdv: string; autorizacao: string }
export interface PagamentoSistema { id: string; valor: number; data: string; hora: string; forma: string }
export type EstadoConciliacao = 'conciliado' | 'so_no_extrato' | 'so_no_sistema';
export interface ItemConciliado {
  estado: EstadoConciliacao; data: string; valor: number;
  extrato?: ExtratoLinha; sistema?: PagamentoSistema; via?: 'direto' | 'outra_forma';
}
export interface ConciliacaoDia { data: string; extratoQtd: number; extratoValor: number; sistemaQtd: number; sistemaValor: number; diferenca: number; completo: boolean }
export interface ExtratoResponse {
  periodo: { from: string; to: string };
  fronteiraSync: string | null; // ultimo dia sincronizado: dele em diante nada e julgado
  extrato: { linhas: number; autorizadas: number; paginas: number };
  porDia: ConciliacaoDia[];
  totais: {
    extratoQtd: number; extratoValor: number; sistemaQtd: number; sistemaValor: number;
    conciliados: number; soNoExtrato: number; soNoSistema: number;
    valorSoNoExtrato: number; valorSoNoSistema: number;
  };
  diasIgnorados: string[];
  problemas: ItemConciliado[];
  meta: FreshnessMeta;
}
export interface IntegracoesResponse { getcard: { user: string | null; temSenha: boolean } }
