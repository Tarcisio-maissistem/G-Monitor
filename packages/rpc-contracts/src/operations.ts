import { z } from 'zod';

// Cada operacao RPC: schema de params + schema de result.

export const opPing = {
  name: 'ping',
  params: z.object({ nonce: z.string() }),
  result: z.object({ nonce: z.string(), uptimeSeconds: z.number() }),
};

export const opGetAgentInfo = {
  name: 'getAgentInfo',
  params: z.object({}),
  result: z.object({
    agentVersion: z.string(),
    protocolVersion: z.string(),
    os: z.string(),
    firebirdVersion: z.string().nullable(),
    firebirdPath: z.string().nullable(),
    fdbPath: z.string().nullable(),
    poolActive: z.number().int(),
    rpcPending: z.number().int(),
  }),
};

export const opGetSchema = {
  name: 'getSchema',
  params: z.object({ table: z.string().optional() }),
  result: z.object({
    tables: z.array(
      z.object({
        name: z.string(),
        columns: z.array(
          z.object({ name: z.string(), type: z.string(), nullable: z.boolean() }),
        ),
      }),
    ),
  }),
};

// runReport: backend nunca envia SQL. Envia reportId; agente resolve via catalogo assinado.
export const opRunReport = {
  name: 'runReport',
  params: z.object({
    reportId: z.string(),
    params: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  }),
  result: z.object({
    columns: z.array(z.string()),
    rows: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))),
    rowCount: z.number().int(),
    durationMs: z.number(),
  }),
};

// syncTick: backend pede ao agente para empurrar deltas pendentes de todas as tabelas.
export const opSyncTick = {
  name: 'syncTick',
  params: z.object({ tables: z.array(z.string()).optional() }),
  result: z.object({
    tablesProcessed: z.array(
      z.object({ name: z.string(), rowsSent: z.number().int(), newCheckpoint: z.string() }),
    ),
    totalRows: z.number().int(),
  }),
};

// syncBatch: agente envia ao backend (sentido inverso). Backend persiste em Postgres SaaS.
export const opSyncBatch = {
  name: 'syncBatch',
  params: z.object({
    table: z.string(),
    rows: z.array(z.record(z.unknown())),
    checkpoint: z.string(),
  }),
  result: z.object({ persisted: z.number().int() }),
};

export const opRotateToken = {
  name: 'rotateToken',
  params: z.object({ newToken: z.string() }),
  result: z.object({ rotatedAt: z.string().datetime() }),
};

export const opCheckUpdate = {
  name: 'checkUpdate',
  params: z.object({ currentVersion: z.string(), channel: z.enum(['stable', 'beta', 'canary']) }),
  result: z.object({
    available: z.boolean(),
    version: z.string().optional(),
    downloadUrl: z.string().url().optional(),
    sha256: z.string().optional(),
    signature: z.string().optional(),
  }),
};

export const opForceUpdate = {
  name: 'forceUpdate',
  params: z.object({}),
  result: z.object({ scheduled: z.boolean() }),
};

export const opUpdateCatalog = {
  name: 'updateCatalog',
  params: z.object({ catalogVersion: z.string(), catalogUrl: z.string().url(), signature: z.string() }),
  result: z.object({ applied: z.boolean() }),
};

export const ALL_OPS = {
  ping: opPing,
  getAgentInfo: opGetAgentInfo,
  getSchema: opGetSchema,
  runReport: opRunReport,
  syncTick: opSyncTick,
  syncBatch: opSyncBatch,
  rotateToken: opRotateToken,
  checkUpdate: opCheckUpdate,
  forceUpdate: opForceUpdate,
  updateCatalog: opUpdateCatalog,
} as const;

export type OpName = keyof typeof ALL_OPS;
