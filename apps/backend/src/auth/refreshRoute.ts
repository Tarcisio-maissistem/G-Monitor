import type { FastifyInstance } from 'fastify';
import { Errors } from '@gmonitor/shared';
import { prisma } from '../db/prisma.js';
import { signAccess, signRefresh, verifyRefresh } from './jwt.js';
import { generateRandomToken, hashToken } from './tokens.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

// Refresh com rotacao: cada uso emite novo par e invalida o anterior.
// Reuso de refresh ja usado dispara revogacao global do usuario.
export async function refreshRoute(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/refresh', async (req, reply) => {
    const cookie = req.cookies.refresh;
    if (!cookie) throw Errors.unauthorized('Sem refresh token');

    const { sub, jti } = await verifyRefresh(cookie).catch(() => {
      throw Errors.unauthorized('Refresh invalido');
    });

    const stored = await prisma.refreshToken.findFirst({
      where: { tokenHash: hashToken(jti), userId: sub },
    });
    if (!stored) throw Errors.unauthorized('Refresh nao encontrado');

    if (stored.revokedAt || stored.usedAt) {
      await prisma.refreshToken.updateMany({
        where: { userId: sub, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      logger.warn({ userId: sub }, 'refresh token reuse detected');
      throw Errors.unauthorized('Sessao invalidada por seguranca');
    }
    if (stored.expiresAt < new Date()) throw Errors.unauthorized('Refresh expirado');

    const user = await prisma.user.findUnique({ where: { id: sub } });
    if (!user || user.deletedAt) throw Errors.unauthorized();

    await prisma.refreshToken.update({ where: { id: stored.id }, data: { usedAt: new Date() } });

    const newRaw = generateRandomToken(48);
    const newJwt = await signRefresh(user.id, newRaw);
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(newRaw),
        parentId: stored.id,
        ip: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    const accessToken = await signAccess({
      sub: user.id,
      tid: user.tenantId,
      rol: user.role,
      ...(user.storeId ? { sto: user.storeId } : {}),
    });

    reply.setCookie('refresh', newJwt, {
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/auth',
      domain: config.COOKIE_DOMAIN,
      maxAge: 30 * 24 * 60 * 60,
    });

    return { accessToken };
  });
}
