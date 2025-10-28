import type { Env } from '../../types/env';
import type { Logger } from '../logger';
import {
  getMerchantRollupFromD1,
  buildMerchantRollupFromNotion,
  type MerchantRollup,
  type MerchantRollupLookup,
} from '../merchant-rollup';

export interface MerchantRollupValidationDifference {
  path: string;
  d1Value: unknown;
  notionValue: unknown;
  difference?: number;
}

export interface MerchantRollupValidationResult {
  canvasId?: string;
  merchantUuid?: string | null;
  matches: boolean;
  d1Missing: boolean;
  differences: MerchantRollupValidationDifference[];
  d1Rollup?: MerchantRollup | null;
  notionRollup?: MerchantRollup | null;
}

const COMPARISON_FIELDS: Array<{ path: string; tolerance?: number; treatAsNumber?: boolean }> = [
  { path: 'funding.totalPrincipalAmount', tolerance: 0.01, treatAsNumber: true },
  { path: 'funding.totalPaybackAmount', tolerance: 0.01, treatAsNumber: true },
  { path: 'funding.totalPayments', tolerance: 0.01, treatAsNumber: true },
  { path: 'funding.outstandingPaybackBalance', tolerance: 0.01, treatAsNumber: true },
  { path: 'funding.outstandingPrincipalBalance', tolerance: 0.01, treatAsNumber: true },
  { path: 'funding.averageHoldbackPercent', tolerance: 0.0001, treatAsNumber: true },
  { path: 'funding.activeAdvanceCount', tolerance: 0.1, treatAsNumber: true },
  { path: 'funding.lifetimeSalesAmount', tolerance: 0.01, treatAsNumber: true },
  { path: 'funding.lifetimeSalesCount', tolerance: 0.1, treatAsNumber: true },
  { path: 'communications.totalCallCount', tolerance: 0.1, treatAsNumber: true },
  { path: 'communications.totalMessageCount', tolerance: 0.1, treatAsNumber: true },
  { path: 'communications.totalMailCount', tolerance: 0.1, treatAsNumber: true },
];

function getValueFromPath(rollup: MerchantRollup | null | undefined, path: string): unknown {
  if (!rollup) {
    return undefined;
  }
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current && typeof current === 'object' && segment in (current as Record<string, unknown>)) {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, rollup as unknown);
}

function normalizeNumeric(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function valuesMatch(
  d1Value: unknown,
  notionValue: unknown,
  tolerance = 0,
  treatAsNumber = false
): { matches: boolean; difference?: number } {
  if (d1Value === undefined && notionValue === undefined) {
    return { matches: true };
  }
  if (treatAsNumber) {
    const d1Number = normalizeNumeric(d1Value);
    const notionNumber = normalizeNumeric(notionValue);
    if (d1Number === null && notionNumber === null) {
      return { matches: true };
    }
    if (d1Number === null || notionNumber === null) {
      return { matches: false };
    }
    const difference = Math.abs(d1Number - notionNumber);
    return { matches: difference <= tolerance, difference };
  }

  return { matches: d1Value === notionValue };
}

export async function validateMerchantRollup(
  env: Env,
  logger: Logger,
  lookup: MerchantRollupLookup
): Promise<MerchantRollupValidationResult> {
  const d1Rollup = await getMerchantRollupFromD1(env, lookup);
  const notionRollup = await buildMerchantRollupFromNotion(env, logger, lookup, 'validation_spot_check');

  const differences: MerchantRollupValidationDifference[] = [];

  for (const field of COMPARISON_FIELDS) {
    const d1Value = getValueFromPath(d1Rollup, field.path);
    const notionValue = getValueFromPath(notionRollup, field.path);
    const { matches, difference } = valuesMatch(
      d1Value,
      notionValue,
      field.tolerance ?? 0,
      field.treatAsNumber ?? false
    );
    if (!matches) {
      differences.push({
        path: field.path,
        d1Value,
        notionValue,
        difference,
      });
    }
  }

  const result: MerchantRollupValidationResult = {
    canvasId: d1Rollup?.canvasId ?? notionRollup?.canvasId,
    merchantUuid: d1Rollup?.merchantUuid ?? notionRollup?.merchantUuid ?? null,
    matches: differences.length === 0 && !!d1Rollup,
    d1Missing: !d1Rollup,
    differences,
    d1Rollup,
    notionRollup,
  };

  if (!result.matches) {
    logger.warn('Merchant rollup validation differences detected', {
      lookup,
      differences: result.differences,
    });
  }

  return result;
}
