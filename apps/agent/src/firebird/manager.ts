import { createFirebirdPool, type FirebirdPool } from './client.js';
import type { AgentConfig } from '../config.js';
import { logger } from '../logger.js';

let pool: FirebirdPool | null = null;

export function initFirebird(cfg: AgentConfig): FirebirdPool {
  if (pool) return pool;
  pool = createFirebirdPool(cfg);
  logger.info({ db: cfg.firebird.database }, 'firebird pool initialized');
  return pool;
}

export function getFirebirdPool(): FirebirdPool | null {
  return pool;
}

export async function closeFirebird(): Promise<void> {
  if (pool) {
    await pool.close();
    pool = null;
  }
}

// Health check periodico (1 min).
export function startFirebirdHealthCheck(): NodeJS.Timeout {
  return setInterval(async () => {
    if (!pool) return;
    const start = Date.now();
    try {
      await pool.query('SELECT 1 AS OK FROM RDB$DATABASE');
      logger.info({ ms: Date.now() - start }, 'firebird ok');
    } catch (err) {
      logger.error({ err, ms: Date.now() - start }, 'firebird health check failed');
    }
  }, 60_000);
}
