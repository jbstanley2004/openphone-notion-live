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
  const event = queuedEvent.data as WebhookEvent;

  logger.info('Processing webhook event', {
    eventId: event.id,
    eventType: event.type,
  });

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

    logger.warn('Unknown webhook event type received', { eventType: event.type });
  } catch (error) {
    logger.error('Error processing webhook event via workflows', error);
    throw error;
  }
}

function extractCallId(event: WebhookEvent): string | null {
  const object = event.data.object as Call | CallSummary | CallTranscript | { callId?: string };

  if ('id' in object && typeof object.id === 'string' && event.type !== 'call.summary.completed') {
    return object.id;
  }

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
