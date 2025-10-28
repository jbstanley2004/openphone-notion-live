/**
 * Vectorize Integration for Semantic Search
 *
 * Enables semantic search across all calls and messages:
 * - "Find all calls about pricing"
 * - Similar call detection (duplicate leads)
 * - Content-based Canvas matching
 * - Trend analysis across conversations
 * - Query rewriting for better retrieval
 * - RAG-based response generation
 * - Similarity caching for performance
 */

import type { Env } from '../types/env';
import type { Call, Message, Mail } from '../types/openphone';
import type { Logger } from './logger';

export interface VectorMetadata {
  phoneNumber?: string;
  timestamp: string;
  notionPageId?: string;
  type: 'call' | 'message' | 'mail';
  direction?: string;
  canvasId?: string;
  merchantUuid?: string;
  merchantName?: string;
  interactionType?: 'call' | 'message' | 'mail';
}

export interface VectorSearchResult {
  id: string;
  score: number;
  metadata: {
    phoneNumber?: string;
    timestamp: string;
    notionPageId?: string;
    type: 'call' | 'message';
    direction?: string;
    merchantUuid?: string | null;
    canvasId?: string | null;
  };
  metadata: VectorMetadata;
}

interface VectorMetadataContext {
  canvasId?: string | null;
  merchantUuid?: string | null;
  merchantName?: string | null;
}

export interface RAGSearchResult {
  answer: string;
  sources: VectorSearchResult[];
  originalQuery: string;
  rewrittenQuery?: string;
  cached: boolean;
}

/**
 * Index a call in Vectorize for semantic search
 */
export async function indexCall(
  call: Call,
  transcript: string | undefined,
  summary: string | undefined,
  notionPageId: string,
  merchantUuid: string | null,
  canvasId: string | null,
  env: Env,
  logger: Logger,
  context: VectorMetadataContext = {}
): Promise<void> {
  try {
    // Build searchable text from call data
    const searchableText = buildCallSearchText(call, transcript, summary);

    // Generate embeddings using Workers AI
    const embeddings = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
      text: [searchableText],
    }) as { data: number[][] };

    if (!embeddings?.data?.[0]) {
      logger.warn('No embeddings generated for call', { callId: call.id });
      return;
    }

    // Store in Vectorize
    const metadata: Record<string, any> = {
      phoneNumber: call.participants[0] || '',
      timestamp: call.createdAt,
      notionPageId,
      type: 'call',
      direction: call.direction,
      interactionType: 'call',
    };

    if (context.canvasId) {
      metadata.canvasId = context.canvasId;
    }
    const merchantUuid = context.merchantUuid ?? context.canvasId;
    if (merchantUuid) {
      metadata.merchantUuid = merchantUuid;
    }
    if (context.merchantName) {
      metadata.merchantName = context.merchantName;
    }

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
          ...(merchantUuid ? { merchantUuid } : {}),
          ...(canvasId ? { canvasId } : {}),
        },
        metadata,
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
  merchantUuid: string | null,
  canvasId: string | null,
  env: Env,
  logger: Logger,
  context: VectorMetadataContext = {}
): Promise<void> {
  try {
    const searchableText = buildMessageSearchText(message, summary);

    const embeddings = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
      text: [searchableText],
    }) as { data: number[][] };

    if (!embeddings?.data?.[0]) {
      logger.warn('No embeddings generated for message', { messageId: message.id });
      return;
    }

    const metadata: Record<string, any> = {
      phoneNumber: message.from,
      timestamp: message.createdAt,
      notionPageId,
      type: 'message',
      direction: message.direction,
      interactionType: 'message',
    };

    if (context.canvasId) {
      metadata.canvasId = context.canvasId;
    }
    const merchantUuid = context.merchantUuid ?? context.canvasId;
    if (merchantUuid) {
      metadata.merchantUuid = merchantUuid;
    }
    if (context.merchantName) {
      metadata.merchantName = context.merchantName;
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
          ...(merchantUuid ? { merchantUuid } : {}),
          ...(canvasId ? { canvasId } : {}),
        },
        metadata,
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
 * Index a mail item in Vectorize for semantic search
 */
export async function indexMail(
  mail: Mail,
  summary: string | undefined,
  notionPageId: string,
  env: Env,
  logger: Logger,
  context: VectorMetadataContext = {}
): Promise<void> {
  try {
    const searchableText = buildMailSearchText(mail, summary);

    const embeddings = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
      text: [searchableText],
    }) as { data: number[][] };

    if (!embeddings?.data?.[0]) {
      logger.warn('No embeddings generated for mail', { mailId: mail.id });
      return;
    }

    const metadata: Record<string, any> = {
      phoneNumber: mail.from,
      timestamp: mail.createdAt,
      notionPageId,
      type: 'mail',
      direction: mail.direction,
      interactionType: 'mail',
    };

    if (context.canvasId) {
      metadata.canvasId = context.canvasId;
    }
    const merchantUuid = context.merchantUuid ?? context.canvasId;
    if (merchantUuid) {
      metadata.merchantUuid = merchantUuid;
    }
    if (context.merchantName) {
      metadata.merchantName = context.merchantName;
    }

    await env.CALL_VECTORS.upsert([
      {
        id: `mail:${mail.id}`,
        values: embeddings.data[0],
        metadata,
      },
    ]);

    logger.info('Mail indexed in Vectorize', { mailId: mail.id });
  } catch (error) {
    logger.error('Failed to index mail in Vectorize', {
      mailId: mail.id,
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
  try {
    const startTime = Date.now();

    // Generate query embeddings
    const embeddings = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
      text: [query],
    }) as { data: number[][] };

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
        if (!match.metadata?.timestamp) return false;
        const timestamp = new Date(match.metadata.timestamp as string).getTime();
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
      metadata: ((match.metadata as unknown) || {}) as VectorMetadata,
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
      metadata: ((match.metadata as unknown) || {}) as VectorMetadata,
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
    }) as { data: number[][] };

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
      .map((match) => match.metadata?.notionPageId as string)
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
// AI Search Enhancements
// ========================================================================

/**
 * Rewrite a user query to optimize it for better retrieval
 * Uses LLM to expand, clarify, and optimize the search query
 */
export async function rewriteQuery(
  query: string,
  env: Env,
  logger: Logger
): Promise<string> {
  try {
    const response = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        {
          role: 'system',
          content: `You are a search query optimizer for a business phone call database. Your task is to rewrite user queries to improve semantic search retrieval.

Rules:
- Expand abbreviations and acronyms
- Add relevant synonyms and related terms
- Clarify ambiguous terms
- Keep queries concise (max 2-3 sentences)
- Focus on business communication context
- Output ONLY the rewritten query, no explanation

Examples:
Input: "pricing calls"
Output: "calls discussing pricing, quotes, cost, rates, payment terms, and billing information"

Input: "angry customers"
Output: "calls with frustrated, upset, dissatisfied customers expressing complaints, issues, or negative feedback"

Input: "follow up needed"
Output: "calls requiring follow-up action, callbacks, additional information, or unresolved issues needing attention"`
        },
        {
          role: 'user',
          content: query
        }
      ],
      max_tokens: 150
    }) as { response: string };

    const rewrittenQuery = response.response.trim();

    logger.info('Query rewritten', {
      original: query,
      rewritten: rewrittenQuery
    });

    return rewrittenQuery;
  } catch (error) {
    logger.error('Query rewriting failed, using original', {
      query,
      error: String(error)
    });
    return query; // Fall back to original query
  }
}

/**
 * Generate a cache key for similarity caching
 * Uses hash of query for efficient lookup
 */
async function generateQueryCacheKey(
  query: string,
  options: {
    topK?: number;
    type?: string;
    phoneNumber?: string;
    dateFrom?: string;
    dateTo?: string;
  }
): Promise<string> {
  const cacheInput = JSON.stringify({ query, ...options });
  // Use Web Crypto API (available in Cloudflare Workers)
  const encoder = new TextEncoder();
  const data = encoder.encode(cacheInput);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
  return `search:v1:${hash}`;
}

/**
 * Enhanced semantic search with similarity caching
 * Caches results for 1 hour to improve performance for repeated queries
 */
export async function semanticSearchWithCache(
  query: string,
  options: {
    topK?: number;
    type?: 'call' | 'message' | 'all';
    phoneNumber?: string;
    dateFrom?: string;
    dateTo?: string;
    useCache?: boolean;
    rewriteQuery?: boolean;
  },
  env: Env,
  logger: Logger
): Promise<VectorSearchResult[]> {
  const useCache = options.useCache !== false; // Default to true
  const cacheKey = await generateQueryCacheKey(query, options);

  // Check cache first
  if (useCache) {
    try {
      const cached = await env.CACHE.get(cacheKey, 'json') as VectorSearchResult[] | null;
      if (cached) {
        logger.info('Search results retrieved from cache', {
          query,
          resultCount: cached.length,
          cacheKey
        });
        return cached;
      }
    } catch (error) {
      logger.warn('Cache retrieval failed, performing fresh search', {
        error: String(error)
      });
    }
  }

  // Optionally rewrite query for better retrieval
  let searchQuery = query;
  if (options.rewriteQuery) {
    searchQuery = await rewriteQuery(query, env, logger);
  }

  // Perform search
  const results = await semanticSearch(searchQuery, options, env, logger);

  // Cache results for 1 hour
  if (useCache && results.length > 0) {
    try {
      await env.CACHE.put(cacheKey, JSON.stringify(results), {
        expirationTtl: 3600 // 1 hour
      });
      logger.info('Search results cached', {
        query,
        resultCount: results.length,
        cacheKey
      });
    } catch (error) {
      logger.warn('Failed to cache results', {
        error: String(error)
      });
    }
  }

  return results;
}

/**
 * RAG (Retrieval Augmented Generation) search
 * Performs semantic search and generates an AI answer based on the results
 */
export async function searchWithAnswer(
  query: string,
  options: {
    topK?: number;
    type?: 'call' | 'message' | 'all';
    phoneNumber?: string;
    dateFrom?: string;
    dateTo?: string;
    useCache?: boolean;
    rewriteQuery?: boolean;
    systemPrompt?: string;
  },
  env: Env,
  logger: Logger
): Promise<RAGSearchResult> {
  const startTime = Date.now();
  const useCache = options.useCache !== false;
  const originalQuery = query;

  // Generate cache key for the entire RAG response
  const baseCacheKey = await generateQueryCacheKey(query, options);
  const ragCacheKey = `rag:v1:${baseCacheKey}`;

  // Check if we have a cached RAG response
  if (useCache) {
    try {
      const cached = await env.CACHE.get(ragCacheKey, 'json') as RAGSearchResult | null;
      if (cached) {
        logger.info('RAG response retrieved from cache', {
          query,
          cacheKey: ragCacheKey,
          duration: Date.now() - startTime
        });
        return { ...cached, cached: true };
      }
    } catch (error) {
      logger.warn('RAG cache retrieval failed', { error: String(error) });
    }
  }

  // Perform semantic search with caching
  const results = await semanticSearchWithCache(
    query,
    {
      ...options,
      topK: options.topK || 5 // Default to 5 for RAG context
    },
    env,
    logger
  );

  if (results.length === 0) {
    const noResultsResponse: RAGSearchResult = {
      answer: "I couldn't find any relevant calls or messages matching your query. Try rephrasing your search or broadening the criteria.",
      sources: [],
      originalQuery,
      cached: false
    };
    return noResultsResponse;
  }

  // Build context from search results
  // We need to fetch the actual content from the results
  const contextParts: string[] = [];

  for (const result of results.slice(0, 5)) { // Limit to top 5 for context
    const parts: string[] = [
      `[${result.metadata.type === 'call' ? 'Call' : 'Message'} - Score: ${result.score.toFixed(2)}]`,
      `Phone: ${result.metadata.phoneNumber || 'Unknown'}`,
      `Date: ${new Date(result.metadata.timestamp).toLocaleString()}`,
      `Direction: ${result.metadata.direction || 'Unknown'}`,
      `ID: ${result.id}`
    ];
    contextParts.push(parts.join(' | '));
  }

  const context = contextParts.join('\n\n');

  // Generate AI response using the context
  const systemPrompt = options.systemPrompt || `You are an AI assistant helping analyze business phone calls and messages.
You have access to a database of calls and messages and can provide insights based on the retrieved information.

When answering:
- Be concise and specific
- Reference the call/message details when relevant
- If multiple calls match, summarize the common themes
- Always base your answer on the provided context
- If the context doesn't fully answer the question, acknowledge this`;

  try {
    const response = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: `Based on the following search results, answer this question: "${query}"

Search Results:
${context}

Provide a clear, concise answer based on these results.`
        }
      ],
      max_tokens: 500
    }) as { response: string };

    const answer = response.response.trim();
    const rewrittenQuery = options.rewriteQuery ? await rewriteQuery(query, env, logger) : undefined;

    const ragResult: RAGSearchResult = {
      answer,
      sources: results,
      originalQuery,
      rewrittenQuery,
      cached: false
    };

    // Cache the RAG response
    if (useCache) {
      try {
        await env.CACHE.put(ragCacheKey, JSON.stringify(ragResult), {
          expirationTtl: 3600 // 1 hour
        });
        logger.info('RAG response cached', {
          query,
          cacheKey: ragCacheKey
        });
      } catch (error) {
        logger.warn('Failed to cache RAG response', { error: String(error) });
      }
    }

    const duration = Date.now() - startTime;
    logger.info('RAG search completed', {
      query,
      sourceCount: results.length,
      answerLength: answer.length,
      durationMs: duration
    });

    return ragResult;
  } catch (error) {
    logger.error('RAG answer generation failed', {
      query,
      error: String(error)
    });

    // Return results without AI-generated answer
    return {
      answer: `Found ${results.length} relevant results, but failed to generate an answer. Please review the sources directly.`,
      sources: results,
      originalQuery,
      cached: false
    };
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

  if (message.text) {
    parts.push(message.text);
  }

  return parts.join('\n').slice(0, 8000);
}

function buildMailSearchText(mail: Mail, summary: string | undefined): string {
  const parts = [
    `Mail ${mail.direction ?? 'unknown'}`,
    `From: ${mail.from}`,
    `To: ${(mail.to ?? []).join(', ')}`,
    `Subject: ${mail.subject}`,
  ];

  if (summary) {
    parts.push(summary);
  }

  if (mail.body) {
    parts.push(mail.body);
  }

  return parts.join('\n').slice(0, 8000);
}
