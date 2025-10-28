import type { OpenPhoneID } from '../types/openphone';
import type { Env } from '../types/env';
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

export class CallProcessingWorkflow {
  async run(event: CallWorkflowEvent, step: WorkflowStep, env: Env): Promise<any> {
    const logger = createLogger(env);
    const { callId, phoneNumberId } = event.params;

    const workflowName = 'call-processing';
    const workflowContext = { callId, phoneNumberId };
    const finishWorkflow = logger.startTimer(`workflow.${workflowName}`, workflowContext);

    logger.logWorkflowStep(workflowName, 'workflow', 'start', workflowContext);
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
        const recording = callData.recordings?.[0];
        if (!recording?.url || recording.status !== 'completed') {
          logger.info('No recording to store', { callId });
          return undefined;
        }

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
