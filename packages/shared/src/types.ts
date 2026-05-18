// Tipos comuns trafegados entre backend e frontend.

export interface TenantPublic {
  id: string;
  name: string;
  cnpj: string | null;
  plan: 'starter' | 'business' | 'enterprise';
  subscriptionStatus: 'trialing' | 'active' | 'past_due' | 'suspended' | 'cancelled';
  createdAt: string;
}

export interface UserPublic {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'admin' | 'gestor' | 'operador' | 'leitor';
  storeId: string | null;
  twoFactorEnabled: boolean;
  createdAt: string;
}

export interface StorePublic {
  id: string;
  name: string;
  externalId: string;
  timezone: string;
  agentOnline: boolean;
  lastSyncedAt: string | null;
  stalenessSeconds: number | null;
}

export interface AgentStatus {
  storeId: string;
  online: boolean;
  agentVersion: string | null;
  firebirdVersion: string | null;
  lastSeenAt: string | null;
  pendingRpc: number;
}
