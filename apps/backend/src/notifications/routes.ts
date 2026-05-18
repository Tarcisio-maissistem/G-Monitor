import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const ruleUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
  cooldownMinutes: z.number().int().min(15).max(1440).optional(),
});

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/notifications', { preHandler: [requireAuth] }, async (req) => {
    const list = await prisma.notification.findMany({
      where: { tenantId: req.user!.tenantId, userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const unread = list.filter((n) => !n.readAt).length;
    return { list, unread };
  });

  app.post('/api/notifications/:id/read', { preHandler: [requireAuth] }, async (req) => {
    const { id } = req.params as { id: string };
    await prisma.notification.updateMany({
      where: { id, userId: req.user!.id, tenantId: req.user!.tenantId },
      data: { readAt: new Date() },
    });
    return { ok: true };
  });

  app.get('/api/notifications/rules', { preHandler: [requireAuth] }, async (req) => {
    const rules = await prisma.notificationRule.findMany({
      where: { tenantId: req.user!.tenantId },
      orderBy: { ruleType: 'asc' },
    });
    return { rules };
  });

  app.patch('/api/notifications/rules/:ruleType', { preHandler: [requireAuth] }, async (req) => {
    const { ruleType } = req.params as { ruleType: string };
    const body = ruleUpdateSchema.parse(req.body);
    const rule = await prisma.notificationRule.upsert({
      where: { tenantId_ruleType: { tenantId: req.user!.tenantId, ruleType } },
      create: {
        tenantId: req.user!.tenantId,
        ruleType,
        enabled: body.enabled ?? true,
        config: body.config ?? {},
        cooldownMinutes: body.cooldownMinutes ?? 240,
      },
      update: body,
    });
    return { rule };
  });
}
