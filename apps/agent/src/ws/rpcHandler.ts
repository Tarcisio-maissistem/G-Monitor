import os from 'node:os';
import { resolveReport } from '../catalog/index.js';
import { RPC_ERROR_CODES } from '@gmonitor/rpc-contracts';
import { getFirebirdPool } from '../firebird/manager.js';
import { logger } from '../logger.js';
import { runSyncTick } from '../sync/syncer.js';

interface RpcContext {
  uptimeSeconds: number;
  pendingRpc: number;
  protocolVersion: string;
}

class RpcError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

export async function handleRpc(op: string, params: unknown, ctx: RpcContext): Promise<unknown> {
  switch (op) {
    // "Sincronizar agora" do painel (dono 28/08): dispara um ciclo completo sem esperar a hora.
    case 'syncNow': {
      const iniciado = await runSyncTick();
      return { iniciado };
    }

    case 'ping':
      return { nonce: (params as { nonce?: string })?.nonce ?? '', uptimeSeconds: ctx.uptimeSeconds };

    case 'getAgentInfo': {
      const pool = getFirebirdPool();
      return {
        agentVersion: process.env.AGENT_VERSION ?? '0.1.0',
        protocolVersion: ctx.protocolVersion,
        os: `${os.platform()} ${os.release()}`,
        firebirdVersion: pool ? '5.0' : null,
        firebirdPath: null,
        fdbPath: null,
        poolActive: pool ? 1 : 0,
        rpcPending: ctx.pendingRpc,
      };
    }

    case 'runReport': {
      const { reportId, params: reportParams } = params as { reportId: string; params: Record<string, unknown> };
      const entry = resolveReport(reportId);
      if (!entry) throw new RpcError(RPC_ERROR_CODES.REPORT_NOT_FOUND, `Report ${reportId} nao existe`);

      const parsed = entry.paramSchema.safeParse(reportParams ?? {});
      if (!parsed.success) {
        throw new RpcError(RPC_ERROR_CODES.INVALID_PARAMS, parsed.error.message);
      }

      const pool = getFirebirdPool();
      if (!pool) throw new RpcError(RPC_ERROR_CODES.DB_UNAVAILABLE, 'Firebird indisponivel');

      // Ordem dos parametros: ordem das chaves do schema.
      // Para queries com FIRST N, o N pode estar antes dos demais — definido por entry.
      const orderedParams = Object.values(parsed.data);
      const start = Date.now();
      const rows = await pool.query<Record<string, unknown>>(entry.sql, orderedParams);
      const durationMs = Date.now() - start;

      const columns = rows.length > 0 ? Object.keys(rows[0]!) : [];
      return {
        columns,
        rows: rows.map((r) => columns.map((c) => (r[c] as string | number | boolean | null) ?? null)),
        rowCount: rows.length,
        durationMs,
      };
    }

    default:
      throw new RpcError(RPC_ERROR_CODES.INVALID_PARAMS, `Operacao desconhecida: ${op}`);
  }
}

logger; // referencia para evitar warning de import
