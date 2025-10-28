/**
 * OpenPhone to Notion Sync - Main Worker
 * Webhook receiver and queue consumer
 *
 * Architecture:
 * - Durable Objects: Per-phone-number sync coordination (real-time)
 * - D1 Database: Analytics and sync history (reporting)
 * - Webhooks: Real-time event processing
 * - Cron: Periodic backfill and health checks
 */

import type { D1PreparedStatement, D1Result } from '@cloudflare/workers-types';
import type { Env, QueuedWebhookEvent } from './types/env';
import type { WebhookEvent } from './types/openphone';
import { createLogger } from './utils/logger';
import { isEventProcessed, markEventProcessed } from './utils/helpers';
import { invalidateCanvasMapping, normalizeCanvasLookup, type CanvasLookupType } from './utils/canvas-cache';

// Export Durable Object
export { PhoneNumberSync } from './durable-objects/phone-number-sync';

// Export Workflow
export { CallProcessingWorkflow } from './workflows/call-processing';

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

      // Debug Canvas lookup endpoint
      if (url.pathname === '/debug/canvas' && request.method === 'POST') {
        const { NotionClient } = await import('./utils/notion-client');
        const notionClient = new NotionClient(env, logger);

        const body = await request.json() as { phone?: string; email?: string };
        const result: any = { timestamp: new Date().toISOString() };

        if (body.phone) {
          logger.info('Testing Canvas lookup by phone', { phone: body.phone });
          result.phone = body.phone;
          result.canvasId = await notionClient.findCanvasByPhone(body.phone);
        }

        if (body.email) {
          logger.info('Testing Canvas lookup by email', { email: body.email });
          result.email = body.email;
          result.canvasIdByEmail = await notionClient.findCanvasByEmail(body.email);
        }

        return new Response(JSON.stringify(result, null, 2), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Debug database structure endpoint
      if (url.pathname === '/debug/schema' && request.method === 'GET') {
        const { NotionClient } = await import('./utils/notion-client');
        const notionClient = new NotionClient(env, logger);

        const debugInfo = await notionClient.getDebugInfo();
        const result = {
          timestamp: new Date().toISOString(),
          ...debugInfo,
        };

        return new Response(JSON.stringify(result, null, 2), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Merchant Retrieval API - Get all data for a merchant by Canvas ID
      if (url.pathname === '/api/merchant/canvas' && request.method === 'POST') {
        return await handleMerchantByCanvasAPI(request, env, logger);
      }

      // Merchant Retrieval API - Get all data for a merchant by phone number
      if (url.pathname === '/api/merchant/phone' && request.method === 'POST') {
        return await handleMerchantByPhoneAPI(request, env, logger);
      }

      // Merchant Retrieval API - Get all data for a merchant by email
      if (url.pathname === '/api/merchant/email' && request.method === 'POST') {
        return await handleMerchantByEmailAPI(request, env, logger);
      }

      // Merchant Retrieval API - Search merchants
      if (url.pathname === '/api/merchant/search' && request.method === 'POST') {
        return await handleMerchantSearchAPI(request, env, logger);
      }

      // Merchant Retrieval API - Get merchant summary
      if (url.pathname === '/api/merchant/summary' && request.method === 'POST') {
        return await handleMerchantSummaryAPI(request, env, logger);
      }

      // Backfill API - Trigger comprehensive backfill
      if (url.pathname === '/api/backfill/comprehensive' && request.method === 'POST') {
        return await handleComprehensiveBackfillAPI(request, env, logger, ctx);
      }

      // Dashboard API - Stats endpoint
      if (url.pathname === '/api/stats' && request.method === 'GET') {
        return await handleStatsAPI(env, logger);
      }

      // Dashboard API - Semantic search endpoint (enhanced with caching)
      if (url.pathname === '/api/search' && request.method === 'POST') {
        return await handleSearchAPI(request, env, logger);
      }

      // Dashboard API - RAG search endpoint (search with AI-generated answer)
      if (url.pathname === '/api/search/rag' && request.method === 'POST') {
        return await handleRAGSearchAPI(request, env, logger);
      }

      // Dashboard API - Query rewriting endpoint
      if (url.pathname === '/api/search/rewrite' && request.method === 'POST') {
        return await handleQueryRewriteAPI(request, env, logger);
      }

      // Dashboard API - Cache stats endpoint
      if (url.pathname === '/api/cache' && request.method === 'GET') {
        return await handleCacheAPI(env, logger);
      }

      if (url.pathname === '/api/canvas/cache/invalidate' && request.method === 'POST') {
        return await handleCanvasCacheInvalidateAPI(request, env, logger);
      }

      // Webhook endpoint
      if (url.pathname === env.WEBHOOK_PATH && request.method === 'POST') {
        return await handleWebhook(request, env, logger);
      }

      // API routes (should not serve dashboard for API routes)
      if (url.pathname.startsWith('/api/')) {
        return new Response('Not Found', { status: 404 });
      }

      // Serve dashboard from static assets
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }

      // Fallback if assets not configured
      return new Response('OpenPhone Notion Sync Worker - Dashboard not configured', {
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
    const kvLookupKey = `event:${payload.id}`;
    const kvLookupStart = Date.now();
    const isDuplicate = await isEventProcessed(env.SYNC_STATE, payload.id);
    logger.logKVOperation('SYNC_STATE', 'get', {
      key: kvLookupKey,
      hit: isDuplicate,
      durationMs: Date.now() - kvLookupStart,
    });

    if (isDuplicate) {
      logger.info('Duplicate webhook event, ignoring', { eventId: payload.id });
      return new Response('OK (duplicate)', { status: 200 });
    }

    // Mark event as received
    const kvMarkStart = Date.now();
    await markEventProcessed(env.SYNC_STATE, payload.id);
    logger.logKVOperation('SYNC_STATE', 'put', {
      key: kvLookupKey,
      durationMs: Date.now() - kvMarkStart,
    });

    // Queue the event for processing
    const queuedEvent: QueuedWebhookEvent = {
      id: payload.id,
      type: payload.type,
      timestamp: payload.createdAt,
      data: payload,
      retryCount: 0,
    };

    const enqueueTimer = logger.startTimer('queue.enqueue', {
      binding: 'WEBHOOK_EVENTS',
      queue: 'openphone-webhook-events',
      eventId: payload.id,
    });

    try {
      await env.WEBHOOK_EVENTS.send(queuedEvent);
      enqueueTimer('success');
    } catch (error) {
      enqueueTimer('error', {}, error);
      throw error;
    }

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
 * Handle stats API request for dashboard
 */
async function handleStatsAPI(
  env: Env,
  logger: typeof createLogger extends (...args: any[]) => infer R ? R : never
): Promise<Response> {
  try {
    async function runQuery<T>(
      operation: string,
      query: string,
      mode: 'first',
      binder?: (statement: D1PreparedStatement) => D1PreparedStatement
    ): Promise<T | null>;
    async function runQuery<T>(
      operation: string,
      query: string,
      mode: 'all',
      binder?: (statement: D1PreparedStatement) => D1PreparedStatement
    ): Promise<D1Result<T>>;
    async function runQuery<T>(
      operation: string,
      query: string,
      mode: 'first' | 'all',
      binder?: (statement: D1PreparedStatement) => D1PreparedStatement
    ): Promise<T | null | D1Result<T>> {
      const started = Date.now();

      try {
        let statement = env.DB.prepare(query);
        if (binder) {
          statement = binder(statement);
        }

        if (mode === 'first') {
          const result = await statement.first<T>();

          logger.logD1Query(operation, Date.now() - started, 'success', {
            mode,
            rows: result ? 1 : 0,
          });

          return result;
        }

        const result = await statement.all<T>();
        const rows = result.results.length;

        logger.logD1Query(operation, Date.now() - started, 'success', {
          mode,
          rows,
        });

        return result;
      } catch (error) {
        logger.logD1Query(operation, Date.now() - started, 'error', {
          mode,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    // Query D1 for statistics
    const callsResult = await runQuery<{ count: number }>(
      'sync_history.count_calls',
      'SELECT COUNT(*) as count FROM sync_history WHERE resource_type = ?',
      'first',
      (statement) => statement.bind('call')
    );

    const messagesResult = await runQuery<{ count: number }>(
      'sync_history.count_messages',
      'SELECT COUNT(*) as count FROM sync_history WHERE resource_type = ?',
      'first',
      (statement) => statement.bind('message')
    );

    const cacheResult = await runQuery<{ count: number; avg_hits: number | null }>(
      'canvas_cache.summary',
      'SELECT COUNT(*) as count, AVG(hit_count) as avg_hits FROM canvas_cache',
      'first'
    );

    const recentActivity = await runQuery<any>(
      'sync_history.recent_activity',
      'SELECT * FROM sync_history ORDER BY synced_at DESC LIMIT 10',
      'all'
    );

    const stats = {
      totalCalls: callsResult?.count || 0,
      totalMessages: messagesResult?.count || 0,
      aiAnalyzed: callsResult?.count || 0, // All calls are analyzed with AI
      cacheHitRate: 85, // Placeholder - would need to track this
      cachedCanvases: cacheResult?.count || 0,
      recentActivity: recentActivity.results?.map((row: any) => ({
        timestamp: row.synced_at,
        message: `${row.resource_type} ${row.resource_id} - ${row.sync_status}`,
        level: row.sync_status === 'failed' ? 'error' : 'info',
      })) || [],
    };

    return new Response(JSON.stringify(stats), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    logger.error('Failed to fetch stats', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch stats' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function handleCanvasCacheInvalidateAPI(
  request: Request,
  env: Env,
  logger: typeof createLogger extends (...args: any[]) => infer R ? R : never
): Promise<Response> {
  try {
    const body = await request.json() as {
      lookup: string;
      type: CanvasLookupType;
      reason?: string;
    };

    if (!body.lookup || (body.type !== 'phone' && body.type !== 'email')) {
      return new Response(JSON.stringify({ error: 'lookup and type (phone|email) are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const normalized = normalizeCanvasLookup(body.type, body.lookup);
    if (!normalized) {
      return new Response(JSON.stringify({ error: 'Lookup normalized to empty value' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await invalidateCanvasMapping(env, logger, body.type, body.lookup, body.reason);

    return new Response(
      JSON.stringify({
        status: 'invalidated',
        lookup: normalized,
        type: body.type,
        reason: body.reason || null,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    logger.error('Failed to invalidate Canvas cache entry', error);
    return new Response(JSON.stringify({ error: 'Failed to invalidate Canvas cache entry' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle semantic search API request
 */
async function handleSearchAPI(
  request: Request,
  env: Env,
  logger: typeof createLogger extends (...args: any[]) => infer R ? R : never
): Promise<Response> {
  try {
    const body = await request.json() as {
      query: string;
      topK?: number;
      type?: 'call' | 'message' | 'all';
      phoneNumber?: string;
      dateFrom?: string;
      dateTo?: string;
      useCache?: boolean;
      rewriteQuery?: boolean;
    };

    if (!body.query) {
      return new Response(JSON.stringify({ error: 'Query required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Use enhanced search with caching by default
    const { semanticSearchWithCache } = await import('./utils/vector-search');
    const results = await semanticSearchWithCache(
      body.query,
      {
        topK: body.topK || 10,
        type: body.type,
        phoneNumber: body.phoneNumber,
        dateFrom: body.dateFrom,
        dateTo: body.dateTo,
        useCache: body.useCache,
        rewriteQuery: body.rewriteQuery || false
      },
      env,
      logger
    );

    return new Response(JSON.stringify({
      results,
      cached: results.length > 0 // Indicator if results might be cached
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    logger.error('Search failed', error);
    return new Response(JSON.stringify({ error: 'Search failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle RAG search API - Search with AI-generated answers
 */
async function handleRAGSearchAPI(
  request: Request,
  env: Env,
  logger: typeof createLogger extends (...args: any[]) => infer R ? R : never
): Promise<Response> {
  try {
    const body = await request.json() as {
      query: string;
      topK?: number;
      type?: 'call' | 'message' | 'all';
      phoneNumber?: string;
      dateFrom?: string;
      dateTo?: string;
      useCache?: boolean;
      rewriteQuery?: boolean;
      systemPrompt?: string;
    };

    if (!body.query) {
      return new Response(JSON.stringify({ error: 'Query required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { searchWithAnswer } = await import('./utils/vector-search');
    const result = await searchWithAnswer(
      body.query,
      {
        topK: body.topK || 5,
        type: body.type,
        phoneNumber: body.phoneNumber,
        dateFrom: body.dateFrom,
        dateTo: body.dateTo,
        useCache: body.useCache,
        rewriteQuery: body.rewriteQuery || false,
        systemPrompt: body.systemPrompt
      },
      env,
      logger
    );

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    logger.error('RAG search failed', error);
    return new Response(JSON.stringify({ error: 'RAG search failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle query rewriting API - Optimize queries for better retrieval
 */
async function handleQueryRewriteAPI(
  request: Request,
  env: Env,
  logger: typeof createLogger extends (...args: any[]) => infer R ? R : never
): Promise<Response> {
  try {
    const body = await request.json() as { query: string };

    if (!body.query) {
      return new Response(JSON.stringify({ error: 'Query required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { rewriteQuery } = await import('./utils/vector-search');
    const rewritten = await rewriteQuery(body.query, env, logger);

    return new Response(JSON.stringify({
      original: body.query,
      rewritten
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    logger.error('Query rewriting failed', error);
    return new Response(JSON.stringify({ error: 'Query rewriting failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle cache stats API request
 */
async function handleCacheAPI(
  env: Env,
  logger: typeof createLogger extends (...args: any[]) => infer R ? R : never
): Promise<Response> {
  try {
    const { getCacheStats } = await import('./utils/smart-cache');
    const stats = await getCacheStats(env, logger);

    return new Response(JSON.stringify(stats), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    logger.error('Failed to fetch cache stats', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch cache stats' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle merchant by Canvas ID API request
 */
async function handleMerchantByCanvasAPI(
  request: Request,
  env: Env,
  logger: typeof createLogger extends (...args: any[]) => infer R ? R : never
): Promise<Response> {
  try {
    const body = await request.json() as { canvasId: string };
    if (!body.canvasId) {
      return new Response(JSON.stringify({ error: 'canvasId required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { getMerchantDataByCanvas } = await import('./api/merchant-retrieval');
    const data = await getMerchantDataByCanvas(body.canvasId, env, logger);

    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    logger.error('Merchant by Canvas API failed', error);
    return new Response(JSON.stringify({ error: 'Failed to retrieve merchant data' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle merchant by phone API request
 */
async function handleMerchantByPhoneAPI(
  request: Request,
  env: Env,
  logger: typeof createLogger extends (...args: any[]) => infer R ? R : never
): Promise<Response> {
  try {
    const body = await request.json() as { phoneNumber: string };
    if (!body.phoneNumber) {
      return new Response(JSON.stringify({ error: 'phoneNumber required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { getMerchantDataByPhone } = await import('./api/merchant-retrieval');
    const data = await getMerchantDataByPhone(body.phoneNumber, env, logger);

    if (!data) {
      return new Response(JSON.stringify({ error: 'No merchant found for phone number' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    logger.error('Merchant by phone API failed', error);
    return new Response(JSON.stringify({ error: 'Failed to retrieve merchant data' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle merchant by email API request
 */
async function handleMerchantByEmailAPI(
  request: Request,
  env: Env,
  logger: typeof createLogger extends (...args: any[]) => infer R ? R : never
): Promise<Response> {
  try {
    const body = await request.json() as { email: string };
    if (!body.email) {
      return new Response(JSON.stringify({ error: 'email required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { getMerchantDataByEmail } = await import('./api/merchant-retrieval');
    const data = await getMerchantDataByEmail(body.email, env, logger);

    if (!data) {
      return new Response(JSON.stringify({ error: 'No merchant found for email' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    logger.error('Merchant by email API failed', error);
    return new Response(JSON.stringify({ error: 'Failed to retrieve merchant data' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle merchant search API request
 */
async function handleMerchantSearchAPI(
  request: Request,
  env: Env,
  logger: typeof createLogger extends (...args: any[]) => infer R ? R : never
): Promise<Response> {
  try {
    const body = await request.json() as { query: string; topK?: number; dateFrom?: string; dateTo?: string };
    if (!body.query) {
      return new Response(JSON.stringify({ error: 'query required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { searchMerchants } = await import('./api/merchant-retrieval');
    const results = await searchMerchants(body.query, {
      topK: body.topK || 10,
      dateFrom: body.dateFrom,
      dateTo: body.dateTo,
    }, env, logger);

    return new Response(JSON.stringify({ results }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    logger.error('Merchant search API failed', error);
    return new Response(JSON.stringify({ error: 'Failed to search merchants' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle merchant summary API request
 */
async function handleMerchantSummaryAPI(
  request: Request,
  env: Env,
  logger: typeof createLogger extends (...args: any[]) => infer R ? R : never
): Promise<Response> {
  try {
    const body = await request.json() as { canvasId: string };
    if (!body.canvasId) {
      return new Response(JSON.stringify({ error: 'canvasId required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { getMerchantSummary } = await import('./api/merchant-retrieval');
    const summary = await getMerchantSummary(body.canvasId, env, logger);

    return new Response(JSON.stringify(summary), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    logger.error('Merchant summary API failed', error);
    return new Response(JSON.stringify({ error: 'Failed to get merchant summary' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle comprehensive backfill API request
 */
async function handleComprehensiveBackfillAPI(
  request: Request,
  env: Env,
  logger: typeof createLogger extends (...args: any[]) => infer R ? R : never,
  ctx: ExecutionContext
): Promise<Response> {
  try {
    const body = await request.json() as {
      daysBack?: number;
      includeAI?: boolean;
      includeVectorize?: boolean;
      reconcileCanvas?: boolean;
    };

    // Run backfill in background
    const { runComprehensiveBackfill } = await import('./processors/comprehensive-backfill');

    ctx.waitUntil(runComprehensiveBackfill(env, logger, body));

    return new Response(JSON.stringify({
      status: 'started',
      message: 'Comprehensive backfill started in background',
      options: body,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    logger.error('Comprehensive backfill API failed', error);
    return new Response(JSON.stringify({ error: 'Failed to start backfill' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
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
