import pino from 'pino';
import { config } from './config.js';

// Logger pino. Em dev usa pino-pretty; em prod emite JSON estruturado.
// Redact remove campos sensiveis automaticamente.
export const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: [
      'password',
      'passwordHash',
      'token',
      'tokenHash',
      'refreshToken',
      'accessToken',
      'twoFactorSecret',
      'authorization',
      'cookie',
      '*.password',
      '*.token',
    ],
    censor: '***',
  },
  base: { service: 'gmonitor-backend', env: config.NODE_ENV },
  ...(config.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } } }
    : {}),
});
