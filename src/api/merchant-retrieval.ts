/**
 * Merchant-Based Data Retrieval API
 *
 * Enables easy retrieval and segmentation of all data for a specific merchant/Canvas:
 * - All calls for merchant X
 * - All messages for merchant X
 * - All mail for merchant X
 * - Canvas record for merchant X
 * - Combined timeline view
 */

import type { Env } from '../types/env';
import type { Logger } from '../utils/logger';
import { semanticSearch } from '../utils/vector-search';

export interface MerchantData {
  canvasId: string;
  canvas: any; // Canvas Notion page
  calls: any[]; // All calls for this merchant
  messages: any[]; // All messages for this merchant
  mail: any[]; // All mail for this merchant
  timeline: TimelineEntry[]; // Combined chronological timeline
  stats: {
    totalCalls: number;
    totalMessages: number;
    totalMail: number;
    totalInteractions: number;
    firstInteraction: string;
    lastInteraction: string;
    avgSentiment?: string;
    avgLeadScore?: number;
  };
}

export interface TimelineEntry {
  type: 'call' | 'message' | 'mail';
  id: string;
  timestamp: string;
  notionPageId: string;
  summary: string;
  sentiment?: string;
  direction?: string;
}

/**
 * Get all data for a specific merchant by Canvas ID
 */
export async function getMerchantDataByCanvas(
  canvasId: string,
  env: Env,
  logger: Logger
): Promise<MerchantData> {
  logger.info('Retrieving merchant data by Canvas ID', { canvasId });

  try {
    // Import Notion client
    const { NotionClient } = await import('../utils/notion-client');
    const notionClient = new NotionClient(env, logger);

    // 1. Get Canvas page
    const canvas = await notionClient.getPage(canvasId);

    // 2. Query all Calls with this Canvas relation
    const calls = await notionClient.queryDatabase(env.NOTION_CALLS_DATABASE_ID, {
      filter: {
        property: 'Canvas',
        relation: {
          contains: canvasId,
        },
      },
    });

    // 3. Query all Messages with this Canvas relation
    const messages = await notionClient.queryDatabase(env.NOTION_MESSAGES_DATABASE_ID, {
      filter: {
        property: 'Canvas',
        relation: {
          contains: canvasId,
        },
      },
    });

    // 4. Query all Mail with this Canvas relation
    const mail = await notionClient.queryDatabase(env.NOTION_MAIL_DATABASE_ID, {
      filter: {
        property: 'Canvas',
        relation: {
          contains: canvasId,
        },
      },
    });

    // 5. Build timeline
    const timeline = buildTimeline(calls, messages, mail);

    // 6. Calculate stats
    const stats = calculateStats(calls, messages, mail, timeline);

    logger.info('Merchant data retrieved', {
      canvasId,
      callCount: calls.length,
      messageCount: messages.length,
      mailCount: mail.length,
    });

    return {
      canvasId,
      canvas,
      calls,
      messages,
      mail,
      timeline,
      stats,
    };
  } catch (error) {
    logger.error('Failed to retrieve merchant data', { canvasId, error });
    throw error;
  }
}

/**
 * Get all data for a merchant by phone number
 */
export async function getMerchantDataByPhone(
  phoneNumber: string,
  env: Env,
  logger: Logger
): Promise<MerchantData | null> {
  logger.info('Retrieving merchant data by phone number', { phoneNumber });

  try {
    const { NotionClient } = await import('../utils/notion-client');
    const notionClient = new NotionClient(env, logger);

    // Find Canvas by phone number
    const canvasId = await notionClient.findCanvasByPhone(phoneNumber);

    if (!canvasId) {
      logger.warn('No Canvas found for phone number', { phoneNumber });
      return null;
    }

    // Get data using Canvas ID
    return await getMerchantDataByCanvas(canvasId, env, logger);
  } catch (error) {
    logger.error('Failed to retrieve merchant data by phone', { phoneNumber, error });
    throw error;
  }
}

/**
 * Get all data for a merchant by email
 */
export async function getMerchantDataByEmail(
  email: string,
  env: Env,
  logger: Logger
): Promise<MerchantData | null> {
  logger.info('Retrieving merchant data by email', { email });

  try {
    const { NotionClient } = await import('../utils/notion-client');
    const notionClient = new NotionClient(env, logger);

    // Find Canvas by email
    const canvasId = await notionClient.findCanvasByEmail(email);

    if (!canvasId) {
      logger.warn('No Canvas found for email', { email });
      return null;
    }

    // Get data using Canvas ID
    return await getMerchantDataByCanvas(canvasId, env, logger);
  } catch (error) {
    logger.error('Failed to retrieve merchant data by email', { email, error });
    throw error;
  }
}

/**
 * Search for merchants using semantic search
 */
export async function searchMerchants(
  query: string,
  options: {
    topK?: number;
    dateFrom?: string;
    dateTo?: string;
  },
  env: Env,
  logger: Logger
): Promise<{ canvasId: string; relevance: number; preview: string }[]> {
  logger.info('Searching merchants', { query });

  try {
    // Use semantic search to find relevant interactions
    const results = await semanticSearch(query, options, env, logger);

    // Group by Canvas ID and aggregate relevance scores
    const canvasMap = new Map<string, { relevance: number; preview: string }>();

    for (const result of results) {
      if (!result.metadata.notionPageId) continue;

      // Get Canvas ID from the page
      // TODO: This would need to query Notion to get the Canvas relation
      // For now, use a placeholder
      const canvasId = 'placeholder';

      const existing = canvasMap.get(canvasId);
      if (existing) {
        existing.relevance = Math.max(existing.relevance, result.score);
      } else {
        canvasMap.set(canvasId, {
          relevance: result.score,
          preview: `Match in ${result.metadata.type} from ${result.metadata.timestamp}`,
        });
      }
    }

    // Convert to array and sort by relevance
    const merchants = Array.from(canvasMap.entries())
      .map(([canvasId, data]) => ({
        canvasId,
        relevance: data.relevance,
        preview: data.preview,
      }))
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, options.topK || 10);

    logger.info('Merchants found', { count: merchants.length });
    return merchants;
  } catch (error) {
    logger.error('Merchant search failed', { query, error });
    throw error;
  }
}

/**
 * Get interaction summary for a merchant
 */
export async function getMerchantSummary(
  canvasId: string,
  env: Env,
  logger: Logger
): Promise<{
  canvasId: string;
  name: string;
  phone?: string;
  email?: string;
  totalInteractions: number;
  lastContact: string;
  nextAction?: string;
  sentiment: string;
  leadScore?: number;
  tags: string[];
}> {
  logger.info('Getting merchant summary', { canvasId });

  try {
    const data = await getMerchantDataByCanvas(canvasId, env, logger);

    // Extract name, phone, email from Canvas
    const canvas = data.canvas;
    const name = canvas.properties?.Name?.title?.[0]?.plain_text || 'Unknown';
    const phone = canvas.properties?.Phone?.phone_number || undefined;
    const email = canvas.properties?.Email?.email || undefined;

    // Get next action from most recent AI analysis
    const recentCalls = data.calls.slice(0, 5);
    const actionItems = recentCalls
      .map((call) => call.properties?.['AI Action Items']?.rich_text?.[0]?.plain_text)
      .filter(Boolean);

    const nextAction = actionItems[0] || undefined;

    // Extract tags/categories
    const tags = new Set<string>();
    data.calls.forEach((call) => {
      const category = call.properties?.['AI Category']?.select?.name;
      if (category) tags.add(category);
    });

    return {
      canvasId,
      name,
      phone,
      email,
      totalInteractions: data.stats.totalInteractions,
      lastContact: data.stats.lastInteraction,
      nextAction,
      sentiment: data.stats.avgSentiment || 'neutral',
      leadScore: data.stats.avgLeadScore,
      tags: Array.from(tags),
    };
  } catch (error) {
    logger.error('Failed to get merchant summary', { canvasId, error });
    throw error;
  }
}

// ========================================================================
// Helper Functions
// ========================================================================

function buildTimeline(calls: any[], messages: any[], mail: any[]): TimelineEntry[] {
  const timeline: TimelineEntry[] = [];

  // Add calls
  calls.forEach((call) => {
    timeline.push({
      type: 'call',
      id: call.properties?.['Call ID']?.title?.[0]?.plain_text || call.id,
      timestamp: call.properties?.['Created At']?.date?.start || call.created_time,
      notionPageId: call.id,
      summary: call.properties?.['AI Summary']?.rich_text?.[0]?.plain_text || 'Call',
      sentiment: call.properties?.['AI Sentiment']?.select?.name,
      direction: call.properties?.Direction?.select?.name,
    });
  });

  // Add messages
  messages.forEach((message) => {
    timeline.push({
      type: 'message',
      id: message.properties?.['Message ID']?.title?.[0]?.plain_text || message.id,
      timestamp: message.properties?.['Created At']?.date?.start || message.created_time,
      notionPageId: message.id,
      summary: message.properties?.Body?.rich_text?.[0]?.plain_text?.slice(0, 100) || 'Message',
      sentiment: message.properties?.['AI Sentiment']?.select?.name,
      direction: message.properties?.Direction?.select?.name,
    });
  });

  // Add mail
  mail.forEach((email) => {
    timeline.push({
      type: 'mail',
      id: email.id,
      timestamp: email.properties?.['Received At']?.date?.start || email.created_time,
      notionPageId: email.id,
      summary: email.properties?.Subject?.title?.[0]?.plain_text || 'Email',
    });
  });

  // Sort by timestamp (most recent first)
  timeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return timeline;
}

function calculateStats(
  calls: any[],
  messages: any[],
  mail: any[],
  timeline: TimelineEntry[]
) {
  const totalCalls = calls.length;
  const totalMessages = messages.length;
  const totalMail = mail.length;
  const totalInteractions = totalCalls + totalMessages + totalMail;

  const firstInteraction = timeline.length > 0 ? timeline[timeline.length - 1].timestamp : '';
  const lastInteraction = timeline.length > 0 ? timeline[0].timestamp : '';

  // Calculate average sentiment
  const sentiments = calls
    .map((call) => call.properties?.['AI Sentiment']?.select?.name)
    .filter(Boolean);

  const sentimentCounts = sentiments.reduce(
    (acc, s) => {
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const sentimentEntries = Object.entries(sentimentCounts) as Array<[string, number]>;
  const avgSentiment = sentimentEntries.sort((a, b) => b[1] - a[1])[0]?.[0] || 'neutral';

  // Calculate average lead score
  const leadScores = calls
    .map((call) => call.properties?.['AI Lead Score']?.number)
    .filter((score): score is number => typeof score === 'number');

  const avgLeadScore =
    leadScores.length > 0
      ? leadScores.reduce((a, b) => a + b, 0) / leadScores.length
      : undefined;

  return {
    totalCalls,
    totalMessages,
    totalMail,
    totalInteractions,
    firstInteraction,
    lastInteraction,
    avgSentiment,
    avgLeadScore,
  };
}
