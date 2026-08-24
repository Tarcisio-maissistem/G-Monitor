import fs from 'node:fs';
import { createFirebirdPool, type FirebirdPool } from './client.js';
import type { AgentConfig } from '../config.js';
import { logger } from '../logger.js';

let pool: FirebirdPool | null = null;
let cfgRef: AgentConfig | null = null;
let consecutiveFailures = 0;
// 3 falhas seguidas (~3min a 60s/check) antes de recriar o pool do zero. Achado 24/08: o
// arquivo .FDB do GDOOR ficou indisponivel por um instante (o dono renomeou pra trocar de
// banco e renomeou de volta) e o pool ficou preso em "Invalid database handle" pra sempre
// depois disso, mesmo com o arquivo de volta no lugar certo — precisou reiniciar o processo
// na mao. O health check so LOGAVA o erro, nunca tentava se recuperar sozinho.
const MAX_CONSECUTIVE_FAILURES = 3;

// Valida se o arquivo .FDB existe no caminho configurado ANTES de tentar conectar — sem
// isso, um caminho errado (ex: instalador rodou antes do GDOOR terminar de instalar, ou
// pasta digitada errada) so aparecia como erro generico do driver Firebird, dificil de
// diagnosticar remoto. So verifica caminho local (o agente sempre roda na mesma maquina
// do Firebird — nao ha caso de caminho de rede).
function fdbExists(cfg: AgentConfig): boolean {
  try {
    return fs.existsSync(cfg.firebird.database);
  } catch {
    return false;
  }
}

export function initFirebird(cfg: AgentConfig): FirebirdPool {
  if (pool) return pool;
  cfgRef = cfg;
  if (!fdbExists(cfg)) {
    logger.error({ path: cfg.firebird.database }, 'arquivo .FDB nao encontrado no caminho configurado — agente vai continuar tentando (health check)');
  }
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

// Health check periodico (1 min). Depois de MAX_CONSECUTIVE_FAILURES seguidas, destroi e
// recria o pool do zero — o arquivo pode ter voltado a ficar disponivel, mas as conexoes
// antigas do pool ja quebraram e nunca se recuperam sozinhas.
export function startFirebirdHealthCheck(): NodeJS.Timeout {
  return setInterval(async () => {
    if (!pool || !cfgRef) return;
    const start = Date.now();
    if (!fdbExists(cfgRef)) {
      consecutiveFailures++;
      logger.error({ path: cfgRef.firebird.database, consecutiveFailures }, 'arquivo .FDB ausente no caminho configurado');
      return;
    }
    try {
      await pool.query('SELECT 1 AS OK FROM RDB$DATABASE');
      consecutiveFailures = 0;
      logger.info({ ms: Date.now() - start }, 'firebird ok');
    } catch (err) {
      consecutiveFailures++;
      logger.error({ err, ms: Date.now() - start, consecutiveFailures }, 'firebird health check failed');
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && cfgRef) {
        logger.warn({ consecutiveFailures }, 'recriando pool Firebird apos falhas consecutivas');
        try {
          await pool.close();
        } catch {
          // pool ja quebrado — ignora erro do close, so segue e recria
        }
        pool = createFirebirdPool(cfgRef);
        consecutiveFailures = 0;
      }
    }
  }, 60_000);
}
