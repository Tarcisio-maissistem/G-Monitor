import Redis from 'ioredis';
import { config } from '../config.js';
import { logger } from '../logger.js';

// Cliente Redis compartilhado. Cache + pub/sub + filas BullMQ usam instancias dedicadas.
export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null, // BullMQ exige null
});

redis.on('error', (err: Error) => logger.error({ err }, 'redis error'));
redis.on('connect', () => logger.info('redis connected'));
