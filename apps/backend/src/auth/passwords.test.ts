import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './passwords.js';

describe('passwords', () => {
  it('hash diferente da senha em claro', async () => {
    const hash = await hashPassword('senha-supersegura-123');
    expect(hash).not.toContain('senha-supersegura-123');
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('verifica senha correta', async () => {
    const hash = await hashPassword('correta');
    expect(await verifyPassword(hash, 'correta')).toBe(true);
  });

  it('rejeita senha errada', async () => {
    const hash = await hashPassword('correta');
    expect(await verifyPassword(hash, 'errada')).toBe(false);
  });
});
