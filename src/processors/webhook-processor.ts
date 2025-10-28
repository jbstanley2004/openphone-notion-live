import type { Env, QueuedWebhookEvent } from '../types/env';
import type {
  WebhookEvent,
  Call,
  CallSummary,
  CallTranscript,
  Message,
  Mail,
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
import {
  triggerCallWorkflow,
  triggerMessageWorkflow,
  triggerMailWorkflow,
} from '../workflows/trigger';

const CALL_EVENT_TYPES = new Set<WebhookEvent['type']>([
  'call.completed',
  'call.recording.completed',
  'call.transcript.completed',
  'call.summary.completed',
]);

const MESSAGE_EVENT_TYPES = new Set<WebhookEvent['type']>([
  'message.received',
  'message.delivered',
]);

const MAIL_EVENT_TYPES = new Set<WebhookEvent['type']>([
  'mail.received',
  'mail.delivered',
  'mail.sent',
]);

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
    if (CALL_EVENT_TYPES.has(event.type)) {
      const callId = extractCallId(event);
      if (!callId) {
        logger.warn('Unable to determine call ID for event', { eventType: event.type });
        return;
      }

      const phoneNumberId = extractCallPhoneNumberId(event);
      await triggerCallWorkflow(env, logger, { callId, phoneNumberId: phoneNumberId ?? null });
      return;
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
    if (MESSAGE_EVENT_TYPES.has(event.type)) {
      const message = event.data.object as Message;
      await triggerMessageWorkflow(env, logger, {
        messageId: message.id,
        phoneNumberId: message.phoneNumberId ?? null,
      });
      return;
    }

    if (MAIL_EVENT_TYPES.has(event.type)) {
      const mail = event.data.object as Mail;
      await triggerMailWorkflow(env, logger, { mail });
      return;
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
    logger.warn('Unknown webhook event type received', { eventType: event.type });
  } catch (error) {
    logger.error('Error processing webhook event via workflows', error);
    throw error;
  }
}

function extractCallId(event: WebhookEvent): string | null {
  const object = event.data.object as Call | CallSummary | CallTranscript | { callId?: string };

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
  if ('id' in object && typeof object.id === 'string' && event.type !== 'call.summary.completed') {
    return object.id;
  }

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
  if ('callId' in object && typeof object.callId === 'string') {
    return object.callId;
  }

  return null;
}

function extractCallPhoneNumberId(event: WebhookEvent): string | null {
  const object = event.data.object as Call | CallSummary | CallTranscript;
  if ('phoneNumberId' in object && object.phoneNumberId) {
    return object.phoneNumberId;
  }
  return null;
}
