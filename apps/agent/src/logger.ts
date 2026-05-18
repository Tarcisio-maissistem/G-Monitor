import pino from 'pino';
import path from 'node:path';
import fs from 'node:fs';
import { getDataDir } from './config.js';

const logsDir = path.join(getDataDir(), 'logs');
fs.mkdirSync(logsDir, { recursive: true });

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: ['password', 'token', 'tokenHash', 'firebird.password', '*.password', '*.token'],
    censor: '***',
  },
  base: { service: 'gmonitor-agent' },
  transport: {
    targets: [
      { target: 'pino/file', options: { destination: path.join(logsDir, 'agent.log') }, level: 'info' },
      ...(process.stdout.isTTY
        ? [{ target: 'pino-pretty', options: { colorize: true }, level: 'info' }]
        : []),
    ],
  },
});
