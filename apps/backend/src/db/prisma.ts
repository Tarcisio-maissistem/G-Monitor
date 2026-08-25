import { PrismaClient } from '@prisma/client';
import { logger } from '../logger.js';

// Singleton Prisma. Em testes ou ambiente serverless evitar re-instanciar.
export const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'error' },
    { emit: 'event', level: 'warn' },
  ],
});

prisma.$on('error', (e) => logger.error({ prismaError: e }, 'prisma error'));
prisma.$on('warn', (e) => logger.warn({ prismaWarn: e }, 'prisma warn'));

// Pool separado, pequeno e fixo, so pro sync do agente (/api/agent/sync) — decisao D14
// (openspec/changes/create-saas-platform/design.md), tomada apos o incidente de 24/08:
// sync-write e report-read disputando o MESMO connection_limit derrubava os relatorios do
// dono com P1001 durante um backlog grande. Isolar estruturalmente em vez de depender de
// nunca errar o ajuste de concorrencia de novo.
function withConnectionLimit(url: string, limit: number): string {
  const u = new URL(url);
  u.searchParams.set('connection_limit', String(limit));
  return u.toString();
}

export const prismaSync = new PrismaClient({
  datasourceUrl: withConnectionLimit(process.env.DATABASE_URL!, 4),
  log: [{ emit: 'event', level: 'error' }],
});
prismaSync.$on('error', (e) => logger.error({ prismaError: e }, 'prismaSync error'));

// Executa um bloco com contexto de tenant setado para a transacao.
// RLS no Postgres usa current_setting('app.tenant_id') para filtrar.
export async function withTenant<T>(tenantId: string, fn: (tx: typeof prisma) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantId.replace(/'/g, "''")}'`);
    return fn(tx as typeof prisma);
  });
}
