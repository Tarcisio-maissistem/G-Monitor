import { normalizePaymentType, feeChannel } from './paymentType.js';

// Fechamento no formato do gestor da Casa J.Kastros (24/09):
//   ENTRADAS brutas por forma (com %)  ->  menos o vendido A PRAZO (nao e dinheiro efetivo)
//   = liquido de vendas  ->  + RECEBIDOS (titulos baixados no mes)  = entradas efetivas
//   SAIDAS (contas pagas no mes) por grupo  ->  RESULTADO e % sobre as entradas efetivas.
// Pagamento de kind 'recebimento' (baixa de crediario no caixa) NAO entra nas vendas: o titulo
// recebido ja entra em RECEBIDOS pelo contas a receber — somar os dois contaria 2x.

export type FormaFechamento = 'dinheiro' | 'debito' | 'credito' | 'pix' | 'prazo' | 'outros';
export const FORMA_LABEL: Record<FormaFechamento, string> = {
  dinheiro: 'Dinheiro', debito: 'Cartão débito', credito: 'Cartão crédito', pix: 'PIX', prazo: 'A prazo / crediário', outros: 'Outros',
};

/** Forma do fechamento a partir da especie/tipo do GDOOR. Pura. */
export function formaDoPagamento(especie: string | null, paymentType: string | null): FormaFechamento {
  const k = normalizePaymentType(especie) ?? normalizePaymentType(paymentType) ?? 'outros';
  if (k === 'crediario') return 'prazo';
  if (k === 'cartao') {
    const ch = feeChannel(especie, paymentType);
    return ch?.endsWith('debito') ? 'debito' : 'credito';
  }
  return k; // dinheiro | pix | outros
}

export interface ResumoFechamento {
  entradas: {
    bruto: number;
    porForma: Array<{ forma: FormaFechamento; label: string; valor: number; pct: number }>;
    aPrazo: number;
    liquidoVendas: number;      // bruto - a prazo
  };
  recebidos: { valor: number; qtd: number };
  entradasEfetivas: number;     // liquido de vendas + recebidos
  saidas: { total: number; qtd: number; porGrupo: Array<{ nome: string; valor: number; pct: number }>; agrupadoPor: 'fornecedor' | 'plano_contas' };
  resultado: number;            // entradas efetivas - saidas
  resultadoPct: number;         // % sobre as entradas efetivas
}

const r2 = (n: number): number => Math.round(n * 100) / 100;
const pct = (v: number, base: number): number => (base > 0 ? r2((v / base) * 100) : 0);
const MAX_GRUPOS = 15;

export function montarResumoFechamento(p: {
  pagamentos: Array<{ especie: string | null; paymentType: string | null; valor: number }>;
  recebidos: { valor: number; qtd: number };
  saidas: Array<{ grupo: string | null; valor: number; qtd: number }>;
}): ResumoFechamento {
  const soma = new Map<FormaFechamento, number>();
  for (const pg of p.pagamentos) {
    const f = formaDoPagamento(pg.especie, pg.paymentType);
    soma.set(f, (soma.get(f) ?? 0) + pg.valor);
  }
  const bruto = [...soma.values()].reduce((a, v) => a + v, 0);
  const ordem: FormaFechamento[] = ['dinheiro', 'debito', 'credito', 'pix', 'prazo', 'outros'];
  const porForma = ordem.filter((f) => (soma.get(f) ?? 0) !== 0).map((f) => ({ forma: f, label: FORMA_LABEL[f], valor: r2(soma.get(f)!), pct: pct(soma.get(f)!, bruto) }));
  const aPrazo = soma.get('prazo') ?? 0;
  const liquidoVendas = bruto - aPrazo;
  const entradasEfetivas = liquidoVendas + p.recebidos.valor;

  // saidas agrupadas (fornecedor ate o plano de contas chegar pelo agente); cauda vira "Outros"
  const grupos = new Map<string, number>();
  let qtdSaidas = 0;
  for (const s of p.saidas) {
    const nome = (s.grupo ?? '').trim() || '(sem fornecedor)';
    grupos.set(nome, (grupos.get(nome) ?? 0) + s.valor);
    qtdSaidas += s.qtd;
  }
  const totalSaidas = [...grupos.values()].reduce((a, v) => a + v, 0);
  const ordenados = [...grupos.entries()].sort((a, b) => b[1] - a[1]);
  const topo = ordenados.slice(0, MAX_GRUPOS);
  const resto = ordenados.slice(MAX_GRUPOS).reduce((a, [, v]) => a + v, 0);
  const porGrupo = topo.map(([nome, valor]) => ({ nome, valor: r2(valor), pct: pct(valor, totalSaidas) }));
  if (resto > 0) porGrupo.push({ nome: `Outros (${ordenados.length - MAX_GRUPOS})`, valor: r2(resto), pct: pct(resto, totalSaidas) });

  const resultado = entradasEfetivas - totalSaidas;
  return {
    entradas: { bruto: r2(bruto), porForma, aPrazo: r2(aPrazo), liquidoVendas: r2(liquidoVendas) },
    recebidos: { valor: r2(p.recebidos.valor), qtd: p.recebidos.qtd },
    entradasEfetivas: r2(entradasEfetivas),
    saidas: { total: r2(totalSaidas), qtd: qtdSaidas, porGrupo, agrupadoPor: 'fornecedor' },
    resultado: r2(resultado),
    resultadoPct: pct(resultado, entradasEfetivas),
  };
}
