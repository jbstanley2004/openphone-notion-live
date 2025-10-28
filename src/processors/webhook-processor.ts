/**
 * Webhook Event Processor
 * Enriches webhook data and syncs to Notion
 */

import type { Env, QueuedWebhookEvent } from '../types/env';
import type {
  WebhookEvent,
  CallCompletedEvent,
  CallRecordingCompletedEvent,
  CallTranscriptCompletedEvent,
  CallSummaryCompletedEvent,
  MessageReceivedEvent,
  MessageDeliveredEvent,
  Call,
  Message,
} from '../types/openphone';
import { Logger } from '../utils/logger';
import { OpenPhoneClient } from '../utils/openphone-client';
import { NotionClient, type MerchantUuidGap } from '../utils/notion-client';
import { R2Client } from '../utils/r2-client';
import { RateLimiter } from '../utils/rate-limiter';
import {
  getSyncState,
  markAsSynced,
  markAsFailed,
  retry,
  isRetryableError,
} from '../utils/helpers';
import { indexCall, indexMessage } from '../utils/vector-search';

/**
 * Process a webhook event
 */
export async function processWebhookEvent(
  queuedEvent: QueuedWebhookEvent,
  env: Env,
  logger: Logger
): Promise<void> {
  if (queuedEvent.type === 'maintenance.merchant_uuid_backfill') {
    const notionClient = new NotionClient(env, logger);
    await handleMerchantUuidBackfill(queuedEvent.data as MerchantUuidGap, env, logger, notionClient);
    return;
  }

  const event = queuedEvent.data as WebhookEvent;

  logger.info('Processing webhook event', {
    eventId: event.id,
    eventType: event.type,
  });

  // Initialize clients
  const rateLimiter = new RateLimiter(env.RATE_LIMITS, logger);
  const openPhoneClient = new OpenPhoneClient(env, logger, rateLimiter);
  const notionClient = new NotionClient(env, logger);
  const r2Client = new R2Client(env.RECORDINGS_BUCKET, logger);

  try {
    // Route to appropriate handler based on event type
    switch (event.type) {
      case 'call.completed':
        await handleCallCompleted(event as CallCompletedEvent, env, logger, openPhoneClient, notionClient, r2Client);
        break;

      case 'call.recording.completed':
        await handleCallRecordingCompleted(event as CallRecordingCompletedEvent, env, logger, openPhoneClient, notionClient, r2Client);
        break;

      case 'call.transcript.completed':
        await handleCallTranscriptCompleted(event as CallTranscriptCompletedEvent, env, logger, openPhoneClient, notionClient);
        break;

      case 'call.summary.completed':
        await handleCallSummaryCompleted(event as CallSummaryCompletedEvent, env, logger, openPhoneClient, notionClient);
        break;

      case 'message.received':
      case 'message.delivered':
        await handleMessage(event as MessageReceivedEvent | MessageDeliveredEvent, env, logger, openPhoneClient, notionClient);
        break;

      default:
        logger.warn('Unknown webhook event type', { eventType: event.type });
    }

    // Track success in analytics
    if (env.ANALYTICS) {
      env.ANALYTICS.writeDataPoint({
        blobs: [event.type, 'processed_success'],
        doubles: [1],
        indexes: [event.id],
      });
    }
  } catch (error) {
    logger.error('Error processing webhook event', error);

    // Track failure in analytics
    if (env.ANALYTICS) {
      env.ANALYTICS.writeDataPoint({
        blobs: [event.type, 'processed_failure'],
        doubles: [1],
        indexes: [event.id],
      });
    }

    throw error; // Re-throw to trigger retry
  }
}

async function handleMerchantUuidBackfill(
  gap: MerchantUuidGap,
  env: Env,
  logger: Logger,
  notionClient: NotionClient
): Promise<void> {
  logger.info('Handling merchant UUID correction task', {
    database: gap.database,
    pageId: gap.pageId,
    merchantName: gap.merchantName,
  });

  const uuid = await notionClient.repairMerchantUuid(gap);

  if (uuid) {
    logger.info('Merchant UUID correction applied', {
      database: gap.database,
      pageId: gap.pageId,
      merchantUuid: uuid,
    });
  } else {
    logger.warn('Merchant UUID correction could not determine UUID', {
      database: gap.database,
      pageId: gap.pageId,
      merchantName: gap.merchantName,
    });
  }
}

interface SyncHistoryRecord {
  phoneNumberId: string | null;
  resourceType: 'call' | 'message';
  resourceId: string;
  direction: string | null;
  notionPageId: string | null;
  canvasId: string | null;
  merchantUuid: string | null;
  status: 'success' | 'failed';
  durationMs?: number;
  errorMessage?: string;
}

async function recordSyncHistory(
  env: Env,
  logger: Logger,
  record: SyncHistoryRecord
): Promise<void> {
  if (!record.phoneNumberId) {
    logger.warn('Skipping sync history entry without phone number', {
      resourceId: record.resourceId,
      resourceType: record.resourceType,
    });
    return;
  }

  try {
    await env.DB.prepare(
      `INSERT INTO sync_history (
        phone_number_id,
        resource_type,
        resource_id,
        direction,
        notion_page_id,
        canvas_id,
        merchant_uuid,
        sync_status,
        error_message,
        processing_time_ms,
        synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        record.phoneNumberId,
        record.resourceType,
        record.resourceId,
        record.direction,
        record.notionPageId,
        record.canvasId,
        record.merchantUuid,
        record.status,
        record.errorMessage ?? null,
        record.durationMs ?? null,
        Date.now()
      )
      .run();
  } catch (error) {
    logger.error('Failed to record sync history', error, {
      resourceId: record.resourceId,
      resourceType: record.resourceType,
    });
  }
}

/**
 * Handle call.completed event
 */
async function handleCallCompleted(
  event: CallCompletedEvent,
  env: Env,
  logger: Logger,
  openPhoneClient: OpenPhoneClient,
  notionClient: NotionClient,
  r2Client: R2Client
): Promise<void> {
  const call = event.data.object;
  logger.info('Handling call.completed', { callId: call.id });
  const startTime = Date.now();

  // Check if already synced
  const existingSync = await getSyncState(env.SYNC_STATE, call.id);
  if (existingSync?.status === 'completed') {
    logger.info('Call already synced, updating', { callId: call.id });
  }

  try {
    // Fetch complete call data
    const completeData = await retry(
      () => openPhoneClient.getCompleteCall(call.id),
      { maxAttempts: 3 }
    );

    // Download and upload recording to R2 if available
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
          logger.info('Recording uploaded to R2', { callId: call.id, url: recordingUrl });
        } catch (error) {
          logger.error('Failed to upload recording to R2', error);
          // Continue without recording URL
        }
      }
    }

    // Download and upload voicemail to R2 if available
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
        logger.info('Voicemail uploaded to R2', { callId: call.id, url: voicemailUrl });
      } catch (error) {
        logger.error('Failed to upload voicemail to R2', error);
        // Continue without voicemail URL
      }
    }

    // Sync to Notion
    const existingPageId = await notionClient.callPageExists(call.id);
    let notionPageId: string;
    let merchantUuid: string | null = null;
    let canvasId: string | null = null;

    if (existingPageId) {
      const result = await notionClient.updateCallPage(existingPageId, {
        ...completeData,
        recordingUrl,
        voicemailUrl,
      });
      notionPageId = existingPageId;
      merchantUuid = result.merchantUuid;
      canvasId = result.canvasId;
      logger.info('Call page updated in Notion', { callId: call.id, pageId: existingPageId, merchantUuid });
    } else {
      const result = await notionClient.createCallPage({
        ...completeData,
        recordingUrl,
        voicemailUrl,
      });
      notionPageId = result.pageId;
      merchantUuid = result.merchantUuid;
      canvasId = result.canvasId;
      logger.info('Call page created in Notion', { callId: call.id, pageId: notionPageId, merchantUuid });
    }

    const transcriptText = completeData.transcript?.dialogue
      ?.map((segment) => segment.content)
      .join('\n')
      || completeData.voicemail?.transcription
      || undefined;
    const summaryText = completeData.summary?.summary?.join('\n') || undefined;

    await indexCall(
      completeData.call,
      transcriptText,
      summaryText,
      notionPageId,
      merchantUuid,
      canvasId,
      env,
      logger
    );

    // Mark as synced (always update metadata)
    await markAsSynced(env.SYNC_STATE, call.id, 'call', notionPageId, merchantUuid, canvasId);

    await recordSyncHistory(env, logger, {
      phoneNumberId: call.phoneNumberId,
      resourceType: 'call',
      resourceId: call.id,
      direction: call.direction,
      notionPageId,
      canvasId,
      merchantUuid,
      status: 'success',
      durationMs: Date.now() - startTime,
    });
  } catch (error) {
    const attempts = (existingSync?.attempts ?? 0) + 1;
    await markAsFailed(env.SYNC_STATE, call.id, 'call', String(error), attempts);
    await recordSyncHistory(env, logger, {
      phoneNumberId: call.phoneNumberId,
      resourceType: 'call',
      resourceId: call.id,
      direction: call.direction,
      notionPageId: null,
      canvasId: null,
      merchantUuid: null,
      status: 'failed',
      durationMs: Date.now() - startTime,
      errorMessage: String(error),
    });
    throw error;
  }
}

/**
 * Handle call.recording.completed event
 */
async function handleCallRecordingCompleted(
  event: CallRecordingCompletedEvent,
  env: Env,
  logger: Logger,
  openPhoneClient: OpenPhoneClient,
  notionClient: NotionClient,
  r2Client: R2Client
): Promise<void> {
  const call = event.data.object;
  logger.info('Handling call.recording.completed', { callId: call.id });

  // This event fires when a recording is ready
  // We'll fetch the complete data and update the Notion page
  try {
    const completeData = await openPhoneClient.getCompleteCall(call.id);

    // Download and upload recording
    let recordingUrl: string | undefined;
    if (completeData.recordings.length > 0 && completeData.recordings[0].url) {
      const recording = completeData.recordings[0];
      if (recording.url && recording.status === 'completed') {
        const audioData = await openPhoneClient.downloadAudioFile(recording.url);
        recordingUrl = await r2Client.uploadRecording(call.id, audioData, {
          timestamp: call.createdAt,
          duration: recording.duration || undefined,
          contentType: recording.type || undefined,
        });
      }
    }

    // Update or create Notion page
    const existingPageId = await notionClient.callPageExists(call.id);
    let notionPageId: string;
    let merchantUuid: string | null = null;
    let canvasId: string | null = null;

    if (existingPageId) {
      const result = await notionClient.updateCallPage(existingPageId, {
        ...completeData,
        recordingUrl,
      });
      notionPageId = existingPageId;
      merchantUuid = result.merchantUuid;
      canvasId = result.canvasId;
    } else {
      const result = await notionClient.createCallPage({
        ...completeData,
        recordingUrl,
      });
      notionPageId = result.pageId;
      merchantUuid = result.merchantUuid;
      canvasId = result.canvasId;
    }

    const transcriptText = completeData.transcript?.dialogue
      ?.map((segment) => segment.content)
      .join('\n')
      || completeData.voicemail?.transcription
      || undefined;
    const summaryText = completeData.summary?.summary?.join('\n') || undefined;

    await indexCall(
      completeData.call,
      transcriptText,
      summaryText,
      notionPageId,
      merchantUuid,
      canvasId,
      env,
      logger
    );

    await markAsSynced(env.SYNC_STATE, call.id, 'call', notionPageId, merchantUuid, canvasId);
  } catch (error) {
    logger.error('Failed to handle recording.completed', error);
    throw error;
  }
}

/**
 * Handle call.transcript.completed event
 */
async function handleCallTranscriptCompleted(
  event: CallTranscriptCompletedEvent,
  env: Env,
  logger: Logger,
  openPhoneClient: OpenPhoneClient,
  notionClient: NotionClient
): Promise<void> {
  const transcript = event.data.object;
  logger.info('Handling call.transcript.completed', { callId: transcript.callId });

  try {
    const completeData = await openPhoneClient.getCompleteCall(transcript.callId);

    const existingPageId = await notionClient.callPageExists(transcript.callId);
    let notionPageId: string;
    let merchantUuid: string | null = null;
    let canvasId: string | null = null;

    if (existingPageId) {
      const result = await notionClient.updateCallPage(existingPageId, completeData);
      notionPageId = existingPageId;
      merchantUuid = result.merchantUuid;
      canvasId = result.canvasId;
    } else {
      const result = await notionClient.createCallPage(completeData);
      notionPageId = result.pageId;
      merchantUuid = result.merchantUuid;
      canvasId = result.canvasId;
    }

    const transcriptText = completeData.transcript?.dialogue
      ?.map((segment) => segment.content)
      .join('\n')
      || completeData.voicemail?.transcription
      || undefined;
    const summaryText = completeData.summary?.summary?.join('\n') || undefined;

    await indexCall(
      completeData.call,
      transcriptText,
      summaryText,
      notionPageId,
      merchantUuid,
      canvasId,
      env,
      logger
    );

    await markAsSynced(env.SYNC_STATE, transcript.callId, 'call', notionPageId, merchantUuid, canvasId);
  } catch (error) {
    logger.error('Failed to handle transcript.completed', error);
    throw error;
  }
}

/**
 * Handle call.summary.completed event
 */
async function handleCallSummaryCompleted(
  event: CallSummaryCompletedEvent,
  env: Env,
  logger: Logger,
  openPhoneClient: OpenPhoneClient,
  notionClient: NotionClient
): Promise<void> {
  const summary = event.data.object;
  logger.info('Handling call.summary.completed', { callId: summary.callId });

  try {
    const completeData = await openPhoneClient.getCompleteCall(summary.callId);

    const existingPageId = await notionClient.callPageExists(summary.callId);
    let notionPageId: string;
    let merchantUuid: string | null = null;
    let canvasId: string | null = null;

    if (existingPageId) {
      const result = await notionClient.updateCallPage(existingPageId, completeData);
      notionPageId = existingPageId;
      merchantUuid = result.merchantUuid;
      canvasId = result.canvasId;
    } else {
      const result = await notionClient.createCallPage(completeData);
      notionPageId = result.pageId;
      merchantUuid = result.merchantUuid;
      canvasId = result.canvasId;
    }

    const transcriptText = completeData.transcript?.dialogue
      ?.map((segment) => segment.content)
      .join('\n')
      || completeData.voicemail?.transcription
      || undefined;
    const summaryText = completeData.summary?.summary?.join('\n') || undefined;

    await indexCall(
      completeData.call,
      transcriptText,
      summaryText,
      notionPageId,
      merchantUuid,
      canvasId,
      env,
      logger
    );

    await markAsSynced(env.SYNC_STATE, summary.callId, 'call', notionPageId, merchantUuid, canvasId);
  } catch (error) {
    logger.error('Failed to handle summary.completed', error);
    throw error;
  }
}

/**
 * Handle message events (received and delivered)
 */
async function handleMessage(
  event: MessageReceivedEvent | MessageDeliveredEvent,
  env: Env,
  logger: Logger,
  openPhoneClient: OpenPhoneClient,
  notionClient: NotionClient
): Promise<void> {
  const message = event.data.object;
  logger.info('Handling message event', { messageId: message.id, type: event.type });
  const startTime = Date.now();

  // Check if already synced
  const existingSync = await getSyncState(env.SYNC_STATE, message.id);
  if (existingSync?.status === 'completed') {
    logger.info('Message already synced, updating', { messageId: message.id });
  }

  try {
    // Fetch the latest message data (in case it has been updated)
    const latestMessage = await retry(
      () => openPhoneClient.getMessage(message.id),
      { maxAttempts: 3 }
    );

    // Sync to Notion
    const existingPageId = await notionClient.messagePageExists(message.id);
    let notionPageId: string;
    let merchantUuid: string | null = null;
    let canvasId: string | null = null;

    if (existingPageId) {
      const result = await notionClient.updateMessagePage(existingPageId, latestMessage);
      notionPageId = existingPageId;
      merchantUuid = result.merchantUuid;
      canvasId = result.canvasId ?? null;
      logger.info('Message page updated in Notion', { messageId: message.id, pageId: existingPageId, merchantUuid });
    } else {
      const result = await notionClient.createMessagePage(latestMessage);
      notionPageId = result.pageId;
      merchantUuid = result.merchantUuid;
      canvasId = result.canvasId ?? null;
      logger.info('Message page created in Notion', { messageId: message.id, pageId: notionPageId, merchantUuid });
    }

    await indexMessage(
      latestMessage,
      undefined,
      notionPageId,
      merchantUuid,
      canvasId,
      env,
      logger
    );

    await markAsSynced(env.SYNC_STATE, message.id, 'message', notionPageId, merchantUuid, canvasId);

    await recordSyncHistory(env, logger, {
      phoneNumberId: latestMessage.phoneNumberId,
      resourceType: 'message',
      resourceId: message.id,
      direction: latestMessage.direction,
      notionPageId,
      canvasId,
      merchantUuid,
      status: 'success',
      durationMs: Date.now() - startTime,
    });
  } catch (error) {
    const attempts = (existingSync?.attempts ?? 0) + 1;
    await markAsFailed(env.SYNC_STATE, message.id, 'message', String(error), attempts);
    await recordSyncHistory(env, logger, {
      phoneNumberId: message.phoneNumberId,
      resourceType: 'message',
      resourceId: message.id,
      direction: message.direction,
      notionPageId: null,
      canvasId: null,
      merchantUuid: null,
      status: 'failed',
      durationMs: Date.now() - startTime,
      errorMessage: String(error),
    });
    throw error;
  }
}
