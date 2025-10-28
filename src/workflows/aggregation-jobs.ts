import type { Env } from '../types/env';
import type { Logger } from '../utils/logger';
import { createNotionClient } from './modules/resources';

export interface AggregationJobDefinition {
  name: string;
  schedule: 'nightly' | 'hourly' | 'weekly';
  description: string;
  run(env: Env, logger: Logger): Promise<void>;
}

export function getAggregationJobs(): AggregationJobDefinition[] {
  return [
    {
      name: 'daily-interaction-rollup',
      schedule: 'nightly',
      description: 'Aggregate previous day call/message/mail counts into D1 rollup table.',
      run: runDailyInteractionRollup,
    },
    {
      name: 'weekly-merchant-health',
      schedule: 'weekly',
      description: 'Capture weekly merchant engagement metrics for analytics dashboards.',
      run: runWeeklyMerchantHealthSnapshot,
    },
  ];
}

export async function runAggregationJobs(env: Env, logger: Logger): Promise<void> {
  for (const job of getAggregationJobs()) {
    const jobLogger = logger.withContext({ aggregationJob: job.name });
    jobLogger.info('Running aggregation job', { schedule: job.schedule });

    const start = Date.now();
    try {
      await job.run(env, jobLogger);
      jobLogger.info('Aggregation job completed', { durationMs: Date.now() - start });
    } catch (error) {
      jobLogger.error('Aggregation job failed', error, { durationMs: Date.now() - start });
    }
  }
}

async function runDailyInteractionRollup(env: Env, logger: Logger): Promise<void> {
  await env.DB.exec(`
    CREATE TABLE IF NOT EXISTS interaction_rollups (
      rollup_date TEXT PRIMARY KEY,
      call_count INTEGER DEFAULT 0,
      message_count INTEGER DEFAULT 0,
      mail_count INTEGER DEFAULT 0,
      updated_at INTEGER NOT NULL
    )
  `);

  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);

  const results = await env.DB.prepare(
    `SELECT interaction_type, COUNT(*) as count
       FROM interactions
      WHERE occurred_at >= ? AND occurred_at < ?
      GROUP BY interaction_type`
  )
    .bind(start.getTime(), end.getTime())
    .all<{ interaction_type: string; count: number }>();

  const counts = { call: 0, message: 0, mail: 0 };
  for (const row of results.results) {
    if (row.interaction_type in counts) {
      counts[row.interaction_type as 'call' | 'message' | 'mail'] = row.count;
    }
  }

  await env.DB.prepare(
    `INSERT OR REPLACE INTO interaction_rollups (rollup_date, call_count, message_count, mail_count, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(
      start.toISOString().slice(0, 10),
      counts.call,
      counts.message,
      counts.mail,
      Date.now()
    )
    .run();

  logger.info('Daily interaction rollup stored', counts);
}

async function runWeeklyMerchantHealthSnapshot(env: Env, logger: Logger): Promise<void> {
  await env.DB.exec(`
    CREATE TABLE IF NOT EXISTS merchant_health_rollups (
      week_start TEXT PRIMARY KEY,
      active_merchants INTEGER DEFAULT 0,
      high_touch_merchants INTEGER DEFAULT 0,
      updated_at INTEGER NOT NULL
    )
  `);

  const now = new Date();
  const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayOfWeek = weekStart.getUTCDay();
  const offset = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Monday start
  weekStart.setUTCDate(weekStart.getUTCDate() - offset);

  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

  const result = await env.DB.prepare(
    `SELECT canvas_id, COUNT(*) as interaction_count
       FROM interactions
      WHERE occurred_at >= ? AND occurred_at < ?
      GROUP BY canvas_id`
  )
    .bind(weekStart.getTime(), weekEnd.getTime())
    .all<{ canvas_id: string; interaction_count: number }>();

  const activeMerchants = result.results.length;
  const highTouchMerchants = result.results.filter((row) => row.interaction_count >= 5).length;

  await env.DB.prepare(
    `INSERT OR REPLACE INTO merchant_health_rollups (week_start, active_merchants, high_touch_merchants, updated_at)
     VALUES (?, ?, ?, ?)`
  )
    .bind(
      weekStart.toISOString().slice(0, 10),
      activeMerchants,
      highTouchMerchants,
      Date.now()
    )
    .run();

  logger.info('Weekly merchant health snapshot stored', {
    activeMerchants,
    highTouchMerchants,
  });

  const notionClient = createNotionClient(env, logger);
  logger.debug('Notion client ready for future aggregation exports', {
    hasClient: Boolean(notionClient),
  });
}
