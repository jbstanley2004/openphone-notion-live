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
}
