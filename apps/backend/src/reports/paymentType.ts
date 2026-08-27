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

// ─── Canal de taxa (conciliacao bancaria, D21 — 26/08) ──────────────────────────────
// Granularidade MAIOR que PaymentKey: pra taxa, `cartao` nao basta (debito e credito tem
// taxas diferentes) e `pix` nao basta (PIX pelo TEF/Shipay cobra taxa, PIX estatico costuma
// ser outra). Os literais reais do cliente (Piloto, agosto/2026):
//   'CARTãO DéBITO' · 'CARTãO CRéDITO' · 'PAGAMENTO INSTANTâNEO (PIX)' (TEF/Shipay)
//   'PAGAMENTO INSTANTâNEO ESTATICO (PIX)' (QR fixo da loja)
// Retorna null pro que NAO tem taxa de adquirente (dinheiro, crediario da propria loja).
export type FeeChannel = 'pos_debito' | 'pos_credito' | 'pix_tef' | 'pix_estatico';

export const FEE_CHANNELS: readonly FeeChannel[] = ['pos_debito', 'pos_credito', 'pix_tef', 'pix_estatico'];

export function feeChannel(raw: string | null | undefined): FeeChannel | null {
  const t = normalizeText(raw);
  if (!t) return null;
  // PIX primeiro: 'ESTATICO' so aparece no literal do QR fixo.
  if (t.includes('PIX')) return t.includes('ESTATICO') ? 'pix_estatico' : 'pix_tef';
  // crediario da loja NAO e adquirente — checado antes de cartao (mesma ordem do normalize)
  if (t.includes('PRAZO') || t.includes('CREDIARIO') || t.includes('CREDITO LOJA') || t.includes('CARTAO DA LOJA')) return null;
  if (t.includes('DEBITO')) return 'pos_debito';
  if (t.includes('CREDITO')) return 'pos_credito';
  return null; // dinheiro, outros
}
