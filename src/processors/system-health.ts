import type { Env } from '../types/env';
import { Logger } from '../utils/logger';
import { createNotionClient } from '../workflows/modules/resources';

export type HealthStatus = 'ok' | 'warning' | 'critical';

export interface HealthCheckResult {
  name: string;
  status: HealthStatus;
  message: string;
  data?: Record<string, unknown>;
}

export interface PerformanceSnapshot {
  recordedAt: number;
  vectorize: {
    recentInteractions: number;
    missingVectors: number;
  } | null;
  kv: {
    totalKeys: number;
    expiredKeys: number;
    canvasCacheTotal: number;
    canvasCacheStale: number;
  };
  queue: {
    processedLastHour: number;
    processedLastDay: number;
    failuresLastDay: number;
  };
}

interface AlertPayload {
  severity: 'warning' | 'critical';
  summary: string;
  checks: HealthCheckResult[];
  performance: PerformanceSnapshot | null;
}

export interface SystemHealthSummary {
  checks: HealthCheckResult[];
  performance: PerformanceSnapshot | null;
}

export async function runSystemHealthChecks(env: Env, logger: Logger): Promise<SystemHealthSummary> {
  const checkLogger = logger.withContext({ task: 'system-health-checks' });
  const checks: HealthCheckResult[] = [];

  checks.push(await checkMerchantUuidCoverage(env, checkLogger));
  checks.push(await checkCanvasCacheFreshness(env, checkLogger));
  checks.push(await checkD1NotionConsistency(env, checkLogger));

  const performance = await collectPerformanceSnapshot(env, checkLogger);

  await persistSnapshot(env, checkLogger, checks, performance);

  const degraded = checks.filter((check) => check.status !== 'ok');

  if (degraded.length > 0) {
    await sendMonitoringAlert(env, checkLogger, {
      severity: degraded.some((check) => check.status === 'critical') ? 'critical' : 'warning',
      summary: degraded.map((check) => `• ${check.name}: ${check.message}`).join('\n'),
      checks: degraded,
      performance,
    });
  }

  checkLogger.info('System health checks completed', {
    degradedChecks: degraded.length,
    totalChecks: checks.length,
  });

  return { checks, performance };
}

async function checkMerchantUuidCoverage(env: Env, logger: Logger): Promise<HealthCheckResult> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) as total, SUM(CASE WHEN merchant_uuid IS NULL OR TRIM(merchant_uuid) = '' THEN 1 ELSE 0 END) as missing
       FROM merchants`
  ).first<{ total: number | null; missing: number | null }>();

  const total = row?.total ?? 0;
  const missing = row?.missing ?? 0;
  const percentage = total > 0 ? (missing / total) * 100 : 0;

  let status: HealthStatus = 'ok';
  let message = 'All merchants have a Merchant UUID';

  if (missing > 0) {
    status = percentage >= 10 ? 'critical' : 'warning';
    message = `${missing} merchants missing Merchant UUID (${percentage.toFixed(1)}%)`;
  }

  logger.info('Merchant UUID coverage evaluated', { total, missing, percentage });

  return {
    name: 'merchant-uuid-coverage',
    status,
    message,
    data: { total, missing, percentage },
  };
}

async function checkCanvasCacheFreshness(env: Env, logger: Logger): Promise<HealthCheckResult> {
  const now = Date.now();
  const d1Stats = await env.DB.prepare(
    `SELECT COUNT(*) as total,
            SUM(CASE WHEN kv_expires_at IS NULL OR kv_expires_at < ? THEN 1 ELSE 0 END) as stale
       FROM canvas_cache
      WHERE invalidated_at IS NULL`
  )
    .bind(now)
    .first<{ total: number | null; stale: number | null }>();

  let totalKeys = 0;
  let expiredKeys = 0;
  let cursor: string | undefined;

  do {
    const result = await env.CACHE.list({ prefix: 'canvas:', cursor });
    totalKeys += result.keys.length;
    for (const key of result.keys) {
      if (typeof key.expiration === 'number' && key.expiration * 1000 < now) {
        expiredKeys += 1;
      }
    }
    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);

  const canvasTotal = d1Stats?.total ?? 0;
  const canvasStale = d1Stats?.stale ?? 0;
  const staleRatio = canvasTotal > 0 ? canvasStale / canvasTotal : 0;
  const kvExpirationRatio = totalKeys > 0 ? expiredKeys / totalKeys : 0;

  let status: HealthStatus = 'ok';
  let message = 'Canvas cache is healthy';

  if (staleRatio > 0.1 || kvExpirationRatio > 0.1) {
    status = staleRatio > 0.25 || kvExpirationRatio > 0.25 ? 'critical' : 'warning';
    message = 'Canvas cache has stale or expired entries beyond threshold';
  }

  logger.info('Canvas cache freshness evaluated', {
    canvasTotal,
    canvasStale,
    totalKeys,
    expiredKeys,
    staleRatio,
    kvExpirationRatio,
  });

  return {
    name: 'canvas-cache-freshness',
    status,
    message,
    data: {
      canvasTotal,
      canvasStale,
      totalKeys,
      expiredKeys,
      staleRatio,
      kvExpirationRatio,
    },
  };
}

async function checkD1NotionConsistency(env: Env, logger: Logger): Promise<HealthCheckResult> {
  try {
    const notionClient = createNotionClient(env, logger);
    const response = await notionClient.queryDatabase(notionClient.getCanvasDatabaseId(), {
      pageSize: 25,
      sorts: [
        {
          timestamp: 'last_edited_time',
          direction: 'descending',
        },
      ],
    });

    const pages: Array<{ id: string; last_edited_time?: string }> = response?.results ?? [];
    if (pages.length === 0) {
      return {
        name: 'd1-notion-drift',
        status: 'ok',
        message: 'No Canvas pages returned during drift check',
        data: { scannedPages: 0 },
      };
    }

    const ids = pages.map((page) => page.id.replace(/-/g, ''));
    const placeholders = ids.map(() => '?').join(', ');

    const d1Rows = await env.DB.prepare(
      `SELECT canvas_id, last_synced_at, updated_at
         FROM merchants
        WHERE REPLACE(canvas_id, '-', '') IN (${placeholders})`
    )
      .bind(...ids)
      .all<{ canvas_id: string; last_synced_at: number | null; updated_at: number | null }>();

    const d1Map = new Map<string, { last_synced_at: number | null; updated_at: number | null }>();
    for (const row of d1Rows.results ?? []) {
      d1Map.set(row.canvas_id.replace(/-/g, ''), {
        last_synced_at: row.last_synced_at,
        updated_at: row.updated_at,
      });
    }

    const toleranceMs = 15 * 60 * 1000; // 15 minutes
    let outOfSync = 0;
    const driftSamples: Array<Record<string, unknown>> = [];

    for (const page of pages) {
      const compactId = page.id.replace(/-/g, '');
      const notionEdited = page.last_edited_time ? new Date(page.last_edited_time).getTime() : null;
      const d1Data = d1Map.get(compactId);

      if (!d1Data) {
        outOfSync += 1;
        driftSamples.push({ canvasId: page.id, reason: 'missing-from-d1' });
        continue;
      }

      if (notionEdited && d1Data.last_synced_at && d1Data.last_synced_at + toleranceMs < notionEdited) {
        outOfSync += 1;
        driftSamples.push({
          canvasId: page.id,
          notionEdited,
          lastSyncedAt: d1Data.last_synced_at,
        });
      }
    }

    let status: HealthStatus = 'ok';
    let message = 'D1 is in sync with recent Notion changes';

    if (outOfSync > 0) {
      const ratio = outOfSync / pages.length;
      status = ratio >= 0.3 ? 'critical' : 'warning';
      message = `${outOfSync} Canvas records appear out of sync with Notion`;
    }

    logger.info('D1 vs Notion drift evaluated', {
      scanned: pages.length,
      outOfSync,
    });

    return {
      name: 'd1-notion-drift',
      status,
      message,
      data: {
        scannedPages: pages.length,
        outOfSync,
        samples: driftSamples.slice(0, 5),
      },
    };
  } catch (error) {
    logger.error('Failed to run D1 vs Notion drift check', error);
    return {
      name: 'd1-notion-drift',
      status: 'warning',
      message: 'Unable to verify D1 vs Notion consistency',
      data: {
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

async function collectPerformanceSnapshot(env: Env, logger: Logger): Promise<PerformanceSnapshot | null> {
  try {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    const lastHour = await env.DB.prepare(
      `SELECT COUNT(*) as count
         FROM interactions
        WHERE created_at >= ?`
    )
      .bind(oneHourAgo)
      .first<{ count: number | null }>();

    const lastDay = await env.DB.prepare(
      `SELECT COUNT(*) as count
         FROM interactions
        WHERE created_at >= ?`
    )
      .bind(oneDayAgo)
      .first<{ count: number | null }>();

    const failuresLastDay = await env.DB.prepare(
      `SELECT COUNT(*) as failures
         FROM sync_history
        WHERE synced_at >= ?
          AND sync_status = 'failed'`
    )
      .bind(oneDayAgo)
      .first<{ failures: number | null }>();

    const canvasStats = await env.DB.prepare(
      `SELECT COUNT(*) as total,
              SUM(CASE WHEN kv_expires_at IS NULL OR kv_expires_at < ? THEN 1 ELSE 0 END) as stale
         FROM canvas_cache
        WHERE invalidated_at IS NULL`
    )
      .bind(now)
      .first<{ total: number | null; stale: number | null }>();

    const vectorize = await evaluateVectorizeCoverage(env, logger);

    const snapshot: PerformanceSnapshot = {
      recordedAt: now,
      vectorize,
      kv: {
        totalKeys: canvasStats?.total ?? 0,
        expiredKeys: canvasStats?.stale ?? 0,
        canvasCacheTotal: canvasStats?.total ?? 0,
        canvasCacheStale: canvasStats?.stale ?? 0,
      },
      queue: {
        processedLastHour: lastHour?.count ?? 0,
        processedLastDay: lastDay?.count ?? 0,
        failuresLastDay: failuresLastDay?.failures ?? 0,
      },
    };

    logger.info('Performance snapshot collected', snapshot);

    return snapshot;
  } catch (error) {
    logger.error('Failed to collect performance snapshot', error);
    return null;
  }
}

async function evaluateVectorizeCoverage(env: Env, logger: Logger): Promise<PerformanceSnapshot['vectorize']> {
  try {
    const recentInteractions = await env.DB.prepare(
      `SELECT id, interaction_type
         FROM interactions
        ORDER BY occurred_at DESC
        LIMIT 50`
    ).all<{ id: string; interaction_type: string }>();

    const rows = recentInteractions.results ?? [];
    if (rows.length === 0) {
      return { recentInteractions: 0, missingVectors: 0 };
    }

    const batches: string[][] = [];
    const ids: string[] = [];

    for (const row of rows) {
      const prefix = row.interaction_type ?? 'call';
      const vectorId = `${prefix}:${row.id}`;
      ids.push(vectorId);
    }

    for (let i = 0; i < ids.length; i += 25) {
      batches.push(ids.slice(i, i + 25));
    }

    const present = new Set<string>();

    for (const batch of batches) {
      const result = await env.CALL_VECTORS.getByIds(batch);
      for (const vector of result ?? []) {
        if (vector?.id) {
          present.add(vector.id);
        }
      }
    }

    let missingVectors = 0;
    for (const id of ids) {
      if (!present.has(id)) {
        missingVectors += 1;
      }
    }

    return {
      recentInteractions: rows.length,
      missingVectors,
    };
  } catch (error) {
    logger.warn('Unable to evaluate vectorize coverage', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function persistSnapshot(
  env: Env,
  logger: Logger,
  checks: HealthCheckResult[],
  performance: PerformanceSnapshot | null
): Promise<void> {
  try {
    await env.DB.exec(`
      CREATE TABLE IF NOT EXISTS system_health_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recorded_at INTEGER NOT NULL,
        checks TEXT NOT NULL,
        performance TEXT
      )
    `);

    await env.DB.prepare(
      `INSERT INTO system_health_snapshots (recorded_at, checks, performance)
       VALUES (?, ?, ?)`
    )
      .bind(Date.now(), JSON.stringify(checks), JSON.stringify(performance))
      .run();
  } catch (error) {
    logger.error('Failed to persist system health snapshot', error);
  }
}

async function sendMonitoringAlert(env: Env, logger: Logger, payload: AlertPayload): Promise<void> {
  if (!env.ALERT_WEBHOOK_URL) {
    logger.warn('Monitoring alert skipped because ALERT_WEBHOOK_URL is not configured', payload);
    return;
  }

  const severityEmoji = payload.severity === 'critical' ? '🚨' : '⚠️';

  const body = {
    text: `${severityEmoji} System health check ${payload.severity}:\n${payload.summary}`,
    attachments: [
      {
        title: 'Degraded checks',
        text: payload.checks
          .map((check) => `• ${check.name} → ${check.message}`)
          .join('\n'),
        color: payload.severity === 'critical' ? 'danger' : 'warning',
      },
      payload.performance
        ? {
            title: 'Performance snapshot',
            text: `Vectorize missing: ${payload.performance.vectorize?.missingVectors ?? 'n/a'} / ${
              payload.performance.vectorize?.recentInteractions ?? 'n/a'
            }\nKV stale: ${payload.performance.kv.canvasCacheStale}/${payload.performance.kv.canvasCacheTotal}\nQueue processed (24h): ${payload.performance.queue.processedLastDay}`,
            color: '#3A7AFE',
          }
        : undefined,
    ].filter(Boolean),
  };

  try {
    await fetch(env.ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    logger.info('Sent monitoring alert', { severity: payload.severity });
  } catch (error) {
    logger.error('Failed to send monitoring alert', error);
  }
}
