import { createHash, randomBytes } from 'node:crypto';

// Hash de tokens armazenados no banco. SHA-256 e suficiente porque os tokens
// ja sao aleatorios de alta entropia (32+ bytes). Argon2 e excessivo aqui.
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateRandomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

// Token de agente formato: agt_<tenantId>_<uuid>_<secret64>
export function generateAgentToken(tenantId: string, uuid: string): string {
  return `agt_${tenantId}_${uuid}_${generateRandomToken(48)}`;
}

export function parseAgentToken(token: string): { tenantId: string; uuid: string } | null {
  const parts = token.split('_');
  if (parts.length !== 4 || parts[0] !== 'agt') return null;
  return { tenantId: parts[1]!, uuid: parts[2]! };
}
