import type { AgentConfig } from '../config.js';
import { getFirebirdPool } from '../firebird/manager.js';
import { getCheckpoint, setCheckpoint } from './checkpoint.js';
import { resolveReport } from '../catalog/index.js';
import { detectFinancialSchema } from '../firebird/schemaDetect.js';
import { logger } from '../logger.js';

// Loop de sincronizacao incremental.
// Le pelo catalogo (sync-sales-batch etc), empurra ao SaaS via HTTP POST.

// Reduzido de 1000 -> 200 em 24/08 (incidente real): cada upsert paga ~180ms de RTT ate o
// Supabase (medido); com 5 tabelas sincronizando (sales/saleItems/payments/payables/
// receivables) e lote de 1000, cada tick levava 30-60s+ — mais que o intervalo do proprio
// tick (syncIntervalMs=30s), entao os ciclos comecaram a se EMPILHAR (setInterval nao
// espera o anterior terminar), afogando o pool de conexao do backend e derrubando
// respostas normais do dashboard pro usuario (500/504 reais vistos por Tarcisio 24/08,
// 996 requests de /api/agent/sync levando ate 60s). Lote menor = cada tick termina bem
// dentro da janela de 30s, sem empilhar.
const BATCH_SIZE = 200;

interface PushResult {
  persisted: number;
}

async function postBatch(cfg: AgentConfig, table: string, rows: unknown[], checkpoint: string): Promise<PushResult> {
  const url = `${cfg.saasUrl}/api/agent/sync`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.token}`,
    },
    body: JSON.stringify({ table, rows, checkpoint }),
  });
  if (!res.ok) throw new Error(`sync push failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as PushResult;
}

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
    customer_source_id: string | null;
    operator_name: string | null;
    caixa: string | null;
    modelo: string | null;
    natureza: string | null;
    total_value: number;
    cancelled: number | string;
    processed: number | string;
  }>(entry.sql, [BATCH_SIZE, afterId]);
  if (rows.length === 0) return 0;

  const camelRows = rows.map((r) => ({
    sourceId: String(r.source_id),
    saleDate: new Date(r.sale_date).toISOString(),
    customerSourceId: r['customer_source_id'] ? String(r['customer_source_id']) : null,
    operatorName: r['operator_name'] ?? null,
    caixa: r['caixa'] ?? null,
    modelo: r['modelo'] ?? null,
    natureza: r['natureza'] ?? null,
    totalValue: Number(r.total_value),
    cancelled: r['cancelled'] === 1 || r['cancelled'] === '1',
    processed: r['processed'] === 1 || r['processed'] === '1',
  }));

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

  const camelRows = rows.map((r) => ({
    sourceId: String(r.source_id),
    saleSourceId: String(r.sale_source_id),
    productCode: r['product_code'] ? String(r['product_code']) : null,
    description: r['description'] ? String(r['description']) : null,
    quantity: Number(r.quantity),
    unitValue: Number(r.unit_value),
    totalValue: Number(r.total_value),
  }));

  const lastId = String(rows[rows.length - 1]!.source_id);
  const { persisted } = await postBatch(cfg, 'saleItems', camelRows, lastId);
  setCheckpoint('saleItems', lastId);
  return persisted;
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
  }>(entry.sql, [BATCH_SIZE, afterId]);
  if (rows.length === 0) return 0;

  const camelRows = rows.map((r) => ({
    sourceId: String(r.source_id),
    saleSourceId: r['sale_source_id'] != null ? String(r['sale_source_id']) : null,
    paymentDate: new Date(r.payment_date).toISOString(),
    paymentType: r['payment_type'] ? String(r['payment_type']) : 'OUTROS',
    especie: r['especie'] ? String(r['especie']) : null,
    value: Number(r.total_value),
  }));

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
    (r) => ({
      sourceId: String(r['source_id']),
      dueDate: new Date(String(r['due_date'])).toISOString(),
      value: Number(r['total_value']),
      paidValue: Number(r['paid_value'] ?? 0),
      paidDate: r['paid_date'] ? new Date(String(r['paid_date'])).toISOString() : null,
      counterparty: r['counterparty'] || null,
      description: r['description'] || null,
      cancelled: r['cancelled'] === 1 || r['cancelled'] === '1',
    }),
  );
}

function syncReceivables(cfg: AgentConfig): Promise<number> {
  return syncFinancialTable(
    cfg,
    { pagar_receber: 'sync-receivables-batch-receber', contas_pagar_receber: 'sync-receivables-batch-contas-receber' },
    'receivables',
    'receivables',
    (r) => ({
      sourceId: String(r['source_id']),
      dueDate: new Date(String(r['due_date'])).toISOString(),
      value: Number(r['total_value']),
      receivedValue: Number(r['received_value'] ?? 0),
      receivedDate: r['received_date'] ? new Date(String(r['received_date'])).toISOString() : null,
      counterparty: r['counterparty'] || null,
      description: r['description'] || null,
      cancelled: r['cancelled'] === 1 || r['cancelled'] === '1',
    }),
  );
}

export function startSyncLoop(cfg: AgentConfig): NodeJS.Timeout {
  // Trava contra sobreposicao: setInterval dispara um novo tick mesmo se o anterior ainda
  // estiver rodando. Se um tick demorar mais que syncIntervalMs (rede lenta, tabela grande),
  // ticks empilhados multiplicam a carga no backend em vez de so atrasar — foi exatamente
  // isso que derrubou o dashboard do Tarcisio em 24/08. Um tick em andamento faz o proximo
  // simplesmente pular, nunca rodar em paralelo com o de antes.
  let running = false;
  return setInterval(async () => {
    if (running) {
      logger.warn('sync tick anterior ainda rodando, pulando este ciclo');
      return;
    }
    running = true;
    try {
      try {
        const persisted = await syncSales(cfg);
        if (persisted > 0) logger.info({ table: 'sales', persisted }, 'sync tick');
      } catch (err) {
        logger.error({ err }, 'sync tick failed');
      }
      try {
        const persisted = await syncSaleItems(cfg);
        if (persisted > 0) logger.info({ table: 'saleItems', persisted }, 'sync tick');
      } catch (err) {
        logger.error({ err }, 'sync tick failed (saleItems)');
      }
      try {
        const persisted = await syncPayments(cfg);
        if (persisted > 0) logger.info({ table: 'payments', persisted }, 'sync tick');
      } catch (err) {
        logger.error({ err }, 'sync tick failed (payments)');
      }
      try {
        const persisted = await syncPayables(cfg);
        if (persisted > 0) logger.info({ table: 'payables', persisted }, 'sync tick');
      } catch (err) {
        logger.error({ err }, 'sync tick failed (payables)');
      }
      try {
        const persisted = await syncReceivables(cfg);
        if (persisted > 0) logger.info({ table: 'receivables', persisted }, 'sync tick');
      } catch (err) {
        logger.error({ err }, 'sync tick failed (receivables)');
      }
    } finally {
      running = false;
    }
  }, cfg.syncIntervalMs);
}
