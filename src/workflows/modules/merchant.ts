import type { Env } from '../../types/env';
import type { Logger } from '../../utils/logger';
import type { NotionClient } from '../../utils/notion-client';
import { resolveMerchantMetadata } from '../../utils/merchant-metadata';

export interface MerchantContext {
  canvasId: string | null;
  merchantUuid: string | null;
  merchantName: string | null;
}

export function withMerchantUuid(context: MerchantContext): MerchantContext {
  if (context.merchantUuid) {
    return context;
  }

  if (context.canvasId) {
    return {
      ...context,
      merchantUuid: context.canvasId,
    };
  }

  return context;
}

export async function resolveMerchantContextForCall(
  callParticipants: string[],
  env: Env,
  logger: Logger,
  notionClient: NotionClient
): Promise<MerchantContext> {
  for (const participant of callParticipants) {
    const canvasId = await notionClient.findCanvasByPhone(participant);
    if (canvasId) {
      logger.info('Canvas found for call participant', { participant, canvasId });
      const metadata = await resolveMerchantMetadata(env, logger, { canvasId, notionClient });
      return {
        canvasId,
        merchantUuid: metadata.merchantUuid ?? canvasId,
        merchantName: metadata.merchantName ?? null,
      };
    }
  }

  return { canvasId: null, merchantUuid: null, merchantName: null };
}

export async function resolveMerchantContextForMessage(
  messageFrom: string,
  env: Env,
  logger: Logger,
  notionClient: NotionClient
): Promise<MerchantContext> {
  const canvasId = await notionClient.findCanvasByPhone(messageFrom);
  if (!canvasId) {
    return { canvasId: null, merchantUuid: null, merchantName: null };
  }

  const metadata = await resolveMerchantMetadata(env, logger, { canvasId, notionClient });
  return {
    canvasId,
    merchantUuid: metadata.merchantUuid ?? canvasId,
    merchantName: metadata.merchantName ?? null,
  };
}

export async function resolveMerchantContextForMail(
  mail: { direction?: string | null; from?: string | null; to?: string[] | null },
  env: Env,
  logger: Logger,
  notionClient: NotionClient
): Promise<MerchantContext> {
  const canvasId = await notionClient.resolveCanvasForMail(mail);
  if (!canvasId) {
    return { canvasId: null, merchantUuid: null, merchantName: null };
  }

  const metadata = await resolveMerchantMetadata(env, logger, { canvasId, notionClient });
  return {
    canvasId,
    merchantUuid: metadata.merchantUuid ?? canvasId,
    merchantName: metadata.merchantName ?? null,
  };
}
