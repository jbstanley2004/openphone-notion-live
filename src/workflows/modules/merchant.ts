import type { Env } from '../../types/env';
import type { Logger } from '../../utils/logger';
import type { NotionClient } from '../../utils/notion-client';
import { resolveMerchantMetadata } from '../../utils/merchant-metadata';
import type { CanvasLookupFn } from './resources';

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
  notionClient: NotionClient,
  getCachedCanvas: CanvasLookupFn
): Promise<MerchantContext> {
  for (const participant of callParticipants) {
    const lookup = await getCachedCanvas(participant, 'phone');
    if (lookup.canvasId) {
      logger.info('Canvas found for call participant', {
        participant,
        canvasId: lookup.canvasId,
        cacheSource: lookup.source,
      });
      const metadata = await resolveMerchantMetadata(env, logger, {
        canvasId: lookup.canvasId,
        notionClient,
      });
      return {
        canvasId: lookup.canvasId,
        merchantUuid: metadata.merchantUuid ?? lookup.canvasId,
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
  notionClient: NotionClient,
  getCachedCanvas: CanvasLookupFn
): Promise<MerchantContext> {
  const lookup = await getCachedCanvas(messageFrom, 'phone');
  if (!lookup.canvasId) {
    return { canvasId: null, merchantUuid: null, merchantName: null };
  }

  const metadata = await resolveMerchantMetadata(env, logger, { canvasId: lookup.canvasId, notionClient });
  return {
    canvasId: lookup.canvasId,
    merchantUuid: metadata.merchantUuid ?? lookup.canvasId,
    merchantName: metadata.merchantName ?? null,
  };
}

export async function resolveMerchantContextForMail(
  mail: { direction?: string | null; from?: string | null; to?: string[] | null },
  env: Env,
  logger: Logger,
  notionClient: NotionClient,
  getCachedCanvas: CanvasLookupFn
): Promise<MerchantContext> {
  const emailToLookup = mail.direction === 'incoming' ? mail.from : mail.to?.[0] ?? null;
  if (!emailToLookup) {
    return { canvasId: null, merchantUuid: null, merchantName: null };
  }

  const lookup = await getCachedCanvas(emailToLookup, 'email');
  if (!lookup.canvasId) {
    return { canvasId: null, merchantUuid: null, merchantName: null };
  }

  const metadata = await resolveMerchantMetadata(env, logger, {
    canvasId: lookup.canvasId,
    notionClient,
  });
  return {
    canvasId: lookup.canvasId,
    merchantUuid: metadata.merchantUuid ?? lookup.canvasId,
    merchantName: metadata.merchantName ?? null,
  };
}
