import type { Mail } from '../types/openphone';
import type { Env } from '../types/env';
import { createLogger } from '../utils/logger';
import { analyzeMailWithAI } from '../processors/ai-processor';
import { indexMail } from '../utils/vector-search';
import { normalizeMailInteraction } from './modules/normalizers';
import {
  resolveMerchantContextForMail,
  withMerchantUuid,
} from './modules/merchant';
import { publishMerchantInteraction } from './modules/merchant-interaction';
import { createRunStep } from './modules/step-runner';
import { createNotionClient } from './modules/resources';
import type { WorkflowEvent, WorkflowStep } from './types';

interface MailWorkflowEvent extends WorkflowEvent<{
  mail: Mail;
}> {}

export class MailProcessingWorkflow {
  async run(event: MailWorkflowEvent, step: WorkflowStep, env: Env): Promise<any> {
    const logger = createLogger(env);
    const { mail } = event.params;

    const workflowName = 'mail-processing';
    const workflowContext = { mailId: mail.id };
    const finishWorkflow = logger.startTimer(`workflow.${workflowName}`, workflowContext);

    logger.logWorkflowStep(workflowName, 'workflow', 'start', workflowContext);
    logger.info('Starting mail processing workflow', workflowContext);

    const runStep = createRunStep(logger, workflowName, workflowContext, step);

    const notionClient = createNotionClient(env, logger);

    try {
      const normalizedMail = await runStep('normalize-mail', async () => {
        logger.info('Normalizing mail payload', { mailId: mail.id });
        const normalized = {
          ...mail,
          direction: mail.direction ?? 'incoming',
          to: mail.to ?? [],
          cc: mail.cc ?? [],
          bcc: mail.bcc ?? [],
        } as Mail;
        return normalized;
      });

      const analysis = await runStep('ai-analysis', async () => {
        logger.info('Running AI analysis on mail', { mailId: normalizedMail.id });
        return analyzeMailWithAI(normalizedMail, env, logger);
      });

      const merchantContext = await runStep('find-merchant', async () => {
        const context = await resolveMerchantContextForMail(
          {
            direction: normalizedMail.direction,
            from: normalizedMail.from,
            to: normalizedMail.to,
          },
          env,
          logger,
          notionClient
        );
        return withMerchantUuid(context);
      });

      const notionPageId = await runStep('sync-notion', async () => {
        logger.info('Creating/updating Notion page for mail', { mailId: normalizedMail.id });

        const pageData = {
          ...normalizedMail,
          aiSentiment: analysis.sentiment.label,
          aiSummary: analysis.summary,
          aiCategory: analysis.category,
          aiActionItems: analysis.actionItems,
        };

        const existingPageId = await notionClient.mailPageExists(normalizedMail.id);
        if (existingPageId) {
          await notionClient.updateMailPage(existingPageId, pageData);
          return existingPageId;
        }

        return notionClient.createMailPage(pageData);
      });

      await runStep('index-vectorize', async () => {
        logger.info('Indexing mail in Vectorize', { mailId: normalizedMail.id });
        await indexMail(
          normalizedMail,
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

      const interaction = normalizeMailInteraction({
        mail: normalizedMail,
        notionPageId,
        merchant: merchantContext,
        analysis,
      });

      await runStep('publish-interaction', async () => {
        await publishMerchantInteraction(env, logger, interaction, notionClient);
      });

      logger.info('Mail processing workflow completed', {
        mailId: normalizedMail.id,
        notionPageId,
        canvasId: merchantContext.canvasId,
      });
      logger.logWorkflowStep(workflowName, 'workflow', 'success', {
        ...workflowContext,
        notionPageId,
      });
      finishWorkflow('success', { notionPageId });

      return {
        mailId: normalizedMail.id,
        notionPageId,
        canvasId: merchantContext.canvasId,
        interaction,
      };
    } catch (error) {
      finishWorkflow('error', {}, error);
      logger.error('Mail processing workflow failed', error, workflowContext);
      throw error;
    }
  }
}
