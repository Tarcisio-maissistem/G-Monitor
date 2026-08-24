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

  // Renova o access token usando o cookie httpOnly "refresh" — chamado pelo frontend ao
  // carregar a pagina, pra nao pedir login de novo so por causa de um F5. O cookie ja era
  // setado no login desde o inicio, mas esse endpoint pra de fato USAR ele nunca existia
  // (achado 24/08, pedido do dono: "toda vez que atualiza a pagina pede login").
  app.post('/api/auth/refresh', async (req, reply) => {
    const cookie = req.cookies.refresh;
    if (!cookie) throw Errors.unauthorized('Sem sessao');

    const payload = await verifyRefresh(cookie).catch(() => null);
    if (!payload) throw Errors.unauthorized('Sessao invalida');

    const tokenHash = hashToken(payload.jti);
    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      reply.clearCookie('refresh', { path: '/api/auth', domain: config.COOKIE_DOMAIN });
      throw Errors.unauthorized('Sessao expirada');
    }

    // Reuso de um refresh token ja rotacionado = sinal de roubo/replay (alguem usou uma
    // copia antiga do cookie). Revoga TODAS as sessoes do usuario por seguranca.
    if (stored.usedAt) {
      await prisma.refreshToken.updateMany({ where: { userId: stored.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      reply.clearCookie('refresh', { path: '/api/auth', domain: config.COOKIE_DOMAIN });
      logger.warn({ userId: stored.userId }, 'refresh token reuso detectado — todas as sessoes revogadas');
      throw Errors.unauthorized('Sessao invalida');
    }

    const user = await prisma.user.findFirst({ where: { id: stored.userId, deletedAt: null }, include: { tenant: true } });
    if (!user || user.tenant.subscriptionStatus === 'suspended') {
      reply.clearCookie('refresh', { path: '/api/auth', domain: config.COOKIE_DOMAIN });
      throw Errors.unauthorized('Sessao invalida');
    }

    // Rotaciona: marca o antigo como usado e emite um novo, encadeado por parentId.
    const newRaw = generateRandomToken(48);
    const newJwt = await signRefresh(user.id, newRaw);
    await prisma.$transaction([
      prisma.refreshToken.update({ where: { id: stored.id }, data: { usedAt: new Date() } }),
      prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(newRaw),
          parentId: stored.id,
          ip: req.ip,
          userAgent: req.headers['user-agent'] ?? null,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      }),
    ]);

    reply.setCookie('refresh', newJwt, {
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/auth',
      domain: config.COOKIE_DOMAIN,
      maxAge: 30 * 24 * 60 * 60,
    });

    const accessToken = await signAccess({
      sub: user.id,
      tid: user.tenantId,
      rol: user.role,
      ...(user.storeId ? { sto: user.storeId } : {}),
      ...(user.isSuperAdmin ? { sad: true } : {}),
    });

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
