import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { config } from './config.js';
import { logger } from './logger.js';
import { prisma } from './db/prisma.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authRoutes } from './auth/routes.js';
import { refreshRoute } from './auth/refreshRoute.js';
import { twoFactorRoutes } from './auth/twoFactorRoutes.js';
import { tenantRoutes } from './tenants/routes.js';
import { agentRoutes } from './agents/routes.js';
import { agentSyncRoutes } from './agents/syncRoutes.js';
import { reportRoutes } from './reports/routes.js';
import { auditRoutes } from './audit/routes.js';
import { stripeRoutes } from './stripe/routes.js';
import { notificationRoutes } from './notifications/routes.js';
import { userRoutes } from './users/routes.js';
import { adminRoutes } from './admin/routes.js';
import { registerAgentWs } from './ws/agentServer.js';
import { registry, httpRequestDuration } from './metrics.js';
import { scheduleNotificationsLoop } from './workers/notifications.js';

const app = Fastify({
  loggerInstance: logger,
  trustProxy: true,
  bodyLimit: 8 * 1024 * 1024, // 8 MB para batches de sync
});

await app.register(helmet, { contentSecurityPolicy: false });
await app.register(cors, {
  origin: config.CORS_ORIGIN.split(',').map((s) => s.trim()),
  credentials: true,
});
await app.register(cookie);
await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
await app.register(websocket);

app.setErrorHandler(errorHandler);

// Health
app.get('/api/health', async () => {
  const dbOk = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
  return { status: dbOk ? 'ok' : 'degraded', service: 'gmonitor-backend', uptime: process.uptime() };
});

// Metrics
app.get('/metrics', async (_req, reply) => {
  reply.header('Content-Type', registry.contentType);
  return registry.metrics();
});

// Coletor de duracao por request
app.addHook('onResponse', async (req, reply) => {
  const route = req.routeOptions.url ?? 'unknown';
  httpRequestDuration.labels(req.method, route, String(reply.statusCode)).observe(reply.elapsedTime / 1000);
});

// Body parser raw para Stripe webhook (precisa do buffer puro para verificar assinatura).
app.addContentTypeParser(
  'application/json',
  { parseAs: 'buffer' },
  (req, body, done) => {
    if (req.url === '/api/stripe/webhook') {
      (req as unknown as { rawBody: Buffer }).rawBody = body as Buffer;
      done(null, JSON.parse((body as Buffer).toString('utf8')));
    } else {
      // Corpo vazio com Content-Type: application/json (POST sem body — logout, switch de
      // tenant, refresh) nao e erro: trata como {} em vez de estourar no JSON.parse('').
      // Achado 24/08: lib/api.ts do frontend sempre manda esse header, mesmo sem corpo —
      // toda POST sem body (logout/switchTenant/refresh) vinha derrubando com 500
      // "Unexpected end of JSON input" antes desse fix.
      const text = (body as Buffer).toString('utf8').trim();
      if (text === '') {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(text));
      } catch (err) {
        done(err as Error, undefined);
      }
    }
  },
);

// Rotas HTTP
await app.register(authRoutes);
await app.register(refreshRoute);
await app.register(twoFactorRoutes);
await app.register(tenantRoutes);
await app.register(agentRoutes);
await app.register(agentSyncRoutes);
await app.register(reportRoutes);
await app.register(auditRoutes);
await app.register(stripeRoutes);
await app.register(notificationRoutes);
await app.register(userRoutes);
await app.register(adminRoutes);

// Rotas WebSocket
await app.register(registerAgentWs);

// Worker de notificacoes (BullMQ scheduler).
await scheduleNotificationsLoop().catch((err) => logger.warn({ err }, 'notification scheduler failed'));

const port = config.PORT;
await app.listen({ port, host: '0.0.0.0' });
logger.info({ port }, 'gmonitor backend up');

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'shutting down');
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
