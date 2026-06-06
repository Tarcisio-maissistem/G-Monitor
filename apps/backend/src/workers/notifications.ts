import { Queue, Worker } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import type { Prisma } from '@prisma/client';
import { redis } from '../db/redis.js';
import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';

// Worker BullMQ que avalia regras de notificacao a cada tick (5min).
// Cada regra: ruleType -> implementacao da avaliacao.

const redisConn = redis as unknown as ConnectionOptions;
export const notificationQueue = new Queue('notifications-eval', { connection: redisConn });

const RULES: Record<string, (tenantId: string) => Promise<NotificationOutcome | null>> = {
  agent_offline: async (tenantId) => {
    const offline = await prisma.agent.findMany({
      where: {
        tenantId,
        revokedAt: null,
        OR: [
          { lastSeenAt: null },
          { lastSeenAt: { lt: new Date(Date.now() - 30 * 60 * 1000) } },
        ],
      },
      include: { store: true },
    });
    if (offline.length === 0) return null;
    return {
      type: 'agent_offline',
      title: `${offline.length} agente(s) offline`,
      body: offline.map((a) => `${a.store.name} (desde ${a.lastSeenAt?.toISOString() ?? 'nunca'})`).join('; '),
      data: { stores: offline.map((a) => a.storeId) },
    };
  },
};

interface NotificationOutcome {
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

new Worker(
  'notifications-eval',
  async (_job) => {
    const tenants = await prisma.tenant.findMany({
      where: { subscriptionStatus: { in: ['trialing', 'active'] } },
      include: { notificationRules: { where: { enabled: true } } },
    });

    for (const tenant of tenants) {
      for (const rule of tenant.notificationRules) {
        const fn = RULES[rule.ruleType];
        if (!fn) continue;

        const cooldownMs = rule.cooldownMinutes * 60 * 1000;
        if (rule.lastTriggeredAt && Date.now() - rule.lastTriggeredAt.getTime() < cooldownMs) continue;

        const outcome = await fn(tenant.id).catch((err: unknown) => {
          logger.error({ err, rule: rule.ruleType, tenantId: tenant.id }, 'rule eval failed');
          return null;
        });
        if (!outcome) continue;

        const targets = await prisma.user.findMany({
          where: {
            tenantId: tenant.id,
            role: { in: ['owner', 'admin'] },
            deletedAt: null,
          },
        });

        await prisma.$transaction([
          prisma.notification.createMany({
            data: targets.map((u) => ({
              tenantId: tenant.id,
              userId: u.id,
              type: outcome.type,
              title: outcome.title,
              body: outcome.body,
              data: outcome.data as unknown as Prisma.InputJsonValue,
            })),
          }),
          prisma.notificationRule.update({
            where: { id: rule.id },
            data: { lastTriggeredAt: new Date() },
          }),
        ]);

        logger.info({ tenantId: tenant.id, rule: rule.ruleType, recipients: targets.length }, 'notification fired');
      }
    }

    return { tenantsProcessed: tenants.length };
  },
  { connection: redisConn, concurrency: 1 },
);

// Repeat job a cada 5 min.
export async function scheduleNotificationsLoop(): Promise<void> {
  await notificationQueue.add(
    'tick',
    {},
    { repeat: { every: 5 * 60 * 1000 }, removeOnComplete: true, removeOnFail: 100 },
  );
}
