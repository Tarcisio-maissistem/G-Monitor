import fs from 'node:fs';
import path from 'node:path';
import type { AgentConfig } from '../config.js';
import { getDataDir } from '../config.js';
import { getFirebirdPool } from '../firebird/manager.js';
import { getCheckpoint, setCheckpoint } from './checkpoint.js';
import { resolveReport } from '../catalog/index.js';
import { detectFinancialSchema } from '../firebird/schemaDetect.js';
import { logger } from '../logger.js';
import { AGENT_VERSION } from '../version.js';

// Loop de sincronizacao incremental.
// Le pelo catalogo (sync-sales-batch etc), empurra ao SaaS via HTTP POST.

// Reduzido de 1000 -> 200 em 24/08 (incidente real, causa raiz na epoca: backend fazia UM
// upsert Prisma por linha — 200-1000 round-trips de rede por lote). Voltado a 1000 em 25/08
// (decisao D14, ver openspec/design.md): o backend agora faz bulk upsert (1 statement por
// lote inteiro, nao 1 por linha) num pool de conexao isolado so pro sync — o problema que
// motivou reduzir o lote deixou de existir. Lote maior = backlog grande (ex: loja nova synca
// desde o começo) termina em muito menos ticks.
const BATCH_SIZE = 1000;

interface PushResult {
  persisted: number;
  skipped?: Array<{ table: string; sourceId: string; motivo: string }>;
}

// Linhas que a nuvem recusou (valor invalido) ficam registradas aqui: antes o checkpoint passava
// por cima e a linha sumia em silencio (auditoria 04/09). O arquivo e a "dead-letter" pra conferir.
function registrarPuladas(skipped: PushResult['skipped']): void {
  if (!skipped?.length) return;
  try {
    const linha = skipped.map((s) => `${new Date().toISOString()} ${s.table} id=${s.sourceId} ${s.motivo}`).join('\n') + '\n';
    fs.appendFileSync(path.join(getDataDir(), 'sync-deadletter.log'), linha, 'utf-8');
  } catch { /* log local nao pode derrubar o sync */ }
  logger.warn({ puladas: skipped.length, exemplos: skipped.slice(0, 3) }, 'linhas recusadas pela nuvem (dead-letter)');
}

async function postBatch(cfg: AgentConfig, table: string, rows: unknown[], checkpoint: string, recent = false): Promise<PushResult> {
  const url = `${cfg.saasUrl}/api/agent/sync`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.token}`,
      // backend grava em Agent.agentVersion — o painel mostra "v0.8.0 · nova versao disponivel"
      'x-agent-version': AGENT_VERSION,
    },
    // recent=true: janela recente (reenvio de alteracoes) — a nuvem nao avanca checkpoint nem freia
    body: JSON.stringify({ table, rows, checkpoint, ...(recent ? { recent: true } : {}) }),
  });
  if (!res.ok) throw new Error(`sync push failed: ${res.status} ${await res.text()}`);
  const out = (await res.json()) as PushResult;
  registrarPuladas(out.skipped);
  return out;
}

// Mapeadores Firebird -> payload (compartilhados pelo incremental e pela janela recente).
const mapSale = (r: any) => ({
    sourceId: String(r.source_id),
    saleDate: new Date(r.sale_date).toISOString(),
    // HORA_SAIDA -> saleHour (0-23). Vazio no GDOOR = null; nunca vira 0 (0 e meia-noite real).
    saleHour: r['sale_hour'] == null ? null : Number(r['sale_hour']),
    customerSourceId: r['customer_source_id'] ? String(r['customer_source_id']) : null,
    operatorName: r['operator_name'] ?? null,
    // VENDEDOR pode vir string vazia (64% preenchido) — normaliza pra null pra nao poluir o ranking.
    sellerName: r['seller_name'] && String(r['seller_name']).trim() !== '' ? String(r['seller_name']).trim() : null,
    caixa: r['caixa'] ?? null,
    modelo: r['modelo'] ?? null,
    natureza: r['natureza'] ?? null,
    totalValue: Number(r.total_value),
    cancelled: r['cancelled'] === 1 || r['cancelled'] === '1',
    processed: r['processed'] === 1 || r['processed'] === '1',
  });
const mapSaleItem = (r: any) => ({
    sourceId: String(r.source_id),
    saleSourceId: String(r.sale_source_id),
    productCode: r['product_code'] ? String(r['product_code']) : null,
    description: r['description'] ? String(r['description']) : null,
    quantity: Number(r.quantity),
    unitValue: Number(r.unit_value),
    totalValue: Number(r.total_value),
  });
const mapPayment = (r: any) => ({
    sourceId: String(r.source_id),
    saleSourceId: r['sale_source_id'] != null ? String(r['sale_source_id']) : null,
    paymentDate: new Date(r.payment_date).toISOString(),
    paymentType: r['payment_type'] ? String(r['payment_type']) : 'OUTROS',
    especie: r['especie'] ? String(r['especie']) : null,
    value: Number(r.total_value),
    kind: paymentKind(r['tipo']),
    obs: r['obs'] ? String(r['obs']).trim() : null,
    caixa: r['caixa'] != null ? String(r['caixa']).trim() : null,
    operador: r['operador'] != null ? String(r['operador']).trim() : null,
  });
const mapCashClosing = (r: any) => ({
    sourceId: String(r['source_id']),
    pdv: r['pdv'] != null ? String(r['pdv']) : null,
    openedAt: combineDateTime(r['data_abertura'], r['hora_abertura']),
    closedAt: combineDateTime(r['data_fechamento'], r['hora_fechamento']),
    openingAmount: r['valor_abertura'] != null ? Number(r['valor_abertura']) : null,
    totalCounted: r['valor_fechamento'] != null ? Number(r['valor_fechamento']) : null,
    operatorName: r['id_usuario_fechamento'] != null ? String(r['id_usuario_fechamento']) : null,
  });
const mapCardTransaction = (r: any) => ({
    sourceId: String(r['source_id']),
    acquirer: r['acquirer'] != null ? String(r['acquirer']).trim() : null,
    nsu: r['nsu'] != null ? String(r['nsu']).trim() : null,
    authCode: r['auth_code'] != null ? String(r['auth_code']).trim() : null,
    value: Number(r['transaction_value'] ?? 0),
    installments: r['installments'] != null ? Number(r['installments']) : null,
    transactionAt: combineDateTime(r['data'], r['hora']),
    // PROCESSADA e 0/1 no Firebird; 0 = cobrou e nao fechou a venda
    processed: Number(r['processada'] ?? 1) === 1,
    paymentSourceId: r['payment_source_id'] != null ? String(r['payment_source_id']) : null,
  });
const mapCashClosingSpecies = (r: any) => ({
    sourceId: String(r['source_id']),
    closingSourceId: String(r['closing_source_id']),
    especie: String(r['especie'] ?? ''),
    counted: Number(r['counted'] ?? 0),
  });
const mapPayable = (r: any) => ({
      sourceId: String(r['source_id']),
      dueDate: new Date(String(r['due_date'])).toISOString(),
      value: Number(r['total_value']),
      paidValue: Number(r['paid_value'] ?? 0),
      paidDate: r['paid_date'] ? new Date(String(r['paid_date'])).toISOString() : null,
      counterparty: r['counterparty'] || null,
      description: r['description'] || null,
      cancelled: r['cancelled'] === 1 || r['cancelled'] === '1',
    });
const mapReceivable = (r: any) => ({
      sourceId: String(r['source_id']),
      dueDate: new Date(String(r['due_date'])).toISOString(),
      value: Number(r['total_value']),
      receivedValue: Number(r['received_value'] ?? 0),
      receivedDate: r['received_date'] ? new Date(String(r['received_date'])).toISOString() : null,
      counterparty: r['counterparty'] || null,
      description: r['description'] || null,
      cancelled: r['cancelled'] === 1 || r['cancelled'] === '1',
    });

async function syncSales(cfg: AgentConfig): Promise<number> {
  const pool = getFirebirdPool();
  if (!pool) return 0;

  const entry = resolveReport('sync-sales-batch')!;
  const checkpoint = getCheckpoint('sales') ?? '0';
  const afterId = Number(checkpoint);
  // SQL usa FIRST N — primeiro parametro é o limit, depois afterId.
  const rows = await pool.query<{
    source_id: number;
    sale_date: string;
    sale_hour: number | null;
    customer_source_id: string | null;
    operator_name: string | null;
    seller_name: string | null;
    caixa: string | null;
    modelo: string | null;
    natureza: string | null;
    total_value: number;
    cancelled: number | string;
    processed: number | string;
  }>(entry.sql, [BATCH_SIZE, afterId]);
  if (rows.length === 0) return 0;

  const camelRows = rows.map(mapSale);

  const lastId = String(rows[rows.length - 1]!.source_id);
  const { persisted } = await postBatch(cfg, 'sales', camelRows, lastId);
  setCheckpoint('sales', lastId);
  return persisted;
}

async function syncSaleItems(cfg: AgentConfig): Promise<number> {
  const pool = getFirebirdPool();
  if (!pool) return 0;

  const entry = resolveReport('sync-sale-items-batch')!;
  const checkpoint = getCheckpoint('saleItems') ?? '0';
  const afterId = Number(checkpoint);
  const rows = await pool.query<{
    source_id: number;
    sale_source_id: number;
    product_code: string | null;
    description: string | null;
    quantity: number;
    unit_value: number;
    total_value: number;
  }>(entry.sql, [BATCH_SIZE, afterId]);
  if (rows.length === 0) return 0;

  const camelRows = rows.map(mapSaleItem);

  const lastId = String(rows[rows.length - 1]!.source_id);
  const { persisted } = await postBatch(cfg, 'saleItems', camelRows, lastId);
  setCheckpoint('saleItems', lastId);
  return persisted;
}

// MOV_OPERADORES.TIPO (confirmado na prod 26/08): 'PV 000442662' (pagamento da pre-venda),
// 'NFC-e P 143955' (NFC-e direta, sem PV — anomalia), 'NOTA FISCAL' (NF-e 55),
// 'Recebimentos' (baixa de credito/carteira no PDV), 'SANGRIA', 'SUPRIMENTO'.
// Sangria/suprimento NAO sao receita (P5) — antes entravam no caixa como "avulsos".
function paymentKind(tipo: string | null | undefined): string {
  const t = String(tipo ?? '').trim().toUpperCase();
  if (t === 'SANGRIA') return 'sangria';
  if (t === 'SUPRIMENTO') return 'suprimento';
  if (t.startsWith('RECEB')) return 'recebimento';
  if (t.startsWith('PV ') || t.startsWith('NFC-E') || t === 'NOTA FISCAL') return 'venda';
  return 'outro';
}

async function syncPayments(cfg: AgentConfig): Promise<number> {
  const pool = getFirebirdPool();
  if (!pool) return 0;

  const entry = resolveReport('sync-payments-batch')!;
  const checkpoint = getCheckpoint('payments') ?? '0';
  const afterId = Number(checkpoint);
  const rows = await pool.query<{
    source_id: number;
    sale_source_id: number | null;
    payment_date: string;
    payment_type: string | null;
    especie: string | null;
    total_value: number;
    tipo: string | null;
  }>(entry.sql, [BATCH_SIZE, afterId]);
  if (rows.length === 0) return 0;

  const camelRows = rows.map(mapPayment);

  const lastId = String(rows[rows.length - 1]!.source_id);
  const { persisted } = await postBatch(cfg, 'payments', camelRows, lastId);
  setCheckpoint('payments', lastId);
  return persisted;
}

// Sincroniza uma tabela financeira (payables/receivables) usando o mapeamento de campos passado.
// Escolhe o catalogo certo pela variante de schema detectada (ver design.md D11):
// 'pagar_receber' (PAGAR/RECEBER, CONFIRMADA em producao 22/08) ou 'contas_pagar_receber'
// (CONTAS_PAGAR/CONTAS_RECEBER, so inferida do codigo legado — mantida como fallback).
async function syncFinancialTable(
  cfg: AgentConfig,
  reportIdByVariant: Record<'pagar_receber' | 'contas_pagar_receber', string>,
  checkpointKey: 'payables' | 'receivables',
  syncTable: 'payables' | 'receivables',
  mapRow: (r: Record<string, unknown>) => Record<string, unknown>,
): Promise<number> {
  const pool = getFirebirdPool();
  if (!pool) return 0;

  const schema = await detectFinancialSchema(pool);
  if (schema !== 'pagar_receber' && schema !== 'contas_pagar_receber') return 0;

  const entry = resolveReport(reportIdByVariant[schema])!;
  const checkpoint = getCheckpoint(checkpointKey) ?? '0';
  const afterId = Number(checkpoint);
  const rows = await pool.query<Record<string, unknown>>(entry.sql, [BATCH_SIZE, afterId]);
  if (rows.length === 0) return 0;

  const camelRows = rows.map(mapRow);
  const lastId = String(rows[rows.length - 1]!['source_id']);
  const { persisted } = await postBatch(cfg, syncTable, camelRows, lastId);
  setCheckpoint(checkpointKey, lastId);
  return persisted;
}

function syncPayables(cfg: AgentConfig): Promise<number> {
  return syncFinancialTable(
    cfg,
    { pagar_receber: 'sync-payables-batch-pagar', contas_pagar_receber: 'sync-payables-batch-contas-pagar' },
    'payables',
    'payables',
    mapPayable,
  );
}

function syncReceivables(cfg: AgentConfig): Promise<number> {
  return syncFinancialTable(
    cfg,
    { pagar_receber: 'sync-receivables-batch-receber', contas_pagar_receber: 'sync-receivables-batch-contas-receber' },
    'receivables',
    'receivables',
    mapReceivable,
  );
}

// Religado em 25/08 (decisao D14, aprovada pelo dono): estava DESLIGADO desde 24/08 porque
// ITEVENDAS (652 mil linhas) e MOV_OPERADORES (195 mil, piloto) derrubavam /api/reports/*
// do dono com P1001 — nao era fila lenta, era literalmente 1 round-trip de rede POR LINHA
// upsertada, competindo pelo mesmo connection_limit dos relatorios. Fix real (nao so
// cosmetico de lote/intervalo): backend agora faz bulk upsert num pool de conexao isolado
// (ver syncRoutes.ts + db/prisma.ts). Se voltar a dar problema, LIGAR ESSA FLAG DE VOLTA
// PARA false e investigar antes de tentar de novo — nao ajustar so lote/concorrencia.
const SYNC_SALE_ITEMS_AND_PAYMENTS_ENABLED = true;

// DATE + TIME separados no GDOOR -> um ISO so. TIME vem como Date de 1970 (node-firebird).
function combineDateTime(d: unknown, t: unknown): string | null {
  if (!d) return null;
  const date = new Date(String(d));
  if (t) {
    const time = new Date(String(t));
    date.setUTCHours(time.getUTCHours(), time.getUTCMinutes(), time.getUTCSeconds(), 0);
  }
  return date.toISOString();
}

// FECHAMENTO_CAIXA -> cashClosings (D20). Volume pequeno (~5k linhas no piloto).
async function syncCashClosings(cfg: AgentConfig): Promise<number> {
  const pool = getFirebirdPool();
  if (!pool) return 0;
  const entry = resolveReport('sync-cash-closings-batch')!;
  const afterId = Number(getCheckpoint('cashClosings') ?? '0');
  const rows = await pool.query<Record<string, unknown>>(entry.sql, [BATCH_SIZE, afterId]);
  if (rows.length === 0) return 0;
  const camelRows = rows.map(mapCashClosing);
  const lastId = String(rows[rows.length - 1]!['source_id']);
  const { persisted } = await postBatch(cfg, 'cashClosings', camelRows, lastId);
  setCheckpoint('cashClosings', lastId);
  return persisted;
}

async function syncCardTransactions(cfg: AgentConfig): Promise<number> {
  const pool = getFirebirdPool();
  if (!pool) return 0;
  const entry = resolveReport('sync-card-transactions-batch')!;
  const afterId = Number(getCheckpoint('cardTransactions') ?? '0');
  const rows = await pool.query<Record<string, unknown>>(entry.sql, [BATCH_SIZE, afterId]);
  if (rows.length === 0) return 0;
  const camelRows = rows.map(mapCardTransaction);
  const lastId = String(rows[rows.length - 1]!['source_id']);
  const { persisted } = await postBatch(cfg, 'cardTransactions', camelRows, lastId);
  setCheckpoint('cardTransactions', lastId);
  return persisted;
}

async function syncCashClosingSpecies(cfg: AgentConfig): Promise<number> {
  const pool = getFirebirdPool();
  if (!pool) return 0;
  const entry = resolveReport('sync-cash-closing-species-batch')!;
  const afterId = Number(getCheckpoint('cashClosingSpecies') ?? '0');
  const rows = await pool.query<Record<string, unknown>>(entry.sql, [BATCH_SIZE, afterId]);
  if (rows.length === 0) return 0;
  const camelRows = rows.map(mapCashClosingSpecies);
  const lastId = String(rows[rows.length - 1]!['source_id']);
  const { persisted } = await postBatch(cfg, 'cashClosingSpecies', camelRows, lastId);
  setCheckpoint('cashClosingSpecies', lastId);
  return persisted;
}

// Estado do loop no modulo: o RPC 'syncNow' (botao "Sincronizar" do painel) e o handshake
// (intervalo ditado pelo servidor) precisam alcancar o tick e o timer sem ter o cfg na mao.

// JANELA RECENTE (0.9.8, auditoria 04/09): o incremental so ve ID novo, entao venda cancelada
// depois, titulo baixado depois ou valor editado NUNCA subia. Quando a tabela esta em dia,
// reenvia tudo com data nos ultimos RECENT_DAYS dias — a nuvem faz upsert, o checkpoint fica quieto.
const RECENT_DAYS = 7;
// A janela recente reenvia milhares de linhas; rodar a cada tick (1h) pesa no plano free da
// Supabase sem necessidade — cancelamento/baixa de ontem nao muda de minuto em minuto. Uma vez
// a cada 6h por tabela ja pega tudo bem antes do fechamento do dia. Marca no proprio sync.json.
const RECENT_INTERVAL_MS = 6 * 60 * 60 * 1000;
function podeRodarRecente(table: string): boolean {
  const ultimo = Number(getCheckpoint(`recent:${table}`) ?? '0');
  return Date.now() - ultimo >= RECENT_INTERVAL_MS;
}
function desdeRecente(): Date {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - RECENT_DAYS); return d;
}
async function syncRecent(cfg: AgentConfig, table: string, entryId: string, mapRow: (r: any) => unknown, params: unknown[]): Promise<number> {
  const pool = getFirebirdPool();
  if (!pool) return 0;
  const entry = resolveReport(entryId);
  if (!entry) return 0;
  const rows = await pool.query<Record<string, unknown>>(entry.sql, params);
  if (rows.length === 0) return 0;
  const { persisted } = await postBatch(cfg, table, rows.map(mapRow), getCheckpoint(table) ?? '0', true);
  return persisted;
}
async function janelaRecente(cfg: AgentConfig, emDia: Record<string, boolean>): Promise<void> {
  const since = desdeRecente();
  const plano: Array<[string, string, (r: any) => unknown, unknown[]]> = [
    ['sales', 'sync-sales-recent', mapSale, [2000, since]],
    ['saleItems', 'sync-sale-items-recent', mapSaleItem, [5000, since]],
    ['payments', 'sync-payments-recent', mapPayment, [5000, since]],
    ['cashClosings', 'sync-cash-closings-recent', mapCashClosing, [2000, since]],
    ['cashClosingSpecies', 'sync-cash-closing-species-recent', mapCashClosingSpecies, [5000, since]],
    ['cardTransactions', 'sync-card-transactions-recent', mapCardTransaction, [5000, since]],
  ];
  const pool = getFirebirdPool();
  if (pool && (await detectFinancialSchema(pool)) === 'pagar_receber') {
    plano.push(['payables', 'sync-payables-recent-pagar', mapPayable, [5000, since, since]]);
    plano.push(['receivables', 'sync-receivables-recent-receber', mapReceivable, [5000, since, since]]);
  }
  for (const [table, entryId, mapRow, params] of plano) {
    if (!emDia[table]) continue; // ainda em backfill: nao gastar a nuvem com reenvio
    if (!podeRodarRecente(table)) continue; // ja rodou ha menos de 6h
    try {
      const n = await syncRecent(cfg, table, entryId, mapRow, params);
      setCheckpoint(`recent:${table}`, String(Date.now()));
      if (n > 0) logger.info({ table, reenviadas: n, dias: RECENT_DAYS }, 'janela recente');
    } catch (err) {
      logger.warn({ err, table }, 'janela recente falhou (segue no proximo tick)');
    }
  }
}

let cfgAtual: AgentConfig | null = null;
let timerAtual: NodeJS.Timeout | null = null;
let intervaloAtualMs = 0;
let running = false;

/** Roda UM ciclo completo agora (todas as tabelas). Ignora se ja houver um em andamento. */
export async function runSyncTick(): Promise<boolean> {
  if (!cfgAtual) return false;
  if (running) { logger.warn('sync tick anterior ainda rodando, pulando este ciclo'); return false; }
  await tick(cfgAtual);
  return true;
}

/** Aplica um intervalo novo (ex.: o que o servidor manda no handshake) sem reiniciar o agente. */
export function setSyncInterval(ms: number): void {
  if (!cfgAtual || !Number.isFinite(ms) || ms < 30_000 || ms === intervaloAtualMs) return;
  if (timerAtual) clearInterval(timerAtual);
  intervaloAtualMs = ms;
  timerAtual = setInterval(() => void runSyncTick(), ms);
  logger.info({ syncIntervalMs: ms }, 'intervalo de sync ajustado pelo servidor');
}

export function startSyncLoop(cfg: AgentConfig): NodeJS.Timeout {
  cfgAtual = cfg;
  intervaloAtualMs = cfg.syncIntervalMs;
  // Primeiro ciclo logo apos subir (1 min): com intervalo de 1h, esperar a 1a hora inteira
  // deixaria a loja "sem dado" logo depois de instalar.
  setTimeout(() => void runSyncTick(), 60_000);
  timerAtual = setInterval(() => void runSyncTick(), cfg.syncIntervalMs);
  return timerAtual;
}

// Trava contra sobreposicao: se um tick demorar mais que o intervalo (rede lenta, tabela
// grande), ticks empilhados multiplicam a carga no backend em vez de so atrasar — foi
// exatamente isso que derrubou o dashboard do Tarcisio em 24/08.
async function tick(cfg: AgentConfig): Promise<void> {
  {
    running = true;
    const emDia: Record<string, boolean> = {}; // tabela sem lote novo neste tick = em dia
    try {
      try {
        const persisted = await syncSales(cfg);
        emDia['sales'] = persisted === 0;
        if (persisted > 0) logger.info({ table: 'sales', persisted }, 'sync tick');
      } catch (err) {
        logger.error({ err }, 'sync tick failed');
      }
      if (SYNC_SALE_ITEMS_AND_PAYMENTS_ENABLED) {
        try {
          const persisted = await syncSaleItems(cfg);
          emDia['saleItems'] = persisted === 0;
          if (persisted > 0) logger.info({ table: 'saleItems', persisted }, 'sync tick');
        } catch (err) {
          logger.error({ err }, 'sync tick failed (saleItems)');
        }
        try {
          const persisted = await syncPayments(cfg);
          emDia['payments'] = persisted === 0;
          if (persisted > 0) logger.info({ table: 'payments', persisted }, 'sync tick');
        } catch (err) {
          logger.error({ err }, 'sync tick failed (payments)');
        }
      }
      try {
        const persisted = await syncPayables(cfg);
        emDia['payables'] = persisted === 0;
        if (persisted > 0) logger.info({ table: 'payables', persisted }, 'sync tick');
      } catch (err) {
        logger.error({ err }, 'sync tick failed (payables)');
      }
      // D20 Conferencia de Caixa: fechamentos (pai) antes das especies (filhas resolvem FK)
      for (const [name, fn] of [['cashClosings', syncCashClosings], ['cashClosingSpecies', syncCashClosingSpecies], ['cardTransactions', syncCardTransactions]] as const) {
        try {
          const persisted = await fn(cfg);
          emDia[name] = persisted === 0;
          if (persisted > 0) logger.info({ table: name, persisted }, 'sync tick');
        } catch (err) {
          logger.error({ err }, `sync tick failed (${name})`);
        }
      }
      try {
        const persisted = await syncReceivables(cfg);
        emDia['receivables'] = persisted === 0;
        if (persisted > 0) logger.info({ table: 'receivables', persisted }, 'sync tick');
      } catch (err) {
        logger.error({ err }, 'sync tick failed (receivables)');
      }
      await janelaRecente(cfg, emDia);
    } finally {
      running = false;
    }
  }
}
