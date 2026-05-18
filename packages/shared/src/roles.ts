// Papeis suportados por tenant. 1 usuario tem exatamente 1 papel por tenant.
export const ROLES = ['owner', 'admin', 'gestor', 'operador', 'leitor'] as const;
export type Role = (typeof ROLES)[number];

// Permissoes derivadas. roleHas(role, capability) -> boolean.
const PERMISSIONS: Record<Role, ReadonlySet<string>> = {
  owner: new Set([
    'tenant.update',
    'tenant.delete',
    'user.invite',
    'user.update',
    'user.delete',
    'store.create',
    'store.update',
    'store.delete',
    'agent.rotate',
    'agent.revoke',
    'billing.manage',
    'audit.view',
    'reports.view',
    'reports.export',
    'settings.update',
  ]),
  admin: new Set([
    'user.invite',
    'user.update',
    'store.create',
    'store.update',
    'agent.rotate',
    'audit.view',
    'reports.view',
    'reports.export',
    'settings.update',
  ]),
  gestor: new Set(['reports.view', 'reports.export']),
  operador: new Set(['reports.view']),
  leitor: new Set(['reports.view']),
};

export function roleHas(role: Role, capability: string): boolean {
  return PERMISSIONS[role].has(capability);
}
