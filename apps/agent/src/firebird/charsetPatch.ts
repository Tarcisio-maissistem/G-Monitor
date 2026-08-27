import { logger } from '../logger.js';
// Modulo INTERNO do node-firebird (a partir da v2 ele ja vem com tipos).
import Xsql from 'node-firebird/lib/wire/xsqlvar.js';

// node-firebird tem um bug conhecido (verificado ainda presente na v2.15.0) (comentario "ToDo: with column charset" no
// proprio codigo-fonte, lib/wire/xsqlvar.js): SQLVarString/SQLVarText.decode ignora
// options.encoding e SEMPRE decodifica CHAR/VARCHAR como UTF8 (Const.DEFAULT_ENCODING,
// hardcoded). O banco do GDOOR declara charset NONE (sem enforcement) e guarda texto em
// bytes Windows-1252 (padrao Windows BR) — decodificar como UTF8 corrompe qualquer
// acento (vira '�'/"?" ou lanca "Malformed string" do proprio Firebird em CAST/
// SUBSTRING). Confirmado ao vivo contra o Firebird real do piloto: "AÇOUGUEIRO" so sai
// correto trocando o decode pra latin1 (== win1252 pros acentos PT-BR usados aqui).
//
// `Const` (lib/wire/const.js) vem congelado (Object.freeze), entao nao da pra so trocar
// DEFAULT_ENCODING. O fix e sobrescrever os metodos decode no prototype de SQLVarString/
// SQLVarText (nao congelados) pra usar latin1 no lugar do UTF8 hardcoded.
let patched = false;

export function patchFirebirdStringDecoding(): void {
  if (patched) return;
  patched = true;

  Xsql.SQLVarString.prototype.decode = function decodeLatin1String(this: any, data: any, lowerV13: boolean) {
    const ret = this.subType === 1 ? data.readBuffer() : data.readString('latin1');
    if (!lowerV13 || !data.readInt()) return ret;
    return null;
  };

  Xsql.SQLVarText.prototype.decode = function decodeLatin1Text(this: any, data: any, lowerV13: boolean) {
    const ret = this.subType === 1 ? data.readBuffer(this.length) : data.readText(this.length, 'latin1');
    if (!lowerV13 || !data.readInt()) return ret;
    return null;
  };

  logger.info('firebird string decoding patched: UTF8 -> latin1 (GDOOR usa Windows-1252, banco declara charset NONE)');
}
