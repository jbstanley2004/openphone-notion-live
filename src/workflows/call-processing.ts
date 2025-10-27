/**
 * Call Processing Workflow
 *
 * Uses Cloudflare Workflows for complex multi-step processing with:
 * - Independent step retries
 * - Better error isolation
 * - Visual workflow tracking
 * - Easier debugging of failures
 *
 * Each step can retry independently without re-running the entire process.
 */

// Note: Workflows API is in beta and syntax may vary
// This is the target architecture based on Cloudflare's documentation

import type { Env } from '../types/env';
import type { Call } from '../types/openphone';
import { OpenPhoneClient } from '../utils/openphone-client';
import { NotionClient } from '../utils/notion-client';
import { R2Client } from '../utils/r2-client';
import { RateLimiter } from '../utils/rate-limiter';
import { createLogger } from '../utils/logger';
import { analyzeCallWithAI } from '../processors/ai-processor';
import { indexCall } from '../utils/vector-search';

interface WorkflowEvent {
  params: {
    callId: string;
    phoneNumberId: string;
  };
}

interface WorkflowStep {
  do<T>(name: string, fn: () => Promise<T>): Promise<T>;
  sleep(duration: string): Promise<void>;
}

/**
 * Call Processing Workflow
 *
 * Orchestrates the complete call processing pipeline:
 * 1. Fetch call data from OpenPhone
 * 2. Download and store recordings in R2
 * 3. Perform AI analysis
 * 4. Create/update Notion page
 * 5. Index in Vectorize for search
 */
export class CallProcessingWorkflow {
  async run(event: WorkflowEvent, step: WorkflowStep, env: Env): Promise<any> {
    const logger = createLogger(env);
    const { callId, phoneNumberId } = event.params;

    logger.info('Starting call processing workflow', { callId, phoneNumberId });

    // Step 1: Fetch call data (retriable independently)
    const call = await step.do('fetch-call', async () => {
      logger.info('Fetching call data', { callId });

      const rateLimiter = new RateLimiter(env.RATE_LIMITS, logger);
      const openPhoneClient = new OpenPhoneClient(env, logger, rateLimiter);

      const completeData = await openPhoneClient.getCompleteCall(callId);

      logger.info('Call data fetched', {
        callId,
        direction: completeData.direction,
        duration: completeData.duration,
      });

      return completeData;
    });

    // Step 2: Store recording (can retry independently if upload fails)
    const recordingUrl = await step.do('store-recording', async () => {
      if (!call.recordings?.[0]?.url || call.recordings[0].status !== 'completed') {
        logger.info('No recording to store', { callId });
        return undefined;
      }

      logger.info('Storing recording', { callId });

      const rateLimiter = new RateLimiter(env.RATE_LIMITS, logger);
      const openPhoneClient = new OpenPhoneClient(env, logger, rateLimiter);
      const r2Client = new R2Client(env.RECORDINGS_BUCKET, logger);

      const audioData = await openPhoneClient.downloadAudioFile(call.recordings[0].url);
      const url = await r2Client.uploadRecording(callId, audioData, {
        timestamp: call.createdAt,
        duration: call.recordings[0].duration,
        contentType: call.recordings[0].type,
      });

      logger.info('Recording stored', { callId, url });
      return url;
    });

    // Step 3: Store voicemail (independent from recording)
    const voicemailUrl = await step.do('store-voicemail', async () => {
      if (!call.voicemail?.url) {
        logger.info('No voicemail to store', { callId });
        return undefined;
      }

      logger.info('Storing voicemail', { callId });

      const rateLimiter = new RateLimiter(env.RATE_LIMITS, logger);
      const openPhoneClient = new OpenPhoneClient(env, logger, rateLimiter);
      const r2Client = new R2Client(env.RECORDINGS_BUCKET, logger);

      const audioData = await openPhoneClient.downloadAudioFile(call.voicemail.url);
      const url = await r2Client.uploadVoicemail(callId, audioData, {
        timestamp: call.createdAt,
        duration: call.voicemail.duration,
        transcription: call.voicemail.transcription,
      });

      logger.info('Voicemail stored', { callId, url });
      return url;
    });

    // Step 4: AI analysis (expensive operation, retry separately)
    const analysis = await step.do('ai-analysis', async () => {
      logger.info('Running AI analysis', { callId });

      const transcript = call.voicemail?.transcription;
      const aiAnalysis = await analyzeCallWithAI(call, transcript, env, logger);

      logger.info('AI analysis completed', {
        callId,
        sentiment: aiAnalysis.sentiment.label,
        actionItemCount: aiAnalysis.actionItems.length,
        category: aiAnalysis.category,
        leadScore: aiAnalysis.leadScore,
      });

      return aiAnalysis;
    });

    // Step 5: Find Canvas relation
    const canvasId = await step.do('find-canvas', async () => {
      logger.info('Finding Canvas relation', { callId });

      const notionClient = new NotionClient(env, logger);

      // Try each participant
      for (const participant of call.participants) {
        const id = await notionClient.findCanvasByPhone(participant);
        if (id) {
          logger.info('Canvas found', { callId, participant, canvasId: id });
          return id;
        }
      }

      logger.info('No Canvas found', { callId });
      return null;
    });

    // Step 6: Create/update Notion page (final step)
    const notionPageId = await step.do('create-notion', async () => {
      logger.info('Creating/updating Notion page', { callId });

      const notionClient = new NotionClient(env, logger);

      const pageData = {
        ...call,
        recordingUrl,
        voicemailUrl,
        // Add AI-generated fields
        aiSentiment: analysis.sentiment.label,
        aiSummary: analysis.summary,
        aiActionItems: analysis.actionItems,
        aiCategory: analysis.category,
        aiLeadScore: analysis.leadScore,
        aiKeywords: analysis.keywords,
      };

      const existingPageId = await notionClient.callPageExists(callId);

      let pageId: string;
      if (existingPageId) {
        await notionClient.updateCallPage(existingPageId, pageData);
        pageId = existingPageId;
      } else {
        pageId = await notionClient.createCallPage(pageData);
      }

      logger.info('Notion page created/updated', { callId, pageId });
      return pageId;
    });

    // Step 7: Index in Vectorize (optional but valuable for search)
    await step.do('index-vectorize', async () => {
      logger.info('Indexing in Vectorize', { callId });

      const transcript = call.voicemail?.transcription;
      await indexCall(call, transcript, analysis.summary, notionPageId, env, logger);

      logger.info('Indexed in Vectorize', { callId });
    });

    // Workflow complete!
    logger.info('Call processing workflow completed', {
      callId,
      notionPageId,
      canvasId,
      sentiment: analysis.sentiment.label,
      leadScore: analysis.leadScore,
    });

    return {
      callId,
      notionPageId,
      canvasId,
      sentiment: analysis.sentiment.label,
      leadScore: analysis.leadScore,
      actionItems: analysis.actionItems,
    };
  }
}

/**
 * Message Processing Workflow
 *
 * Similar to call processing but optimized for text messages
 */
export class MessageProcessingWorkflow {
  async run(event: WorkflowEvent, step: WorkflowStep, env: Env): Promise<any> {
    const logger = createLogger(env);
    const { messageId } = event.params as any;

    logger.info('Starting message processing workflow', { messageId });

    // Step 1: Fetch message data
    const message = await step.do('fetch-message', async () => {
      logger.info('Fetching message data', { messageId });

      const rateLimiter = new RateLimiter(env.RATE_LIMITS, logger);
      const openPhoneClient = new OpenPhoneClient(env, logger, rateLimiter);

      const messageData = await openPhoneClient.getMessage(messageId);

      logger.info('Message data fetched', { messageId });
      return messageData;
    });

    // Step 2: AI analysis
    const analysis = await step.do('ai-analysis', async () => {
      logger.info('Running AI analysis on message', { messageId });

      const { analyzeMessageWithAI } = await import('../processors/ai-processor');
      const aiAnalysis = await analyzeMessageWithAI(message, env, logger);

      logger.info('Message AI analysis completed', {
        messageId,
        sentiment: aiAnalysis.sentiment.label,
        category: aiAnalysis.category,
      });

      return aiAnalysis;
    });

    // Step 3: Find Canvas relation
    const canvasId = await step.do('find-canvas', async () => {
      const notionClient = new NotionClient(env, logger);
      return await notionClient.findCanvasByPhone(message.from);
    });

    // Step 4: Create/update Notion page
    const notionPageId = await step.do('create-notion', async () => {
      logger.info('Creating/updating Notion page for message', { messageId });

      const notionClient = new NotionClient(env, logger);

      const pageData = {
        ...message,
        aiSentiment: analysis.sentiment.label,
        aiSummary: analysis.summary,
        aiCategory: analysis.category,
        aiActionItems: analysis.actionItems,
      };

      const existingPageId = await notionClient.messagePageExists(messageId);

      let pageId: string;
      if (existingPageId) {
        await notionClient.updateMessagePage(existingPageId, pageData);
        pageId = existingPageId;
      } else {
        pageId = await notionClient.createMessagePage(pageData);
      }

      logger.info('Notion page created/updated for message', { messageId, pageId });
      return pageId;
    });

    // Step 5: Index in Vectorize
    await step.do('index-vectorize', async () => {
      logger.info('Indexing message in Vectorize', { messageId });

      const { indexMessage } = await import('../utils/vector-search');
      await indexMessage(message, analysis.summary, notionPageId, env, logger);

      logger.info('Message indexed in Vectorize', { messageId });
    });

    logger.info('Message processing workflow completed', { messageId, notionPageId });

    return {
      messageId,
      notionPageId,
      canvasId,
      sentiment: analysis.sentiment.label,
    };
  }
}

// Export workflows for wrangler.jsonc
export default CallProcessingWorkflow;
