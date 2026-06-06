// Rotas super-admin — listar tenants e fazer switch de contexto.
// Acesso restrito: apenas users com isSuperAdmin=true no JWT.
import type { FastifyInstance } from 'fastify';
import { prisma } from '../db/prisma.js';
import { Errors } from '@gmonitor/shared';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import { signAccess } from '../auth/jwt.js';

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // Lista todos os tenants com contagem de agentes
  app.get('/api/admin/tenants', { preHandler: [requireAuth, requireSuperAdmin] }, async (_req) => {
    const tenants = await prisma.tenant.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        cnpj: true,
        plan: true,
        subscriptionStatus: true,
        createdAt: true,
        _count: { select: { agents: true, stores: true } },
      },
    });
    return { tenants };
  });

  // Emite JWT com tid = tenantId alvo — super-admin continua marcado no token
  app.post<{ Params: { id: string } }>(
    '/api/admin/tenants/:id/switch',
    { preHandler: [requireAuth, requireSuperAdmin] },
    async (req) => {
      const tenant = await prisma.tenant.findFirst({
        where: { id: req.params.id, deletedAt: null },
      });
      if (!tenant) throw Errors.notFound('Tenant nao encontrado');

      const token = await signAccess({
        sub: req.user!.id,
        tid: tenant.id,
        rol: req.user!.role,
        sad: true,
      });

      return { token, tenant: { id: tenant.id, name: tenant.name } };
    },
  );
}
