import { OpenPhoneClient } from '../../utils/openphone-client';
import { NotionClient } from '../../utils/notion-client';
import { R2Client } from '../../utils/r2-client';
import { RateLimiter } from '../../utils/rate-limiter';
import type { Env } from '../../types/env';
import type { Logger } from '../../utils/logger';
import {
  buildCanvasKVKey,
  normalizeCanvasLookup,
  invalidateCanvasMapping,
  type CanvasLookupType,
  type CanvasCacheKVValue,
} from '../../utils/canvas-cache';

const CACHE_API_TTL_SECONDS = 5 * 60; // 5 minutes

export type CanvasLookupSource = 'cache-api' | 'kv' | 'notion' | 'miss';

export interface CanvasLookupResult {
  canvasId: string | null;
  source: CanvasLookupSource;
  normalizedLookup: string | null;
}

export type CanvasLookupFn = (
  lookup: string,
  type: CanvasLookupType
) => Promise<CanvasLookupResult>;

export interface NotionResources {
  client: NotionClient;
  getCachedCanvas: CanvasLookupFn;
}

export interface OpenPhoneResources {
  client: OpenPhoneClient;
  rateLimiter: RateLimiter;
}

export function createOpenPhoneResources(env: Env, logger: Logger): OpenPhoneResources {
  const rateLimiter = new RateLimiter(env.RATE_LIMITS, logger);
  const client = new OpenPhoneClient(env, logger, rateLimiter);
  return { client, rateLimiter };
}

export function createNotionResources(env: Env, logger: Logger): NotionResources {
  const notionClient = new NotionClient(env, logger);

  async function putCacheApi(
    normalizedLookup: string,
    type: CanvasLookupType,
    value: CanvasCacheKVValue
  ): Promise<void> {
    if (typeof caches === 'undefined') {
      return;
    }
    const cacheKey = buildCacheApiUrl(type, normalizedLookup);
    const cacheRequest = new Request(cacheKey);

    try {
      const response = new Response(JSON.stringify(value), {
        headers: {
          'Cache-Control': `max-age=${CACHE_API_TTL_SECONDS}`,
          'Content-Type': 'application/json',
        },
      });

      await caches.default.put(cacheRequest, response);
      logger.debug('Canvas cache promoted to Cache API', {
        lookup: normalizedLookup,
        type,
      });
    } catch (error) {
      logger.warn('Failed to write Canvas cache to Cache API', {
        lookup: normalizedLookup,
        type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function getCachedCanvas(lookup: string, type: CanvasLookupType): Promise<CanvasLookupResult> {
    const normalizedLookup = normalizeCanvasLookup(type, lookup);
    const startTime = Date.now();

    if (!normalizedLookup) {
      logger.warn('Skipping Canvas cache lookup - normalized value empty', {
        lookup,
        type,
      });

      return { canvasId: null, source: 'miss', normalizedLookup: null };
    }

    const cacheApiUrl = buildCacheApiUrl(type, normalizedLookup);
    const cacheRequest = new Request(cacheApiUrl);

    if (typeof caches !== 'undefined') {
      try {
        const cacheResponse = await caches.default.match(cacheRequest);
        if (cacheResponse) {
          const parsed = (await cacheResponse.json()) as CanvasCacheKVValue;
          if (parsed?.canvasId) {
            logger.info('Canvas cache hit (Cache API)', {
              lookup: normalizedLookup,
              type,
              canvasId: parsed.canvasId,
              durationMs: Date.now() - startTime,
            });

            return {
              canvasId: parsed.canvasId,
              source: 'cache-api',
              normalizedLookup,
            };
          }
        }
      } catch (error) {
        logger.warn('Cache API lookup failed', {
          lookup: normalizedLookup,
          type,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const kvKey = buildCanvasKVKey(type, normalizedLookup);
    try {
      const kvValue = await env.CACHE.get(kvKey);
      if (kvValue) {
        const parsed = JSON.parse(kvValue) as CanvasCacheKVValue;
        if (parsed?.canvasId) {
          logger.info('Canvas cache hit (KV)', {
            lookup: normalizedLookup,
            type,
            canvasId: parsed.canvasId,
            durationMs: Date.now() - startTime,
          });

          await putCacheApi(normalizedLookup, type, parsed);

          return {
            canvasId: parsed.canvasId,
            source: 'kv',
            normalizedLookup,
          };
        }
      }
    } catch (error) {
      logger.error('Failed to read Canvas cache from KV', {
        lookup: normalizedLookup,
        type,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    logger.info('Canvas cache miss - querying Notion', {
      lookup: normalizedLookup,
      type,
    });

    const canvasId =
      type === 'phone'
        ? await notionClient.findCanvasByPhone(lookup)
        : await notionClient.findCanvasByEmail(lookup);

    const durationMs = Date.now() - startTime;

    if (canvasId) {
      logger.info('Canvas resolved via Notion fallback', {
        lookup: normalizedLookup,
        type,
        canvasId,
        durationMs,
      });

      const cacheValue: CanvasCacheKVValue = {
        canvasId,
        version: 1,
        source: 'notion',
        cachedAt: Date.now(),
        lastVerifiedAt: Date.now(),
      };

      await putCacheApi(normalizedLookup, type, cacheValue);

      await invalidateCanvasMapping(env, logger, type, lookup, 'notion-lookup-refresh');

      return {
        canvasId,
        source: 'notion',
        normalizedLookup,
      };
    }

    logger.info('Canvas not found in Notion lookup', {
      lookup: normalizedLookup,
      type,
      durationMs,
    });

    await invalidateCanvasMapping(env, logger, type, lookup, 'notion-lookup-miss');

    return {
      canvasId: null,
      source: 'miss',
      normalizedLookup,
    };
  }

  return {
    client: notionClient,
    getCachedCanvas,
  };
}

export function createR2Client(env: Env, logger: Logger): R2Client {
  return new R2Client(env.RECORDINGS_BUCKET, logger);
}

export function createNotionClient(env: Env, logger: Logger): NotionClient {
  return createNotionResources(env, logger).client;
}

function buildCacheApiUrl(type: CanvasLookupType, normalizedLookup: string): string {
  return `https://canvas-cache/${type}/${encodeURIComponent(normalizedLookup)}`;
}
