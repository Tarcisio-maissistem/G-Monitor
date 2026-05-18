import { z } from 'zod';

// Envelope generico de mensagem trafegada pelo WebSocket.
// type=request -> backend -> agente. type=response -> agente -> backend.
// type=event -> qualquer lado pode emitir (log, metrica, alerta).
export const messageEnvelopeSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('request'),
    requestId: z.string().uuid(),
    op: z.string(),
    params: z.unknown(),
    timeoutMs: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal('response'),
    requestId: z.string().uuid(),
    ok: z.boolean(),
    result: z.unknown().optional(),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        retryAfterMs: z.number().int().positive().optional(),
      })
      .optional(),
  }),
  z.object({
    type: z.literal('event'),
    name: z.string(),
    payload: z.unknown(),
    ts: z.string().datetime(),
  }),
]);

export type MessageEnvelope = z.infer<typeof messageEnvelopeSchema>;

// Codigos de erro RPC padronizados.
export const RPC_ERROR_CODES = {
  INVALID_PARAMS: 'invalid_params',
  REPORT_NOT_FOUND: 'report_not_found',
  TIMEOUT: 'timeout',
  TOO_BUSY: 'too_busy',
  DB_UNAVAILABLE: 'db_unavailable',
  INTERNAL: 'internal',
  UNAUTHORIZED: 'unauthorized',
} as const;
