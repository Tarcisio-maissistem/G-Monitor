import { describe, it, expect } from 'vitest';
import { bucketKey, mergeCashflow, mergeForecast, pickGranularity, type DayAgg, type PaymentAgg } from './cashflowMerge.js';

// Cenario em memoria com os literais reais da prod (Fase 0). A query ja descartou venda
// cancelada (LEFT JOIN sales), entao aqui o que chega e o que a query devolveria.
const payments: PaymentAgg[] = [
  { day: '2026-08-03', paymentType: 'DINHEIRO', avulso: false, total: 100, count: 2 },
  { day: '2026-08-03', paymentType: 'CARTãO CRéDITO', avulso: false, total: 250.5, count: 3 },
  { day: '2026-08-03', paymentType: 'PAGAMENTO INSTANTâNEO (PIX)', avulso: false, total: 80, count: 1 },
  { day: '2026-08-03', paymentType: 'A PRAZO / CRéDITO LOJA', avulso: false, total: 500, count: 1 }, // crediario: NAO entra (P1)
  { day: '2026-08-03', paymentType: 'SEM PAGAMENTO', avulso: false, total: 999, count: 1 }, // ignorado
  { day: '2026-08-04', paymentType: 'DINHEIRO', avulso: true, total: 60, count: 2 }, // avulso (saleId NULL)
  { day: '2026-08-04', paymentType: 'OUTRAS', avulso: false, total: 10, count: 1 },
];
const receivables: DayAgg[] = [{ day: '2026-08-04', total: 500, count: 1 }]; // baixa do crediario de dia 03
const payables: DayAgg[] = [
  { day: '2026-08-03', total: 30, count: 1 },
  { day: '2026-08-05', total: 200, count: 2 }, // dia so com saida
];

describe('mergeCashflow (dia)', () => {
  const r = mergeCashflow({ payments, receivables, payables }, 'day');

  it('agrupa por forma normalizada e exclui crediario e SEM PAGAMENTO das vendas', () => {
    const d3 = r.data.find((x) => x.dia === '2026-08-03')!;
    expect(d3.detalhe.vendas).toEqual({ dinheiro: 100, cartao: 250.5, pix: 80, outros: 0 });
    expect(d3.entradas).toBe(430.5);
    expect(d3.saidas).toBe(30);
    expect(d3.saldoDia).toBe(400.5);
  });

  it('crediario conta 1x, na baixa do titulo (receivable), nao na venda', () => {
    const d4 = r.data.find((x) => x.dia === '2026-08-04')!;
    expect(d4.detalhe.crediarioRecebido).toBe(500);
    expect(r.totals.entradas).toBe(430.5 + 60 + 10 + 500); // sem os 500 do Payment crediario
  });

  it('avulsos (saleId NULL) vao pra linha propria e sao contados', () => {
    const d4 = r.data.find((x) => x.dia === '2026-08-04')!;
    expect(d4.detalhe.avulsos).toBe(60);
    expect(d4.detalhe.vendas.dinheiro).toBe(0);
    expect(d4.detalhe.vendas.outros).toBe(10);
    expect(r.avulsosNaoClassificados).toBe(2);
  });

  it('saldo acumulado bate dia a dia e o total e a variacao do periodo', () => {
    expect(r.data.map((x) => x.dia)).toEqual(['2026-08-03', '2026-08-04', '2026-08-05']);
    expect(r.data.map((x) => x.saldoAcumulado)).toEqual([400.5, 970.5, 770.5]);
    expect(r.totals).toEqual({ entradas: 1000.5, saidas: 230, variacao: 770.5 });
  });

  it('dia so com saida aparece com entradas 0', () => {
    const d5 = r.data.find((x) => x.dia === '2026-08-05')!;
    expect(d5.entradas).toBe(0);
    expect(d5.saidas).toBe(200);
    expect(d5.movimentos).toBe(2);
  });

  it('movimentos conta lancamentos que entraram (nao conta crediario/SEM PAGAMENTO)', () => {
    const d3 = r.data.find((x) => x.dia === '2026-08-03')!;
    expect(d3.movimentos).toBe(2 + 3 + 1 + 1); // 3 formas de venda + 1 payable
  });

  it('vazio devolve lista vazia e totais zerados', () => {
    expect(mergeCashflow({ payments: [], receivables: [], payables: [] }, 'day')).toEqual({
      data: [],
      totals: { entradas: 0, saidas: 0, variacao: 0 },
      avulsosNaoClassificados: 0,
    });
  });
});

describe('mergeCashflow (semana / mes)', () => {
  it('semana agrupa na segunda-feira ISO', () => {
    // 2026-08-03 e segunda; 04 e 05 caem na mesma semana
    const r = mergeCashflow({ payments, receivables, payables }, 'week');
    expect(r.data).toHaveLength(1);
    expect(r.data[0]!.dia).toBe('2026-08-03');
    expect(r.data[0]!.entradas).toBe(1000.5);
    expect(r.data[0]!.saidas).toBe(230);
  });

  it('mes agrupa no dia 1', () => {
    const r = mergeCashflow({ payments, receivables, payables }, 'month');
    expect(r.data).toHaveLength(1);
    expect(r.data[0]!.dia).toBe('2026-08-01');
    expect(r.data[0]!.saldoAcumulado).toBe(770.5);
  });
});

describe('bucketKey / pickGranularity', () => {
  it('domingo volta pra segunda anterior', () => {
    expect(bucketKey('2026-08-09', 'week')).toBe('2026-08-03'); // 09/08/2026 e domingo
    expect(bucketKey('2026-08-10', 'week')).toBe('2026-08-10'); // segunda fica
    expect(bucketKey('2026-08-31', 'month')).toBe('2026-08-01');
    expect(bucketKey('2026-08-31', 'day')).toBe('2026-08-31');
  });

  it('mais de 31 dias vira semana; pedido explicito vence', () => {
    const from = new Date('2026-07-01T00:00:00Z');
    expect(pickGranularity(from, new Date('2026-07-31T23:59:59Z'))).toBe('day');
    expect(pickGranularity(from, new Date('2026-08-01T23:59:59Z'))).toBe('week');
    expect(pickGranularity(from, new Date('2026-08-01T23:59:59Z'), 'day')).toBe('day');
  });
});

describe('mergeForecast', () => {
  it('junta receber e pagar por vencimento com saldo por dia', () => {
    const r = mergeForecast(
      [{ day: '2026-09-01', total: 100, count: 1 }, { day: '2026-09-03', total: 50, count: 1 }],
      [{ day: '2026-09-01', total: 30, count: 1 }, { day: '2026-09-02', total: 70, count: 2 }],
    );
    expect(r.data).toEqual([
      { dia: '2026-09-01', entradas: 100, saidas: 30, saldo: 70 },
      { dia: '2026-09-02', entradas: 0, saidas: 70, saldo: -70 },
      { dia: '2026-09-03', entradas: 50, saidas: 0, saldo: 50 },
    ]);
    expect(r.totals).toEqual({ entradas: 150, saidas: 100, saldo: 50 });
  });
});

describe('sangria conta como saida do caixa, suprimento nao e receita (dono 04/09)', () => {
  const dia = '2026-08-26';
  it('sangria entra nas saidas em linha propria (a loja paga despesa pelo caixa tambem)', () => {
    const r = mergeCashflow({
      payments: [
        { day: dia, paymentType: 'DINHEIRO', avulso: false, kind: 'venda', total: 1000, count: 10 },
        { day: dia, paymentType: 'DINHEIRO', avulso: false, kind: 'sangria', total: 800, count: 2 },
      ],
      receivables: [], payables: [],
    }, 'day');
    expect(r.totals.saidas).toBe(800);
    expect(r.totals.entradas).toBe(1000);
    expect(r.data[0]!.detalhe.sangrias).toBe(800); // visivel em separado das contas pagas
    expect(r.data[0]!.detalhe.contasPagas).toBe(0);
  });
  it('suprimento (troco) nao vira receita', () => {
    const r = mergeCashflow({
      payments: [{ day: dia, paymentType: 'DINHEIRO', avulso: false, kind: 'suprimento', total: 400, count: 2 }],
      receivables: [], payables: [],
    }, 'day');
    expect(r.totals.entradas).toBe(0);
    expect(r.data[0]!.detalhe.suprimentos).toBe(400);
  });
  it('conta paga continua sendo saida', () => {
    const r = mergeCashflow({ payments: [], receivables: [], payables: [{ day: dia, total: 250, count: 1 }] }, 'day');
    expect(r.totals.saidas).toBe(250);
  });
});
