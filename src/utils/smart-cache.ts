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
        canvasId: cacheApiResult,
        durationMs: Date.now() - startTime,
      });
      return cacheApiResult;
    }

    // Tier 2: KV (region-level)
    const kvResult = await checkKV(lookup, type, env);
    if (kvResult) {
      logger.info('Canvas found in KV (region)', {
        lookup,
        type,
        canvasId: kvResult,
        durationMs: Date.now() - startTime,
      });

      // Promote to Cache API for faster future access
      await promoteToCacheAPI(lookup, type, kvResult);

      return kvResult;
    }

    // Tier 3: Query Notion (slowest)
    const notionClient = new NotionClient(env, logger);
    const canvasId = await queryNotion(lookup, type, notionClient);

    if (canvasId) {
      logger.info('Canvas found via Notion query', {
        lookup,
        type,
        canvasId,
        durationMs: Date.now() - startTime,
      });

      // Store in both caches for future requests
      await Promise.all([
        storeInKV(lookup, type, canvasId, env),
        promoteToCacheAPI(lookup, type, canvasId),
      ]);
    } else {
      logger.info('Canvas not found', {
        lookup,
        type,
        durationMs: Date.now() - startTime,
      });
    }

    return canvasId;
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
  mappings: Array<{ lookup: string; type: 'phone' | 'email'; canvasId: string }>,
  env: Env,
  logger: Logger
): Promise<void> {
  logger.info('Warming up cache', { count: mappings.length });

  const promises = mappings.map(async (mapping) => {
    try {
      await Promise.all([
        storeInKV(mapping.lookup, mapping.type, mapping.canvasId, env),
        promoteToCacheAPI(mapping.lookup, mapping.type, mapping.canvasId),
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
async function checkCacheAPI(lookup: string, type: 'phone' | 'email'): Promise<string | null> {
  try {
    const cache = caches.default;
    const cacheKey = buildCacheKey(lookup, type);
    const cacheRequest = new Request(`https://cache/${cacheKey}`);

    const response = await cache.match(cacheRequest);
    if (response) {
      return await response.text();
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
async function checkKV(lookup: string, type: 'phone' | 'email', env: Env): Promise<string | null> {
  try {
    const kvKey = buildKVKey(lookup, type);
    return await env.CACHE.get(kvKey);
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
): Promise<string | null> {
  if (type === 'phone') {
    return await notionClient.findCanvasByPhone(lookup);
  } else {
    return await notionClient.findCanvasByEmail(lookup);
  }
}

/**
 * Promote to Cache API
 */
async function promoteToCacheAPI(lookup: string, type: 'phone' | 'email', canvasId: string): Promise<void> {
  try {
    const cache = caches.default;
    const cacheKey = buildCacheKey(lookup, type);
    const cacheRequest = new Request(`https://cache/${cacheKey}`);

    await cache.put(
      cacheRequest,
      new Response(canvasId, {
        headers: {
          'Cache-Control': `max-age=${CACHE_API_TTL}`,
          'Content-Type': 'text/plain',
          'X-Cache-Version': CACHE_VERSION,
        },
      })
    );
  } catch (error) {
    // Non-critical error, log but don't throw
    console.error('Error promoting to Cache API:', error);
  }
}

/**
 * Store in KV
 */
async function storeInKV(lookup: string, type: 'phone' | 'email', canvasId: string, env: Env): Promise<void> {
  try {
    const kvKey = buildKVKey(lookup, type);
    await env.CACHE.put(kvKey, canvasId, {
      expirationTtl: KV_TTL,
    });
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
