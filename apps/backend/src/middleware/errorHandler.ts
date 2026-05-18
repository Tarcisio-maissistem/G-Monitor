import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '@gmonitor/shared';
import { logger } from '../logger.js';

export function errorHandler(err: FastifyError, req: FastifyRequest, reply: FastifyReply): void {
  if (err instanceof AppError) {
    reply.status(err.status).send({
      error: { code: err.code, message: err.message, meta: err.meta },
    });
    return;
  }

  // Validacao Fastify/Zod
  if ((err as { validation?: unknown }).validation) {
    reply.status(422).send({
      error: { code: 'validation', message: err.message, meta: (err as { validation: unknown }).validation },
    });
    return;
  }

  logger.error({ err, url: req.url, method: req.method }, 'unhandled error');
  reply.status(500).send({ error: { code: 'internal', message: 'Erro interno' } });
}
