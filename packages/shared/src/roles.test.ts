import { describe, it, expect } from 'vitest';
import { roleHas } from './roles.js';

describe('roleHas', () => {
  it('owner pode tudo de tenant.update', () => {
    expect(roleHas('owner', 'tenant.update')).toBe(true);
  });

  it('leitor so vê relatorios', () => {
    expect(roleHas('leitor', 'reports.view')).toBe(true);
    expect(roleHas('leitor', 'tenant.update')).toBe(false);
  });

  it('operador nao gerencia usuarios', () => {
    expect(roleHas('operador', 'user.invite')).toBe(false);
  });
});
