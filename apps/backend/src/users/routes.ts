import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors, ROLES } from '@gmonitor/shared';
import { prisma } from '../db/prisma.js';
import { requireAuth, requireCapability } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import { generateRandomToken, hashToken } from '../auth/tokens.js';
import { signAccess } from '../auth/jwt.js';

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(ROLES),
  storeId: z.string().cuid().optional(),
});

const updateUserSchema = z.object({
  name: z.string().min(2).optional(),
  role: z.enum(ROLES).optional(),
  storeId: z.string().cuid().nullable().optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(12),
});

const acceptInviteSchema = z.object({
  name: z.string().min(2),
  password: z.string().min(12),
});

export async function userRoutes(app: FastifyInstance): Promise<void> {
  // Lista todos os usuarios ativos do tenant
  app.get('/api/users', { preHandler: [requireAuth] }, async (req) => {
    const users = await prisma.user.findMany({
      where: { tenantId: req.user!.tenantId, deletedAt: null },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        storeId: true,
        twoFactorEnabled: true,
        lastLoginAt: true,
        createdAt: true,
        store: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    });
    return { users };
  });

  // Cria convite (token enviado na resposta para o admin repassar por email)
  app.post(
    '/api/users/invite',
    { preHandler: [requireAuth, requireCapability('user.invite'), audit({ action: 'user.invite', entity: 'invitation', captureBody: true })] },
    async (req, reply) => {
      const body = inviteSchema.parse(req.body);

      // Nao convida quem ja e membro ativo
      const existing = await prisma.user.findFirst({
        where: { tenantId: req.user!.tenantId, email: body.email, deletedAt: null },
      });
      if (existing) throw Errors.conflict('Email ja cadastrado neste tenant');

      // Invalida convites pendentes anteriores para o mesmo email
      await prisma.invitation.updateMany({
        where: { tenantId: req.user!.tenantId, email: body.email, acceptedAt: null },
        data: { expiresAt: new Date() },
      });

      const rawToken = generateRandomToken(32);
      const invitation = await prisma.invitation.create({
        data: {
          tenantId: req.user!.tenantId,
          email: body.email,
          role: body.role,
          storeId: body.storeId ?? null,
          tokenHash: hashToken(rawToken),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 dias
        },
      });

      reply.status(201).send({
        invitationId: invitation.id,
        token: rawToken, // enviar por email; exibido aqui para dev
        expiresAt: invitation.expiresAt,
      });
    },
  );

  // Aceita convite e cria conta
  app.post('/api/users/invite/:token/accept', async (req, reply) => {
    const { token } = req.params as { token: string };
    const body = acceptInviteSchema.parse(req.body);

    const invitation = await prisma.invitation.findFirst({
      where: {
        tokenHash: hashToken(token),
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!invitation) throw Errors.notFound('Convite invalido ou expirado');

    // Cria usuario e marca convite como aceito em transacao
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          tenantId: invitation.tenantId,
          email: invitation.email,
          name: body.name,
          passwordHash: await hashPassword(body.password),
          role: invitation.role,
          storeId: invitation.storeId ?? null,
        },
      });
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });
      return created;
    });

    reply.status(201).send({ userId: user.id, email: user.email, role: user.role });
  });

  // Atualiza nome / papel / loja de um usuario
  app.patch(
    '/api/users/:id',
    { preHandler: [requireAuth, requireCapability('user.update'), audit({ action: 'user.update', entity: 'user', captureBody: true })] },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = updateUserSchema.parse(req.body);

      const target = await prisma.user.findFirst({
        where: { id, tenantId: req.user!.tenantId, deletedAt: null },
      });
      if (!target) throw Errors.notFound('Usuario nao encontrado');

      // Owner nao pode ter seu papel rebaixado por outro usuario
      if (target.role === 'owner' && body.role && body.role !== 'owner') {
        throw Errors.forbidden('Papel de owner nao pode ser alterado');
      }

      const updated = await prisma.user.update({
        where: { id },
        data: {
          ...(body.name ? { name: body.name } : {}),
          ...(body.role ? { role: body.role } : {}),
          ...(body.storeId !== undefined ? { storeId: body.storeId } : {}),
        },
        select: { id: true, email: true, name: true, role: true, storeId: true },
      });
      return { user: updated };
    },
  );

  // Soft-delete de usuario
  app.delete(
    '/api/users/:id',
    { preHandler: [requireAuth, requireCapability('user.delete'), audit({ action: 'user.delete', entity: 'user' })] },
    async (req) => {
      const { id } = req.params as { id: string };

      const target = await prisma.user.findFirst({
        where: { id, tenantId: req.user!.tenantId, deletedAt: null },
      });
      if (!target) throw Errors.notFound('Usuario nao encontrado');
      if (target.role === 'owner') throw Errors.forbidden('Owner nao pode ser removido');
      if (target.id === req.user!.id) throw Errors.forbidden('Nao e possivel remover o proprio usuario');

      await prisma.$transaction([
        // Revoga todos os refresh tokens do usuario
        prisma.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
        prisma.user.update({
          where: { id },
          data: { deletedAt: new Date() },
        }),
      ]);

      return { ok: true };
    },
  );

  // Empresas adicionais que o usuario logado tem acesso (alem da propria tenantId).
  // Super-admin nao usa isso — ja acessa tudo via /api/admin/tenants + switch.
  app.get('/api/users/me/tenant-access', { preHandler: [requireAuth] }, async (req) => {
    const accesses = await prisma.tenantAccess.findMany({
      where: { userId: req.user!.id },
      include: { tenant: { select: { id: true, name: true } } },
      orderBy: { grantedAt: 'desc' },
    });
    return {
      accesses: accesses.map((a) => ({ tenantId: a.tenant.id, tenantName: a.tenant.name, role: a.role })),
    };
  });

  // Troca de contexto pra uma empresa concedida via TenantAccess (ou a propria, trivial).
  // Mesmo padrao do /api/admin/tenants/:id/switch, mas sem exigir isSuperAdmin — checa a
  // concessao explicita em vez disso.
  app.post<{ Params: { tenantId: string } }>('/api/users/me/tenant-access/:tenantId/switch', { preHandler: [requireAuth] }, async (req) => {
    const { tenantId } = req.params;
    const isOwnTenant = tenantId === req.user!.tenantId;

    let grantRole = req.user!.role;
    if (!isOwnTenant) {
      const grant = await prisma.tenantAccess.findUnique({
        where: { userId_tenantId: { userId: req.user!.id, tenantId } },
      });
      if (!grant) throw Errors.forbidden('Sem acesso concedido a esta empresa');
      grantRole = grant.role;
    }

    const tenant = await prisma.tenant.findFirst({ where: { id: tenantId, deletedAt: null } });
    if (!tenant) throw Errors.notFound('Empresa nao encontrada');

    const token = await signAccess({ sub: req.user!.id, tid: tenant.id, rol: grantRole });
    return { token, tenant: { id: tenant.id, name: tenant.name } };
  });

  // Troca de senha do proprio usuario
  app.patch('/api/users/me/password', { preHandler: [requireAuth] }, async (req) => {
    const body = changePasswordSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw Errors.notFound();

    const ok = await verifyPassword(user.passwordHash, body.currentPassword);
    if (!ok) throw Errors.unauthorized('Senha atual incorreta');

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(body.newPassword) },
    });

    // Invalida todos os refresh tokens atuais (forca novo login nos outros dispositivos)
    await prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return { ok: true };
  });
}
