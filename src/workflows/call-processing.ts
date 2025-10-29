import type { OpenPhoneID } from '../types/openphone';
import type { Env } from '../types/env';
import type { OpenPhoneID } from '../types/openphone';
import { OpenPhoneClient } from '../utils/openphone-client';
import { NotionClient } from '../utils/notion-client';
import { R2Client } from '../utils/r2-client';
import { RateLimiter } from '../utils/rate-limiter';
import { createLogger } from '../utils/logger';
import { analyzeCallWithAI } from '../processors/ai-processor';
import { indexCall } from '../utils/vector-search';
import { normalizeCallInteraction } from './modules/normalizers';
import {
  resolveMerchantContextForCall,
  withMerchantUuid,
} from './modules/merchant';
import { publishMerchantInteraction } from './modules/merchant-interaction';
import { createRunStep } from './modules/step-runner';
import { createOpenPhoneResources, createNotionResources, createR2Client } from './modules/resources';
import { storeCallRecording, storeCallVoicemail } from './modules/call';
import type { WorkflowEvent, WorkflowStep } from './types';

interface CallWorkflowEvent extends WorkflowEvent<{
  callId: OpenPhoneID<'AC'>;
  phoneNumberId?: string | null;
}> {}

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
  async run(event: CallWorkflowEvent, step: WorkflowStep, env: Env): Promise<any> {
    const logger = createLogger(env);
    const { callId, phoneNumberId } = event.params;

    const workflowName = 'call-processing';
    const workflowContext = { callId, phoneNumberId };
    const finishWorkflow = logger.startTimer(`workflow.${workflowName}`, workflowContext);

    logger.logWorkflowStep(workflowName, 'workflow', 'start', workflowContext);

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

    logger.info('Starting call processing workflow', workflowContext);

    const runStep = createRunStep(logger, workflowName, workflowContext, step);

    const { client: openPhoneClient } = createOpenPhoneResources(env, logger);
    const { client: notionClient, getCachedCanvas } = createNotionResources(env, logger);
    const r2Client = createR2Client(env, logger);

    try {
      const callData = await runStep('fetch-call', async () => {
        logger.info('Fetching call data', { callId });
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
        const recording = callData.recordings?.[0];
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

        return storeCallRecording(openPhoneClient, r2Client, logger, {
          callId,
          createdAt: callData.call.createdAt,
          recordingUrl: recording.url,
          duration: recording.duration,
          contentType: recording.type,
        });
      });

      const voicemailUrl = await runStep('store-voicemail', async () => {
        if (!callData.voicemail?.url) {
          logger.info('No voicemail to store', { callId });
          return undefined;
        }

        return storeCallVoicemail(openPhoneClient, r2Client, logger, {
          callId,
          createdAt: callData.call.createdAt,
          voicemail: callData.voicemail,
        });
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

      const notionResult = await runStep('create-notion', async () => {
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

        if (existingPageId) {
          const result = await notionClient.updateCallPage(existingPageId, pageData);
          const resolvedCanvasId = result.canvasId ?? canvasId ?? null;
          logger.info('Notion page created/updated', {
            callId,
            pageId: existingPageId,
            canvasId: resolvedCanvasId,
            merchantUuid: result.merchantUuid ?? null,
          });
          return {
            pageId: existingPageId,
            merchantUuid: result.merchantUuid ?? null,
            canvasId: resolvedCanvasId,
          };
        }

        const result = await notionClient.createCallPage(pageData);
        const resolvedCanvasId = result.canvasId ?? canvasId ?? null;
        logger.info('Notion page created/updated', {
          callId,
          pageId: result.pageId,
          canvasId: resolvedCanvasId,
          merchantUuid: result.merchantUuid ?? null,
        });
        return {
          pageId: result.pageId,
          merchantUuid: result.merchantUuid ?? null,
          canvasId: resolvedCanvasId,
        };
      });

      const notionPageId = notionResult.pageId;
      const merchantUuid = notionResult.merchantUuid;
      const finalCanvasId = notionResult.canvasId ?? canvasId;

      await runStep('index-vectorize', async () => {
        logger.info('Indexing in Vectorize', { callId });

        const transcript = call.voicemail?.transcription ?? undefined;
        await indexCall(
          call.call,
          transcript,
          analysis.summary,
          notionPageId,
          merchantUuid,
          finalCanvasId ?? null,
          env,
          logger
        );

        logger.info('Indexed in Vectorize', { callId });
      });

      logger.info('Call processing workflow completed', {
        callId,
        notionPageId,
        canvasId: finalCanvasId,
        sentiment: analysis.sentiment.label,
        leadScore: analysis.leadScore,
      });
      logger.logWorkflowStep(workflowName, 'workflow', 'success', {
        ...workflowContext,
        notionPageId,
        canvasId: finalCanvasId,
      });
      finishWorkflow('success', { notionPageId, canvasId: finalCanvasId });
      return {
        callId,
        notionPageId,
        canvasId: finalCanvasId,
        sentiment: analysis.sentiment.label,
        leadScore: analysis.leadScore,
        actionItems: analysis.actionItems,
        merchantUuid,
      };
    } catch (error) {
      finishWorkflow('error', {}, error);
      logger.logWorkflowStep(workflowName, 'workflow', 'failure', workflowContext);
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

      const notionResult = await runStep('create-notion', async () => {
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

        if (existingPageId) {
          const result = await notionClient.updateMessagePage(existingPageId, pageData);
          const resolvedCanvasId = result.canvasId ?? canvasId ?? null;
          logger.info('Notion page created/updated for message', {
            messageId,
            pageId: existingPageId,
            canvasId: resolvedCanvasId,
            merchantUuid: result.merchantUuid ?? null,
          });
          return {
            pageId: existingPageId,
            merchantUuid: result.merchantUuid ?? null,
            canvasId: resolvedCanvasId,
          };
        }

        const result = await notionClient.createMessagePage(pageData);
        const resolvedCanvasId = result.canvasId ?? canvasId ?? null;
        logger.info('Notion page created/updated for message', {
          messageId,
          pageId: result.pageId,
          canvasId: resolvedCanvasId,
          merchantUuid: result.merchantUuid ?? null,
        });
        return {
          pageId: result.pageId,
          merchantUuid: result.merchantUuid ?? null,
          canvasId: resolvedCanvasId,
        };
      });

      const notionPageId = notionResult.pageId;
      const merchantUuid = notionResult.merchantUuid;
      const finalCanvasId = notionResult.canvasId ?? canvasId;

      await runStep('index-vectorize', async () => {
        logger.info('Indexing message in Vectorize', { messageId });

        const { indexMessage } = await import('../utils/vector-search');
        await indexMessage(
          message,
          analysis.summary,
          notionPageId,
          merchantUuid,
          finalCanvasId ?? null,
          env,
          logger
        );

        logger.info('Message indexed in Vectorize', { messageId });
      });

      logger.info('Message processing workflow completed', {
        messageId,
        notionPageId,
        canvasId: finalCanvasId,
        const transcript = callData.voicemail?.transcription ?? undefined;
        return analyzeCallWithAI(callData.call, transcript, env, logger);
      });

      const merchantContext = await runStep('find-merchant', async () => {
        logger.info('Resolving merchant context for call', { callId });
        const context = await resolveMerchantContextForCall(
          callData.call.participants,
          env,
          logger,
          notionClient,
          getCachedCanvas
        );
        return withMerchantUuid(context);
      });

      const notionPageId = await runStep('sync-notion', async () => {
        logger.info('Creating/updating Notion page', { callId });
        const pageData = {
          ...callData,
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
        if (existingPageId) {
          await notionClient.updateCallPage(existingPageId, pageData);
          return existingPageId;
        }

        return notionClient.createCallPage(pageData);
      });

      await runStep('index-vectorize', async () => {
        logger.info('Indexing call in Vectorize', { callId });
        const transcript = callData.voicemail?.transcription ?? undefined;
        await indexCall(
          callData.call,
          transcript,
          analysis.summary,
          notionPageId,
          env,
          logger,
          {
            canvasId: merchantContext.canvasId ?? undefined,
            merchantUuid: merchantContext.merchantUuid ?? undefined,
            merchantName: merchantContext.merchantName ?? undefined,
          }
        );
      });

      const interaction = normalizeCallInteraction({
        call: callData.call,
        transcript: callData.voicemail?.transcription ?? undefined,
        recordingUrl,
        voicemailUrl,
        analysis,
        notionPageId,
        merchant: merchantContext,
      });

      await runStep('publish-interaction', async () => {
        await publishMerchantInteraction(env, logger, interaction, notionClient);
      });

      logger.info('Call processing workflow completed', {
        callId,
        notionPageId,
        canvasId: merchantContext.canvasId,
        sentiment: analysis.sentiment.label,
        leadScore: analysis.leadScore,
      });
      logger.logWorkflowStep(workflowName, 'workflow', 'success', {
        ...workflowContext,
        notionPageId,
        canvasId: finalCanvasId,
      });
      finishWorkflow('success', { notionPageId, canvasId: finalCanvasId });
      return {
        messageId,
        notionPageId,
        canvasId: finalCanvasId,
        sentiment: analysis.sentiment.label,
        merchantUuid,
      };
    } catch (error) {
      finishWorkflow('error', {}, error);
      logger.logWorkflowStep(workflowName, 'workflow', 'failure', workflowContext);
      logger.error('Message processing workflow failed', error, workflowContext);
        canvasId: merchantContext.canvasId,
      });
      finishWorkflow('success', { notionPageId, canvasId: merchantContext.canvasId });

      return {
        callId,
        notionPageId,
        canvasId: merchantContext.canvasId,
        sentiment: analysis.sentiment.label,
        leadScore: analysis.leadScore,
        actionItems: analysis.actionItems,
        interaction,
      };
    } catch (error) {
      finishWorkflow('error', {}, error);
      logger.error('Call processing workflow failed', error, workflowContext);
      throw error;
    }
  }
}
