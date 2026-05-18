import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors } from '@gmonitor/shared';
import { prisma } from '../db/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { generateTotpSecret, buildOtpAuthUrl, verifyTotp } from './totp.js';

const verifySchema = z.object({ code: z.string().regex(/^\d{6}$/) });

export async function twoFactorRoutes(app: FastifyInstance): Promise<void> {
  // Inicia enrollment: gera secret, retorna otpauth URL para QR code.
  // Secret so e persistido (e 2FA habilitado) apos /verify.
  app.post('/api/auth/2fa/enroll', { preHandler: [requireAuth] }, async (req) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw Errors.unauthorized();
    if (user.twoFactorEnabled) throw Errors.conflict('2FA ja habilitado');

    const secret = generateTotpSecret();
    // Salva secret pendente em campo temporario (reusando twoFactorSecret com enabled=false).
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorSecret: secret, twoFactorEnabled: false },
    });

    const otpAuthUrl = buildOtpAuthUrl(user.email, secret, 'G-Monitor');
    return { otpAuthUrl, secret };
  });

  app.post('/api/auth/2fa/verify', { preHandler: [requireAuth] }, async (req) => {
    const body = verifySchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user?.twoFactorSecret) throw Errors.validation('Enrollment nao iniciado');

    if (!verifyTotp(user.twoFactorSecret, body.code)) {
      throw Errors.unauthorized('Codigo invalido');
    }

    await prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
    return { ok: true };
  });

  app.post('/api/auth/2fa/disable', { preHandler: [requireAuth] }, async (req) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw Errors.unauthorized();
    // Owners nao podem desabilitar 2FA apos ativacao.
    if (user.role === 'owner') throw Errors.forbidden('Owner nao pode desabilitar 2FA');

    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: false, twoFactorSecret: null },
    });
    return { ok: true };
  });
}
