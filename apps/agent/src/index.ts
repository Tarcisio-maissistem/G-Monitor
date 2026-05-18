import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { initFirebird, closeFirebird, startFirebirdHealthCheck } from './firebird/manager.js';
import { AgentWsClient } from './ws/client.js';
import { startSyncLoop } from './sync/syncer.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  logger.info({ saasUrl: cfg.saasUrl }, 'gmonitor agent starting');

  initFirebird(cfg);
  const healthTimer = startFirebirdHealthCheck();

  const wsClient = new AgentWsClient(cfg);
  wsClient.start();

  const syncTimer = startSyncLoop(cfg);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down agent');
    clearInterval(healthTimer);
    clearInterval(syncTimer);
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
