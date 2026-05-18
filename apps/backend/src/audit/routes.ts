import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { requireAuth, requireCapability } from '../middleware/auth.js';

const querySchema = z.object({
  entity: z.string().optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/audit', { preHandler: [requireAuth, requireCapability('audit.view')] }, async (req) => {
    const q = querySchema.parse(req.query);
    const logs = await prisma.auditLog.findMany({
      where: {
        tenantId: req.user!.tenantId,
        ...(q.entity ? { entity: q.entity } : {}),
        ...(q.from || q.to
          ? {
              createdAt: {
                ...(q.from ? { gte: new Date(q.from + 'T00:00:00Z') } : {}),
                ...(q.to ? { lte: new Date(q.to + 'T23:59:59Z') } : {}),
              },
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
    });
    return { logs, nextCursor: logs.length === q.limit ? logs[logs.length - 1]!.id : null };
  });

  for (const method of ['PATCH', 'DELETE', 'PUT'] as const) {
    app.route({
      method,
      url: '/api/audit/:id',
      handler: async (_req, reply) => reply.status(405).send({ error: 'audit log imutavel' }),
    });
  }
}
