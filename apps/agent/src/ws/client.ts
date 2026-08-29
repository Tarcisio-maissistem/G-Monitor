import WebSocket from 'ws';
import { pack, unpack } from 'msgpackr';
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  RECONNECT_BACKOFF,
  PROTOCOL_VERSION,
  messageEnvelopeSchema,
  MAX_PENDING_RPC,
  RPC_ERROR_CODES,
} from '@gmonitor/rpc-contracts';
import type { AgentConfig } from '../config.js';
import { logger } from '../logger.js';
import { setSyncInterval } from '../sync/syncer.js';
import { handleRpc } from './rpcHandler.js';

// Cliente WebSocket que mantem conexao persistente com o SaaS.
// Reconexao com backoff exponencial e jitter ate 60s.
// Heartbeat ping a cada 25s; 60s sem pong -> reconecta.

export class AgentWsClient {
  private ws: WebSocket | null = null;
  private reconnectMs = RECONNECT_BACKOFF.initialMs;
  private pingTimer: NodeJS.Timeout | null = null;
  private pongTimer: NodeJS.Timeout | null = null;
  private startTime = Date.now();
  private pendingCount = 0;
  private closed = false;

  constructor(private readonly cfg: AgentConfig) {}

  start(): void {
    this.connect();
  }

  stop(): void {
    this.closed = true;
    this.clearTimers();
    this.ws?.close(1000, 'agent_shutdown');
  }

  get uptimeSeconds(): number {
    return Math.floor((Date.now() - this.startTime) / 1000);
  }

  get pendingRpc(): number {
    return this.pendingCount;
  }

  private connect(): void {
    if (this.closed) return;

    logger.info({ url: this.cfg.wsUrl }, 'connecting to saas');
    const ws = new WebSocket(this.cfg.wsUrl, {
      headers: { Authorization: `Bearer ${this.cfg.token}` },
    });
    this.ws = ws;

    ws.on('open', () => {
      logger.info('ws open');
      this.reconnectMs = RECONNECT_BACKOFF.initialMs;
      this.scheduleHeartbeat();
    });

    ws.on('pong', () => {
      if (this.pongTimer) clearTimeout(this.pongTimer);
    });

    ws.on('message', (raw: WebSocket.RawData) => {
      void this.handleMessage(raw as Buffer);
    });

    ws.on('close', (code, reason) => {
      logger.warn({ code, reason: reason.toString() }, 'ws closed');
      this.clearTimers();
      this.ws = null;
      if (!this.closed) this.scheduleReconnect();
    });

    ws.on('error', (err) => logger.error({ err }, 'ws error'));
  }

  private scheduleHeartbeat(): void {
    this.pingTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.ws.ping();
      this.pongTimer = setTimeout(() => {
        logger.warn('heartbeat timeout — terminating ws');
        this.ws?.terminate();
      }, HEARTBEAT_TIMEOUT_MS - HEARTBEAT_INTERVAL_MS);
    }, HEARTBEAT_INTERVAL_MS);
  }

  private clearTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pingTimer = null;
    this.pongTimer = null;
  }

  private scheduleReconnect(): void {
    const jitter = this.reconnectMs * RECONNECT_BACKOFF.jitterRatio;
    const delay = this.reconnectMs + (Math.random() * 2 - 1) * jitter;
    logger.info({ delayMs: Math.round(delay) }, 'reconnect scheduled');
    setTimeout(() => this.connect(), Math.max(500, delay));
    this.reconnectMs = Math.min(this.reconnectMs * RECONNECT_BACKOFF.multiplier, RECONNECT_BACKOFF.maxMs);
  }

  private async handleMessage(raw: Buffer): Promise<void> {
    let parsed: unknown;
    try {
      parsed = unpack(raw);
    } catch {
      return;
    }

    const env = messageEnvelopeSchema.safeParse(parsed);
    if (!env.success) return;

    if (env.data.type !== 'request') {
      // events e responses do servidor: logar e ignorar (sem RPC pendente saindo do agente no MVP)
      if (env.data.type === 'event' && env.data.name === 'handshake_ack') {
        logger.info({ payload: env.data.payload }, 'handshake ack');
        const ms = (env.data.payload as { syncIntervalMs?: unknown } | undefined)?.syncIntervalMs;
        if (typeof ms === 'number') setSyncInterval(ms); // o servidor dita o ritmo
      }
      return;
    }

    if (this.pendingCount >= MAX_PENDING_RPC) {
      this.send({
        type: 'response',
        requestId: env.data.requestId,
        ok: false,
        error: { code: RPC_ERROR_CODES.TOO_BUSY, message: 'Agente saturado', retryAfterMs: 5_000 },
      });
      return;
    }

    this.pendingCount++;
    const start = Date.now();
    try {
      const result = await handleRpc(env.data.op, env.data.params, {
        uptimeSeconds: this.uptimeSeconds,
        pendingRpc: this.pendingCount,
        protocolVersion: PROTOCOL_VERSION,
      });
      this.send({ type: 'response', requestId: env.data.requestId, ok: true, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'erro desconhecido';
      this.send({
        type: 'response',
        requestId: env.data.requestId,
        ok: false,
        error: { code: RPC_ERROR_CODES.INTERNAL, message },
      });
    } finally {
      this.pendingCount--;
      logger.info({ op: env.data.op, ms: Date.now() - start }, 'rpc handled');
    }
  }

  private send(payload: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(pack(payload));
  }
}
