import { describe, it, expect } from 'vitest';
import { conciliar, type LinhaExtrato, type PagamentoSistema } from './matcher.js';

const ex = (valor: number, hora: string, data = '2026-08-22', nsu = 'x'): LinhaExtrato =>
  ({ nsu, valor, data, hora, adquirente: 'CIELO', bandeira: 'ELO', pdv: '001', autorizacao: 'a' });
const si = (valor: number, hora: string, data = '2026-08-22', id = '1'): PagamentoSistema =>
  ({ id, valor, data, hora, forma: 'TEF CREDITO' });

describe('conciliar', () => {
  it('casa transacoes iguais no mesmo dia', () => {
    const r = conciliar([ex(84.12, '16:01:51')], [si(84.12, '16:01:49')]);
    expect(r.totais.conciliados).toBe(1);
    expect(r.totais.soNoExtrato).toBe(0);
  });

  it('acusa cobranca que nao virou venda (o caso real de R$567,80)', () => {
    const r = conciliar([ex(84.12, '16:01:51'), ex(567.80, '11:08:43', '2026-08-22', '002319')], [si(84.12, '16:01:49')]);
    expect(r.totais.soNoExtrato).toBe(1);
    expect(r.totais.valorSoNoExtrato).toBeCloseTo(567.80, 2);
    expect(r.itens.find((i) => i.estado === 'so_no_extrato')?.extrato?.nsu).toBe('002319');
  });

  it('acusa pagamento do sistema sem transacao no extrato', () => {
    const r = conciliar([ex(10, '10:00:00')], [si(10, '10:00:00'), si(99, '11:00:00', '2026-08-22', '2')]);
    expect(r.totais.soNoSistema).toBe(1);
    expect(r.totais.valorSoNoSistema).toBe(99);
  });

  it('com valores repetidos, casa pela hora mais proxima', () => {
    const r = conciliar([ex(50, '09:00:00')], [si(50, '18:00:00', '2026-08-22', 'tarde'), si(50, '09:00:30', '2026-08-22', 'manha')]);
    const casado = r.itens.find((i) => i.estado === 'conciliado');
    expect(casado?.sistema?.id).toBe('manha');
    expect(r.totais.soNoSistema).toBe(1); // o da tarde sobra
  });

  it('IGNORA dia sem nenhum pagamento no sistema (sincronizacao incompleta)', () => {
    // foi isso que fez a copia desatualizada parecer R$13.720 de divergencia em 27/08
    const r = conciliar([ex(100, '10:00:00', '2026-08-25')], []);
    expect(r.diasIgnorados).toEqual(['2026-08-25']);
    expect(r.totais.soNoExtrato).toBe(0);
    expect(r.porDia[0]?.completo).toBe(false);
  });

  it('nao casa transacao de um dia com pagamento de outro', () => {
    // os dois dias tem movimento nos dois lados (senao o dia sem pagamento seria ignorado),
    // mas os valores estao trocados de dia: nada pode casar.
    const r = conciliar(
      [ex(70, '10:00:00', '2026-08-01'), ex(80, '10:00:00', '2026-08-02')],
      [si(80, '10:00:00', '2026-08-01', 'a'), si(70, '10:00:00', '2026-08-02', 'b')],
    );
    expect(r.totais.conciliados).toBe(0);
    expect(r.totais.soNoExtrato).toBe(2);
    expect(r.totais.soNoSistema).toBe(2);
  });

  it('centavos nao se perdem em ponto flutuante', () => {
    const r = conciliar([ex(0.1 + 0.2, '10:00:00')], [si(0.3, '10:00:00')]);
    expect(r.totais.conciliados).toBe(1);
  });
});

describe('conciliar com outras formas de cartao (D29)', () => {
  it('nao acusa venda registrada em OUTRA forma de cartao (o caso real de R$49,43)', () => {
    const r = conciliar(
      [ex(49.43, '09:49:57', '2026-08-03')],
      [si(10, '08:00:00', '2026-08-03')], // TEF do dia (so pra o dia contar como sincronizado)
      [{ id: '601588', valor: 49.43, data: '2026-08-03', hora: '09:49:42', forma: 'CREDITO ENTREGA' }],
    );
    const item = r.itens.find((i) => i.valor === 49.43);
    expect(item?.estado).toBe('conciliado');
    expect(item?.via).toBe('outra_forma');
    expect(r.totais.soNoExtrato).toBe(0);
  });

  it('a segunda chance NAO inventa conciliado quando o valor nao existe em lugar nenhum', () => {
    const r = conciliar(
      [ex(567.80, '11:08:43', '2026-08-22')],
      [si(10, '08:00:00', '2026-08-22')],
      [{ id: 'x', valor: 99.99, data: '2026-08-22', hora: '10:00:00', forma: 'DEBITO ENTREGA' }],
    );
    expect(r.totais.soNoExtrato).toBe(1);
    expect(r.totais.valorSoNoExtrato).toBeCloseTo(567.80, 2);
  });
});
