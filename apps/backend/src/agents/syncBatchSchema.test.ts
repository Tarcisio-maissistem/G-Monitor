import { describe, it, expect } from 'vitest';
import { syncBatchSchema } from './syncSchema.js';

// 24/09: janela recente da Casa J.Kastros (agente 0.9.8) era recusada por ter > 1000 linhas.
const lote = (n: number, recent?: boolean) => ({ table: 'sales', rows: Array.from({ length: n }, (_, i) => ({ sourceId: i })), checkpoint: '0', ...(recent ? { recent } : {}) });

describe('limite de linhas do lote de sync', () => {
  it('lote incremental ate 1000 passa', () => {
    expect(syncBatchSchema.safeParse(lote(1000)).success).toBe(true);
  });
  it('lote incremental acima de 1000 e recusado', () => {
    expect(syncBatchSchema.safeParse(lote(1001)).success).toBe(false);
  });
  it('janela recente com 5000 linhas passa', () => {
    expect(syncBatchSchema.safeParse(lote(5000, true)).success).toBe(true);
  });
  it('janela recente acima de 5000 e recusada', () => {
    expect(syncBatchSchema.safeParse(lote(5001, true)).success).toBe(false);
  });
});
