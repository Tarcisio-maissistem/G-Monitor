import { describe, it, expect } from 'vitest';
import { classificarVenda, agregar, type VendaLinha } from './operadores.js';

// Casos tirados da Casa J.Kastros em setembro/2026 (auditoria 24/09).
const base: VendaLinha = {
  id: 'v1', sourceId: '619529', saleDate: new Date('2026-09-20T03:00:00Z'), saleHour: 10,
  operador: 'CAMILA', vendedor: 'JOAO', caixa: '1', total: 100, cancelada: false, itens: 100, nItens: 3, pago: 100,
};
const tipos = (v: Partial<VendaLinha>, lim = 10) => classificarVenda({ ...base, ...v }, lim).map((o) => o.tipo);

describe('classificarVenda (ocorrências de uma venda)', () => {
  it('venda certa não gera ocorrência', () => {
    expect(tipos({})).toEqual([]);
  });
  it('cancelada gera só "cancelada" com o valor da venda', () => {
    const o = classificarVenda({ ...base, cancelada: true, nItens: 0, pago: 10 }, 10);
    expect(o).toEqual([{ tipo: 'cancelada', diferenca: 100, detalhe: 'Venda cancelada' }]);
  });
  it('sem itens com valor', () => {
    expect(tipos({ nItens: 0, itens: null })).toEqual(['sem_itens']);
  });
  it('total zero com itens = pré-venda zerada (não é desconto de 100%)', () => {
    expect(tipos({ total: 0, itens: 205.68, pago: null })).toEqual(['pre_venda_zerada']);
  });
  it('desconto acima do limite (113,02 de 138,86 = 18,6%)', () => {
    const o = classificarVenda({ ...base, total: 113.02, itens: 138.86, pago: 113.02 }, 10);
    expect(o.map((x) => x.tipo)).toEqual(['desconto']);
    expect(o[0]!.diferenca).toBeCloseTo(25.84, 2);
  });
  it('desconto abaixo do limite (3,4%) não é ocorrência', () => {
    expect(tipos({ total: 42.65, itens: 44.15, pago: 42.65 })).toEqual([]);
  });
  it('limite configurável: 3,4% vira ocorrência com limite 2%', () => {
    expect(tipos({ total: 42.65, itens: 44.15, pago: 42.65 }, 2)).toEqual(['desconto']);
  });
  it('pago a MAIOR (troco em dinheiro) não é ocorrência', () => {
    expect(tipos({ pago: 150 })).toEqual([]);
  });
  it('pago a menor é ocorrência', () => {
    expect(tipos({ pago: 80 })).toEqual(['pago_a_menor']);
  });
  it('sem pagamento vinculado não é ocorrência (lacuna de sync)', () => {
    expect(tipos({ pago: null })).toEqual([]);
  });
  it('centavos de arredondamento não geram ocorrência', () => {
    expect(tipos({ total: 99.97, itens: 100, pago: 99.97 }, 0)).toEqual([]);
  });
});

describe('agregar por operador', () => {
  const vendas: VendaLinha[] = [
    { ...base, id: 'a', total: 100 },
    { ...base, id: 'b', total: 50, itens: 50, pago: 50 },
    { ...base, id: 'c', cancelada: true, total: 30 },
    { ...base, id: 'd', operador: 'JESSICA', total: 80, itens: 100, pago: 80 },
  ];
  const r = agregar(vendas, 'operador', 10);
  it('soma só vendas válidas e ordena pelo total', () => {
    expect(r.map((x) => [x.nome, x.vendas, x.total])).toEqual([['CAMILA', 2, 150], ['JESSICA', 1, 80]]);
  });
  it('conta cancelamento e desconto de quem lançou', () => {
    const camila = r.find((x) => x.nome === 'CAMILA')!;
    expect([camila.canceladas, camila.valorCancelado, camila.ticketMedio]).toEqual([1, 30, 75]);
    const jessica = r.find((x) => x.nome === 'JESSICA')!;
    expect([jessica.descontos, jessica.valorDesconto]).toEqual([1, 20]);
  });
});
