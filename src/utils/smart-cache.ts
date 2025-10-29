/**
 * Smart Caching with Multi-Tier Strategy
 *
 * Implements a 3-tier caching architecture:
 * 1. Cache API (edge-level, sub-millisecond)
 * 2. KV (region-level, ~1-5ms)
 * 3. Notion API (slowest, 1-2 seconds)
 *
 * Benefits:
 * - 5-10x faster Canvas lookups
 * - Reduced KV reads (lower costs)
 * - Automatic cache promotion
 */

import type { Env } from '../types/env';
import type { Logger } from './logger';
import { NotionClient } from './notion-client';

const CACHE_VERSION = 'v1';
const CACHE_API_TTL = 3600; // 1 hour in seconds
const KV_TTL = 86400; // 24 hours in seconds

interface CachedCanvasData {
  canvasId: string;
  merchantUuid: string | null;
}

/**
 * Get Canvas ID with smart multi-tier caching
 */
export async function getCachedCanvas(
  lookup: string,
  type: 'phone' | 'email',
  env: Env,
  logger: Logger
): Promise<string | null> {
  const startTime = Date.now();

  try {
    // Tier 1: Cache API (edge-level, fastest)
    const cacheApiResult = await checkCacheAPI(lookup, type);
    if (cacheApiResult) {
      logger.info('Canvas found in Cache API (edge)', {
        lookup,
        type,
        canvasId: cacheApiResult.canvasId,
        durationMs: Date.now() - startTime,
      });
      return cacheApiResult.canvasId;
    }

    // Tier 2: KV (region-level)
    const kvResult = await checkKV(lookup, type, env);
    if (kvResult) {
      logger.info('Canvas found in KV (region)', {
        lookup,
        type,
        canvasId: kvResult.canvasId,
        durationMs: Date.now() - startTime,
      });

      // Promote to Cache API for faster future access
      await promoteToCacheAPI(lookup, type, kvResult);

      return kvResult.canvasId;
    }

    // Tier 3: Query Notion (slowest)
    const notionClient = new NotionClient(env, logger);
    const canvasResult = await queryNotion(lookup, type, notionClient);

    if (canvasResult) {
      logger.info('Canvas found via Notion query', {
        lookup,
        type,
        canvasId: canvasResult.canvasId,
        durationMs: Date.now() - startTime,
      });

      // Store in both caches for future requests
      await Promise.all([
        storeInKV(lookup, type, canvasResult, env),
        promoteToCacheAPI(lookup, type, canvasResult),
      ]);
    } else {
      logger.info('Canvas not found', {
        lookup,
        type,
        durationMs: Date.now() - startTime,
      });
    }

    return canvasResult?.canvasId ?? null;
  } catch (error) {
    logger.error('Error in smart cache lookup', {
      lookup,
      type,
      error: String(error),
    });
    return null;
  }
}

/**
 * Invalidate cache for a specific lookup
 * Use this when Canvas relationships are updated
 */
export async function invalidateCache(
  lookup: string,
  type: 'phone' | 'email',
  env: Env,
  logger: Logger
): Promise<void> {
  try {
    const cacheKey = buildCacheKey(lookup, type);
    const kvKey = buildKVKey(lookup, type);

    // Clear from Cache API
    const cache = caches.default;
    const cacheRequest = new Request(`https://cache/${cacheKey}`);
    await cache.delete(cacheRequest);

    // Clear from KV
    await env.CACHE.delete(kvKey);

    logger.info('Cache invalidated', { lookup, type });
  } catch (error) {
    logger.error('Error invalidating cache', { lookup, type, error: String(error) });
  }
}

/**
 * Warm up cache with known Canvas mappings
 * Useful for bulk operations or initial setup
 */
export async function warmUpCache(
  mappings: Array<{
    lookup: string;
    type: 'phone' | 'email';
    canvasId: string;
    merchantUuid?: string | null;
  }>,
  env: Env,
  logger: Logger
): Promise<void> {
  logger.info('Warming up cache', { count: mappings.length });

  const promises = mappings.map(async (mapping) => {
    try {
      const data: CachedCanvasData = {
        canvasId: mapping.canvasId,
        merchantUuid: mapping.merchantUuid ?? null,
      };
      await Promise.all([
        storeInKV(mapping.lookup, mapping.type, data, env),
        promoteToCacheAPI(mapping.lookup, mapping.type, data),
      ]);
    } catch (error) {
      logger.error('Error warming up cache entry', {
        lookup: mapping.lookup,
        error: String(error),
      });
    }
  });

  await Promise.allSettled(promises);

  logger.info('Cache warm-up completed', { count: mappings.length });
}

/**
 * Get cache statistics
 */
export async function getCacheStats(env: Env, logger: Logger): Promise<{
  kvEntries: number;
  estimatedHitRate: number;
}> {
  // Note: Cache API doesn't provide enumeration
  // This is a simplified implementation

  try {
    // Get KV entries count (requires listing)
    const kvList = await env.CACHE.list({ prefix: 'canvas:' });
    const kvEntries = kvList.keys.length;

    // Hit rate would need to be tracked separately in D1 or Analytics Engine
    // For now, return placeholder
    return {
      kvEntries,
      estimatedHitRate: 0,
    };
  } catch (error) {
    logger.error('Error getting cache stats', { error: String(error) });
    return {
      kvEntries: 0,
      estimatedHitRate: 0,
    };
  }
}

// ========================================================================
// Private Helper Functions
// ========================================================================

/**
 * Check Cache API (Tier 1)
 */
async function checkCacheAPI(lookup: string, type: 'phone' | 'email'): Promise<CachedCanvasData | null> {
  try {
    const cache = caches.default;
    const cacheKey = buildCacheKey(lookup, type);
    const cacheRequest = new Request(`https://cache/${cacheKey}`);

    const response = await cache.match(cacheRequest);
    if (response) {
      const text = await response.text();
      return parseCachedCanvas(text);
    }

    return null;
  } catch (error) {
    // Cache API errors shouldn't break the flow
    return null;
  }
}

/**
 * Check KV (Tier 2)
 */
async function checkKV(lookup: string, type: 'phone' | 'email', env: Env): Promise<CachedCanvasData | null> {
  try {
    const kvKey = buildKVKey(lookup, type);
    const value = await env.CACHE.get(kvKey);
    return parseCachedCanvas(value);
  } catch (error) {
    return null;
  }
}

/**
 * Query Notion (Tier 3)
 */
async function queryNotion(
  lookup: string,
  type: 'phone' | 'email',
  notionClient: NotionClient
): Promise<CachedCanvasData | null> {
  const canvasId = type === 'phone'
    ? await notionClient.findCanvasByPhone(lookup)
    : await notionClient.findCanvasByEmail(lookup);

  if (!canvasId) {
    return null;
  }

  const merchantInfo = await notionClient.getCanvasMerchantInfo(canvasId);
  return {
    canvasId,
    merchantUuid: merchantInfo.uuid ?? null,
  };
}

/**
 * Promote to Cache API
 */
async function promoteToCacheAPI(
  lookup: string,
  type: 'phone' | 'email',
  data: CachedCanvasData
): Promise<void> {
  try {
    const cache = caches.default;
    const cacheKey = buildCacheKey(lookup, type);
    const cacheRequest = new Request(`https://cache/${cacheKey}`);

    await cache.put(
      cacheRequest,
      new Response(
        JSON.stringify({
          canvasId: data.canvasId,
          merchantUuid: data.merchantUuid,
          cachedAt: new Date().toISOString(),
        }),
        {
          headers: {
            'Cache-Control': `max-age=${CACHE_API_TTL}`,
            'Content-Type': 'text/plain',
            'X-Cache-Version': CACHE_VERSION,
          },
        }
      )
    );
  } catch (error) {
    // Non-critical error, log but don't throw
    console.error('Error promoting to Cache API:', error);
  }
}

/**
 * Store in KV
 */
async function storeInKV(
  lookup: string,
  type: 'phone' | 'email',
  data: CachedCanvasData,
  env: Env
): Promise<void> {
  try {
    const kvKey = buildKVKey(lookup, type);
    await env.CACHE.put(
      kvKey,
      JSON.stringify({
        canvasId: data.canvasId,
        merchantUuid: data.merchantUuid,
        cachedAt: new Date().toISOString(),
      }),
      {
        expirationTtl: KV_TTL,
      }
    );
  } catch (error) {
    // Non-critical error
    console.error('Error storing in KV:', error);
  }
}

/**
 * Build cache key for Cache API
 */
function buildCacheKey(lookup: string, type: 'phone' | 'email'): string {
  // Normalize phone numbers and emails
  const normalized = normalizeIdentifier(lookup, type);
  return `${CACHE_VERSION}/canvas/${type}/${normalized}`;
}

function parseCachedCanvas(value: string | null): CachedCanvasData | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && parsed.canvasId) {
      return {
        canvasId: String(parsed.canvasId),
        merchantUuid:
          typeof parsed.merchantUuid === 'string' ? parsed.merchantUuid : parsed.merchantUuid ?? null,
      };
    }
  } catch (error) {
    // Fall back to legacy string format
  }

  return {
    canvasId: value,
    merchantUuid: null,
  };
}

/**
 * Build key for KV
 */
function buildKVKey(lookup: string, type: 'phone' | 'email'): string {
  const normalized = normalizeIdentifier(lookup, type);
  return `canvas:${type}:${normalized}`;
}

/**
 * Normalize identifiers for consistent caching
 */
function normalizeIdentifier(identifier: string, type: 'phone' | 'email'): string {
  if (type === 'phone') {
    // Remove all non-digits
    return identifier.replace(/\D/g, '');
  } else {
    // Lowercase email
    return identifier.toLowerCase().trim();
  }
}
