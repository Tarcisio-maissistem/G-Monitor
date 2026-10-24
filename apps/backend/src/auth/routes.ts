import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors } from '@gmonitor/shared';
import { prisma } from '../db/prisma.js';
import { verifyPassword } from './passwords.js';
import { signAccess, signRefresh, verifyRefresh } from './jwt.js';
import { generateRandomToken, hashToken } from './tokens.js';
import { verifyTotp } from './totp.js';
import { config } from '../config.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
  totp: z.string().regex(/^\d{6}$/).optional(),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // v2026-10-24 — O AUTOCADASTRO PUBLICO FOI REMOVIDO (decisao do dono 24/10).
  // `POST /api/auth/signup` criava empresa + usuario SEM login nenhum; em 21/10 uma rodada
  // de QA usou essa porta e criou 5 empresas que o dono nao reconheceu. Criar empresa agora
  // so por `POST /api/admin/tenants` (requireSuperAdmin + auditoria). Nao virou rota
  // bloqueada por papel de proposito: dois caminhos de criacao divergiriam de novo.
  // Change: openspec/changes/fechar-autocadastro-empresa/
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
