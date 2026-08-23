import Firebird from 'node-firebird';
import { logger } from '../logger.js';
import type { AgentConfig } from '../config.js';
import { patchFirebirdStringDecoding } from './charsetPatch.js';

// Wrapper Promise sobre node-firebird com pool de conexoes.
// Prepared statements: o driver suporta parametros via array no segundo arg de query().

export interface FirebirdPool {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

export function createFirebirdPool(cfg: AgentConfig): FirebirdPool {
  patchFirebirdStringDecoding();

  const options: Firebird.Options = {
    host: cfg.firebird.host,
    port: cfg.firebird.port,
    database: cfg.firebird.database,
    user: cfg.firebird.user,
    password: cfg.firebird.password,
    lowercase_keys: true,
    role: '',
    pageSize: 4096,
  };

  const pool = Firebird.pool(5, options);

  return {
    query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
      return new Promise((resolve, reject) => {
        pool.get((err, db) => {
          if (err) return reject(err);
          db.query(sql, params, (qerr, result) => {
            db.detach();
            if (qerr) return reject(qerr);
            resolve((result ?? []) as T[]);
          });
        });
      });
    },
    async close(): Promise<void> {
      pool.destroy();
      logger.info('firebird pool destroyed');
    },
  };
}
