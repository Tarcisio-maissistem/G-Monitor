import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { initFirebird, closeFirebird, startFirebirdHealthCheck } from './firebird/manager.js';
import { AgentWsClient } from './ws/client.js';
import { startSyncLoop } from './sync/syncer.js';
import { startUpdaterLoop } from './updater.js';
import { AGENT_VERSION } from './version.js';

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

main().catch((err) => {
  logger.error({ err }, 'fatal error');
  process.exit(1);
});
