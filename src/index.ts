/**
 * OpenPhone to Notion Sync - Main Worker
 * Webhook receiver and queue consumer
 */

import type { Env, QueuedWebhookEvent } from './types/env';
import type { WebhookEvent } from './types/openphone';
import { createLogger } from './utils/logger';
import { isEventProcessed, markEventProcessed } from './utils/helpers';

export default {
  /**
   * Handle incoming HTTP requests (webhook receiver)
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const logger = createLogger(env, request);

    try {
      const url = new URL(request.url);

      // Health check endpoint
      if (url.pathname === '/health') {
        return new Response(JSON.stringify({ status: 'healthy', timestamp: new Date().toISOString() }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Webhook endpoint
      if (url.pathname === env.WEBHOOK_PATH && request.method === 'POST') {
        return await handleWebhook(request, env, logger);
      }

      // Default response
      return new Response('OpenPhone Notion Sync Worker', {
        headers: { 'Content-Type': 'text/plain' },
      });
    } catch (error) {
      logger.error('Unhandled error in fetch handler', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  },

  /**
   * Handle queued webhook events (queue consumer)
   */
  async queue(batch: MessageBatch<QueuedWebhookEvent>, env: Env): Promise<void> {
    const logger = createLogger(env);

    logger.info('Processing webhook event batch', {
      batchSize: batch.messages.length,
      queueName: batch.queue,
    });

    // Import the processor dynamically to avoid circular dependencies
    const { processWebhookEvent } = await import('./processors/webhook-processor');

    // Process messages in parallel (but respect rate limits in the processor)
    await Promise.allSettled(
      batch.messages.map(async (message) => {
        const event = message.body;
        const messageLogger = logger.withContext({
          webhookEventId: event.id,
          eventType: event.type,
        });

        try {
          messageLogger.info('Processing webhook event', {
            retryCount: message.attempts,
          });

          await processWebhookEvent(event, env, messageLogger);

          // Acknowledge the message
          message.ack();

          messageLogger.info('Webhook event processed successfully');
        } catch (error) {
          messageLogger.error('Failed to process webhook event', error);

          // Retry or send to DLQ
          if (message.attempts >= 3) {
            messageLogger.error('Max retries exceeded, message will go to DLQ');
            message.ack(); // Remove from queue (will go to DLQ)
          } else {
            message.retry(); // Retry later
          }
        }
      })
    );
  },

  /**
   * Handle scheduled/cron tasks
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const logger = createLogger(env);

    logger.info('Running scheduled task', {
      cron: event.cron,
      scheduledTime: new Date(event.scheduledTime).toISOString(),
    });

    try {
      // Import the scheduled tasks module
      const { runScheduledTasks } = await import('./processors/scheduled-tasks');
      await runScheduledTasks(env, logger);

      logger.info('Scheduled task completed successfully');
    } catch (error) {
      logger.error('Scheduled task failed', error);
    }
  },
};

/**
 * Handle incoming webhook from OpenPhone
 */
async function handleWebhook(
  request: Request,
  env: Env,
  logger: typeof createLogger extends (...args: any[]) => infer R ? R : never
): Promise<Response> {
  try {
    // Parse webhook payload
    const payload: WebhookEvent = await request.json();

    logger.info('Received webhook', {
      eventId: payload.id,
      eventType: payload.type,
      apiVersion: payload.apiVersion,
    });

    // Validate webhook signature if secret is configured
    if (env.WEBHOOK_SECRET) {
      const signature = request.headers.get('x-openphone-signature');
      if (!signature || !await validateWebhookSignature(request, env.WEBHOOK_SECRET, signature)) {
        logger.warn('Invalid webhook signature');
        return new Response('Invalid signature', { status: 401 });
      }
    }

    // Check for duplicate events
    const isDuplicate = await isEventProcessed(env.SYNC_STATE, payload.id);
    if (isDuplicate) {
      logger.info('Duplicate webhook event, ignoring', { eventId: payload.id });
      return new Response('OK (duplicate)', { status: 200 });
    }

    // Mark event as received
    await markEventProcessed(env.SYNC_STATE, payload.id);

    // Queue the event for processing
    const queuedEvent: QueuedWebhookEvent = {
      id: payload.id,
      type: payload.type,
      timestamp: payload.createdAt,
      data: payload,
      retryCount: 0,
    };

    await env.WEBHOOK_EVENTS.send(queuedEvent);

    logger.info('Webhook queued for processing', { eventId: payload.id });

    // Track event in analytics
    if (env.ANALYTICS) {
      env.ANALYTICS.writeDataPoint({
        blobs: [payload.type, 'webhook_received'],
        doubles: [1],
        indexes: [payload.id],
      });
    }

    return new Response('OK', { status: 200 });
  } catch (error) {
    logger.error('Error handling webhook', error);
    return new Response('Error processing webhook', { status: 500 });
  }
}

/**
 * Validate webhook signature (if OpenPhone provides one)
 * This is a placeholder - adjust based on OpenPhone's actual signature scheme
 */
async function validateWebhookSignature(
  request: Request,
  secret: string,
  signature: string
): Promise<boolean> {
  try {
    // This is a simplified example
    // Adjust based on OpenPhone's actual signature verification method
    const body = await request.clone().text();

    // Most webhook signatures use HMAC-SHA256
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(body)
    );

    const computedSignature = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    return computedSignature === signature;
  } catch (error) {
    console.error('Error validating signature:', error);
    return false;
  }
}
