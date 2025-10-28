import type { Env } from '../../types/env';
import type { Logger } from '../../utils/logger';
import type { MerchantInteraction } from '../../types/interactions';
import type { NotionClient } from '../../utils/notion-client';
import { recordInteraction, upsertMerchantFromCanvasPage } from '../../utils/d1-merchants';

export async function publishMerchantInteraction(
  env: Env,
  logger: Logger,
  interaction: MerchantInteraction,
  notionClient?: NotionClient
): Promise<void> {
  if (!interaction.merchant.canvasId) {
    logger.info('Skipping MerchantInteraction publish - no Canvas match', {
      interactionId: interaction.id,
      type: interaction.type,
    });
    return;
  }

  const metadata = {
    ...(interaction.metadata ?? {}),
    merchantUuid: interaction.merchant.merchantUuid,
    merchantName: interaction.merchant.merchantName,
    ai: interaction.ai,
    sources: interaction.sources,
  };

  if (notionClient) {
    try {
      const canvasPage = await notionClient.getPage(interaction.merchant.canvasId);
      if (canvasPage) {
        await upsertMerchantFromCanvasPage(env, logger, canvasPage, {
          interactionTimestamp: interaction.occurredAt,
          interactionType: interaction.type,
          summary: interaction.summary ?? null,
        });
      }
    } catch (error) {
      logger.warn('Failed to upsert merchant context from Canvas page', {
        canvasId: interaction.merchant.canvasId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await recordInteraction(env, logger, {
    id: interaction.id,
    canvasId: interaction.merchant.canvasId,
    interactionType: interaction.type,
    occurredAt: interaction.occurredAt,
    summary: interaction.summary ?? null,
    direction: interaction.direction ?? null,
    sentiment: interaction.ai?.sentiment ?? null,
    leadScore: interaction.ai?.leadScore ?? null,
    notionPageId: interaction.notionPageId ?? null,
    openphoneId: interaction.sources?.openphoneId ?? null,
    mailThreadId: interaction.sources?.mailThreadId ?? null,
    metadata,
  });
}
