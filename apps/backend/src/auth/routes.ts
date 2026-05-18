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
  cnpj: z.string().optional(),
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
  app.post('/api/auth/signup', async (req, reply) => {
    const body = signupSchema.parse(req.body);

    const existing = await prisma.tenant.findFirst({
      where: body.cnpj ? { cnpj: body.cnpj } : { users: { some: { email: body.email } } },
    });
    if (existing) throw Errors.conflict('Tenant ou email ja cadastrado');

    const passwordHash = await hashPassword(body.password);
    const tenant = await prisma.tenant.create({
      data: {
        name: body.tenantName,
        cnpj: body.cnpj ?? null,
        users: {
          create: {
            email: body.email,
            name: body.name,
            passwordHash,
            role: 'owner',
          },
        },
      },
      include: { users: true },
    });

    logger.info({ tenantId: tenant.id }, 'tenant created');
    reply.status(201).send({ tenantId: tenant.id, ownerId: tenant.users[0]!.id });
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

    return { accessToken, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
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
