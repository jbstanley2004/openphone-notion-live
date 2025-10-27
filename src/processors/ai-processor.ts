/**
 * Workers AI Integration for Intelligent Call Analysis
 *
 * Uses Cloudflare Workers AI for:
 * - Sentiment analysis
 * - Automatic summarization
 * - Action item extraction
 * - Call categorization
 * - Lead scoring
 */

import type { Env } from '../types/env';
import type { Call, Message } from '../types/openphone';
import type { Logger } from '../utils/logger';

export interface CallAnalysis {
  sentiment: {
    label: string; // positive, negative, neutral
    score: number; // confidence score
  };
  summary: string;
  actionItems: string[];
  category: string;
  leadScore?: number;
  keywords: string[];
}

export interface MessageAnalysis {
  sentiment: {
    label: string;
    score: number;
  };
  summary: string;
  actionItems: string[];
  category: string;
}

/**
 * Analyze call using Workers AI
 */
export async function analyzeCallWithAI(
  call: Call,
  transcript: string | undefined,
  env: Env,
  logger: Logger
): Promise<CallAnalysis> {
  const startTime = Date.now();

  try {
    // Build analysis context from call data
    const context = buildCallContext(call, transcript);

    // Run AI models in parallel for efficiency
    const [sentiment, summary, actionItems] = await Promise.all([
      analyzeSentiment(context, env),
      generateSummary(context, env),
      extractActionItems(context, env),
    ]);

    // Categorize and score the call
    const category = await categorizeCall(context, env);
    const leadScore = calculateLeadScore(call, sentiment, actionItems);
    const keywords = extractKeywords(context);

    const duration = Date.now() - startTime;
    logger.info('AI analysis completed', {
      callId: call.id,
      sentiment: sentiment.label,
      actionItemCount: actionItems.length,
      category,
      leadScore,
      durationMs: duration,
    });

    return {
      sentiment,
      summary,
      actionItems,
      category,
      leadScore,
      keywords,
    };
  } catch (error) {
    logger.error('AI analysis failed', { callId: call.id, error: String(error) });

    // Return fallback analysis
    return {
      sentiment: { label: 'neutral', score: 0.5 },
      summary: `Call with ${call.participants.join(', ')}`,
      actionItems: [],
      category: 'general',
      keywords: [],
    };
  }
}

/**
 * Analyze message using Workers AI
 */
export async function analyzeMessageWithAI(
  message: Message,
  env: Env,
  logger: Logger
): Promise<MessageAnalysis> {
  const startTime = Date.now();

  try {
    const context = message.body || '';

    const [sentiment, summary, actionItems] = await Promise.all([
      analyzeSentiment(context, env),
      generateSummary(context, env),
      extractActionItems(context, env),
    ]);

    const category = await categorizeMessage(context, env);

    const duration = Date.now() - startTime;
    logger.info('Message AI analysis completed', {
      messageId: message.id,
      sentiment: sentiment.label,
      category,
      durationMs: duration,
    });

    return {
      sentiment,
      summary,
      actionItems,
      category,
    };
  } catch (error) {
    logger.error('Message AI analysis failed', { messageId: message.id, error: String(error) });

    return {
      sentiment: { label: 'neutral', score: 0.5 },
      summary: message.body || '',
      actionItems: [],
      category: 'general',
    };
  }
}

// ========================================================================
// Private Helper Functions
// ========================================================================

function buildCallContext(call: Call, transcript: string | undefined): string {
  const parts = [
    `Direction: ${call.direction}`,
    `Duration: ${call.duration} seconds`,
    `Participants: ${call.participants.join(', ')}`,
  ];

  if (transcript) {
    parts.push(`Transcript: ${transcript}`);
  }

  return parts.join('\n');
}

/**
 * Sentiment analysis using Workers AI
 */
async function analyzeSentiment(
  text: string,
  env: Env
): Promise<{ label: string; score: number }> {
  try {
    const response = await env.AI.run('@cf/huggingface/distilbert-sst-2-int8', {
      text: text.slice(0, 512), // Model has max token limit
    });

    // Response format: [{ label: 'POSITIVE' | 'NEGATIVE', score: number }]
    const result = Array.isArray(response) ? response[0] : response;

    return {
      label: result.label.toLowerCase(),
      score: result.score,
    };
  } catch (error) {
    return { label: 'neutral', score: 0.5 };
  }
}

/**
 * Automatic summarization using Workers AI
 */
async function generateSummary(text: string, env: Env): Promise<string> {
  try {
    const response = await env.AI.run('@cf/facebook/bart-large-cnn', {
      input_text: text,
      max_length: 100,
    });

    return response.summary || text.slice(0, 200);
  } catch (error) {
    return text.slice(0, 200);
  }
}

/**
 * Extract action items using LLM
 */
async function extractActionItems(text: string, env: Env): Promise<string[]> {
  try {
    const response = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
      messages: [
        {
          role: 'system',
          content:
            'Extract action items from this call or message. Return only a bullet-point list of specific tasks or follow-ups. If there are no action items, return "None".',
        },
        {
          role: 'user',
          content: text,
        },
      ],
      max_tokens: 256,
    });

    const content = response.response || '';

    // Parse bullet points
    const items = content
      .split('\n')
      .filter((line) => line.trim().startsWith('-') || line.trim().startsWith('•'))
      .map((line) => line.replace(/^[-•]\s*/, '').trim())
      .filter((item) => item.length > 0 && !item.toLowerCase().includes('none'));

    return items;
  } catch (error) {
    return [];
  }
}

/**
 * Categorize call using AI
 */
async function categorizeCall(context: string, env: Env): Promise<string> {
  try {
    const response = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
      messages: [
        {
          role: 'system',
          content:
            'Categorize this call into ONE of these categories: sales, support, inquiry, follow-up, appointment, complaint, or general. Return only the category name.',
        },
        {
          role: 'user',
          content: context,
        },
      ],
      max_tokens: 10,
    });

    const category = (response.response || 'general').toLowerCase().trim();
    const validCategories = ['sales', 'support', 'inquiry', 'follow-up', 'appointment', 'complaint', 'general'];

    return validCategories.includes(category) ? category : 'general';
  } catch (error) {
    return 'general';
  }
}

/**
 * Categorize message using AI
 */
async function categorizeMessage(text: string, env: Env): Promise<string> {
  try {
    const response = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
      messages: [
        {
          role: 'system',
          content:
            'Categorize this message into ONE of these categories: question, information, request, confirmation, or general. Return only the category name.',
        },
        {
          role: 'user',
          content: text,
        },
      ],
      max_tokens: 10,
    });

    const category = (response.response || 'general').toLowerCase().trim();
    const validCategories = ['question', 'information', 'request', 'confirmation', 'general'];

    return validCategories.includes(category) ? category : 'general';
  } catch (error) {
    return 'general';
  }
}

/**
 * Calculate lead score based on AI insights
 */
function calculateLeadScore(
  call: Call,
  sentiment: { label: string; score: number },
  actionItems: string[]
): number {
  let score = 50; // Base score

  // Sentiment contribution
  if (sentiment.label === 'positive') {
    score += 20 * sentiment.score;
  } else if (sentiment.label === 'negative') {
    score -= 15 * sentiment.score;
  }

  // Action items indicate engagement
  score += Math.min(actionItems.length * 5, 20);

  // Call duration indicates engagement
  if (call.duration) {
    if (call.duration > 300) score += 15; // 5+ minutes
    else if (call.duration > 120) score += 10; // 2+ minutes
    else if (call.duration > 60) score += 5; // 1+ minute
  }

  // Incoming calls might be more valuable
  if (call.direction === 'incoming') {
    score += 10;
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Extract keywords from text (simple version)
 */
function extractKeywords(text: string): string[] {
  // Simple keyword extraction (could be enhanced with AI)
  const words = text.toLowerCase().split(/\W+/);
  const stopWords = new Set(['the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'but', 'in', 'with', 'to', 'for', 'of', 'as', 'by']);

  const wordFreq = new Map<string, number>();
  for (const word of words) {
    if (word.length > 3 && !stopWords.has(word)) {
      wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
    }
  }

  return Array.from(wordFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map((entry) => entry[0]);
}
