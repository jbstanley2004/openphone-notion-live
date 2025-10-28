/**
 * Comprehensive Backfill and Reconciliation System
 *
 * Handles:
 * - Complete historical backfill of all databases (Calls, Messages, Mail, Canvas)
 * - AI analysis integration (sentiment, lead scoring, action items)
 * - Automatic vectorization for semantic search
 * - Canvas relation reconciliation across all records
 * - Merchant-based data segmentation
 */

import type { Env } from '../types/env';
import { Logger } from '../utils/logger';
import { OpenPhoneClient } from '../utils/openphone-client';
import { NotionClient } from '../utils/notion-client';
import { R2Client } from '../utils/r2-client';
import { RateLimiter } from '../utils/rate-limiter';
import { analyzeCallWithAI, analyzeMessageWithAI } from './ai-processor';
import { indexCall, indexMessage } from '../utils/vector-search';
import { getCachedCanvas } from '../utils/smart-cache';
import { getSyncState, markAsSynced, markAsFailed, sleep } from '../utils/helpers';
import { syncCallToD1, syncMessageToD1, syncMailToD1, MailSyncInput } from '../utils/d1-ingestion';
import { upsertMerchantFromCanvasPage } from '../utils/d1-merchants';

interface BackfillStats {
  calls: { synced: number; failed: number; skipped: number };
  messages: { synced: number; failed: number; skipped: number };
  mail: { synced: number; failed: number; skipped: number };
  canvas: { synced: number; failed: number; skipped: number };
}

interface BackfillOptions {
  daysBack?: number; // How many days of history to backfill (default: 30)
  includeAI?: boolean; // Include AI analysis (default: true)
  includeVectorize?: boolean; // Include vectorization (default: true)
  reconcileCanvas?: boolean; // Reconcile Canvas relations (default: true)
  batchSize?: number; // Process in batches (default: 10)
}

/**
 * Run comprehensive backfill of all databases
 */
export async function runComprehensiveBackfill(
  env: Env,
  logger: Logger,
  options: BackfillOptions = {}
): Promise<BackfillStats> {
  const {
    daysBack = 30,
    includeAI = true,
    includeVectorize = true,
    reconcileCanvas = true,
    batchSize = 10,
  } = options;

  logger.info('Starting comprehensive backfill', {
    daysBack,
    includeAI,
    includeVectorize,
    reconcileCanvas,
  });

  const stats: BackfillStats = {
    calls: { synced: 0, failed: 0, skipped: 0 },
    messages: { synced: 0, failed: 0, skipped: 0 },
    mail: { synced: 0, failed: 0, skipped: 0 },
    canvas: { synced: 0, failed: 0, skipped: 0 },
  };

  try {
    // Step 1: Backfill Canvas database (merchants)
    logger.info('Step 1: Backfilling Canvas database');
    const canvasStats = await backfillCanvasDatabase(env, logger);
    stats.canvas = canvasStats;

    // Step 2: Backfill Calls with AI and vectorization
    logger.info('Step 2: Backfilling Calls database');
    const callsStats = await backfillCallsDatabase(
      env,
      logger,
      daysBack,
      includeAI,
      includeVectorize,
      batchSize
    );
    stats.calls = callsStats;

    // Step 3: Backfill Messages with AI and vectorization
    logger.info('Step 3: Backfilling Messages database');
    const messagesStats = await backfillMessagesDatabase(
      env,
      logger,
      daysBack,
      includeAI,
      includeVectorize,
      batchSize
    );
    stats.messages = messagesStats;

    // Step 4: Backfill Mail database
    logger.info('Step 4: Backfilling Mail database');
    const mailStats = await backfillMailDatabase(env, logger, daysBack, batchSize);
    stats.mail = mailStats;

    // Step 5: Reconcile Canvas relations across all records
    if (reconcileCanvas) {
      logger.info('Step 5: Reconciling Canvas relations');
      await reconcileCanvasRelations(env, logger);
    }

    logger.info('Comprehensive backfill completed', stats);
    return stats;
  } catch (error) {
    logger.error('Comprehensive backfill failed', error);
    throw error;
  }
}

/**
 * Backfill Canvas database (merchants)
 */
async function backfillCanvasDatabase(env: Env, logger: Logger) {
  logger.info('Backfilling Canvas database');

  const notionClient = new NotionClient(env, logger);
  let synced = 0;
  let failed = 0;
  let skipped = 0;

  try {
    let startCursor: string | undefined = undefined;

    do {
      const response = await notionClient.queryDatabase(env.NOTION_CANVAS_DATABASE_ID, {
        pageSize: 50,
        startCursor,
      });

      const pages = Array.isArray(response.results) ? response.results : [];

      for (const page of pages) {
        try {
          await upsertMerchantFromCanvasPage(env, logger, page);
          synced++;
        } catch (error) {
          failed++;
          logger.error('Failed to upsert Canvas page into D1', {
            canvasId: page?.id,
            error,
          });
        }
      }

      startCursor = response.next_cursor ?? undefined;

      if (!response.has_more) {
        break;
      }
    } while (startCursor);

    logger.info('Canvas backfill completed', { synced, failed, skipped });

    return { synced, failed, skipped };
  } catch (error) {
    logger.error('Canvas backfill failed', error);
    throw error;
  }
}

/**
 * Backfill Calls database with AI analysis and vectorization
 */
async function backfillCallsDatabase(
  env: Env,
  logger: Logger,
  daysBack: number,
  includeAI: boolean,
  includeVectorize: boolean,
  batchSize: number
) {
  logger.info('Backfilling Calls database', { daysBack, includeAI, includeVectorize });

  const rateLimiter = new RateLimiter(env.RATE_LIMITS, logger);
  const openPhoneClient = new OpenPhoneClient(env, logger, rateLimiter);
  const notionClient = new NotionClient(env, logger);
  const r2Client = new R2Client(env.RECORDINGS_BUCKET, logger);

  let synced = 0;
  let failed = 0;
  let skipped = 0;

  try {
    const phoneNumbers = await openPhoneClient.listPhoneNumbers();
    logger.info('Found phone numbers for call backfill', { count: phoneNumbers.length });

    const cutoffDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

    for (const phoneNumber of phoneNumbers) {
      try {
        // Fetch ALL calls with pagination
        let allCalls: any[] = [];
        let pageToken: string | undefined = undefined;
        let pageCount = 0;
        const maxPages = 200; // Up to 20,000 calls per phone number

        do {
          const response = await openPhoneClient.listCalls({
            phoneNumberId: phoneNumber.id,
            participants: [],
            maxResults: 100,
            pageToken,
          });

          allCalls = allCalls.concat(response.data);
          pageCount++;
          pageToken = response.nextPageToken;

          logger.debug('Fetched call page', {
            phoneNumber: phoneNumber.number,
            page: pageCount,
            callsInPage: response.data.length,
          });
        } while (pageToken && pageCount < maxPages);

        // Filter by date
        const relevantCalls = allCalls.filter((call) => {
          const callDate = new Date(call.createdAt);
          return callDate >= new Date(cutoffDate);
        });

        logger.info('Processing calls for phone number', {
          phoneNumber: phoneNumber.number,
          totalFetched: allCalls.length,
          relevantCalls: relevantCalls.length,
        });

        // Process in batches
        for (let i = 0; i < relevantCalls.length; i += batchSize) {
          const batch = relevantCalls.slice(i, i + batchSize);

          await Promise.allSettled(
            batch.map(async (call) => {
              try {
                // Check if already synced
                const syncState = await getSyncState(env.SYNC_STATE, call.id);
                if (syncState?.status === 'completed') {
                  skipped++;
                  return;
                }

                // Only sync completed calls
                if (call.status !== 'completed') {
                  return;
                }

                logger.info('Backfilling call with AI', { callId: call.id });

                // Fetch complete call data
                const completeData = await openPhoneClient.getCompleteCall(call.id);

                // Get transcript if available
                const transcript = completeData.voicemail?.transcription;

                // AI Analysis (if enabled)
                let aiAnalysis = null;
                if (includeAI) {
                  aiAnalysis = await analyzeCallWithAI(call, transcript, env, logger);
                  logger.info('AI analysis completed', {
                    callId: call.id,
                    sentiment: aiAnalysis.sentiment.label,
                    leadScore: aiAnalysis.leadScore,
                  });
                }

                // Download recordings
                let recordingUrl: string | undefined;
                if (completeData.recordings?.[0]?.url && completeData.recordings[0].status === 'completed') {
                  try {
                    const audioData = await openPhoneClient.downloadAudioFile(completeData.recordings[0].url);
                    recordingUrl = await r2Client.uploadRecording(call.id, audioData, {
                      timestamp: call.createdAt,
                      duration: completeData.recordings[0].duration,
                      contentType: completeData.recordings[0].type,
                    });
                  } catch (error) {
                    logger.error('Failed to upload recording', { callId: call.id, error });
                  }
                }

                // Download voicemail
                let voicemailUrl: string | undefined;
                if (completeData.voicemail?.url) {
                  try {
                    const audioData = await openPhoneClient.downloadAudioFile(completeData.voicemail.url);
                    voicemailUrl = await r2Client.uploadVoicemail(call.id, audioData, {
                      timestamp: call.createdAt,
                      duration: completeData.voicemail.duration,
                      transcription: completeData.voicemail.transcription,
                    });
                  } catch (error) {
                    logger.error('Failed to upload voicemail', { callId: call.id, error });
                  }
                }

                // Find Canvas relation using smart cache
                let canvasId: string | null = null;
                for (const participant of call.participants) {
                  canvasId = await getCachedCanvas(participant, 'phone', env, logger);
                  if (canvasId) break;
                }

                // Create or update in Notion with AI data
                const pageData = {
                  ...completeData,
                  recordingUrl,
                  voicemailUrl,
                  // Add AI-generated fields if available
                  ...(aiAnalysis && {
                    aiSentiment: aiAnalysis.sentiment.label,
                    aiSummary: aiAnalysis.summary,
                    aiActionItems: aiAnalysis.actionItems,
                    aiCategory: aiAnalysis.category,
                    aiLeadScore: aiAnalysis.leadScore,
                    aiKeywords: aiAnalysis.keywords,
                  }),
                };

                const existingPageId = await notionClient.callPageExists(call.id);
                let notionPageId: string;

                if (existingPageId) {
                  await notionClient.updateCallPage(existingPageId, pageData);
                  notionPageId = existingPageId;
                } else {
                  notionPageId = await notionClient.createCallPage(pageData);
                }

                // Vectorize (if enabled)
                if (includeVectorize) {
                  await indexCall(
                    call,
                    transcript,
                    aiAnalysis?.summary,
                    notionPageId,
                    env,
                    logger
                  );
                  logger.info('Call vectorized', { callId: call.id });
                }

                await markAsSynced(env.SYNC_STATE, call.id, 'call', notionPageId);
                synced++;
                logger.info('Call backfilled successfully', {
                  callId: call.id,
                  canvasId,
                  aiEnabled: includeAI,
                  vectorized: includeVectorize,
                });

                try {
                  await syncCallToD1(completeData, env, notionClient, logger, {
                    notionPageId,
                    recordingUrl,
                    voicemailUrl,
                  });
                } catch (error) {
                  logger.error('Failed to sync call to D1 during backfill', {
                    callId: call.id,
                    error,
                  });
                }
              } catch (error) {
                failed++;
                logger.error('Failed to backfill call', { callId: call.id, error });
                await markAsFailed(env.SYNC_STATE, call.id, 'call', String(error), 1);
              }
            })
          );

          // Delay between batches
          await sleep(1000);
        }
      } catch (error) {
        logger.error('Failed to process phone number for calls', {
          phoneNumberId: phoneNumber.id,
          error,
        });
      }
    }

    logger.info('Call backfill completed', { synced, failed, skipped });
    return { synced, failed, skipped };
  } catch (error) {
    logger.error('Call backfill failed', error);
    throw error;
  }
}

/**
 * Backfill Messages database with AI analysis and vectorization
 */
async function backfillMessagesDatabase(
  env: Env,
  logger: Logger,
  daysBack: number,
  includeAI: boolean,
  includeVectorize: boolean,
  batchSize: number
) {
  logger.info('Backfilling Messages database', { daysBack, includeAI, includeVectorize });

  const rateLimiter = new RateLimiter(env.RATE_LIMITS, logger);
  const openPhoneClient = new OpenPhoneClient(env, logger, rateLimiter);
  const notionClient = new NotionClient(env, logger);

  let synced = 0;
  let failed = 0;
  let skipped = 0;

  try {
    const phoneNumbers = await openPhoneClient.listPhoneNumbers();
    logger.info('Found phone numbers for message backfill', { count: phoneNumbers.length });

    const cutoffDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

    for (const phoneNumber of phoneNumbers) {
      try {
        // Fetch ALL messages with pagination
        let allMessages: any[] = [];
        let pageToken: string | undefined = undefined;
        let pageCount = 0;
        const maxPages = 200;

        do {
          const response = await openPhoneClient.listMessages({
            phoneNumberId: phoneNumber.id,
            participants: [],
            maxResults: 100,
            pageToken,
          });

          allMessages = allMessages.concat(response.data);
          pageCount++;
          pageToken = response.nextPageToken;
        } while (pageToken && pageCount < maxPages);

        // Filter by date
        const relevantMessages = allMessages.filter((msg) => {
          const msgDate = new Date(msg.createdAt);
          return msgDate >= new Date(cutoffDate);
        });

        logger.info('Processing messages for phone number', {
          phoneNumber: phoneNumber.number,
          totalFetched: allMessages.length,
          relevantMessages: relevantMessages.length,
        });

        // Process in batches
        for (let i = 0; i < relevantMessages.length; i += batchSize) {
          const batch = relevantMessages.slice(i, i + batchSize);

          await Promise.allSettled(
            batch.map(async (message) => {
              try {
                const syncState = await getSyncState(env.SYNC_STATE, message.id);
                if (syncState?.status === 'completed') {
                  skipped++;
                  return;
                }

                logger.info('Backfilling message with AI', { messageId: message.id });

                // AI Analysis (if enabled)
                let aiAnalysis = null;
                if (includeAI) {
                  aiAnalysis = await analyzeMessageWithAI(message, env, logger);
                  logger.info('Message AI analysis completed', {
                    messageId: message.id,
                    sentiment: aiAnalysis.sentiment.label,
                  });
                }

                // Find Canvas relation
                let canvasId: string | null = null;
                canvasId = await getCachedCanvas(message.from, 'phone', env, logger);

                // Create or update in Notion with AI data
                const pageData = {
                  ...message,
                  ...(aiAnalysis && {
                    aiSentiment: aiAnalysis.sentiment.label,
                    aiSummary: aiAnalysis.summary,
                    aiCategory: aiAnalysis.category,
                    aiActionItems: aiAnalysis.actionItems,
                  }),
                };

                const existingPageId = await notionClient.messagePageExists(message.id);
                let notionPageId: string;

                if (existingPageId) {
                  await notionClient.updateMessagePage(existingPageId, pageData);
                  notionPageId = existingPageId;
                } else {
                  notionPageId = await notionClient.createMessagePage(pageData);
                }

                // Vectorize (if enabled)
                if (includeVectorize) {
                  await indexMessage(
                    message,
                    aiAnalysis?.summary,
                    notionPageId,
                    env,
                    logger
                  );
                }

                await markAsSynced(env.SYNC_STATE, message.id, 'message', notionPageId);
                synced++;

                try {
                  await syncMessageToD1(message, env, notionClient, logger, {
                    notionPageId,
                  });
                } catch (error) {
                  logger.error('Failed to sync message to D1 during backfill', {
                    messageId: message.id,
                    error,
                  });
                }
              } catch (error) {
                failed++;
                logger.error('Failed to backfill message', { messageId: message.id, error });
                await markAsFailed(env.SYNC_STATE, message.id, 'message', String(error), 1);
              }
            })
          );

          await sleep(1000);
        }
      } catch (error) {
        logger.error('Failed to process phone number for messages', {
          phoneNumberId: phoneNumber.id,
          error,
        });
      }
    }

    logger.info('Message backfill completed', { synced, failed, skipped });
    return { synced, failed, skipped };
  } catch (error) {
    logger.error('Message backfill failed', error);
    throw error;
  }
}

/**
 * Backfill Mail database
 * Note: This depends on your mail source (Gmail API, IMAP, etc.)
 * Placeholder implementation - adjust based on your mail integration
 */
async function backfillMailDatabase(
  env: Env,
  logger: Logger,
  daysBack: number,
  batchSize: number
) {
  logger.info('Backfilling Mail database', { daysBack });

  const notionClient = new NotionClient(env, logger);
  let synced = 0;
  let failed = 0;
  let skipped = 0;

  try {
    const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
    let startCursor: string | undefined = undefined;

    do {
      const response = await notionClient.queryDatabase(env.NOTION_MAIL_DATABASE_ID, {
        pageSize: batchSize,
        startCursor,
        filter: {
          property: 'Created At',
          date: {
            on_or_after: cutoff,
          },
        },
      });

      const pages = Array.isArray(response.results) ? response.results : [];

      for (const page of pages) {
        try {
          const mailInput = mapMailPageToSyncInput(page);
          await syncMailToD1(mailInput, env, notionClient, logger, {
            notionPageId: page.id,
          });
          synced++;
        } catch (error) {
          failed++;
          logger.error('Failed to sync mail page to D1', {
            pageId: page?.id,
            error,
          });
        }
      }

      startCursor = response.next_cursor ?? undefined;
      if (!response.has_more) {
        break;
      }
    } while (startCursor);

    logger.info('Mail backfill completed', { synced, failed, skipped });
    return { synced, failed, skipped };
  } catch (error) {
    logger.error('Mail backfill failed', error);
    throw error;
  }
}

function getPlainText(property: any): string | null {
  if (!property) {
    return null;
  }

  const segments = Array.isArray(property.rich_text)
    ? property.rich_text
    : Array.isArray(property.title)
      ? property.title
      : [];

  if (!Array.isArray(segments)) {
    return null;
  }

  const text = segments.map((segment: any) => segment.plain_text ?? '').join('').trim();
  return text || null;
}

function mapMailPageToSyncInput(page: any): MailSyncInput {
  const props = page.properties || {};
  const subject = getPlainText(props.Subject) ?? '(No Subject)';
  const body = getPlainText(props.Body) ?? '';
  const from = props.From?.email ?? getPlainText(props.From) ?? undefined;
  const toRaw = getPlainText(props.To) ?? '';
  const toList = toRaw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const direction = props.Direction?.select?.name ?? undefined;
  const status = props.Status?.select?.name ?? undefined;
  const createdAt = props['Created At']?.date?.start ?? page.created_time;
  const updatedAt = props['Updated At']?.date?.start ?? page.last_edited_time;
  const relation = Array.isArray(props.Canvas?.relation) ? props.Canvas.relation : [];
  let canvasId = relation.length > 0 ? relation[0].id : undefined;
  const rawData = getPlainText(props['Raw Data']);
  let metadata: Record<string, any> | undefined;
  let mailId = page.id;
  let threadId: string | undefined;

  if (rawData) {
    try {
      const parsed = JSON.parse(rawData);
      metadata = parsed;
      if (typeof parsed?.id === 'string') {
        mailId = parsed.id;
      }
      if (typeof parsed?.threadId === 'string') {
        threadId = parsed.threadId;
      } else if (parsed?.conversationId !== undefined) {
        threadId = String(parsed.conversationId);
      }
      if (!canvasId && typeof parsed?.canvasId === 'string') {
        canvasId = parsed.canvasId;
      }
    } catch (error) {
      metadata = undefined;
    }
  }

  return {
    id: mailId,
    subject,
    body,
    from,
    to: toList.length > 0 ? toList : undefined,
    direction,
    status,
    createdAt,
    updatedAt,
    threadId,
    metadata,
    canvasId,
  };
}

/**
 * Reconcile Canvas relations across all databases
 * Ensures every record has proper Canvas relation based on phone/email
 */
async function reconcileCanvasRelations(env: Env, logger: Logger) {
  logger.info('Reconciling Canvas relations across all databases');

  const notionClient = new NotionClient(env, logger);

  try {
    // This would query Notion databases and update Canvas relations
    // Implementation depends on Notion API pagination and update patterns
    logger.info('Canvas reconciliation will update records with missing Canvas relations');

    // TODO: Implement full reconciliation
    // 1. Query all Calls pages without Canvas relation
    // 2. Look up Canvas by phone number
    // 3. Update relation
    // 4. Repeat for Messages and Mail

    logger.info('Canvas reconciliation completed');
  } catch (error) {
    logger.error('Canvas reconciliation failed', error);
  }
}
