import type { OpenPhoneID } from '../types/openphone';
import type { Env } from '../types/env';
import { createLogger } from '../utils/logger';
import { analyzeMessageWithAI } from '../processors/ai-processor';
import { indexMessage } from '../utils/vector-search';
import { normalizeMessageInteraction } from './modules/normalizers';
import {
  resolveMerchantContextForMessage,
  withMerchantUuid,
} from './modules/merchant';
import { publishMerchantInteraction } from './modules/merchant-interaction';
import { createRunStep } from './modules/step-runner';
import { createOpenPhoneResources, createNotionClient } from './modules/resources';
import type { WorkflowEvent, WorkflowStep } from './types';

interface MessageWorkflowEvent extends WorkflowEvent<{
  messageId: OpenPhoneID<'AC'>;
  phoneNumberId?: OpenPhoneID<'PN'> | null;
}> {}

export class MessageProcessingWorkflow {
  async run(event: MessageWorkflowEvent, step: WorkflowStep, env: Env): Promise<any> {
    const logger = createLogger(env);
    const { messageId, phoneNumberId } = event.params;

    const workflowName = 'message-processing';
    const workflowContext = { messageId, phoneNumberId };
    const finishWorkflow = logger.startTimer(`workflow.${workflowName}`, workflowContext);

    logger.logWorkflowStep(workflowName, 'workflow', 'start', workflowContext);
    logger.info('Starting message processing workflow', workflowContext);

    const runStep = createRunStep(logger, workflowName, workflowContext, step);

    const { client: openPhoneClient } = createOpenPhoneResources(env, logger);
    const notionClient = createNotionClient(env, logger);

    try {
      const message = await runStep('fetch-message', async () => {
        logger.info('Fetching message data', { messageId });
        const messageData = await openPhoneClient.getMessage(messageId);
        logger.info('Message data fetched', { messageId });
        return messageData;
      });

      const analysis = await runStep('ai-analysis', async () => {
        logger.info('Running AI analysis on message', { messageId });
        return analyzeMessageWithAI(message, env, logger);
      });

      const merchantContext = await runStep('find-merchant', async () => {
        const context = await resolveMerchantContextForMessage(
          message.from,
          env,
          logger,
          notionClient
        );
        return withMerchantUuid(context);
      });

      const notionPageId = await runStep('sync-notion', async () => {
        logger.info('Creating/updating Notion page for message', { messageId });

        const pageData = {
          ...message,
          aiSentiment: analysis.sentiment.label,
          aiSummary: analysis.summary,
          aiCategory: analysis.category,
          aiActionItems: analysis.actionItems,
        };

        const existingPageId = await notionClient.messagePageExists(messageId);
        if (existingPageId) {
          await notionClient.updateMessagePage(existingPageId, pageData);
          return existingPageId;
        }

        return notionClient.createMessagePage(pageData);
      });

      await runStep('index-vectorize', async () => {
        logger.info('Indexing message in Vectorize', { messageId });
        await indexMessage(
          message,
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

      const interaction = normalizeMessageInteraction({
        message,
        analysis,
        notionPageId,
        merchant: merchantContext,
      });

      await runStep('publish-interaction', async () => {
        await publishMerchantInteraction(env, logger, interaction, notionClient);
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
        canvasId: merchantContext.canvasId,
        sentiment: analysis.sentiment.label,
        interaction,
      };
    } catch (error) {
      finishWorkflow('error', {}, error);
      logger.error('Message processing workflow failed', error, workflowContext);
      throw error;
    }
  }
}
