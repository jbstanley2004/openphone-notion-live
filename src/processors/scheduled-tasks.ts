/**
 * Scheduled Tasks Processor
 * Handles cron jobs for comprehensive backfilling with AI analysis and vectorization
 */

import type { Env } from '../types/env';
import { Logger } from '../utils/logger';
import { runComprehensiveBackfill } from './comprehensive-backfill';
import { replicateCanvasCacheToKV } from './canvas-cache-replicator';

/**
 * Run all scheduled tasks
 *
 * Runs comprehensive backfill every 6 hours:
 * - Backfills all 4 databases (Calls, Messages, Mail, Canvas)
 * - Includes AI analysis (sentiment, summary, action items, lead scoring)
 * - Includes vectorization for semantic search
 * - Reconciles Canvas relations
 */
export async function runScheduledTasks(env: Env, logger: Logger): Promise<void> {
  logger.info('Starting scheduled comprehensive backfill');

  try {
    const replication = await replicateCanvasCacheToKV(env, logger);
    logger.info('Canvas cache replication run before backfill', replication);
  } catch (error) {
    logger.error('Canvas cache replication failed', error);
  }

  try {
    // Run comprehensive backfill with full AI and vectorization
    const stats = await runComprehensiveBackfill(env, logger, {
      daysBack: 30, // Last 30 days on each run
      includeAI: true, // Always include AI analysis
      includeVectorize: true, // Always vectorize for search
      reconcileCanvas: true, // Always reconcile Canvas relations
      batchSize: 10, // Process 10 records at a time
    });

    logger.info('Scheduled comprehensive backfill completed', {
      calls: stats.calls,
      messages: stats.messages,
      mail: stats.mail,
      canvas: stats.canvas,
      totalSynced: stats.calls.synced + stats.messages.synced + stats.mail.synced + stats.canvas.synced,
      totalFailed: stats.calls.failed + stats.messages.failed + stats.mail.failed + stats.canvas.failed,
      totalSkipped: stats.calls.skipped + stats.messages.skipped + stats.mail.skipped + stats.canvas.skipped,
    });
  } catch (error) {
    logger.error('Error in scheduled comprehensive backfill', error);
    throw error;
  }
}
