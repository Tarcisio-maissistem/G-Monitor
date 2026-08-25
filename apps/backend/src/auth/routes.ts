import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors } from '@gmonitor/shared';
import { prisma } from '../db/prisma.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { signAccess, signRefresh, verifyRefresh } from './jwt.js';
import { generateRandomToken, hashToken } from './tokens.js';
import { verifyTotp } from './totp.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

const signupSchema = z.object({
  tenantName: z.string().min(2).max(120),
  // CNPJ obrigatorio: e a chave que o instalador usa pra achar a empresa e pedir o token
  // do agente (POST /api/agents/register-by-cnpj) — pedido do dono 24/08.
  cnpj: z.string().min(14),
  email: z.string().email(),
  name: z.string().min(2),
  password: z.string().min(12),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
  totp: z.string().regex(/^\d{6}$/).optional(),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Autocadastro pelo login (pedido do dono 24/08): cria tenant + loja padrao + owner,
  // MAS fica pendingApproval=true — agente ate registra token (register-by-cnpj), mas
  // WS/sync ficam bloqueados ate o super-admin aprovar. Notificacao criada aqui pra
  // aparecer no sino do painel do super-admin.
  app.post('/api/auth/signup', async (req, reply) => {
    const body = signupSchema.parse(req.body);

    const existing = await prisma.tenant.findFirst({ where: { cnpj: body.cnpj } });
    if (existing) throw Errors.conflict('CNPJ ja cadastrado');

    const passwordHash = await hashPassword(body.password);
    const tenant = await prisma.tenant.create({
      data: {
        name: body.tenantName,
        cnpj: body.cnpj,
        pendingApproval: true,
        users: {
          create: {
            email: body.email,
            name: body.name,
            passwordHash,
            role: 'owner',
          },
        },
        stores: {
          create: { name: body.tenantName, externalId: 'loja-01' },
        },
        notifications: {
          create: {
            type: 'signup_pending',
            title: 'Nova empresa aguardando aprovação',
            body: `${body.tenantName} se cadastrou pelo login e está esperando você autorizar.`,
          },
        },
      },
      include: { users: true },
    });

    logger.info({ tenantId: tenant.id }, 'tenant created (pending approval)');
    reply.status(201).send({ tenantId: tenant.id, ownerId: tenant.users[0]!.id, pendingApproval: true });
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = loginSchema.parse(req.body);

    const user = await prisma.user.findFirst({
      where: { email: body.email, deletedAt: null },
      include: { tenant: true },
    });

    if (!user) throw Errors.unauthorized('Credenciais invalidas');
    if (user.tenant.subscriptionStatus === 'suspended') throw Errors.forbidden('Tenant suspenso');

    const ok = await verifyPassword(user.passwordHash, body.password);
    if (!ok) throw Errors.unauthorized('Credenciais invalidas');

    if (user.twoFactorEnabled) {
      if (!body.totp) throw Errors.unauthorized('2fa_required');
      if (!user.twoFactorSecret || !verifyTotp(user.twoFactorSecret, body.totp)) {
        throw Errors.unauthorized('Codigo 2FA invalido');
      }
    }

    const accessToken = await signAccess({
      sub: user.id,
      tid: user.tenantId,
      rol: user.role,
      ...(user.storeId ? { sto: user.storeId } : {}),
      ...(user.isSuperAdmin ? { sad: true } : {}),
    });

    const refreshRaw = generateRandomToken(48);
    const refreshJwt = await signRefresh(user.id, refreshRaw);
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshRaw),
        ip: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    reply.setCookie('refresh', refreshJwt, {
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/auth',
      domain: config.COOKIE_DOMAIN,
      maxAge: 30 * 24 * 60 * 60,
    });

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    return {
      accessToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, isSuperAdmin: user.isSuperAdmin },
      tenant: { id: user.tenantId, name: user.tenant.name },
    };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const cookie = req.cookies.refresh;
    if (cookie) {
      const { jti } = await verifyRefresh(cookie).catch(() => ({ jti: null }) as { jti: string | null });
      if (jti) {
        await prisma.refreshToken.updateMany({
          where: { tokenHash: hashToken(jti) },
          data: { revokedAt: new Date() },
        });
      }
    }
    reply.clearCookie('refresh', { path: '/api/auth', domain: config.COOKIE_DOMAIN });
    return { ok: true };
  });
}
