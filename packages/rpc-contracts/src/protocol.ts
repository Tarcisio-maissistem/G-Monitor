// Versao do protocolo RPC. Major incompatible -> agente forcado a atualizar.
export const PROTOCOL_VERSION = '1.0.0';

export const HEARTBEAT_INTERVAL_MS = 25_000;
export const HEARTBEAT_TIMEOUT_MS = 60_000;
export const DEFAULT_RPC_TIMEOUT_MS = 30_000;
export const MAX_PENDING_RPC = 10;

export const RECONNECT_BACKOFF = {
  initialMs: 1_000,
  maxMs: 60_000,
  multiplier: 2,
  jitterRatio: 0.2,
};

export const WS_CLOSE_CODES = {
  AUTH_FAILED: 4401,
  PROTOCOL_OUTDATED: 4402,
  REPLACED_BY_NEW_SESSION: 4403,
  TENANT_SUSPENDED: 4404,
  PENDING_APPROVAL: 4405,
} as const;
