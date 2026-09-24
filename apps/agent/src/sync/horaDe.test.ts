import { describe, it, expect } from 'vitest';
import { horaDe } from './syncer.js';

// 0.9.11: o horario do movimento de caixa vinha zerado (gestor J.Kastros 24/09)
describe('horaDe (TIME do Firebird)', () => {
  it('le o relogio do TIME', () => {
    expect(horaDe(new Date('1970-01-01T10:42:07Z'))).toBe('10:42:07');
  });
  it('aceita texto', () => {
    expect(horaDe('1970-01-01T23:05:00Z')).toBe('23:05:00');
  });
  it('vazio vira null (nunca 00:00:00)', () => {
    expect(horaDe(null)).toBeNull();
    expect(horaDe('')).toBeNull();
    expect(horaDe('lixo')).toBeNull();
  });
});
