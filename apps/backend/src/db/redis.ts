import { Redis } from 'ioredis';
import { config } from '../config.js';
import { logger } from '../logger.js';

// Workaround: moduleResolution:NodeNext trata Redis como namespace do modulo em vez da classe.
// Cast explicito para evitar TS2351 sem alterar o comportamento em runtime.
type RedisCtor = new (url: string, opts?: object) => Redis;
export const redis = new (Redis as unknown as RedisCtor)(config.REDIS_URL, {
  maxRetriesPerRequest: null, // BullMQ exige null
});

redis.on('error', (err: Error) => logger.error({ err }, 'redis error'));
redis.on('connect', () => logger.info('redis connected'));
