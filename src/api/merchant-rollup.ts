import type { Env } from '../types/env';
import type { Logger } from '../utils/logger';
import {
  getMerchantRollupFromD1,
  buildMerchantRollupFromNotion,
  type MerchantRollup,
  type MerchantRollupLookup,
} from '../utils/merchant-rollup';

export interface MerchantRollupResponse extends MerchantRollup {
  source: 'd1' | 'notion';
}

export async function getMerchantRollup(
  lookup: MerchantRollupLookup,
  env: Env,
  logger: Logger,
  options: { fallbackToNotion?: boolean } = {}
): Promise<MerchantRollupResponse> {
  if (!lookup.merchantUuid && !lookup.canvasId) {
    throw new Error('Either merchantUuid or canvasId must be provided to retrieve a merchant rollup');
  }

  const d1Rollup = await getMerchantRollupFromD1(env, lookup);
  if (d1Rollup) {
    logger.info('Merchant rollup served from D1', {
      canvasId: d1Rollup.canvasId,
      merchantUuid: d1Rollup.merchantUuid,
    });
    return d1Rollup;
  }

  if (!options.fallbackToNotion) {
    throw new Error('Merchant rollup is unavailable in D1 and Notion fallback is disabled');
  }

  logger.warn('Merchant rollup not found in D1, building on-demand from Notion', lookup);
  const fallback = await buildMerchantRollupFromNotion(env, logger, lookup, 'd1_rollup_missing');
  if (!fallback) {
    throw new Error('Unable to build merchant rollup from Notion');
  }

  return fallback;
}
