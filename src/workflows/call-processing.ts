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
import type { OpenPhoneID } from '../types/openphone';
import { OpenPhoneClient } from '../utils/openphone-client';
import { NotionClient } from '../utils/notion-client';
import { R2Client } from '../utils/r2-client';
import { RateLimiter } from '../utils/rate-limiter';
import { createLogger } from '../utils/logger';
import { analyzeCallWithAI } from '../processors/ai-processor';
import { indexCall } from '../utils/vector-search';

interface WorkflowEvent {
  params: {
    callId: OpenPhoneID<'AC'>;
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

    const workflowName = 'call-processing';
    const workflowContext = { callId, phoneNumberId };
    const finishWorkflow = logger.startTimer(`workflow.${workflowName}`, workflowContext);

    logger.logWorkflowStep(workflowName, 'workflow', 'start', workflowContext);
    logger.info('Starting call processing workflow', workflowContext);

    const runStep = async <T>(stepName: string, fn: () => Promise<T>): Promise<T> => {
      const stepContext = { ...workflowContext, step: stepName };
      logger.logWorkflowStep(workflowName, stepName, 'start', stepContext);
      const finishStep = logger.startTimer(`workflow.${workflowName}.${stepName}`, stepContext);

      try {
        const result = await step.do(stepName, async () => fn());
        finishStep('success');
        logger.logWorkflowStep(workflowName, stepName, 'success', stepContext);
        return result;
      } catch (error) {
        finishStep('error', {}, error);
        logger.logWorkflowStep(workflowName, stepName, 'failure', stepContext);
        logger.error('Workflow step failed', error, {
          workflow: workflowName,
          ...stepContext,
        });
        throw error;
      }
    };

    try {
      const call = await runStep('fetch-call', async () => {
        logger.info('Fetching call data', { callId });

        const rateLimiter = new RateLimiter(env.RATE_LIMITS, logger);
        const openPhoneClient = new OpenPhoneClient(env, logger, rateLimiter);

        const completeData = await openPhoneClient.getCompleteCall(callId);

        logger.info('Call data fetched', {
          callId,
          direction: completeData.call.direction,
          duration: completeData.call.duration,
        });

        return completeData;
      });

      const recordingUrl = await runStep('store-recording', async () => {
        const recording = call.recordings?.[0];
        if (!recording?.url || recording.status !== 'completed') {
          logger.info('No recording to store', { callId });
          return undefined;
        }

        logger.info('Storing recording', { callId });

        const rateLimiter = new RateLimiter(env.RATE_LIMITS, logger);
        const openPhoneClient = new OpenPhoneClient(env, logger, rateLimiter);
        const r2Client = new R2Client(env.RECORDINGS_BUCKET, logger);

        const audioData = await openPhoneClient.downloadAudioFile(recording.url);
        const url = await r2Client.uploadRecording(callId, audioData, {
          timestamp: call.call.createdAt,
          duration: recording.duration ?? undefined,
          contentType: recording.type ?? undefined,
        });

        logger.info('Recording stored', { callId, url });
        return url;
      });

      const voicemailUrl = await runStep('store-voicemail', async () => {
        const voicemail = call.voicemail;
        if (!voicemail?.url) {
          logger.info('No voicemail to store', { callId });
          return undefined;
        }

        logger.info('Storing voicemail', { callId });

        const rateLimiter = new RateLimiter(env.RATE_LIMITS, logger);
        const openPhoneClient = new OpenPhoneClient(env, logger, rateLimiter);
        const r2Client = new R2Client(env.RECORDINGS_BUCKET, logger);

        const audioData = await openPhoneClient.downloadAudioFile(voicemail.url);
        const url = await r2Client.uploadVoicemail(callId, audioData, {
          timestamp: call.call.createdAt,
          duration: voicemail.duration ?? undefined,
          transcription: voicemail.transcription ?? undefined,
        });

        logger.info('Voicemail stored', { callId, url });
        return url;
      });

      const analysis = await runStep('ai-analysis', async () => {
        logger.info('Running AI analysis', { callId });

        const transcript = call.voicemail?.transcription ?? undefined;
        const aiAnalysis = await analyzeCallWithAI(call.call, transcript, env, logger);

        logger.info('AI analysis completed', {
          callId,
          sentiment: aiAnalysis.sentiment.label,
          actionItemCount: aiAnalysis.actionItems.length,
          category: aiAnalysis.category,
          leadScore: aiAnalysis.leadScore,
        });

        return aiAnalysis;
      });

      const canvasId = await runStep('find-canvas', async () => {
        logger.info('Finding Canvas relation', { callId });

        const notionClient = new NotionClient(env, logger);

        for (const participant of call.call.participants) {
          const id = await notionClient.findCanvasByPhone(participant);
          if (id) {
            logger.info('Canvas found', { callId, participant, canvasId: id });
            return id;
          }
        }

        logger.info('No Canvas found', { callId });
        return null;
      });

      const notionPageId = await runStep('create-notion', async () => {
        logger.info('Creating/updating Notion page', { callId });

        const notionClient = new NotionClient(env, logger);

        const pageData = {
          ...call,
          recordingUrl,
          voicemailUrl,
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

      await runStep('index-vectorize', async () => {
        logger.info('Indexing in Vectorize', { callId });

        const transcript = call.voicemail?.transcription ?? undefined;
        await indexCall(call.call, transcript, analysis.summary, notionPageId, env, logger);

        logger.info('Indexed in Vectorize', { callId });
      });

      logger.info('Call processing workflow completed', {
        callId,
        notionPageId,
        canvasId,
        sentiment: analysis.sentiment.label,
        leadScore: analysis.leadScore,
      });
      logger.logWorkflowStep(workflowName, 'workflow', 'success', {
        ...workflowContext,
        notionPageId,
        canvasId,
      });
      finishWorkflow('success', { notionPageId, canvasId });

      return {
        callId,
        notionPageId,
        canvasId,
        sentiment: analysis.sentiment.label,
        leadScore: analysis.leadScore,
        actionItems: analysis.actionItems,
      };
    } catch (error) {
      finishWorkflow('error', {}, error);
      logger.error('Call processing workflow failed', error, workflowContext);
      throw error;
    }
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

    const workflowName = 'message-processing';
    const workflowContext = { messageId };
    const finishWorkflow = logger.startTimer(`workflow.${workflowName}`, workflowContext);

    logger.logWorkflowStep(workflowName, 'workflow', 'start', workflowContext);
    logger.info('Starting message processing workflow', workflowContext);

    const runStep = async <T>(stepName: string, fn: () => Promise<T>): Promise<T> => {
      const stepContext = { ...workflowContext, step: stepName };
      logger.logWorkflowStep(workflowName, stepName, 'start', stepContext);
      const finishStep = logger.startTimer(`workflow.${workflowName}.${stepName}`, stepContext);

      try {
        const result = await step.do(stepName, async () => fn());
        finishStep('success');
        logger.logWorkflowStep(workflowName, stepName, 'success', stepContext);
        return result;
      } catch (error) {
        finishStep('error', {}, error);
        logger.logWorkflowStep(workflowName, stepName, 'failure', stepContext);
        logger.error('Workflow step failed', error, {
          workflow: workflowName,
          ...stepContext,
        });
        throw error;
      }
    };

    try {
      const message = await runStep('fetch-message', async () => {
        logger.info('Fetching message data', { messageId });

        const rateLimiter = new RateLimiter(env.RATE_LIMITS, logger);
        const openPhoneClient = new OpenPhoneClient(env, logger, rateLimiter);

        const messageData = await openPhoneClient.getMessage(messageId);

        logger.info('Message data fetched', { messageId });
        return messageData;
      });

      const analysis = await runStep('ai-analysis', async () => {
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

      const canvasId = await runStep('find-canvas', async () => {
        const notionClient = new NotionClient(env, logger);
        return await notionClient.findCanvasByPhone(message.from);
      });

      const notionPageId = await runStep('create-notion', async () => {
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

      await runStep('index-vectorize', async () => {
        logger.info('Indexing message in Vectorize', { messageId });

        const { indexMessage } = await import('../utils/vector-search');
        await indexMessage(message, analysis.summary, notionPageId, env, logger);

        logger.info('Message indexed in Vectorize', { messageId });
      });

      logger.info('Message processing workflow completed', { messageId, notionPageId });
      logger.logWorkflowStep(workflowName, 'workflow', 'success', {
        ...workflowContext,
        notionPageId,
      });
      finishWorkflow('success', { notionPageId });

      return {
        messageId,
        notionPageId,
        canvasId,
        sentiment: analysis.sentiment.label,
      };
    } catch (error) {
      finishWorkflow('error', {}, error);
      logger.error('Message processing workflow failed', error, workflowContext);
      throw error;
    }
  }
}

// Export workflows for wrangler.jsonc
export default CallProcessingWorkflow;
