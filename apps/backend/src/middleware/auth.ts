import type { FastifyReply, FastifyRequest } from 'fastify';
import { Errors, type Role, roleHas } from '@gmonitor/shared';
import { verifyAccess } from '../auth/jwt.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: string; tenantId: string; role: Role; storeId?: string };
  }
}

export async function requireAuth(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) throw Errors.unauthorized();
  const token = header.substring(7);
  const payload = await verifyAccess(token).catch(() => null);
  if (!payload) throw Errors.unauthorized('Token invalido ou expirado');
  req.user = {
    id: payload.sub,
    tenantId: payload.tid,
    role: payload.rol as Role,
    storeId: payload.sto,
  };
}

export function requireCapability(capability: string) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    if (!req.user) throw Errors.unauthorized();
    if (!roleHas(req.user.role, capability)) throw Errors.forbidden();
  };
}
