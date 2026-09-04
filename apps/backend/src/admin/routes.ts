// Rotas super-admin — gestao de empresas (tenants), usuarios por empresa, e concessao de
// acesso cross-tenant (TenantAccess). Acesso restrito: apenas users com isSuperAdmin=true.
// Decisao do dono (23/08): so isSuperAdmin acessa TODAS as empresas automaticamente;
// qualquer outro usuario precisa de concessao explicita via /tenant-access.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors, ROLES } from '@gmonitor/shared';
import { prisma } from '../db/prisma.js';
import { marcarDadosNovos } from '../reports/routes.js';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';
import { signAccess } from '../auth/jwt.js';
import { hashPassword } from '../auth/passwords.js';

const createTenantSchema = z.object({
  name: z.string().min(2),
  cnpj: z.string().optional(),
  phone: z.string().optional(),
});

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
  password: z.string().min(8),
  role: z.enum(ROLES),
});

const grantAccessSchema = z.object({
  tenantId: z.string().cuid(),
  role: z.enum(ROLES).default('leitor'),
});

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // Lista todos os tenants com contagem de agentes/lojas/usuarios
  app.get('/api/admin/tenants', { preHandler: [requireAuth, requireSuperAdmin] }, async (_req) => {
    const tenants = await prisma.tenant.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        cnpj: true,
        phone: true,
        plan: true,
        subscriptionStatus: true,
        pendingApproval: true,
        createdAt: true,
        meta: true,
        _count: { select: { agents: true, stores: true, users: true } },
      },
    });
    // Do meta so interessa a meta mensal no cadastro; nao vazar o resto (taxas, getcard etc).
    return { tenants: tenants.map(({ meta, ...t }) => ({ ...t, monthlyGoal: Number((meta as Record<string, unknown> | null)?.monthlyGoal ?? 0) })) };
  });

  // Meta mensal no CADASTRO da empresa (pedido do dono 01/09: a guia "Meta Mensal" sumiu do
  // menu; a barra vive no dashboard e a configuracao vive aqui). Merge no meta pra nao
  // atropelar taxas/getcard que moram no mesmo json.
  app.patch<{ Params: { id: string } }>(
    '/api/admin/tenants/:id/monthly-goal',
    { preHandler: [requireAuth, requireSuperAdmin, audit({ action: 'tenant.monthly_goal', entity: 'tenant', captureBody: true })] },
    async (req) => {
      const body = z.object({ monthlyGoal: z.number().min(0).max(1e9) }).parse(req.body);
      const tenant = await prisma.tenant.findFirst({ where: { id: req.params.id, deletedAt: null }, select: { meta: true } });
      if (!tenant) throw Errors.notFound('Empresa nao encontrada');
      const meta = { ...((tenant.meta as Record<string, unknown>) ?? {}), monthlyGoal: body.monthlyGoal };
      await prisma.tenant.update({ where: { id: req.params.id }, data: { meta } });
      await marcarDadosNovos(req.params.id); // invalida o cache do monthly-goal daquela empresa
      return { ok: true, monthlyGoal: body.monthlyGoal };
    },
  );

  // Aprova empresa que se autocadastrou pelo login (pedido do dono 24/08) — libera o
  // WS/sync do agente, que ja estava tentando conectar em backoff desde o cadastro.
  app.post<{ Params: { id: string } }>(
    '/api/admin/tenants/:id/approve',
    { preHandler: [requireAuth, requireSuperAdmin, audit({ action: 'tenant.approve', entity: 'tenant' })] },
    async (req) => {
      const tenant = await prisma.tenant.findFirst({ where: { id: req.params.id, deletedAt: null } });
      if (!tenant) throw Errors.notFound('Empresa nao encontrada');

      await prisma.$transaction([
        prisma.tenant.update({ where: { id: tenant.id }, data: { pendingApproval: false } }),
        prisma.notification.updateMany({
          where: { tenantId: tenant.id, type: 'signup_pending', readAt: null },
          data: { readAt: new Date() },
        }),
      ]);
      return { ok: true };
    },
  );

  app.post('/api/admin/tenants', { preHandler: [requireAuth, requireSuperAdmin, audit({ action: 'tenant.create', entity: 'tenant', captureBody: true })] }, async (req, reply) => {
    const body = createTenantSchema.parse(req.body);
    if (body.cnpj) {
      const existing = await prisma.tenant.findFirst({ where: { cnpj: body.cnpj, deletedAt: null } });
      if (existing) throw Errors.conflict('CNPJ ja cadastrado');
    }
    const tenant = await prisma.tenant.create({
      data: { name: body.name, cnpj: body.cnpj ?? null, phone: body.phone ?? null },
    });
    reply.status(201).send({ tenant });
  });

  // Soft-delete: desativa a empresa e revoga os agentes (nao apaga historico sincronizado)
  app.delete<{ Params: { id: string } }>(
    '/api/admin/tenants/:id',
    { preHandler: [requireAuth, requireSuperAdmin, audit({ action: 'tenant.delete', entity: 'tenant' })] },
    async (req) => {
      const tenant = await prisma.tenant.findFirst({ where: { id: req.params.id, deletedAt: null } });
      if (!tenant) throw Errors.notFound('Empresa nao encontrada');

      await prisma.$transaction([
        prisma.agent.updateMany({ where: { tenantId: tenant.id, revokedAt: null }, data: { revokedAt: new Date() } }),
        prisma.tenant.update({ where: { id: tenant.id }, data: { deletedAt: new Date() } }),
      ]);
      return { ok: true };
    },
  );

  // Loja principal — usado pela tela de Empresas pra ir direto no agente/config da loja
  app.get<{ Params: { id: string } }>(
    '/api/admin/tenants/:id/primary-store',
    { preHandler: [requireAuth, requireSuperAdmin] },
    async (req) => {
      const store = await prisma.store.findFirst({
        where: { tenantId: req.params.id, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true },
      });
      return { store };
    },
  );

  // Usuarios de uma empresa especifica (visao do super-admin, cross-tenant)
  app.get<{ Params: { id: string } }>(
    '/api/admin/tenants/:id/users',
    { preHandler: [requireAuth, requireSuperAdmin] },
    async (req) => {
      const users = await prisma.user.findMany({
        where: { tenantId: req.params.id, deletedAt: null },
        select: { id: true, email: true, name: true, role: true, isSuperAdmin: true, lastLoginAt: true, createdAt: true },
        orderBy: { name: 'asc' },
      });
      return { users };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/admin/tenants/:id/users',
    { preHandler: [requireAuth, requireSuperAdmin, audit({ action: 'admin.user.create', entity: 'user', captureBody: true })] },
    async (req, reply) => {
      const tenant = await prisma.tenant.findFirst({ where: { id: req.params.id, deletedAt: null } });
      if (!tenant) throw Errors.notFound('Empresa nao encontrada');

      const body = createUserSchema.parse(req.body);
      const existing = await prisma.user.findFirst({ where: { tenantId: tenant.id, email: body.email, deletedAt: null } });
      if (existing) throw Errors.conflict('Email ja cadastrado nesta empresa');

      const user = await prisma.user.create({
        data: {
          tenantId: tenant.id,
          email: body.email,
          name: body.name,
          passwordHash: await hashPassword(body.password),
          role: body.role,
        },
        select: { id: true, email: true, name: true, role: true },
      });
      reply.status(201).send({ user });
    },
  );

  // Admin remove qualquer usuario (cross-tenant) — mesma regra do soft-delete de /api/users/:id
  app.delete<{ Params: { id: string } }>(
    '/api/admin/users/:id',
    { preHandler: [requireAuth, requireSuperAdmin, audit({ action: 'admin.user.delete', entity: 'user' })] },
    async (req) => {
      const target = await prisma.user.findFirst({ where: { id: req.params.id, deletedAt: null } });
      if (!target) throw Errors.notFound('Usuario nao encontrado');
      if (target.role === 'owner') throw Errors.forbidden('Owner nao pode ser removido');
      if (target.isSuperAdmin) throw Errors.forbidden('Super admin nao pode ser removido por aqui');

      await prisma.$transaction([
        prisma.refreshToken.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date() } }),
        prisma.user.update({ where: { id: target.id }, data: { deletedAt: new Date() } }),
      ]);
      return { ok: true };
    },
  );

  // Concessoes de acesso cross-tenant de um usuario (matriz que precisa ver filiais/outras empresas)
  app.get<{ Params: { id: string } }>(
    '/api/admin/users/:id/tenant-access',
    { preHandler: [requireAuth, requireSuperAdmin] },
    async (req) => {
      const accesses = await prisma.tenantAccess.findMany({
        where: { userId: req.params.id },
        include: { tenant: { select: { name: true } } },
        orderBy: { grantedAt: 'desc' },
      });
      return {
        accesses: accesses.map((a) => ({
          tenantId: a.tenantId,
          tenantName: a.tenant.name,
          role: a.role,
          grantedAt: a.grantedAt,
        })),
      };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/admin/users/:id/tenant-access',
    { preHandler: [requireAuth, requireSuperAdmin, audit({ action: 'tenant-access.grant', entity: 'tenant_access', captureBody: true })] },
    async (req, reply) => {
      const user = await prisma.user.findFirst({ where: { id: req.params.id, deletedAt: null } });
      if (!user) throw Errors.notFound('Usuario nao encontrado');
      const body = grantAccessSchema.parse(req.body);
      if (body.tenantId === user.tenantId) throw Errors.validation('Usuario ja tem acesso a propria empresa');

      const tenant = await prisma.tenant.findFirst({ where: { id: body.tenantId, deletedAt: null } });
      if (!tenant) throw Errors.notFound('Empresa nao encontrada');

      const access = await prisma.tenantAccess.upsert({
        where: { userId_tenantId: { userId: user.id, tenantId: body.tenantId } },
        create: { userId: user.id, tenantId: body.tenantId, role: body.role },
        update: { role: body.role },
      });
      reply.status(201).send({ access });
    },
  );

  app.delete<{ Params: { id: string; tenantId: string } }>(
    '/api/admin/users/:id/tenant-access/:tenantId',
    { preHandler: [requireAuth, requireSuperAdmin, audit({ action: 'tenant-access.revoke', entity: 'tenant_access' })] },
    async (req) => {
      await prisma.tenantAccess.deleteMany({ where: { userId: req.params.id, tenantId: req.params.tenantId } });
      return { ok: true };
    },
  );

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
