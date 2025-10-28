import type { Env } from '../types/env';
import type { Logger } from './logger';
import { NotionClient } from './notion-client';

interface MerchantReportingRow {
  canvas_id: string;
  merchant_uuid: string | null;
  canonical_name: string | null;
  canonical_phone: string | null;
  canonical_email: string | null;
  lifecycle_stage: string | null;
  stage_entered_at: number | null;
  stage_exited_at: number | null;
  lifecycle_source: string | null;
  lifecycle_refreshed_at: number | null;
  lifecycle_quality: string | null;
  first_funded_at: number | null;
  latest_funded_at: number | null;
  active_advance_count: number | null;
  total_principal_amount: number | null;
  total_payback_amount: number | null;
  total_payments: number | null;
  outstanding_payback_balance: number | null;
  outstanding_principal_balance: number | null;
  average_holdback_percent: number | null;
  last_batch_date: number | null;
  last_batch_payments: number | null;
  lifetime_sales_amount: number | null;
  lifetime_sales_count: number | null;
  funding_source: string | null;
  funding_refreshed_at: number | null;
  funding_quality: string | null;
  total_call_count: number | null;
  total_message_count: number | null;
  total_mail_count: number | null;
  first_interaction_at: number | null;
  last_interaction_at: number | null;
  last_call_at: number | null;
  last_message_at: number | null;
  last_mail_at: number | null;
  communication_source: string | null;
  communication_refreshed_at: number | null;
  communication_quality: string | null;
  merchant_last_synced_at: number | null;
}

export interface MerchantRollupLookup {
  merchantUuid?: string;
  canvasId?: string;
}

export interface MerchantRollup {
  canvasId: string;
  merchantUuid?: string | null;
  canonicalName?: string | null;
  canonicalPhone?: string | null;
  canonicalEmail?: string | null;
  lifecycle?: {
    stage?: string | null;
    stageEnteredAt?: string | null;
    stageExitedAt?: string | null;
    source?: string | null;
    lastRefreshedAt?: string | null;
    qualityFlags?: string[];
  };
  funding?: {
    firstFundedAt?: string | null;
    latestFundedAt?: string | null;
    activeAdvanceCount?: number | null;
    totalPrincipalAmount?: number | null;
    totalPaybackAmount?: number | null;
    totalPayments?: number | null;
    outstandingPaybackBalance?: number | null;
    outstandingPrincipalBalance?: number | null;
    averageHoldbackPercent?: number | null;
    lastBatchDate?: string | null;
    lastBatchPayments?: number | null;
    lifetimeSalesAmount?: number | null;
    lifetimeSalesCount?: number | null;
    source?: string | null;
    lastRefreshedAt?: string | null;
    qualityFlags?: string[];
  };
  communications?: {
    totalCallCount?: number | null;
    totalMessageCount?: number | null;
    totalMailCount?: number | null;
    firstInteractionAt?: string | null;
    lastInteractionAt?: string | null;
    lastCallAt?: string | null;
    lastMessageAt?: string | null;
    lastMailAt?: string | null;
    source?: string | null;
    lastRefreshedAt?: string | null;
    qualityFlags?: string[];
  };
  merchantLastSyncedAt?: string | null;
  source: 'd1' | 'notion';
  fallbackReason?: string;
}

interface MerchantIdentifiers {
  canvasId: string;
  merchantUuid?: string | null;
  merchantLastSyncedAt?: number | null;
}

function toIso(timestamp?: number | null): string | null {
  if (!timestamp || Number.isNaN(timestamp)) {
    return null;
  }
  try {
    return new Date(Number(timestamp)).toISOString();
  } catch (error) {
    console.warn('Failed to convert timestamp to ISO string', { timestamp, error });
    return null;
  }
}

function parseQualityFlags(value: string | null | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed as string[];
    }
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).flags)) {
      return (parsed as any).flags as string[];
    }
    if (typeof parsed === 'string') {
      return [parsed];
    }
  } catch (error) {
    console.warn('Unable to parse quality flags JSON, returning raw string', { value, error });
  }
  return [value];
}

async function fetchRollupRow(
  env: Env,
  field: 'merchant_uuid' | 'canvas_id',
  value: string
): Promise<MerchantReportingRow | null> {
  const statement = `SELECT * FROM merchant_reporting_rollup WHERE ${field} = ?`;
  const row = await env.DB.prepare(statement).bind(value).first<MerchantReportingRow>();
  return row ?? null;
}

function mapRowToRollup(row: MerchantReportingRow): MerchantRollup {
  return {
    canvasId: row.canvas_id,
    merchantUuid: row.merchant_uuid,
    canonicalName: row.canonical_name,
    canonicalPhone: row.canonical_phone,
    canonicalEmail: row.canonical_email,
    lifecycle: {
      stage: row.lifecycle_stage,
      stageEnteredAt: toIso(row.stage_entered_at),
      stageExitedAt: toIso(row.stage_exited_at),
      source: row.lifecycle_source ?? undefined,
      lastRefreshedAt: toIso(row.lifecycle_refreshed_at),
      qualityFlags: parseQualityFlags(row.lifecycle_quality),
    },
    funding: {
      firstFundedAt: toIso(row.first_funded_at),
      latestFundedAt: toIso(row.latest_funded_at),
      activeAdvanceCount: row.active_advance_count,
      totalPrincipalAmount: row.total_principal_amount,
      totalPaybackAmount: row.total_payback_amount,
      totalPayments: row.total_payments,
      outstandingPaybackBalance: row.outstanding_payback_balance,
      outstandingPrincipalBalance: row.outstanding_principal_balance,
      averageHoldbackPercent: row.average_holdback_percent,
      lastBatchDate: toIso(row.last_batch_date),
      lastBatchPayments: row.last_batch_payments,
      lifetimeSalesAmount: row.lifetime_sales_amount,
      lifetimeSalesCount: row.lifetime_sales_count,
      source: row.funding_source ?? undefined,
      lastRefreshedAt: toIso(row.funding_refreshed_at),
      qualityFlags: parseQualityFlags(row.funding_quality),
    },
    communications: {
      totalCallCount: row.total_call_count,
      totalMessageCount: row.total_message_count,
      totalMailCount: row.total_mail_count,
      firstInteractionAt: toIso(row.first_interaction_at),
      lastInteractionAt: toIso(row.last_interaction_at),
      lastCallAt: toIso(row.last_call_at),
      lastMessageAt: toIso(row.last_message_at),
      lastMailAt: toIso(row.last_mail_at),
      source: row.communication_source ?? undefined,
      lastRefreshedAt: toIso(row.communication_refreshed_at),
      qualityFlags: parseQualityFlags(row.communication_quality),
    },
    merchantLastSyncedAt: toIso(row.merchant_last_synced_at),
    source: 'd1',
  };
}

export async function getMerchantRollupFromD1(
  env: Env,
  lookup: MerchantRollupLookup
): Promise<MerchantRollup | null> {
  if (lookup.merchantUuid) {
    const row = await fetchRollupRow(env, 'merchant_uuid', lookup.merchantUuid);
    if (row) {
      return mapRowToRollup(row);
    }
  }
  if (lookup.canvasId) {
    const row = await fetchRollupRow(env, 'canvas_id', lookup.canvasId);
    if (row) {
      return mapRowToRollup(row);
    }
  }
  return null;
}

async function resolveMerchantIdentifiers(
  env: Env,
  lookup: MerchantRollupLookup
): Promise<MerchantIdentifiers | null> {
  if (!lookup.merchantUuid && !lookup.canvasId) {
    return null;
  }

  if (lookup.canvasId && lookup.merchantUuid) {
    const merchantRow = await env.DB.prepare(
      'SELECT merchant_uuid, last_synced_at FROM merchants WHERE canvas_id = ?'
    )
      .bind(lookup.canvasId)
      .first<{ merchant_uuid: string | null; last_synced_at: number | null }>();
    return {
      canvasId: lookup.canvasId,
      merchantUuid: merchantRow?.merchant_uuid ?? lookup.merchantUuid ?? null,
      merchantLastSyncedAt: merchantRow?.last_synced_at ?? null,
    };
  }

  if (lookup.canvasId) {
    const merchantRow = await env.DB.prepare(
      'SELECT merchant_uuid, last_synced_at FROM merchants WHERE canvas_id = ?'
    )
      .bind(lookup.canvasId)
      .first<{ merchant_uuid: string | null; last_synced_at: number | null }>();
    return {
      canvasId: lookup.canvasId,
      merchantUuid: merchantRow?.merchant_uuid ?? null,
      merchantLastSyncedAt: merchantRow?.last_synced_at ?? null,
    };
  }

  // Must look up by merchant UUID to retrieve Canvas identifier
  const merchantRow = await env.DB.prepare(
    'SELECT canvas_id, merchant_uuid, last_synced_at FROM merchants WHERE merchant_uuid = ?'
  )
    .bind(lookup.merchantUuid)
    .first<{ canvas_id: string; merchant_uuid: string | null; last_synced_at: number | null }>();

  if (!merchantRow?.canvas_id) {
    return null;
  }

  return {
    canvasId: merchantRow.canvas_id,
    merchantUuid: merchantRow.merchant_uuid ?? lookup.merchantUuid ?? null,
    merchantLastSyncedAt: merchantRow.last_synced_at ?? null,
  };
}

function getTitleText(property: any): string | null {
  if (!property) {
    return null;
  }
  if (Array.isArray(property.title)) {
    return property.title.map((t: any) => t.plain_text).join('').trim() || null;
  }
  return null;
}

function getNumber(property: any): number | null {
  if (!property) {
    return null;
  }
  if (typeof property.number === 'number') {
    return property.number;
  }
  return null;
}

function getDate(property: any): number | null {
  if (!property?.date?.start) {
    return null;
  }
  const dateValue = property.date.start;
  try {
    const parsed = Date.parse(dateValue);
    if (Number.isNaN(parsed)) {
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn('Failed to parse Notion date property', { dateValue, error });
    return null;
  }
}

async function queryAllNotionRecords(
  notionClient: NotionClient,
  databaseId: string,
  body: { filter?: any; sorts?: any }
): Promise<any[]> {
  const results: any[] = [];
  let startCursor: string | undefined = undefined;

  do {
    const response = await notionClient.queryDatabase(databaseId, {
      filter: body.filter,
      sorts: body.sorts,
      startCursor,
      pageSize: 100,
    });
    if (response?.results) {
      results.push(...response.results);
    }
    startCursor = response?.has_more ? response?.next_cursor ?? undefined : undefined;
  } while (startCursor);

  return results;
}

function ensureQualityFlags(flags: string[]): string[] | undefined {
  if (!flags.length) {
    return undefined;
  }
  return Array.from(new Set(flags));
}

export async function buildMerchantRollupFromNotion(
  env: Env,
  logger: Logger,
  lookup: MerchantRollupLookup,
  fallbackReason?: string
): Promise<MerchantRollup | null> {
  const identifiers = await resolveMerchantIdentifiers(env, lookup);
  if (!identifiers) {
    logger.warn('Unable to resolve merchant identifiers for rollup fallback', lookup);
    return null;
  }

  const notionClient = new NotionClient(env, logger);
  const canvasPage = await notionClient.getPage(identifiers.canvasId);
  if (!canvasPage) {
    logger.warn('Canvas page missing for merchant rollup fallback', identifiers);
    return null;
  }

  const lifecycleFlags: string[] = [];
  const fundingFlags: string[] = [];
  const communicationFlags: string[] = [];

  const canvasName = getTitleText(canvasPage.properties?.Name) ?? null;
  let canonicalName = canvasName;
  const canonicalPhone = canvasPage.properties?.Phone?.phone_number ?? null;
  const canonicalEmail = canvasPage.properties?.Email?.email ?? null;
  const lifecycleStage = canvasPage.properties?.Status?.status?.name
    ?? canvasPage.properties?.Status?.select?.name
    ?? null;
  const stageEnteredAt = getDate(canvasPage.properties?.['Created time'])
    ?? (canvasPage.created_time ? Date.parse(canvasPage.created_time) : null);
  const stageExitedAt = getDate(canvasPage.properties?.['Last edited time'])
    ?? (canvasPage.last_edited_time ? Date.parse(canvasPage.last_edited_time) : null);

  // Funding metrics from Funding database
  const fundingDatabaseId = notionClient.getFundingDatabaseId(false);
  let fundingRecords: any[] = [];
  if (fundingDatabaseId) {
    try {
      if (canonicalName) {
        fundingRecords = await queryAllNotionRecords(notionClient, fundingDatabaseId, {
          filter: {
            property: 'Merchant',
            title: { equals: canonicalName },
          },
        });
        if (!fundingRecords.length) {
          fundingRecords = await queryAllNotionRecords(notionClient, fundingDatabaseId, {
            filter: {
              property: 'Merchant',
              title: { contains: canonicalName },
            },
          });
        }
      }
      if (!fundingRecords.length) {
        logger.info('No Funding records matched Canvas name, performing UUID lookup if available', {
          merchantUuid: identifiers.merchantUuid,
        });
        if (identifiers.merchantUuid) {
          fundingRecords = await queryAllNotionRecords(notionClient, fundingDatabaseId, {
            filter: {
              property: 'Merchant UUID',
              rich_text: { equals: identifiers.merchantUuid },
            },
          });
        }
      }
    } catch (error) {
      logger.error('Failed to query Funding database for merchant rollup', { error, identifiers });
      fundingFlags.push('funding_query_failed');
    }
  } else {
    fundingFlags.push('funding_database_unconfigured');
  }

  let totalPrincipal = 0;
  let totalPayback = 0;
  let totalPayments = 0;
  let outstandingPayback = 0;
  let outstandingPrincipal = 0;
  let firstFundedAt: number | null = null;
  let latestFundedAt: number | null = null;
  let activeAdvanceCount = 0;
  const holdbackValues: number[] = [];
  let lastBatchDateFromFunding: number | null = null;

  const activeStatuses = new Set(['Active', 'Current', 'First']);

  for (const record of fundingRecords) {
    const properties = record.properties ?? {};
    const merchantTitle = getTitleText(properties.Merchant);
    if (merchantTitle) {
      canonicalName = merchantTitle;
    }

    const principal = getNumber(properties['Principal Amount']) ?? 0;
    const payback = getNumber(properties['Payback Amount']) ?? 0;
    const payments = getNumber(properties.Payments) ?? 0;
    const paybackBalance = getNumber(properties['Payback Balance']) ?? 0;
    const principalBalance = getNumber(properties['Principle Balance']) ?? 0;
    const holdback = getNumber(properties['CC Split %']);
    const confirmationDate = getDate(properties['Confirmation Date']);
    const lastBatchDate = getDate(properties['Last Batch Date']);
    const percentagePaid = getNumber(properties['Percentage Paid']);
    const status = properties['Funding Status']?.select?.name ?? null;

    totalPrincipal += principal;
    totalPayback += payback;
    totalPayments += payments;
    outstandingPayback += paybackBalance;
    outstandingPrincipal += principalBalance;

    if (holdback !== null) {
      holdbackValues.push(holdback);
      if (holdback > 1) {
        fundingFlags.push('holdback_not_decimal');
      }
    }

    if (percentagePaid !== null && percentagePaid > 1.05) {
      fundingFlags.push('percentage_paid_out_of_bounds');
    }

    if (confirmationDate) {
      if (!firstFundedAt || confirmationDate < firstFundedAt) {
        firstFundedAt = confirmationDate;
      }
      if (!latestFundedAt || confirmationDate > latestFundedAt) {
        latestFundedAt = confirmationDate;
      }
    }

    if (lastBatchDate) {
      if (!lastBatchDateFromFunding || lastBatchDate > lastBatchDateFromFunding) {
        lastBatchDateFromFunding = lastBatchDate;
      }
    }

    if (status && activeStatuses.has(status)) {
      activeAdvanceCount += 1;
    }
  }

  const averageHoldbackPercent = holdbackValues.length
    ? holdbackValues.reduce((sum, value) => sum + value, 0) / holdbackValues.length
    : null;

  // Batch metrics sourced from processor batches
  const batchesDatabaseId = notionClient.getBatchesDatabaseId(false);
  let batchRecords: any[] = [];
  if (batchesDatabaseId) {
    try {
      if (canonicalName) {
        batchRecords = await queryAllNotionRecords(notionClient, batchesDatabaseId, {
          filter: {
            property: 'Name',
            title: { equals: canonicalName },
          },
        });
        if (!batchRecords.length) {
          batchRecords = await queryAllNotionRecords(notionClient, batchesDatabaseId, {
            filter: {
              property: 'Name',
              title: { contains: canonicalName },
            },
          });
        }
      }
    } catch (error) {
      logger.error('Failed to query Batches database for merchant rollup', { error, identifiers });
      fundingFlags.push('batch_query_failed');
    }
  } else {
    fundingFlags.push('batches_database_unconfigured');
  }

  let lifetimeSalesAmount = 0;
  let lifetimeSalesCount = 0;
  let lastBatchDateFromBatches: number | null = null;
  let lastBatchPayments = 0;

  for (const record of batchRecords) {
    const properties = record.properties ?? {};
    const salesAmount = getNumber(properties['Sales Amt.']) ?? 0;
    const salesCount = getNumber(properties['Sales Ct.']) ?? 0;
    const payments = getNumber(properties.Payments) ?? 0;
    const batchDate = getDate(properties['Batch Date']);

    lifetimeSalesAmount += salesAmount;
    lifetimeSalesCount += salesCount;

    if (batchDate) {
      if (!lastBatchDateFromBatches || batchDate > lastBatchDateFromBatches) {
        lastBatchDateFromBatches = batchDate;
        lastBatchPayments = payments;
      }
    }
  }

  const lastBatchDate = lastBatchDateFromBatches ?? lastBatchDateFromFunding;

  // Communication metrics (calls, messages, mail)
  const callResults = await queryAllNotionRecords(notionClient, notionClient.getCallsDatabaseId(), {
    filter: {
      property: 'Canvas',
      relation: { contains: identifiers.canvasId },
    },
  });

  const messageResults = await queryAllNotionRecords(
    notionClient,
    notionClient.getMessagesDatabaseId(),
    {
      filter: {
        property: 'Canvas',
        relation: { contains: identifiers.canvasId },
      },
    }
  );

  const mailResults = await queryAllNotionRecords(notionClient, notionClient.getMailDatabaseId(), {
    filter: {
      property: 'Canvas',
      relation: { contains: identifiers.canvasId },
    },
  });

  let firstInteractionAt: number | null = null;
  let lastInteractionAt: number | null = null;
  let lastCallAt: number | null = null;
  let lastMessageAt: number | null = null;
  let lastMailAt: number | null = null;

  function processTimestamp(
    current: number | null,
    next: number | null,
    flags: string[],
    flagLabel: string
  ): number | null {
    if (!next) {
      flags.push(flagLabel);
      return current;
    }
    if (!current || next < current) {
      return next;
    }
    return current;
  }

  function updateLatest(current: number | null, next: number | null): number | null {
    if (!next) {
      return current;
    }
    if (!current || next > current) {
      return next;
    }
    return current;
  }

  for (const call of callResults) {
    const callTimestamp = getDate(call.properties?.['Call Date'])
      ?? (call.properties?.['Created time']?.created_time ? Date.parse(call.properties['Created time'].created_time) : null)
      ?? (call.created_time ? Date.parse(call.created_time) : null);
    firstInteractionAt = processTimestamp(firstInteractionAt, callTimestamp, communicationFlags, 'call_missing_timestamp');
    lastInteractionAt = updateLatest(lastInteractionAt, callTimestamp);
    lastCallAt = updateLatest(lastCallAt, callTimestamp);
  }

  for (const message of messageResults) {
    const messageTimestamp = getDate(message.properties?.['Created time'])
      ?? (message.last_edited_time ? Date.parse(message.last_edited_time) : null)
      ?? (message.created_time ? Date.parse(message.created_time) : null);
    firstInteractionAt = processTimestamp(firstInteractionAt, messageTimestamp, communicationFlags, 'message_missing_timestamp');
    lastInteractionAt = updateLatest(lastInteractionAt, messageTimestamp);
    lastMessageAt = updateLatest(lastMessageAt, messageTimestamp);
  }

  for (const mail of mailResults) {
    const mailTimestamp = getDate(mail.properties?.['Date Received'])
      ?? getDate(mail.properties?.Date)
      ?? (mail.created_time ? Date.parse(mail.created_time) : null);
    firstInteractionAt = processTimestamp(firstInteractionAt, mailTimestamp, communicationFlags, 'mail_missing_timestamp');
    lastInteractionAt = updateLatest(lastInteractionAt, mailTimestamp);
    lastMailAt = updateLatest(lastMailAt, mailTimestamp);
  }

  if (!callResults.length && !messageResults.length && !mailResults.length) {
    communicationFlags.push('no_interactions_in_notion');
  }

  const rollup: MerchantRollup = {
    canvasId: identifiers.canvasId,
    merchantUuid: identifiers.merchantUuid ?? null,
    canonicalName,
    canonicalPhone,
    canonicalEmail,
    lifecycle: {
      stage: lifecycleStage,
      stageEnteredAt: toIso(stageEnteredAt),
      stageExitedAt: toIso(stageExitedAt),
      source: 'notion',
      lastRefreshedAt: new Date().toISOString(),
      qualityFlags: ensureQualityFlags(lifecycleFlags),
    },
    funding: {
      firstFundedAt: toIso(firstFundedAt),
      latestFundedAt: toIso(latestFundedAt),
      activeAdvanceCount,
      totalPrincipalAmount: totalPrincipal,
      totalPaybackAmount: totalPayback,
      totalPayments,
      outstandingPaybackBalance: outstandingPayback,
      outstandingPrincipalBalance: outstandingPrincipal,
      averageHoldbackPercent,
      lastBatchDate: toIso(lastBatchDate),
      lastBatchPayments,
      lifetimeSalesAmount,
      lifetimeSalesCount,
      source: 'notion',
      lastRefreshedAt: new Date().toISOString(),
      qualityFlags: ensureQualityFlags(fundingFlags),
    },
    communications: {
      totalCallCount: callResults.length,
      totalMessageCount: messageResults.length,
      totalMailCount: mailResults.length,
      firstInteractionAt: toIso(firstInteractionAt),
      lastInteractionAt: toIso(lastInteractionAt),
      lastCallAt: toIso(lastCallAt),
      lastMessageAt: toIso(lastMessageAt),
      lastMailAt: toIso(lastMailAt),
      source: 'notion',
      lastRefreshedAt: new Date().toISOString(),
      qualityFlags: ensureQualityFlags(communicationFlags),
    },
    merchantLastSyncedAt: toIso(identifiers.merchantLastSyncedAt),
    source: 'notion',
    fallbackReason,
  };

  return rollup;
}

export interface MerchantRollupWithSource extends MerchantRollup {
  source: 'd1' | 'notion';
}
