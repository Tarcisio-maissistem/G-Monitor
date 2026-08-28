import { describe, it, expect } from 'vitest';
import { normalizePaymentType, normalizeText, feeChannel } from './paymentType.js';

// Literais REAIS de payments.paymentType na prod (Fase 0, 25/08) — cada um com a chave esperada.
// Se o GDOOR de um cliente novo mandar algo diferente, o literal entra aqui junto com a regra.
const PROD_LITERALS: Array<[string, ReturnType<typeof normalizePaymentType>]> = [
  ['CARTãO CRéDITO', 'cartao'],
  ['DINHEIRO', 'dinheiro'],
  ['A PRAZO / CRéDITO LOJA', 'crediario'],
  ['PAGAMENTO INSTANTâNEO (PIX)', 'pix'],
  ['CARTãO DA LOJA, CREDIáRIO DIGITAL, OUTROS CREDIáRIOS', 'crediario'],
  ['OUTRAS', 'outros'],
  ['SEM PAGAMENTO', null],
];

describe('normalizePaymentType — literais da prod', () => {
  for (const [raw, expected] of PROD_LITERALS) {
    it(`${JSON.stringify(raw)} -> ${String(expected)}`, () => {
      expect(normalizePaymentType(raw)).toBe(expected);
    });
  }
});

describe('normalizePaymentType — variantes', () => {
  it('literais exatos do TYPE_MAP antigo continuam batendo', () => {
    expect(normalizePaymentType('DINHEIRO')).toBe('dinheiro');
    expect(normalizePaymentType('CARTAO')).toBe('cartao');
    expect(normalizePaymentType('PIX')).toBe('pix');
    expect(normalizePaymentType('CREDIARIO')).toBe('crediario');
  });

  it('mojibake (UTF-8 lido como latin1) resolve igual ao acento normal', () => {
    // 'é' = C3 A9 -> 'Ã©'; 'ã' = C3 A3 -> 'Ã£'; 'â' = C3 A2 -> 'Ã¢'; 'á' = C3 A1 -> 'Ã¡'
    expect(normalizePaymentType('CARTÃ£O CRÃ©DITO')).toBe('cartao');
    expect(normalizePaymentType('PAGAMENTO INSTANTÃ¢NEO (PIX)')).toBe('pix');
    expect(normalizePaymentType('A PRAZO / CRÃ©DITO LOJA')).toBe('crediario');
    expect(normalizePaymentType('CARTÃ£O DA LOJA, CREDIÃ¡RIO DIGITAL')).toBe('crediario');
    // mojibake de maiuscula acentuada (2o byte em 0x80-0x9F): latin1 e cp1252
    expect(normalizeText(Buffer.from('CRÉDITO', 'utf8').toString('latin1'))).toBe('CREDITO');
    expect(normalizeText('CRÃ‰DITO')).toBe('CREDITO');
  });

  it('minusculas, espacos extras e acento maiusculo', () => {
    expect(normalizePaymentType('  cartão débito ')).toBe('cartao');
    expect(normalizePaymentType('CARTÃO DÉBITO')).toBe('cartao');
    expect(normalizePaymentType('Pix')).toBe('pix');
  });

  it('ordem: crediario antes de cartao (cartao da loja e crediario)', () => {
    expect(normalizePaymentType('CARTAO DA LOJA')).toBe('crediario');
    expect(normalizePaymentType('CREDITO LOJA')).toBe('crediario');
    expect(normalizePaymentType('VENDA A PRAZO')).toBe('crediario');
  });

  it('vazio/null e SEM PAGAMENTO nao somam (null)', () => {
    expect(normalizePaymentType(null)).toBeNull();
    expect(normalizePaymentType(undefined)).toBeNull();
    expect(normalizePaymentType('')).toBeNull();
    expect(normalizePaymentType('sem pagamento')).toBeNull();
  });

  it('desconhecido vira outros', () => {
    expect(normalizePaymentType('CHEQUE')).toBe('outros');
    expect(normalizePaymentType('VALE ALIMENTACAO')).toBe('outros');
  });
});

describe('normalizeText', () => {
  it('serve pra comparar natureza da venda sem depender de acento', () => {
    expect(normalizeText('Devolução de compra para comercialização')).toBe('DEVOLUCAO DE COMPRA PARA COMERCIALIZACAO');
    expect(normalizeText('Venda com substituição tributária')).toBe('VENDA COM SUBSTITUICAO TRIBUTARIA');
  });
});

describe('feeChannel', () => {
  it('separa TEF de maquininha avulsa (literais reais da J.Kastros)', () => {
    expect(feeChannel('TEF CREDITO')).toBe('tef_credito');
    expect(feeChannel('TEF DEBITO')).toBe('tef_debito');
    expect(feeChannel('CREDITO ENTREGA')).toBe('pos_credito');
    expect(feeChannel('DEBITO ENTREGA')).toBe('pos_debito');
    expect(feeChannel('CREDITO TEF')).toBe('tef_credito'); // ordem invertida existe em prod
  });
  it('separa PIX do TEF do PIX estatico', () => {
    expect(feeChannel('PIX TEF')).toBe('pix_tef');
    expect(feeChannel('PIX ENTREGA')).toBe('pix_estatico');
    expect(feeChannel(null, 'PAGAMENTO INSTANTâNEO ESTATICO (PIX)')).toBe('pix_estatico');
  });
  it('usa o paymentType so quando nao ha especie', () => {
    expect(feeChannel(null, 'CARTãO CRéDITO')).toBe('pos_credito');
    expect(feeChannel('', 'CARTãO DéBITO')).toBe('pos_debito');
  });
  it('nao cobra taxa de dinheiro nem de crediario da loja', () => {
    expect(feeChannel('DINHEIRO')).toBeNull();
    expect(feeChannel('PRAZO')).toBeNull();
    expect(feeChannel('A PRAZO / CRéDITO LOJA')).toBeNull();
    expect(feeChannel(null)).toBeNull();
  });
});
