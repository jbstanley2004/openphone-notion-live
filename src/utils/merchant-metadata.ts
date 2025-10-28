import type { Env } from '../types/env';
import type { Logger } from './logger';
import type { NotionClient } from './notion-client';
import { getMerchantRow } from './d1-merchants';

export interface MerchantMetadata {
  canvasId?: string | null;
  merchantUuid?: string | null;
  merchantName?: string | null;
}

function extractPlainText(property: any): string | null {
  if (!property) return null;
  if (Array.isArray(property.rich_text)) {
    const text = property.rich_text.map((t: any) => t.plain_text || '').join('');
    return text.trim() || null;
  }
  if (Array.isArray(property.title)) {
    const text = property.title.map((t: any) => t.plain_text || '').join('');
    return text.trim() || null;
  }
  if (typeof property === 'string') {
    return property || null;
  }
  if (property.type === 'rich_text' && Array.isArray(property.rich_text)) {
    const text = property.rich_text.map((t: any) => t.plain_text || '').join('');
    return text.trim() || null;
  }
  if (property.type === 'title' && Array.isArray(property.title)) {
    const text = property.title.map((t: any) => t.plain_text || '').join('');
    return text.trim() || null;
  }
  return null;
}

export async function resolveMerchantMetadata(
  env: Env,
  logger: Logger,
  options: {
    canvasId?: string | null;
    notionClient?: NotionClient;
    fallbackToNotion?: boolean;
  } = {}
): Promise<MerchantMetadata> {
  const { canvasId, notionClient, fallbackToNotion = true } = options;

  if (!canvasId) {
    return {};
  }

  try {
    const merchant = await getMerchantRow(env, canvasId);
    if (merchant) {
      return {
        canvasId,
        merchantUuid: merchant.merchant_uuid || canvasId,
        merchantName: merchant.name || null,
      };
    }
  } catch (error) {
    logger.warn('Failed to fetch merchant from D1', {
      canvasId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (!fallbackToNotion || !notionClient) {
    return {
      canvasId,
      merchantUuid: canvasId,
      merchantName: null,
    };
  }

  try {
    const page = await notionClient.getPage(canvasId);
    const name = extractPlainText(page?.properties?.Name);
    const merchantUuid = extractPlainText(page?.properties?.['Merchant UUID']);

    return {
      canvasId,
      merchantUuid: merchantUuid || canvasId,
      merchantName: name,
    };
  } catch (error) {
    logger.warn('Failed to fetch merchant metadata from Notion', {
      canvasId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      canvasId,
      merchantUuid: canvasId,
      merchantName: null,
    };
  }
}
