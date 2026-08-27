// Cofre de segredo de integracao: cifra em repouso com AES-256-GCM.
//
// PRIMEIRA cifra do G-Monitor (27/08). Ate aqui o projeto nao guardava senha de terceiro
// nenhuma; a do portal GetCard e a primeira. Desenho copiado do que ja roda no Ana Food
// (src/lib/secretBox.js), inclusive o formato, pra nao inventar padrao novo.
//
// GCM (nao CBC) de proposito: e cifra AUTENTICADA — se o texto cifrado for adulterado no
// banco, o open() FALHA em vez de devolver lixo silenciosamente.
//
// Formato: v1:<iv_b64>:<tag_b64>:<ciphertext_b64> — o prefixo de versao permite trocar
// algoritmo/chave depois sem adivinhar o formato antigo.
import crypto from 'node:crypto';

const VERSAO = 'v1';
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12; // nonce canonico do GCM

// A chave NUNCA fica no banco nem no codigo: so em process.env.INTEGRACAO_ENC_KEY. Guardar a
// chave junto do que ela cifra anula a cifra. Lida na hora do uso (nao no import) pra um
// import solto nao derrubar o boot de quem nem usa cifra.
function lerChave(): Buffer {
  const bruto = process.env.INTEGRACAO_ENC_KEY;
  if (!bruto) throw new Error('INTEGRACAO_ENC_KEY_ausente');
  const chave = /^[0-9a-f]{64}$/i.test(bruto) ? Buffer.from(bruto, 'hex') : Buffer.from(bruto, 'base64');
  // mensagem sem o valor: chave errada nao vira log com chave dentro
  if (chave.length !== 32) throw new Error(`INTEGRACAO_ENC_KEY_invalida (esperado 32 bytes, veio ${chave.length})`);
  return chave;
}

export function seal(texto: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const c = crypto.createCipheriv(ALGO, lerChave(), iv);
  const ct = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return [VERSAO, iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

export function open(cifrado: string): string {
  const [v, ivB64, tagB64, ctB64] = cifrado.split(':');
  if (v !== VERSAO || !ivB64 || !tagB64 || !ctB64) throw new Error('segredo_formato_invalido');
  const d = crypto.createDecipheriv(ALGO, lerChave(), Buffer.from(ivB64, 'base64'));
  d.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ctB64, 'base64')), d.final()]).toString('utf8');
}

// true quando a string tem cara de segredo cifrado por aqui (pra migrar valor antigo em claro).
export function isSealed(v: unknown): boolean {
  return typeof v === 'string' && v.startsWith(`${VERSAO}:`) && v.split(':').length === 4;
}
