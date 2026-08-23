import type { AgentConfig } from '../config.js';
import { getFirebirdPool } from '../firebird/manager.js';
import { getCheckpoint, setCheckpoint } from './checkpoint.js';
import { resolveReport } from '../catalog/index.js';
import { detectFinancialSchema } from '../firebird/schemaDetect.js';
import { logger } from '../logger.js';

// Loop de sincronizacao incremental.
// Le pelo catalogo (sync-sales-batch etc), empurra ao SaaS via HTTP POST.

const BATCH_SIZE = 1000;

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
  return setInterval(async () => {
    try {
      const persisted = await syncSales(cfg);
      if (persisted > 0) logger.info({ table: 'sales', persisted }, 'sync tick');
    } catch (err) {
      logger.error({ err }, 'sync tick failed');
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
  }, cfg.syncIntervalMs);
}
