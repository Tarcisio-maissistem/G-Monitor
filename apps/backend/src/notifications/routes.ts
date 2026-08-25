import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const ruleUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
  cooldownMinutes: z.number().int().min(15).max(1440).optional(),
});

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/notifications', { preHandler: [requireAuth] }, async (req) => {
    // Super-admin ve tambem os alertas de novo autocadastro (signup_pending) de QUALQUER
    // empresa, nao so da que ele esta olhando no momento no seletor — senao um cadastro
    // novo nunca aparece se ele estiver com outro tenant selecionado. Achado 24/08.
    const list = await prisma.notification.findMany({
      where: req.user!.isSuperAdmin
        ? { OR: [{ tenantId: req.user!.tenantId, userId: req.user!.id }, { type: 'signup_pending' }] }
        : { tenantId: req.user!.tenantId, userId: req.user!.id },
      include: { tenant: { select: { name: true, pendingApproval: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const unread = list.filter((n) => !n.readAt).length;
    return { list, unread };
  });

  app.post('/api/notifications/:id/read', { preHandler: [requireAuth] }, async (req) => {
    const { id } = req.params as { id: string };
    await prisma.notification.updateMany({
      where: req.user!.isSuperAdmin
        ? { id, OR: [{ tenantId: req.user!.tenantId, userId: req.user!.id }, { type: 'signup_pending' }] }
        : { id, userId: req.user!.id, tenantId: req.user!.tenantId },
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
        config: (body.config ?? {}) as unknown as Prisma.InputJsonValue,
        cooldownMinutes: body.cooldownMinutes ?? 240,
      },
      update: {
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.config !== undefined ? { config: body.config as Prisma.InputJsonValue } : {}),
        ...(body.cooldownMinutes !== undefined ? { cooldownMinutes: body.cooldownMinutes } : {}),
      },
    });
    return { rule };
  });
}
