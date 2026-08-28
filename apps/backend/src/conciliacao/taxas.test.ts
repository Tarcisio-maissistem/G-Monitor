import { describe, it, expect } from 'vitest';
import { calcularCusto, escolherRegra, modalidadeDaBandeira, bandeiraBase, type RegraTaxa } from './taxas.js';

// Tabela REAL do contrato da J.Kastros (informada pelo dono 27/08).
const CONTRATO: RegraTaxa[] = [
  { acquirer: 'REDE', bandeira: 'MASTERCARD', modalidade: 'debito', percent: 0.81, daysToReceive: 1 },
  { acquirer: 'REDE', bandeira: 'VISA', modalidade: 'debito', percent: 0.81, daysToReceive: 1 },
  { acquirer: 'REDE', bandeira: 'ELO', modalidade: 'debito', percent: 1.61, daysToReceive: 1 },
  { acquirer: 'CIELO', bandeira: 'VISA', modalidade: 'credito', percent: 2.89 },
  { acquirer: 'CIELO', bandeira: 'MASTERCARD', modalidade: 'credito', percent: 2.89 },
  { acquirer: 'CIELO', bandeira: 'ELO', modalidade: 'credito', percent: 3.23 },
  { acquirer: 'CIELO', bandeira: 'ELO', modalidade: 'debito', percent: 1.23 },
  { acquirer: 'CIELO', bandeira: 'AMEX', modalidade: 'credito', percent: 3.53 },
];

describe('modalidade a partir da bandeira do extrato', () => {
  it('reconhece debito pelos sufixos reais', () => {
    expect(modalidadeDaBandeira('MASTERCARD DEB')).toBe('debito');
    expect(modalidadeDaBandeira('ELO DEBITO')).toBe('debito');
    expect(modalidadeDaBandeira('ELECTRON')).toBe('debito'); // Visa Electron
  });
  it('sem sufixo e credito (padrao do extrato)', () => {
    expect(modalidadeDaBandeira('MASTERCARD')).toBe('credito');
    expect(modalidadeDaBandeira('VISA')).toBe('credito');
    expect(modalidadeDaBandeira('ELO CREDITO')).toBe('credito');
  });
  it('SHIPAY e PIX', () => {
    expect(modalidadeDaBandeira('', 'SHIPAY')).toBe('pix');
  });
  it('tira o sufixo pra casar com o contrato', () => {
    expect(bandeiraBase('MASTERCARD DEB')).toBe('MASTERCARD');
    expect(bandeiraBase('ELO CREDITO')).toBe('ELO');
  });
});

describe('escolha da regra', () => {
  it('nao confunde Elo debito com Elo credito (1,23% x 3,23%)', () => {
    const deb = escolherRegra(CONTRATO, { acquirer: 'CIELO', bandeira: 'ELO DEBITO', valor: 100 }, 'debito');
    const cred = escolherRegra(CONTRATO, { acquirer: 'CIELO', bandeira: 'ELO CREDITO', valor: 100 }, 'credito');
    expect(deb?.percent).toBe(1.23);
    expect(cred?.percent).toBe(3.23);
  });
  it('Electron casa com a regra da Visa (apelido)', () => {
    expect(escolherRegra(CONTRATO, { acquirer: 'REDE', bandeira: 'ELECTRON', valor: 100 }, 'debito')?.percent).toBe(0.81);
  });
  it('mesma bandeira em adquirente diferente nao vale', () => {
    // Mastercard debito existe na REDE; pedindo pela CIELO nao pode cair na regra da REDE
    expect(escolherRegra(CONTRATO, { acquirer: 'CIELO', bandeira: 'MASTERCARD DEB', valor: 100 }, 'debito')).toBeNull();
  });
  it('curinga do adquirente cobre bandeira nao cadastrada', () => {
    const comCuringa: RegraTaxa[] = [...CONTRATO, { acquirer: 'REDE', bandeira: null, modalidade: 'debito', percent: 1.61 }];
    expect(escolherRegra(comCuringa, { acquirer: 'REDE', bandeira: 'CABAL', valor: 100 }, 'debito')?.percent).toBe(1.61);
  });
});

describe('custo sobre o extrato real de agosto', () => {
  // mistura medida no portal em 01-27/08 (R$ 275.165,03 autorizados)
  const extrato = [
    { acquirer: 'CIELO', bandeira: 'MASTERCARD', valor: 77386.98 },
    { acquirer: 'REDE', bandeira: 'MASTERCARD DEB', valor: 62423.89 },
    { acquirer: 'CIELO', bandeira: 'VISA', valor: 55253.25 },
    { acquirer: 'REDE', bandeira: 'ELECTRON', valor: 55078.23 },
    { acquirer: 'CIELO', bandeira: 'ELO DEBITO', valor: 12301.75 },
    { acquirer: 'CIELO', bandeira: 'ELO CREDITO', valor: 12046.25 },
    { acquirer: 'CIELO', bandeira: 'AMEX', valor: 674.68 },
  ];
  it('reproduz o custo conferido na mao: R$ 5.349,29 (1,94%)', () => {
    const r = calcularCusto(extrato, CONTRATO);
    expect(r.bruto).toBeCloseTo(275165.03, 2);
    expect(r.taxa).toBeCloseTo(5349.29, 1);
    expect(r.taxaEfetivaPct).toBeCloseTo(1.94, 2);
    expect(r.semRegra.transacoes).toBe(0);
  });
  it('bandeira sem taxa cadastrada fica FORA do liquido, nao vira 0%', () => {
    const r = calcularCusto([...extrato, { acquirer: 'REDE', bandeira: 'CABAL DEB', valor: 1000 }], CONTRATO);
    expect(r.semRegra).toEqual({ bruto: 1000, transacoes: 1 });
    expect(r.bruto).toBeCloseTo(275165.03, 2); // o bruto sem regra nao entra
  });
});
