import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';
import { seal, open, isSealed } from './secretBox.js';

beforeAll(() => { process.env.INTEGRACAO_ENC_KEY = crypto.randomBytes(32).toString('base64'); });

describe('secretBox', () => {
  it('abre o que fechou', () => {
    const s = 'senha-do-portal-123@';
    expect(open(seal(s))).toBe(s);
  });
  it('gera cifra diferente a cada vez (IV aleatorio)', () => {
    expect(seal('x')).not.toBe(seal('x'));
  });
  it('FALHA se o texto cifrado for adulterado (GCM autenticado)', () => {
    const c = seal('senha');
    const partes = c.split(':');
    partes[3] = Buffer.from('outracoisa').toString('base64');
    expect(() => open(partes.join(':'))).toThrow();
  });
  it('recusa formato desconhecido', () => {
    expect(() => open('senha-em-claro')).toThrow('segredo_formato_invalido');
    expect(isSealed('senha-em-claro')).toBe(false);
    expect(isSealed(seal('a'))).toBe(true);
  });
});
