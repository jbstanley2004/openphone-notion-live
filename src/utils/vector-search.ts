/**
 * Vectorize Integration for Semantic Search
 *
 * Enables semantic search across all calls and messages:
 * - "Find all calls about pricing"
 * - Similar call detection (duplicate leads)
 * - Content-based Canvas matching
 * - Trend analysis across conversations
 */

import type { Env } from '../types/env';
import type { Call, Message } from '../types/openphone';
import type { Logger } from './logger';

export interface VectorSearchResult {
  id: string;
  score: number;
  metadata: {
    phoneNumber?: string;
    timestamp: string;
    notionPageId?: string;
    type: 'call' | 'message';
    direction?: string;
  };
}

/**
 * Index a call in Vectorize for semantic search
 */
export async function indexCall(
  call: Call,
  transcript: string | undefined,
  summary: string | undefined,
  notionPageId: string,
  env: Env,
  logger: Logger
): Promise<void> {
  // Check if Vectorize is available
  if (!env.CALL_VECTORS) {
    logger.debug('Vectorize not configured, skipping indexing', { callId: call.id });
    return;
  }

  try {
    // Build searchable text from call data
    const searchableText = buildCallSearchText(call, transcript, summary);

    // Generate embeddings using Workers AI
    const embeddings = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
      text: [searchableText],
    });

    if (!embeddings?.data?.[0]) {
      logger.warn('No embeddings generated for call', { callId: call.id });
      return;
    }

    // Store in Vectorize
    await env.CALL_VECTORS.upsert([
      {
        id: `call:${call.id}`,
        values: embeddings.data[0],
        metadata: {
          phoneNumber: call.participants[0] || '',
          timestamp: call.createdAt,
          notionPageId,
          type: 'call',
          direction: call.direction,
        },
      },
    ]);

    logger.info('Call indexed in Vectorize', { callId: call.id });
  } catch (error) {
    logger.error('Failed to index call in Vectorize', {
      callId: call.id,
      error: String(error),
    });
  }
}

/**
 * Index a message in Vectorize for semantic search
 */
export async function indexMessage(
  message: Message,
  summary: string | undefined,
  notionPageId: string,
  env: Env,
  logger: Logger
): Promise<void> {
  // Check if Vectorize is available
  if (!env.CALL_VECTORS) {
    logger.debug('Vectorize not configured, skipping indexing', { messageId: message.id });
    return;
  }

  try {
    const searchableText = buildMessageSearchText(message, summary);

    const embeddings = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
      text: [searchableText],
    });

    if (!embeddings?.data?.[0]) {
      logger.warn('No embeddings generated for message', { messageId: message.id });
      return;
    }

    await env.CALL_VECTORS.upsert([
      {
        id: `message:${message.id}`,
        values: embeddings.data[0],
        metadata: {
          phoneNumber: message.from,
          timestamp: message.createdAt,
          notionPageId,
          type: 'message',
          direction: message.direction,
        },
      },
    ]);

    logger.info('Message indexed in Vectorize', { messageId: message.id });
  } catch (error) {
    logger.error('Failed to index message in Vectorize', {
      messageId: message.id,
      error: String(error),
    });
  }
}

/**
 * Perform semantic search across all calls and messages
 */
export async function semanticSearch(
  query: string,
  options: {
    topK?: number;
    type?: 'call' | 'message' | 'all';
    phoneNumber?: string;
    dateFrom?: string;
    dateTo?: string;
  },
  env: Env,
  logger: Logger
): Promise<VectorSearchResult[]> {
  // Check if Vectorize is available
  if (!env.CALL_VECTORS) {
    logger.debug('Vectorize not configured, skipping search');
    return [];
  }

  try {
    const startTime = Date.now();

    // Generate query embeddings
    const embeddings = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
      text: [query],
    });

    if (!embeddings?.data?.[0]) {
      logger.warn('No embeddings generated for query', { query });
      return [];
    }

    // Build filter based on options
    const filter: any = {};
    if (options.type && options.type !== 'all') {
      filter.type = options.type;
    }
    if (options.phoneNumber) {
      filter.phoneNumber = options.phoneNumber;
    }

    // Perform vector search
    const results = await env.CALL_VECTORS.query(embeddings.data[0], {
      topK: options.topK || 10,
      returnValues: false,
      returnMetadata: true,
      filter: Object.keys(filter).length > 0 ? filter : undefined,
    });

    // Filter by date range if specified
    let filteredResults = results.matches || [];
    if (options.dateFrom || options.dateTo) {
      filteredResults = filteredResults.filter((match) => {
        const timestamp = new Date(match.metadata.timestamp).getTime();
        if (options.dateFrom && timestamp < new Date(options.dateFrom).getTime()) {
          return false;
        }
        if (options.dateTo && timestamp > new Date(options.dateTo).getTime()) {
          return false;
        }
        return true;
      });
    }

    const duration = Date.now() - startTime;
    logger.info('Semantic search completed', {
      query,
      resultCount: filteredResults.length,
      durationMs: duration,
    });

    return filteredResults.map((match) => ({
      id: match.id,
      score: match.score,
      metadata: match.metadata as any,
    }));
  } catch (error) {
    logger.error('Semantic search failed', { query, error: String(error) });
    return [];
  }
}

/**
 * Find similar calls to detect duplicate leads or related conversations
 */
export async function findSimilarCalls(
  callId: string,
  topK: number,
  env: Env,
  logger: Logger
): Promise<VectorSearchResult[]> {
  // Check if Vectorize is available
  if (!env.CALL_VECTORS) {
    logger.debug('Vectorize not configured, skipping similar search');
    return [];
  }

  try {
    // Get the call's vector
    const callVector = await env.CALL_VECTORS.getByIds([`call:${callId}`]);

    if (!callVector || callVector.length === 0) {
      logger.warn('Call not found in vector index', { callId });
      return [];
    }

    // Find similar vectors
    const results = await env.CALL_VECTORS.query(callVector[0].values, {
      topK: topK + 1, // +1 to exclude the call itself
      returnValues: false,
      returnMetadata: true,
      filter: { type: 'call' },
    });

    // Remove the original call from results
    const similarCalls = (results.matches || [])
      .filter((match) => match.id !== `call:${callId}`)
      .slice(0, topK);

    logger.info('Found similar calls', {
      callId,
      similarCount: similarCalls.length,
    });

    return similarCalls.map((match) => ({
      id: match.id.replace('call:', ''),
      score: match.score,
      metadata: match.metadata as any,
    }));
  } catch (error) {
    logger.error('Failed to find similar calls', { callId, error: String(error) });
    return [];
  }
}

/**
 * Get trending topics from recent calls/messages
 */
export async function getTrendingTopics(
  dateFrom: string,
  limit: number,
  env: Env,
  logger: Logger
): Promise<string[]> {
  // This is a placeholder for trending analysis
  // In a real implementation, you might:
  // 1. Fetch recent embeddings
  // 2. Cluster them
  // 3. Extract representative keywords from each cluster
  // For now, we'll return an empty array

  logger.info('Trending topics analysis requested', { dateFrom, limit });
  return [];
}

/**
 * Smart Canvas matching using semantic similarity
 */
export async function findCanvasBySemantic(
  callContext: string,
  env: Env,
  logger: Logger
): Promise<string | null> {
  try {
    // Generate embeddings for the call context
    const embeddings = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
      text: [callContext],
    });

    if (!embeddings?.data?.[0]) {
      return null;
    }

    // Search for similar past calls
    const results = await env.CALL_VECTORS.query(embeddings.data[0], {
      topK: 5,
      returnValues: false,
      returnMetadata: true,
    });

    // Find the most common Canvas ID from similar calls
    const canvasIds = (results.matches || [])
      .map((match) => match.metadata.notionPageId)
      .filter((id) => id);

    if (canvasIds.length === 0) {
      return null;
    }

    // Return the most frequent Canvas ID
    const canvasFreq = new Map<string, number>();
    for (const id of canvasIds) {
      canvasFreq.set(id, (canvasFreq.get(id) || 0) + 1);
    }

    const mostFrequent = Array.from(canvasFreq.entries()).sort((a, b) => b[1] - a[1])[0];

    logger.info('Canvas found via semantic matching', {
      canvasId: mostFrequent[0],
      confidence: mostFrequent[1] / canvasIds.length,
    });

    return mostFrequent[0];
  } catch (error) {
    logger.error('Semantic Canvas matching failed', { error: String(error) });
    return null;
  }
}

// ========================================================================
// Private Helper Functions
// ========================================================================

function buildCallSearchText(
  call: Call,
  transcript: string | undefined,
  summary: string | undefined
): string {
  const parts = [
    `Call ${call.direction}`,
    `Participants: ${call.participants.join(', ')}`,
    `Duration: ${call.duration} seconds`,
  ];

  if (summary) {
    parts.push(summary);
  }

  if (transcript) {
    parts.push(transcript);
  }

  return parts.join('\n').slice(0, 8000); // Limit to ~8k chars for embedding model
}

function buildMessageSearchText(message: Message, summary: string | undefined): string {
  const parts = [
    `Message ${message.direction}`,
    `From: ${message.from}`,
    `To: ${message.to.join(', ')}`,
  ];

  if (summary) {
    parts.push(summary);
  }

  if (message.body) {
    parts.push(message.body);
  }

  return parts.join('\n').slice(0, 8000);
}
