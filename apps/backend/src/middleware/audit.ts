import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';

interface AuditOptions {
  action: string;
  entity?: string;
  captureBody?: boolean;
}

// Middleware factory: registra entrada em audit_logs apos resposta 2xx.
export function audit(opts: AuditOptions) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    reply.raw.on('finish', () => {
      if (reply.statusCode >= 400) return;
      void prisma.auditLog
        .create({
          data: {
            tenantId: req.user?.tenantId ?? 'system',
            actorId: req.user?.id ?? null,
            action: opts.action,
            entity: opts.entity ?? null,
            entityId: (req.params as { id?: string })?.id ?? null,
            after: opts.captureBody ? (req.body as object) : null,
            ip: req.ip,
            userAgent: req.headers['user-agent'] ?? null,
          },
        })
        .catch((err: unknown) => logger.warn({ err }, 'audit log failed'));
    });
  };
}
