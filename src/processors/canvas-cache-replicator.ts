import type { Env } from '../types/env';
import { Logger } from '../utils/logger';

interface CanvasCacheRow {
  lookup_key: string;
  lookup_type: string;
  canvas_id: string;
  merchant_uuid: string | null;
}

const DEFAULT_KV_TTL = 24 * 60 * 60; // 24 hours

export async function replicateCanvasCacheToKV(env: Env, logger: Logger): Promise<void> {
  logger.info('Replicating Canvas cache from D1 to KV');

  try {
    const query = await env.DB.prepare(
      'SELECT lookup_key, lookup_type, canvas_id, merchant_uuid FROM canvas_cache'
    ).all<CanvasCacheRow>();

    const rows = (query?.results as CanvasCacheRow[]) || [];

    if (rows.length === 0) {
      logger.info('No Canvas cache rows to replicate');
      return;
    }

    let replicated = 0;
    for (const row of rows) {
      if (!row.lookup_key || !row.lookup_type || !row.canvas_id) {
        continue;
      }

      const kvKey = `canvas:${row.lookup_type}:${row.lookup_key}`;
      const payload = {
        canvasId: row.canvas_id,
        merchantUuid: row.merchant_uuid ?? null,
        cachedAt: new Date().toISOString(),
      };

      await env.CACHE.put(kvKey, JSON.stringify(payload), {
        expirationTtl: DEFAULT_KV_TTL,
      });
      replicated++;
    }

    logger.info('Canvas cache replication completed', {
      replicated,
      total: rows.length,
    });
  } catch (error) {
    logger.error('Failed to replicate Canvas cache to KV', error);
  }
import {
  CANVAS_CACHE_KV_TTL_SECONDS,
  type CanvasLookupType,
  writeCanvasMappingToKV,
} from '../utils/canvas-cache';

interface CanvasCacheRow {
  lookup_key: string;
  lookup_type: CanvasLookupType;
  canvas_id: string;
  canvas_name?: string | null;
  source?: string | null;
  version?: number | null;
  last_verified_at?: number | null;
  kv_version?: number | null;
  kv_written_at?: number | null;
  kv_ttl?: number | null;
  kv_expires_at?: number | null;
}

export interface CanvasCacheReplicationStats {
  written: number;
  skipped: number;
}

/**
 * Replicate authoritative Canvas mappings from D1 into the global CACHE KV namespace.
 */
export async function replicateCanvasCacheToKV(env: Env, logger: Logger): Promise<CanvasCacheReplicationStats> {
  const now = Date.now();
  const stats: CanvasCacheReplicationStats = { written: 0, skipped: 0 };

  const query = await env.DB.prepare(
    `SELECT lookup_key,
            lookup_type,
            canvas_id,
            canvas_name,
            source,
            version,
            last_verified_at,
            kv_version,
            kv_written_at,
            kv_ttl,
            kv_expires_at
       FROM canvas_cache
      WHERE canvas_id IS NOT NULL
        AND invalidated_at IS NULL
        AND (
          kv_version IS NULL
          OR kv_version < version
          OR kv_written_at IS NULL
          OR kv_expires_at IS NULL
          OR kv_expires_at < ?
        )
      ORDER BY last_verified_at DESC
      LIMIT 200`
  ).bind(now).all<CanvasCacheRow>();

  const rows = query.results || [];

  if (rows.length === 0) {
    logger.debug('No Canvas cache rows require KV replication');
    return stats;
  }

  for (const row of rows) {
    if (!row.lookup_key || !row.canvas_id) {
      stats.skipped += 1;
      continue;
    }

    const type = row.lookup_type || 'phone';
    const version = row.version && row.version > 0 ? row.version : 1;
    const lastVerified = row.last_verified_at || now;

    try {
      await writeCanvasMappingToKV(env.CACHE, type, row.lookup_key, {
        canvasId: row.canvas_id,
        version,
        source: row.source || 'notion',
        cachedAt: lastVerified,
        lastVerifiedAt: lastVerified,
      }, CANVAS_CACHE_KV_TTL_SECONDS);

      const expiration = now + CANVAS_CACHE_KV_TTL_SECONDS * 1000;

      await env.DB.prepare(
        `UPDATE canvas_cache
            SET kv_version = ?,
                kv_written_at = ?,
                kv_ttl = ?,
                kv_expires_at = ?
          WHERE lookup_key = ?`
      )
        .bind(version, now, CANVAS_CACHE_KV_TTL_SECONDS, expiration, row.lookup_key)
        .run();

      stats.written += 1;
    } catch (error) {
      stats.skipped += 1;
      logger.error('Failed to replicate Canvas cache entry to KV', {
        lookup: row.lookup_key,
        type,
        error: String(error),
      });
    }
  }

  logger.info('Canvas cache replication completed', stats);
  return stats;
}
