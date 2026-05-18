import type { AgentConfig } from '../config.js';
import { getFirebirdPool } from '../firebird/manager.js';
import { getCheckpoint, setCheckpoint } from './checkpoint.js';
import { resolveReport } from '../catalog/index.js';
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
  const rows = await pool.query<{ source_id: number; sale_date: string; total_value: number }>(
    entry.sql,
    [BATCH_SIZE, afterId],
  );
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

export function startSyncLoop(cfg: AgentConfig): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      const persisted = await syncSales(cfg);
      if (persisted > 0) logger.info({ table: 'sales', persisted }, 'sync tick');
    } catch (err) {
      logger.error({ err }, 'sync tick failed');
    }
  }, cfg.syncIntervalMs);
}
