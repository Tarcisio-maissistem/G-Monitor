import type { AgentConfig } from '../config.js';
import { getFirebirdPool } from '../firebird/manager.js';
import { getCheckpoint, setCheckpoint } from './checkpoint.js';
import { resolveReport } from '../catalog/index.js';
import { detectFinancialSchema } from '../firebird/schemaDetect.js';
import { logger } from '../logger.js';

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

  const camelRows = rows.map((r) => ({
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

  const camelRows = rows.map((r) => ({
    sourceId: String(r.source_id),
    saleSourceId: r['sale_source_id'] != null ? String(r['sale_source_id']) : null,
    paymentDate: new Date(r.payment_date).toISOString(),
    paymentType: r['payment_type'] ? String(r['payment_type']) : 'OUTROS',
    especie: r['especie'] ? String(r['especie']) : null,
    value: Number(r.total_value),
    kind: paymentKind(r['tipo']),
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
  const camelRows = rows.map((r) => ({
    sourceId: String(r['source_id']),
    pdv: r['pdv'] != null ? String(r['pdv']) : null,
    openedAt: combineDateTime(r['data_abertura'], r['hora_abertura']),
    closedAt: combineDateTime(r['data_fechamento'], r['hora_fechamento']),
    openingAmount: r['valor_abertura'] != null ? Number(r['valor_abertura']) : null,
    totalCounted: r['valor_fechamento'] != null ? Number(r['valor_fechamento']) : null,
    operatorName: r['id_usuario_fechamento'] != null ? String(r['id_usuario_fechamento']) : null,
  }));
  const lastId = String(rows[rows.length - 1]!['source_id']);
  const { persisted } = await postBatch(cfg, 'cashClosings', camelRows, lastId);
  setCheckpoint('cashClosings', lastId);
  return persisted;
}

async function syncCashClosingSpecies(cfg: AgentConfig): Promise<number> {
  const pool = getFirebirdPool();
  if (!pool) return 0;
  const entry = resolveReport('sync-cash-closing-species-batch')!;
  const afterId = Number(getCheckpoint('cashClosingSpecies') ?? '0');
  const rows = await pool.query<Record<string, unknown>>(entry.sql, [BATCH_SIZE, afterId]);
  if (rows.length === 0) return 0;
  const camelRows = rows.map((r) => ({
    sourceId: String(r['source_id']),
    closingSourceId: String(r['closing_source_id']),
    especie: String(r['especie'] ?? ''),
    counted: Number(r['counted'] ?? 0),
  }));
  const lastId = String(rows[rows.length - 1]!['source_id']);
  const { persisted } = await postBatch(cfg, 'cashClosingSpecies', camelRows, lastId);
  setCheckpoint('cashClosingSpecies', lastId);
  return persisted;
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
      if (SYNC_SALE_ITEMS_AND_PAYMENTS_ENABLED) {
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
      }
      try {
        const persisted = await syncPayables(cfg);
        if (persisted > 0) logger.info({ table: 'payables', persisted }, 'sync tick');
      } catch (err) {
        logger.error({ err }, 'sync tick failed (payables)');
      }
      // D20 Conferencia de Caixa: fechamentos (pai) antes das especies (filhas resolvem FK)
      for (const [name, fn] of [['cashClosings', syncCashClosings], ['cashClosingSpecies', syncCashClosingSpecies]] as const) {
        try {
          const persisted = await fn(cfg);
          if (persisted > 0) logger.info({ table: name, persisted }, 'sync tick');
        } catch (err) {
          logger.error({ err }, `sync tick failed (${name})`);
        }
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
