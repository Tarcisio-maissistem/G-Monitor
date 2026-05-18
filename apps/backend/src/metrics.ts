import client from 'prom-client';

// Coletor padrao + metricas custom.
client.collectDefaultMetrics({ prefix: 'gmonitor_' });

export const httpRequestDuration = new client.Histogram({
  name: 'gmonitor_http_request_duration_seconds',
  help: 'Duracao de requests HTTP em segundos',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10],
});

export const agentSessionsActive = new client.Gauge({
  name: 'gmonitor_agent_sessions_active',
  help: 'Quantidade de sessoes de agente conectadas',
});

export const agentRpcLatency = new client.Histogram({
  name: 'gmonitor_agent_rpc_latency_seconds',
  help: 'Latencia de RPC para agente',
  labelNames: ['op'],
  buckets: [0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10, 30],
});

export const syncLag = new client.Gauge({
  name: 'gmonitor_sync_lag_seconds',
  help: 'Lag de sync por tenant/store',
  labelNames: ['tenant_id', 'store_id'],
});

export const registry = client.register;
