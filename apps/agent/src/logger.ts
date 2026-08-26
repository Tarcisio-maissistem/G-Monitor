import pino from 'pino';
import path from 'node:path';
import fs from 'node:fs';
import { getDataDir } from './config.js';

const logsDir = path.join(getDataDir(), 'logs');
fs.mkdirSync(logsDir, { recursive: true });

// SEM pino.transport (worker thread): dentro do .exe empacotado (pkg) o worker do thread-stream
// (lib/worker.js) nao existe no snapshot e o agente morria com MODULE_NOT_FOUND ao subir —
// visto ao vivo no PC do dono 26/08. multistream + destination sincrono escrevem no mesmo
// processo: arquivo agent.log + stdout (o NSSM redireciona stdout pro service.log).
const streams: pino.StreamEntry[] = [
  { level: 'info', stream: pino.destination({ dest: path.join(logsDir, 'agent.log'), sync: false, mkdir: true }) },
  { level: 'info', stream: pino.destination({ dest: 1, sync: false }) },
];

export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? 'info',
    redact: {
      paths: ['password', 'token', 'tokenHash', 'firebird.password', '*.password', '*.token'],
      censor: '***',
    },
    base: { service: 'gmonitor-agent' },
  },
  pino.multistream(streams),
);
