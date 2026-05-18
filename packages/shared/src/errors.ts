// Erros HTTP padronizados.
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  unauthorized: (msg = 'Nao autenticado') => new AppError(401, 'unauthorized', msg),
  forbidden: (msg = 'Sem permissao') => new AppError(403, 'forbidden', msg),
  notFound: (msg = 'Nao encontrado') => new AppError(404, 'not_found', msg),
  conflict: (msg: string) => new AppError(409, 'conflict', msg),
  validation: (msg: string, meta?: Record<string, unknown>) =>
    new AppError(422, 'validation', msg, meta),
  rateLimited: (msg = 'Muitas requisicoes') => new AppError(429, 'rate_limited', msg),
  internal: (msg = 'Erro interno') => new AppError(500, 'internal', msg),
  serviceUnavailable: (msg = 'Servico indisponivel') =>
    new AppError(503, 'service_unavailable', msg),
};
