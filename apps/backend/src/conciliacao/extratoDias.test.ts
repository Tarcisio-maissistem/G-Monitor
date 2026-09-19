import { describe, it, expect } from 'vitest';
import { diasDoPeriodo, diasParaBuscar, hojeBrasilia } from './extratoDias.js';

describe('extrato com cache por dia (19/09)', () => {
  it('lista os dias do periodo, inclusive as pontas', () => {
    expect(diasDoPeriodo('2026-08-30', '2026-09-02')).toEqual(['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02']);
  });
  it('so busca no portal o que nao esta fechado no arquivo', () => {
    expect(diasParaBuscar(['2026-09-17', '2026-09-18', '2026-09-19'], new Set(['2026-09-17', '2026-09-18']))).toEqual(['2026-09-19']);
  });
  it('hoje e o dia de Brasilia: 01h UTC ainda e o dia anterior', () => {
    expect(hojeBrasilia(new Date('2026-09-20T01:00:00Z'))).toBe('2026-09-19');
    expect(hojeBrasilia(new Date('2026-09-20T03:30:00Z'))).toBe('2026-09-20');
  });
});
