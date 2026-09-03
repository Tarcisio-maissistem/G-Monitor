// Motor de taxa de adquirente (27/08). Modelo fiel ao CONTRATO da loja: a taxa varia por
// ADQUIRENTE + BANDEIRA + MODALIDADE, e nao por "cartao de credito" em bloco.
//
// Exemplo real da J.Kastros: no debito a Rede cobra 0,81% em Mastercard/Visa e 1,61% em
// Elo/Banescard/Cabal — 2x de diferenca na MESMA modalidade. Uma taxa unica por canal erraria
// o liquido conforme a mistura de bandeiras do mes mudasse.
//
// A bandeira SO existe no extrato do portal (o GDOOR guarda o adquirente, nao a bandeira),
// entao este motor roda sobre as linhas do extrato — onde o dado e exato.
export interface RegraTaxa {
  acquirer: string;          // REDE | CIELO | SHIPAY ...
  bandeira: string | null;   // null = vale para qualquer bandeira do mesmo adquirente/modalidade
  modalidade: Modalidade;
  percent: number;           // taxa EFETIVA ja somada (ex.: 1,65 + 1,24 de antecipacao = 2,89)
  taxaBase?: number | null;  // decomposicao informativa da efetiva (contrato da J.Kastros
  taxaD1?: number | null;    //   separa taxa base + antecipacao D1; quem cobra e a efetiva)
  fixedValue?: number;       // custo fixo por transacao, se houver
  daysToReceive?: number;
  parcelasDe?: number | null; // faixa de parcelamento (null = a vista / qualquer)
  parcelasAte?: number | null;
  ativo?: boolean;           // false = regra cadastrada mas fora do calculo (ex.: VR/Alelo sem taxa informada)
}

// 'beneficio' = VR/Alelo/Sodexo (01/09: a J.Kastros aceita VR e Alelo pela Cielo)
export type Modalidade = 'debito' | 'credito' | 'pix' | 'beneficio';

export interface LinhaExtratoTaxa {
  acquirer: string;
  bandeira: string;
  valor: number;
  parcelas?: number;
}

export interface CustoLinha {
  linha: LinhaExtratoTaxa;
  modalidade: Modalidade;
  regra: RegraTaxa | null;   // null = sem taxa cadastrada; NAO entra no liquido
  taxa: number;
  liquido: number;
}

// A bandeira do extrato vem com a modalidade colada: "MASTERCARD DEB", "ELO CREDITO",
// "ELECTRON" (debito da Visa). Sem isso o Elo debito (1,23%) levaria a taxa do Elo credito
// (3,23%) — quase 3x errado.
export function modalidadeDaBandeira(bandeira: string, acquirer?: string): Modalidade {
  const b = (bandeira || '').toUpperCase();
  if (b.includes('PIX') || (acquirer || '').toUpperCase() === 'SHIPAY') return 'pix';
  if (/\b(VR|ALELO|SODEXO|TICKET|PLUXEE|BEN VISA)\b/.test(b)) return 'beneficio';
  if (b.includes('DEB') || b.includes('ELECTRON') || b.includes('MAESTRO')) return 'debito';
  if (b.includes('CRED')) return 'credito';
  // Sem sufixo o extrato traz o credito puro ("MASTERCARD", "VISA", "AMEX") — o debito
  // sempre vem marcado. Confirmado no extrato real de agosto da J.Kastros.
  return 'credito';
}

// Nome da bandeira sem o sufixo de modalidade, pra casar com o cadastro do contrato.
export function bandeiraBase(bandeira: string): string {
  return (bandeira || '')
    .toUpperCase()
    .replace(/\b(DEBITO|DEB|CREDITO|CRED|A VISTA)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Apelidos: o extrato e o contrato nem sempre usam a mesma palavra.
const APELIDOS: Record<string, string> = {
  ELECTRON: 'VISA',       // Visa Electron = debito da Visa
  MAESTRO: 'MASTERCARD',  // Maestro = debito da Mastercard
  'AMERICAN EXPRESS': 'AMEX',
};
const canonica = (b: string): string => APELIDOS[b] ?? b;

/** Regra mais especifica primeiro: bandeira exata > curinga do adquirente/modalidade. */
export function escolherRegra(regras: RegraTaxa[], linha: LinhaExtratoTaxa, modalidade: Modalidade): RegraTaxa | null {
  const adq = (linha.acquirer || '').toUpperCase();
  const band = canonica(bandeiraBase(linha.bandeira));
  const parc = linha.parcelas ?? 1;
  const serve = (r: RegraTaxa): boolean => {
    if (r.ativo === false) return false;
    if (r.acquirer.toUpperCase() !== adq) return false;
    if (r.modalidade !== modalidade) return false;
    if (r.parcelasDe != null && parc < r.parcelasDe) return false;
    if (r.parcelasAte != null && parc > r.parcelasAte) return false;
    return true;
  };
  const daBandeira = regras.filter((r) => serve(r) && r.bandeira && canonica(r.bandeira.toUpperCase()) === band);
  if (daBandeira.length) return daBandeira[0]!;
  const curinga = regras.filter((r) => serve(r) && !r.bandeira);
  return curinga[0] ?? null;
}

export interface ResumoCusto {
  bruto: number;
  taxa: number;
  liquido: number;
  taxaEfetivaPct: number | null;
  semRegra: { bruto: number; transacoes: number };
  porBandeira: Array<{ acquirer: string; bandeira: string; modalidade: Modalidade; transacoes: number; bruto: number; percent: number | null; taxa: number; liquido: number }>;
}

/** Custo exato por linha do extrato. Linha sem regra fica FORA do liquido (nunca vira 0%). */
export function calcularCusto(linhas: LinhaExtratoTaxa[], regras: RegraTaxa[]): ResumoCusto {
  const detalhe: CustoLinha[] = linhas.map((linha) => {
    const modalidade = modalidadeDaBandeira(linha.bandeira, linha.acquirer);
    const regra = escolherRegra(regras, linha, modalidade);
    const taxa = regra ? (linha.valor * regra.percent) / 100 + (regra.fixedValue ?? 0) : 0;
    return { linha, modalidade, regra, taxa, liquido: linha.valor - taxa };
  });

  const comRegra = detalhe.filter((d) => d.regra);
  const semRegra = detalhe.filter((d) => !d.regra);
  const grupos = new Map<string, ResumoCusto['porBandeira'][number]>();
  for (const d of detalhe) {
    const k = `${d.linha.acquirer}|${d.linha.bandeira}`;
    const g = grupos.get(k) ?? {
      acquirer: d.linha.acquirer, bandeira: d.linha.bandeira, modalidade: d.modalidade,
      transacoes: 0, bruto: 0, percent: d.regra?.percent ?? null, taxa: 0, liquido: 0,
    };
    g.transacoes++; g.bruto += d.linha.valor; g.taxa += d.taxa; g.liquido += d.liquido;
    grupos.set(k, g);
  }
  const bruto = comRegra.reduce((a, d) => a + d.linha.valor, 0);
  const taxa = comRegra.reduce((a, d) => a + d.taxa, 0);
  return {
    bruto, taxa, liquido: bruto - taxa,
    taxaEfetivaPct: bruto > 0 ? (taxa / bruto) * 100 : null,
    semRegra: { bruto: semRegra.reduce((a, d) => a + d.linha.valor, 0), transacoes: semRegra.length },
    porBandeira: [...grupos.values()].sort((a, b) => b.bruto - a.bruto),
  };
}
