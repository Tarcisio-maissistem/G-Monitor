import { describe, it, expect } from 'vitest';
import { operadorProvavel } from './quemLancou.js';

// Cobrou na maquininha e nao virou venda: quem estava no caixa naquela hora? (24/09)
const vendas = [
  { operador: 'JESSICA', vendedor: 'DIOGO', caixa: '001', hora: 10 },
  { operador: 'JESSICA', vendedor: 'DIOGO', caixa: '001', hora: 10 },
  { operador: 'CAMILA', vendedor: 'ANA', caixa: '002', hora: 10 },
  { operador: 'CAMILA', vendedor: 'ANA', caixa: '002', hora: 10 },
  { operador: 'CAMILA', vendedor: 'ANA', caixa: '002', hora: 10 },
  { operador: 'GILSA', vendedor: 'ANA', caixa: '001', hora: 15 },
];

describe('operadorProvavel', () => {
  it('usa o caixa do PDV do extrato quando o numero bate (PDV 1 = caixa 001)', () => {
    expect(operadorProvavel(vendas, '1', 10)).toMatchObject({ operador: 'JESSICA', caixa: '001', provavel: true });
  });
  it('sem caixa correspondente, pega o operador mais frequente na hora', () => {
    expect(operadorProvavel(vendas, '9', 10)).toMatchObject({ operador: 'CAMILA', caixa: null, provavel: true });
  });
  it('hora sem venda: nao chuta ninguem', () => {
    expect(operadorProvavel(vendas, '1', 22)).toBeNull();
  });
});
