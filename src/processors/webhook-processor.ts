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
import { NotionClient } from '../utils/notion-client';
import { R2Client } from '../utils/r2-client';
import { RateLimiter } from '../utils/rate-limiter';
import {
  getSyncState,
  markAsSynced,
  markAsFailed,
  retry,
  isRetryableError,
} from '../utils/helpers';

/**
 * Process a webhook event
 */
export async function processWebhookEvent(
  queuedEvent: QueuedWebhookEvent,
  env: Env,
  logger: Logger
): Promise<void> {
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
    if (existingPageId) {
      await notionClient.updateCallPage(existingPageId, {
        ...completeData,
        recordingUrl,
        voicemailUrl,
      });
      logger.info('Call page updated in Notion', { callId: call.id, pageId: existingPageId });
    } else {
      const pageId = await notionClient.createCallPage({
        ...completeData,
        recordingUrl,
        voicemailUrl,
      });
      logger.info('Call page created in Notion', { callId: call.id, pageId });

      // Mark as synced
      await markAsSynced(env.SYNC_STATE, call.id, 'call', pageId);
    }
  } catch (error) {
    await markAsFailed(env.SYNC_STATE, call.id, 'call', String(error), existingSync?.attempts || 0 + 1);
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
    if (existingPageId) {
      await notionClient.updateCallPage(existingPageId, {
        ...completeData,
        recordingUrl,
      });
    } else {
      const pageId = await notionClient.createCallPage({
        ...completeData,
        recordingUrl,
      });
      await markAsSynced(env.SYNC_STATE, call.id, 'call', pageId);
    }
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
    if (existingPageId) {
      await notionClient.updateCallPage(existingPageId, completeData);
    } else {
      const pageId = await notionClient.createCallPage(completeData);
      await markAsSynced(env.SYNC_STATE, transcript.callId, 'call', pageId);
    }
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
    if (existingPageId) {
      await notionClient.updateCallPage(existingPageId, completeData);
    } else {
      const pageId = await notionClient.createCallPage(completeData);
      await markAsSynced(env.SYNC_STATE, summary.callId, 'call', pageId);
    }
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
    if (existingPageId) {
      await notionClient.updateMessagePage(existingPageId, latestMessage);
      logger.info('Message page updated in Notion', { messageId: message.id, pageId: existingPageId });
    } else {
      const pageId = await notionClient.createMessagePage(latestMessage);
      logger.info('Message page created in Notion', { messageId: message.id, pageId });

      // Mark as synced
      await markAsSynced(env.SYNC_STATE, message.id, 'message', pageId);
    }
  } catch (error) {
    await markAsFailed(env.SYNC_STATE, message.id, 'message', String(error), existingSync?.attempts || 0 + 1);
    throw error;
  }
}
