import { describe, it, expect } from 'vitest';
import { consultar } from './syncer.js';
import { resolveReport } from '../catalog/index.js';

// 0.9.11: GDOOR sem coluna nova nao pode parar a loja — cai na consulta anterior (-v1).
function poolFalso(recusaColunaNova: boolean) {
  const chamadas: string[] = [];
  return {
    chamadas,
    query: async (sql: string) => {
      chamadas.push(sql.includes('VALOR_DESCO') || sql.includes('M.HORA') ? 'nova' : 'v1');
      if (recusaColunaNova && (sql.includes('VALOR_DESCO') || sql.includes('M.HORA'))) {
        throw new Error('Dynamic SQL Error, SQL error code = -206, Column unknown, I.VALOR_DESCO');
      }
      return [{ source_id: 1 }];
    },
  };
}

describe('consultar (plano B de coluna)', () => {
  it('as versoes -v1 existem e nao tem as colunas novas', () => {
    expect(resolveReport('sync-sale-items-batch-v1')?.sql).not.toContain('VALOR_DESCO');
    expect(resolveReport('sync-payments-batch-v1')?.sql).not.toContain('M.HORA');
    expect(resolveReport('sync-payables-batch-pagar-v1')?.sql).not.toContain('NUM_CONTA');
    expect(resolveReport('sync-sale-items-batch')?.sql).toContain('VALOR_DESCO');
  });
  it('GDOOR com as colunas: usa a consulta nova', async () => {
    const pool = poolFalso(false);
    await consultar(pool as never, 'sync-payments-batch', [1000, 0]);
    expect(pool.chamadas).toEqual(['nova']);
  });
  it('coluna desconhecida: cai na -v1 e lembra nas proximas', async () => {
    const pool = poolFalso(true);
    expect(await consultar(pool as never, 'sync-sale-items-batch', [1000, 0])).toEqual([{ source_id: 1 }]);
    await consultar(pool as never, 'sync-sale-items-batch', [1000, 0]);
    expect(pool.chamadas).toEqual(['nova', 'v1', 'v1']);
  });
  it('outro erro nao e mascarado', async () => {
    const pool = { query: async () => { throw new Error('connection lost'); } };
    await expect(consultar(pool as never, 'sync-payments-recent', [5000, new Date()])).rejects.toThrow('connection lost');
  });
});
