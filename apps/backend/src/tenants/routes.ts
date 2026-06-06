import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { Errors } from '@gmonitor/shared';
import { prisma } from '../db/prisma.js';
import { requireAuth, requireCapability } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';

const updateTenantSchema = z.object({
  name: z.string().min(2).optional(),
  phone: z.string().optional(),
  meta: z.record(z.unknown()).optional(),
});

const createStoreSchema = z.object({
  name: z.string().min(2),
  externalId: z.string().min(1),
  timezone: z.string().default('America/Sao_Paulo'),
});

const updateStoreSchema = z.object({
  name: z.string().min(2).optional(),
  timezone: z.string().optional(),
});

export async function tenantRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/tenant/me', { preHandler: [requireAuth] }, async (req) => {
    const tenant = await prisma.tenant.findUnique({ where: { id: req.user!.tenantId } });
    return { tenant };
  });

  app.patch('/api/tenant/me', { preHandler: [requireAuth, requireCapability('tenant.update'), audit({ action: 'tenant.update', captureBody: true })] }, async (req) => {
    const body = updateTenantSchema.parse(req.body);
    const tenant = await prisma.tenant.update({
      where: { id: req.user!.tenantId },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.meta !== undefined ? { meta: body.meta as Prisma.InputJsonValue } : {}),
      },
    });
    return { tenant };
  });

  app.get('/api/tenant/stores', { preHandler: [requireAuth] }, async (req) => {
    const stores = await prisma.store.findMany({
      where: { tenantId: req.user!.tenantId, deletedAt: null },
      orderBy: { name: 'asc' },
    });
    return { stores };
  });

  app.post('/api/tenant/stores', { preHandler: [requireAuth, requireCapability('store.create'), audit({ action: 'store.create', entity: 'store', captureBody: true })] }, async (req, reply) => {
    const body = createStoreSchema.parse(req.body);
    const store = await prisma.store.create({
      data: { ...body, tenantId: req.user!.tenantId },
    });
    reply.status(201).send({ store });
  });

  app.patch('/api/tenant/stores/:id', { preHandler: [requireAuth, requireCapability('store.update'), audit({ action: 'store.update', entity: 'store', captureBody: true })] }, async (req) => {
    const { id } = req.params as { id: string };
    const body = updateStoreSchema.parse(req.body);
    const store = await prisma.store.findFirst({
      where: { id, tenantId: req.user!.tenantId, deletedAt: null },
    });
    if (!store) throw Errors.notFound('Loja nao encontrada');
    const updated = await prisma.store.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
      },
    });
    return { store: updated };
  });

  app.delete('/api/tenant/stores/:id', { preHandler: [requireAuth, requireCapability('store.delete'), audit({ action: 'store.delete', entity: 'store' })] }, async (req) => {
    const { id } = req.params as { id: string };
    const store = await prisma.store.findFirst({
      where: { id, tenantId: req.user!.tenantId, deletedAt: null },
    });
    if (!store) throw Errors.notFound('Loja nao encontrada');
    await prisma.store.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true };
  });
}
