/**
 * Scheduled Tasks Processor
 * Handles cron jobs for backfilling historical data and maintenance
 */

import type { Env } from '../types/env';
import { Logger } from '../utils/logger';
import { OpenPhoneClient } from '../utils/openphone-client';
import { NotionClient } from '../utils/notion-client';
import { R2Client } from '../utils/r2-client';
import { RateLimiter } from '../utils/rate-limiter';
import { getSyncState, markAsSynced, markAsFailed, sleep } from '../utils/helpers';

/**
 * Run all scheduled tasks
 */
export async function runScheduledTasks(env: Env, logger: Logger): Promise<void> {
  logger.info('Starting scheduled tasks');

  try {
    // Task 1: Backfill recent calls that might have been missed
    await backfillRecentCalls(env, logger);

    // Task 2: Backfill recent messages that might have been missed
    await backfillRecentMessages(env, logger);

    // Task 3: Update calls that have pending transcripts/summaries
    await updatePendingCallData(env, logger);

    // Task 4: Cleanup old sync state entries
    await cleanupOldSyncState(env, logger);

    logger.info('Scheduled tasks completed successfully');
  } catch (error) {
    logger.error('Error in scheduled tasks', error);
    throw error;
  }
}

/**
 * Backfill recent calls from the last 24 hours
 */
async function backfillRecentCalls(env: Env, logger: Logger): Promise<void> {
  logger.info('Starting call backfill');

  const rateLimiter = new RateLimiter(env.RATE_LIMITS, logger, {
    key: 'scheduled_openphone_rate_limit',
  });
  const openPhoneClient = new OpenPhoneClient(env, logger, rateLimiter);
  const notionClient = new NotionClient(env, logger);
  const r2Client = new R2Client(env.RECORDINGS_BUCKET, logger);

  try {
    // Fetch calls from the last 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const calls = await openPhoneClient.listCalls({
      createdAfter: oneDayAgo,
      limit: 100,
    });

    logger.info('Found calls for backfill', { count: calls.length });

    let synced = 0;
    let skipped = 0;
    let failed = 0;

    for (const call of calls) {
      try {
        // Check if already synced
        const syncState = await getSyncState(env.SYNC_STATE, call.id);
        if (syncState?.status === 'completed') {
          skipped++;
          continue;
        }

        // Only sync completed calls
        if (call.status !== 'completed') {
          continue;
        }

        logger.info('Backfilling call', { callId: call.id });

        // Fetch complete data
        const completeData = await openPhoneClient.getCompleteCall(call.id);

        // Download recordings
        let recordingUrl: string | undefined;
        if (completeData.recordings.length > 0 && completeData.recordings[0].url) {
          const recording = completeData.recordings[0];
          if (recording.url && recording.status === 'completed') {
            try {
              const audioData = await openPhoneClient.downloadAudioFile(recording.url);
              recordingUrl = await r2Client.uploadRecording(call.id, audioData, {
                timestamp: call.createdAt,
                duration: recording.duration || undefined,
                contentType: recording.type || undefined,
              });
            } catch (error) {
              logger.error('Failed to upload recording during backfill', error);
            }
          }
        }

        // Download voicemail
        let voicemailUrl: string | undefined;
        if (completeData.voicemail && completeData.voicemail.url) {
          try {
            const audioData = await openPhoneClient.downloadAudioFile(completeData.voicemail.url);
            voicemailUrl = await r2Client.uploadVoicemail(call.id, audioData, {
              timestamp: call.createdAt,
              duration: completeData.voicemail.duration || undefined,
              contentType: completeData.voicemail.type || undefined,
              transcription: completeData.voicemail.transcription || undefined,
            });
          } catch (error) {
            logger.error('Failed to upload voicemail during backfill', error);
          }
        }

        // Create or update in Notion
        const existingPageId = await notionClient.callPageExists(call.id);
        if (existingPageId) {
          await notionClient.updateCallPage(existingPageId, {
            ...completeData,
            recordingUrl,
            voicemailUrl,
          });
        } else {
          const pageId = await notionClient.createCallPage({
            ...completeData,
            recordingUrl,
            voicemailUrl,
          });
          await markAsSynced(env.SYNC_STATE, call.id, 'call', pageId);
        }

        synced++;
        logger.info('Call backfilled successfully', { callId: call.id });

        // Small delay to avoid overwhelming the APIs
        await sleep(100);
      } catch (error) {
        failed++;
        logger.error('Failed to backfill call', { callId: call.id, error });
        await markAsFailed(env.SYNC_STATE, call.id, 'call', String(error), 1);
      }
    }

    logger.info('Call backfill completed', { synced, skipped, failed });
  } catch (error) {
    logger.error('Call backfill failed', error);
    throw error;
  }
}

/**
 * Backfill recent messages from the last 24 hours
 */
async function backfillRecentMessages(env: Env, logger: Logger): Promise<void> {
  logger.info('Starting message backfill');

  const rateLimiter = new RateLimiter(env.RATE_LIMITS, logger, {
    key: 'scheduled_openphone_rate_limit',
  });
  const openPhoneClient = new OpenPhoneClient(env, logger, rateLimiter);
  const notionClient = new NotionClient(env, logger);

  try {
    // Fetch messages from the last 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const messages = await openPhoneClient.listMessages({
      createdAfter: oneDayAgo,
      limit: 100,
    });

    logger.info('Found messages for backfill', { count: messages.length });

    let synced = 0;
    let skipped = 0;
    let failed = 0;

    for (const message of messages) {
      try {
        // Check if already synced
        const syncState = await getSyncState(env.SYNC_STATE, message.id);
        if (syncState?.status === 'completed') {
          skipped++;
          continue;
        }

        logger.info('Backfilling message', { messageId: message.id });

        // Create or update in Notion
        const existingPageId = await notionClient.messagePageExists(message.id);
        if (existingPageId) {
          await notionClient.updateMessagePage(existingPageId, message);
        } else {
          const pageId = await notionClient.createMessagePage(message);
          await markAsSynced(env.SYNC_STATE, message.id, 'message', pageId);
        }

        synced++;
        logger.info('Message backfilled successfully', { messageId: message.id });

        // Small delay
        await sleep(100);
      } catch (error) {
        failed++;
        logger.error('Failed to backfill message', { messageId: message.id, error });
        await markAsFailed(env.SYNC_STATE, message.id, 'message', String(error), 1);
      }
    }

    logger.info('Message backfill completed', { synced, skipped, failed });
  } catch (error) {
    logger.error('Message backfill failed', error);
    throw error;
  }
}

/**
 * Update calls that have pending transcripts or summaries
 * This handles cases where transcripts/summaries complete after the call
 */
async function updatePendingCallData(env: Env, logger: Logger): Promise<void> {
  logger.info('Checking for pending call updates');

  // This would ideally query Notion for calls with pending transcripts/summaries
  // For now, we'll check recent completed calls

  const rateLimiter = new RateLimiter(env.RATE_LIMITS, logger, {
    key: 'scheduled_openphone_rate_limit',
  });
  const openPhoneClient = new OpenPhoneClient(env, logger, rateLimiter);
  const notionClient = new NotionClient(env, logger);

  try {
    // Check calls from the last 7 days (transcripts can take time to process)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const calls = await openPhoneClient.listCalls({
      createdAfter: sevenDaysAgo,
      limit: 50, // Limit to avoid too much work
    });

    let updated = 0;

    for (const call of calls) {
      try {
        // Only check completed calls that are synced
        if (call.status !== 'completed') {
          continue;
        }

        const syncState = await getSyncState(env.SYNC_STATE, call.id);
        if (!syncState || syncState.status !== 'completed') {
          continue;
        }

        // Fetch latest data
        const completeData = await openPhoneClient.getCompleteCall(call.id);

        // Check if there's new transcript or summary data
        const hasNewData =
          (completeData.transcript && completeData.transcript.status === 'completed') ||
          (completeData.summary && completeData.summary.status === 'completed');

        if (hasNewData && syncState.notionPageId) {
          logger.info('Updating call with new transcript/summary', { callId: call.id });
          await notionClient.updateCallPage(syncState.notionPageId, completeData);
          updated++;
        }

        // Small delay
        await sleep(200);
      } catch (error) {
        logger.error('Failed to update pending call', { callId: call.id, error });
      }
    }

    logger.info('Pending call updates completed', { updated });
  } catch (error) {
    logger.error('Pending call update check failed', error);
  }
}

/**
 * Cleanup old sync state entries (older than 30 days)
 */
async function cleanupOldSyncState(env: Env, logger: Logger): Promise<void> {
  logger.info('Cleaning up old sync state entries');

  // KV entries have TTL, so this is mostly for logging
  // You could implement more sophisticated cleanup if needed

  try {
    // Get R2 statistics for monitoring
    const r2Client = new R2Client(env.RECORDINGS_BUCKET, logger);
    const recordingsStats = await r2Client.getStats('recordings/');
    const voicemailsStats = await r2Client.getStats('voicemails/');

    logger.info('R2 storage statistics', {
      recordings: {
        count: recordingsStats.count,
        totalSize: `${(recordingsStats.totalSize / 1024 / 1024).toFixed(2)} MB`,
      },
      voicemails: {
        count: voicemailsStats.count,
        totalSize: `${(voicemailsStats.totalSize / 1024 / 1024).toFixed(2)} MB`,
      },
    });

    logger.info('Cleanup completed');
  } catch (error) {
    logger.error('Cleanup failed', error);
  }
}
