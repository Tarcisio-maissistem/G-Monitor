import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { initFirebird, closeFirebird, startFirebirdHealthCheck } from './firebird/manager.js';
import { AgentWsClient } from './ws/client.js';
import { startSyncLoop } from './sync/syncer.js';
import { startUpdaterLoop } from './updater.js';
import { AGENT_VERSION } from './version.js';
import { detectCnpj } from './detectCnpj.js';

// Modo utilitario chamado pelo install.ps1 (pedido do dono 25/08) — roda ANTES de existir
// agent.json, entao nao usa loadConfig() nem initFirebird() (singleton da config completa).
// Imprime JSON puro no stdout de proposito: o PowerShell so precisa fazer
// ConvertFrom-Json na saida, sem parsear log nenhum.
async function runDetectCnpj(): Promise<void> {
  const args = process.argv.slice(2);
  const get = (flag: string, def?: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : def;
  };
  const fdbPath = get('--fdb-path');
  const fbUser = get('--fb-user', 'SYSDBA')!;
  const fbPassword = get('--fb-password');
  if (!fdbPath || !fbPassword) {
    console.log(JSON.stringify({ error: 'faltou --fdb-path ou --fb-password' }));
    process.exitCode = 1;
    return;
  }
  const result = await detectCnpj({ host: '127.0.0.1', port: 3050, database: fdbPath, user: fbUser, password: fbPassword });
  console.log(JSON.stringify(result ?? { error: 'CNPJ nao encontrado automaticamente' }));
  process.exitCode = result ? 0 : 2;
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  logger.info({ saasUrl: cfg.saasUrl, version: AGENT_VERSION }, 'gmonitor agent starting');

  initFirebird(cfg);
  const healthTimer = startFirebirdHealthCheck();

  const wsClient = new AgentWsClient(cfg);
  wsClient.start();

  const syncTimer = startSyncLoop(cfg);
  // Servidor de manifesto (${host}:8088/latest.json) ainda nao existe (task 16.1) —
  // ate la, so loga warn a cada hora e nao aplica update nenhum.
  const updaterTimer = startUpdaterLoop(cfg);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down agent');
    clearInterval(healthTimer);
    clearInterval(syncTimer);
    clearInterval(updaterTimer);
    wsClient.stop();
    await closeFirebird();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

if (process.argv.includes('--detect-cnpj')) {
  runDetectCnpj().catch((err) => {
    console.log(JSON.stringify({ error: String((err as Error)?.message ?? err) }));
    process.exitCode = 1;
  });
} else {
  main().catch((err) => {
    logger.error({ err }, 'fatal error');
    process.exit(1);
  });
}
