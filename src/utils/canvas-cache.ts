import type { KVNamespace } from '@cloudflare/workers-types';
import type { Env } from '../types/env';
import type { Logger } from './logger';

export type CanvasLookupType = 'phone' | 'email';

export interface CanvasCacheKVValue {
  canvasId: string;
  version: number;
  source: string;
  cachedAt: number;
  lastVerifiedAt: number;
}

export const CANVAS_CACHE_KV_PREFIX = 'canvas';
export const CANVAS_CACHE_KV_TTL_SECONDS = 6 * 60 * 60; // 6 hours

/**
 * Normalize lookup identifiers to ensure consistent storage.
 */
export function normalizeCanvasLookup(type: CanvasLookupType, lookup: string): string {
  const trimmed = (lookup || '').trim();
  if (!trimmed) {
    return '';
  }

  if (type === 'email') {
    return trimmed.toLowerCase();
  }

  // Phone numbers: keep E.164 if present, otherwise strip formatting but preserve leading +
  const normalized = trimmed.replace(/[^\d+]/g, '');
  if (!normalized) {
    return '';
  }

  if (normalized.startsWith('+')) {
    return normalized;
  }

  // If it looks like a North American number without +, prefix +
  if (normalized.length === 11 && normalized.startsWith('1')) {
    return `+${normalized}`;
  }

  if (normalized.length === 10) {
    return `+1${normalized}`;
  }

  return normalized;
}

export function buildCanvasCacheKey(type: CanvasLookupType, normalizedLookup: string): string {
  return `${type}:${normalizedLookup}`;
}

export function buildCanvasKVKey(type: CanvasLookupType, normalizedLookup: string): string {
  return `${CANVAS_CACHE_KV_PREFIX}:${type}:${normalizedLookup}`;
}

export async function writeCanvasMappingToKV(
  kv: KVNamespace,
  type: CanvasLookupType,
  normalizedLookup: string,
  value: CanvasCacheKVValue,
  ttlSeconds: number = CANVAS_CACHE_KV_TTL_SECONDS
): Promise<void> {
  const key = buildCanvasKVKey(type, normalizedLookup);
  await kv.put(key, JSON.stringify(value), {
    expirationTtl: ttlSeconds,
  });
}

export async function deleteCanvasMappingFromKV(
  kv: KVNamespace,
  type: CanvasLookupType,
  normalizedLookup: string
): Promise<void> {
  const key = buildCanvasKVKey(type, normalizedLookup);
  await kv.delete(key);
}

/**
 * Invalidate a Canvas cache mapping.
 * Marks the D1 row as invalidated and removes the KV entry so the next lookup refreshes it.
 */
export async function invalidateCanvasMapping(
  env: Env,
  logger: Logger,
  type: CanvasLookupType,
  lookup: string,
  reason?: string
): Promise<void> {
  const normalizedLookup = normalizeCanvasLookup(type, lookup);
  if (!normalizedLookup) {
    logger.warn('Unable to invalidate Canvas mapping - lookup normalized to empty', { lookup, type, reason });
    return;
  }

  const now = Date.now();
  await deleteCanvasMappingFromKV(env.CACHE, type, normalizedLookup);

  try {
    await env.DB.prepare(
      `UPDATE canvas_cache
         SET invalidated_at = ?,
             kv_version = 0,
             kv_written_at = NULL,
             kv_ttl = NULL,
             kv_expires_at = NULL
       WHERE lookup_key = ?`
    ).bind(now, normalizedLookup).run();

    logger.info('Canvas mapping invalidated', {
      lookup: normalizedLookup,
      type,
      reason: reason || 'unspecified',
    });
  } catch (error) {
    logger.error('Failed to mark Canvas mapping invalidated in D1', {
      lookup: normalizedLookup,
      type,
      error: String(error),
    });
  }
}
