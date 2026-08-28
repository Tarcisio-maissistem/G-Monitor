// Normalizacao da forma de pagamento (Payment.paymentType) — fonte unica pra todo relatorio.
//
// Por que existe: o TYPE_MAP antigo (financial e monthly-closing) so reconhecia 4 literais
// exatos (DINHEIRO/CARTAO/PIX/CREDIARIO). A Fase 0 (25/08, queries na prod) mostrou que o
// GDOOR manda `CARTãO CRéDITO`, `PAGAMENTO INSTANTâNEO (PIX)`, `A PRAZO / CRéDITO LOJA`,
// `CARTãO DA LOJA, CREDIáRIO DIGITAL, OUTROS CREDIáRIOS` — nenhum batia, e R$600k+ de cartao/
// pix/crediario caiam em "outros". O acento fica minusculo porque o UPPER() do Firebird nao
// sobe caractere acentuado; linhas antigas (antes do charsetPatch do agente) ainda podem
// vir em mojibake (`Ã£` no lugar de `ã`). Aqui trata os dois.

export type PaymentKey = 'dinheiro' | 'cartao' | 'pix' | 'crediario' | 'outros';

export const PAYMENT_KEYS: readonly PaymentKey[] = ['dinheiro', 'cartao', 'pix', 'crediario', 'outros'];

// Tabela de mojibake: letra acentuada -> como ela aparece quando os 2 bytes UTF-8 sao lidos
// como latin1 (`é` = C3 A9 = `Ã©`). Montada em runtime a partir das proprias letras pra nao
// digitar sequencia invisivel na mao. As maiusculas tem o 2o byte em 0x80-0x9F, onde latin1 e
// cp1252 divergem — cobre as duas variantes.
const ACCENTED_TO_PLAIN: Record<string, string> = {
  ã: 'a', á: 'a', â: 'a', à: 'a', é: 'e', ê: 'e', í: 'i', ó: 'o', ô: 'o', õ: 'o', ú: 'u', ç: 'c',
  Ã: 'A', Á: 'A', Â: 'A', À: 'A', É: 'E', Ê: 'E', Í: 'I', Ó: 'O', Ô: 'O', Õ: 'O', Ú: 'U', Ç: 'C',
};
// cp1252: byte 0x80-0x9F vira simbolo tipografico (0x83 = U+0192 'ƒ', 0x89 = U+2030 '‰' ...).
const CP1252_HIGH: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡',
  0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž',
  0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—',
  0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};
const MOJIBAKE: Map<string, string> = new Map();
for (const [letter, plain] of Object.entries(ACCENTED_TO_PLAIN)) {
  const bytes = Buffer.from(letter, 'utf8');
  MOJIBAKE.set(bytes.toString('latin1'), plain);
  const second = bytes[1]!;
  const cp = CP1252_HIGH[second];
  if (cp) MOJIBAKE.set(String.fromCharCode(bytes[0]!) + cp, plain);
}
// Qualquer `Ã` (C3) seguido de 1 caractere: se estiver na tabela troca, senao deixa como esta
// (o strip de acento/nao-ASCII abaixo cuida do resto).
const MOJIBAKE_RE = /Ã[\s\S]/g;

// Remove mojibake + acento + caractere fora do ASCII, sobe pra maiusculo e colapsa espacos.
// Exportada porque o DRE usa a mesma regra pra comparar `Sale.natureza` (`Devolução%`).
export function normalizeText(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .replace(MOJIBAKE_RE, (m) => MOJIBAKE.get(m) ?? m)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // marcas combinantes (o acento separado pelo NFD)
    .replace(/[^\x20-\x7e]/g, '') // qualquer sobra fora do ASCII imprimivel
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Retorna a chave normalizada ou `null` quando o pagamento NAO deve ser somado
// (`SEM PAGAMENTO` e vazio). A ORDEM dos testes importa: crediario vem antes de cartao porque
// `CARTAO DA LOJA, CREDIARIO DIGITAL` e crediario, nao cartao; pix vem primeiro porque o
// literal `PAGAMENTO INSTANTANEO (PIX)` nao tem nenhuma das outras palavras.
export function normalizePaymentType(raw: string | null | undefined): PaymentKey | null {
  const t = normalizeText(raw);
  if (!t) return null;
  if (t.includes('PIX')) return 'pix';
  if (t.includes('PRAZO') || t.includes('CREDIARIO') || t.includes('CREDITO LOJA') || t.includes('CARTAO DA LOJA')) return 'crediario';
  if (t.includes('CARTAO') || t.includes('DEBITO') || t.includes('CREDITO')) return 'cartao';
  if (t.includes('DINHEIRO')) return 'dinheiro';
  if (t === 'SEM PAGAMENTO') return null;
  return 'outros';
}

export type PaymentBreakdown = Record<PaymentKey, number>;

export function emptyBreakdown(): PaymentBreakdown {
  return { dinheiro: 0, cartao: 0, pix: 0, crediario: 0, outros: 0 };
}

// ─── Canal de taxa (conciliacao bancaria, D21 — 26/08; revisto 27/08) ──────────────
// Granularidade MAIOR que PaymentKey. Duas separacoes que o dono precisa e que a 1a versao
// perdia (achado 27/08 olhando as formas reais das duas lojas):
//   1. debito x credito — taxas diferentes;
//   2. **TEF x maquininha avulsa** — sao ADQUIRENTES diferentes, com contrato e taxa
//      diferentes. Na J.Kastros: `TEF CREDITO` R$144.948 e `CREDITO ENTREGA` R$103.594 no
//      mesmo mes; a 1a versao somava os dois em "POS" e nao havia onde cadastrar a taxa do TEF.
// PIX segue a mesma logica: `PIX TEF` (pela maquininha) x `PIX ENTREGA`/estatico (QR fixo).
//
// Le a ESPECIE (forma bruta do GDOOR), nao o paymentType: o paymentType ja vem traduzido pro
// nome fiscal, onde `TEF CREDITO` e `CREDITO ENTREGA` viram os dois `CARTAO CREDITO`.
export type FeeChannel =
  | 'tef_debito' | 'tef_credito'      // maquininha integrada ao PDV (TEF)
  | 'pos_debito' | 'pos_credito'      // maquininha avulsa (na J.Kastros, a da entrega)
  | 'pix_tef' | 'pix_estatico';

export const FEE_CHANNELS: readonly FeeChannel[] = [
  'tef_debito', 'tef_credito', 'pos_debito', 'pos_credito', 'pix_tef', 'pix_estatico',
];

/** `especie` = forma bruta do GDOOR (preferida). `paymentType` = fiscal, so como reserva. */
export function feeChannel(especie: string | null | undefined, paymentType?: string | null): FeeChannel | null {
  const t = normalizeText(especie) || normalizeText(paymentType);
  if (!t) return null;
  const ehTef = t.includes('TEF');
  // PIX primeiro: 'ESTATICO' so aparece no literal do QR fixo.
  if (t.includes('PIX')) return ehTef ? 'pix_tef' : 'pix_estatico';
  // crediario da loja NAO e adquirente — antes de cartao (mesma ordem do normalize)
  if (t.includes('PRAZO') || t.includes('CREDIARIO') || t.includes('CREDITO LOJA') || t.includes('CARTAO DA LOJA')) return null;
  if (t.includes('DEBITO')) return ehTef ? 'tef_debito' : 'pos_debito';
  if (t.includes('CREDITO')) return ehTef ? 'tef_credito' : 'pos_credito';
  return null; // dinheiro, outros
}
