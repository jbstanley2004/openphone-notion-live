import { OpenPhoneClient } from '../../utils/openphone-client';
import { NotionClient } from '../../utils/notion-client';
import { R2Client } from '../../utils/r2-client';
import { RateLimiter } from '../../utils/rate-limiter';
import type { Env } from '../../types/env';
import type { Logger } from '../../utils/logger';

export interface OpenPhoneResources {
  client: OpenPhoneClient;
  rateLimiter: RateLimiter;
}

export function createOpenPhoneResources(env: Env, logger: Logger): OpenPhoneResources {
  const rateLimiter = new RateLimiter(env.RATE_LIMITS, logger);
  const client = new OpenPhoneClient(env, logger, rateLimiter);
  return { client, rateLimiter };
}

export function createNotionClient(env: Env, logger: Logger): NotionClient {
  return new NotionClient(env, logger);
}

export function createR2Client(env: Env, logger: Logger): R2Client {
  return new R2Client(env.RECORDINGS_BUCKET, logger);
}
