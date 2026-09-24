import { describe, it, expect } from 'vitest';
import { formaDoPagamento, montarResumoFechamento } from './fechamentoResumo.js';

// Especies reais do GDOOR da Casa J.Kastros
describe('formaDoPagamento', () => {
  it.each([
    ['DINHEIRO', 'DINHEIRO', 'dinheiro'],
    ['TEF DEBITO', 'CARTãO DéBITO', 'debito'],
    ['DEBITO ENTREGA', 'CARTãO DéBITO', 'debito'],
    ['TEF CREDITO', 'CARTãO CRéDITO', 'credito'],
    ['CREDITO ENTREGA', 'CARTãO CRéDITO', 'credito'],
    ['PIX ENTREGA', 'PAGAMENTO INSTANTâNEO ESTATICO (PIX)', 'pix'],
    ['PRAZO', 'A PRAZO / CRéDITO LOJA', 'prazo'],
  ])('%s -> %s', (esp, tipo, esperado) => {
    expect(formaDoPagamento(esp, tipo)).toBe(esperado);
  });
});

describe('montarResumoFechamento', () => {
  const r = montarResumoFechamento({
    pagamentos: [
      { especie: 'DINHEIRO', paymentType: 'DINHEIRO', valor: 300 },
      { especie: 'TEF DEBITO', paymentType: null, valor: 200 },
      { especie: 'TEF CREDITO', paymentType: null, valor: 300 },
      { especie: 'PRAZO', paymentType: 'A PRAZO / CRéDITO LOJA', valor: 200 },
    ],
    recebidos: { valor: 150, qtd: 3 },
    saidas: [{ grupo: 'FRIGORIFICO X', valor: 500, qtd: 2 }, { grupo: 'ENERGIA', valor: 100, qtd: 1 }, { grupo: null, valor: 50, qtd: 1 }],
  });
  it('bruto por forma com percentual', () => {
    expect(r.entradas.bruto).toBe(1000);
    expect(r.entradas.porForma.map((f) => [f.forma, f.pct])).toEqual([['dinheiro', 30], ['debito', 20], ['credito', 30], ['prazo', 20]]);
  });
  it('a prazo sai do liquido; recebidos entram', () => {
    expect([r.entradas.aPrazo, r.entradas.liquidoVendas, r.entradasEfetivas]).toEqual([200, 800, 950]);
  });
  it('saidas agrupadas, resultado e percentual', () => {
    expect(r.saidas.total).toBe(650);
    expect(r.saidas.porGrupo[0]).toEqual({ nome: 'FRIGORIFICO X', valor: 500, pct: 76.92 });
    expect(r.saidas.porGrupo.map((g) => g.nome)).toContain('(sem fornecedor)');
    expect([r.resultado, r.resultadoPct]).toEqual([300, 31.58]);
  });
});
