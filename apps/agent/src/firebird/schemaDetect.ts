import type { FirebirdPool } from './client.js';
import { logger } from '../logger.js';

// Deteccao de schema financeiro do GDOOR. Instalacoes variam entre PAGAR/RECEBER
// (CONFIRMADA em producao, cliente piloto 22/08 — colunas reais via RDB$RELATION_FIELDS)
// e CONTAS_PAGAR/CONTAS_RECEBER (so inferida do codigo legado gdoor-relatorio, mantida
// como fallback pra outra instalacao GDOOR que a tenha). Ver design.md D11.
// Mesmo padrao defensivo do gdoor-relatorio (tableExists via RDB$RELATIONS).

export type FinancialSchema = 'contas_pagar_receber' | 'pagar_receber' | 'none';

let cached: FinancialSchema | null = null;

export async function tableExists(pool: FirebirdPool, tableName: string): Promise<boolean> {
  const rows = await pool.query<{ cnt: number }>(
    'SELECT COUNT(*) AS CNT FROM RDB$RELATIONS WHERE UPPER(TRIM(RDB$RELATION_NAME)) = ?',
    [tableName.toUpperCase()],
  );
  return Number(rows[0]?.cnt ?? 0) > 0;
}

export async function detectFinancialSchema(pool: FirebirdPool): Promise<FinancialSchema> {
  if (cached) return cached;

  const [hasContasPagar, hasContasReceber] = await Promise.all([
    tableExists(pool, 'CONTAS_PAGAR'),
    tableExists(pool, 'CONTAS_RECEBER'),
  ]);
  if (hasContasPagar && hasContasReceber) {
    cached = 'contas_pagar_receber';
    logger.info({ schema: cached }, 'financial schema detected');
    return cached;
  }

  const [hasPagar, hasReceber] = await Promise.all([tableExists(pool, 'PAGAR'), tableExists(pool, 'RECEBER')]);
  if (hasPagar && hasReceber) {
    cached = 'pagar_receber';
    logger.info({ schema: cached }, 'financial schema detected');
    return cached;
  }

  cached = 'none';
  logger.warn('nenhuma tabela financeira (CONTAS_PAGAR/CONTAS_RECEBER ou PAGAR/RECEBER) encontrada no Firebird');
  return cached;
}

export function resetFinancialSchemaCache(): void {
  cached = null;
}
