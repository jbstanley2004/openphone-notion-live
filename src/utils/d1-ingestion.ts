import type { Env } from '../types/env';
import type { Logger } from './logger';
import type {
  Call,
  CallRecording,
  CallSummary,
  CallTranscript,
  CallVoicemail,
  Message,
} from '../types/openphone';
import { getCache, setCache } from './helpers';
import {
  MerchantUpsertContext,
  recordInteraction,
  upsertMailThread,
  upsertMerchantFromCanvasPage,
} from './d1-merchants';
import type { NotionClient } from './notion-client';
import type { MerchantInteraction } from '../types/interactions';
import { resolveMerchantMetadata } from './merchant-metadata';

interface CompleteCallData {
  call: Call;
  recordings: CallRecording[];
  transcript: CallTranscript | null;
  summary: CallSummary | null;
  voicemail: CallVoicemail | null;
}

export interface CallSyncOptions {
  notionPageId?: string;
  recordingUrl?: string;
  voicemailUrl?: string;
}

export interface MessageSyncOptions {
  notionPageId?: string;
}

export interface MailSyncInput {
  id: string;
  subject: string;
  body?: string | null;
  from?: string | null;
  to?: string[] | null;
  direction?: 'incoming' | 'outgoing' | string | null;
  status?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  threadId?: string | null;
  metadata?: Record<string, any> | null;
  canvasId?: string | null;
}

export interface MailSyncOptions {
  notionPageId?: string;
}

async function getCanvasPage(
  env: Env,
  notionClient: NotionClient,
  canvasId: string,
  logger: Logger
): Promise<any | null> {
  const cacheKey = `canvas-page:${canvasId}`;
  const cached = await getCache<any>(env.CACHE, cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const page = await notionClient.getPage(canvasId);
    if (page) {
      await setCache(env.CACHE, cacheKey, page, 3600);
    }
    return page;
  } catch (error) {
    logger.warn('Failed to fetch Canvas page for D1 sync', {
      canvasId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function extractCallSentiment(summary: CallSummary | null): string | null {
  if (!summary?.jobs) {
    return null;
  }

  for (const job of summary.jobs) {
    const entries = job?.result?.data ?? [];
    for (const entry of entries) {
      const name = String(entry.name ?? '').toLowerCase();
      if (name.includes('sentiment')) {
        if (typeof entry.value === 'string') {
          return entry.value;
        }
        if (typeof entry.value === 'number') {
          return entry.value.toString();
        }
      }
    }
  }

  return null;
}

function extractCallLeadScore(summary: CallSummary | null): number | null {
  if (!summary?.jobs) {
    return null;
  }

  for (const job of summary.jobs) {
    const entries = job?.result?.data ?? [];
    for (const entry of entries) {
      const name = String(entry.name ?? '').toLowerCase();
      if (name.includes('lead') && name.includes('score')) {
        if (typeof entry.value === 'number') {
          return entry.value;
        }
        const parsed = Number(entry.value);
        if (!Number.isNaN(parsed)) {
          return parsed;
        }
      }
    }
  }

  return null;
}

export async function syncCallToD1(
  completeCall: CompleteCallData,
  env: Env,
  notionClient: NotionClient,
  logger: Logger,
  options: CallSyncOptions = {}
): Promise<MerchantInteraction | null> {
  const canvasId = await notionClient.resolveCanvasForCall(completeCall.call);
  if (!canvasId) {
    logger.debug('Skipping D1 call sync - no Canvas match found', {
      callId: completeCall.call.id,
    });
    return null;
  }

  const canvasPage = await getCanvasPage(env, notionClient, canvasId, logger);
  if (!canvasPage) {
    return null;
  }

  const occurredAt = new Date(completeCall.call.createdAt).getTime();
  const summaryText = completeCall.summary?.summary?.join('\n') ?? null;
  const sentiment = extractCallSentiment(completeCall.summary);
  const leadScore = extractCallLeadScore(completeCall.summary);

  const merchantContext: MerchantUpsertContext = {
    interactionTimestamp: occurredAt,
    interactionType: 'call',
    summary: summaryText,
  };

  await upsertMerchantFromCanvasPage(env, logger, canvasPage, merchantContext);

  const merchantMetadata = await resolveMerchantMetadata(env, logger, {
    canvasId,
    notionClient,
  });

  const interaction: MerchantInteraction = {
    id: completeCall.call.id,
    type: 'call',
    occurredAt,
    summary: summaryText ?? `Call ${completeCall.call.direction}`,
    direction: completeCall.call.direction,
    merchant: {
      canvasId,
      merchantUuid: merchantMetadata.merchantUuid ?? canvasId,
      merchantName: merchantMetadata.merchantName ?? null,
    },
    notionPageId: options.notionPageId ?? null,
    sources: {
      openphoneId: completeCall.call.id,
      phoneNumberId: completeCall.call.phoneNumberId,
    },
    ai: {
      summary: summaryText,
      sentiment,
      sentimentScore: null,
      actionItems: completeCall.summary?.nextSteps ?? [],
      category: null,
      leadScore,
      keywords: [],
    },
    metadata: {
      duration: completeCall.call.duration,
      participants: completeCall.call.participants,
      recordingUrl: options.recordingUrl ?? completeCall.recordings?.[0]?.url ?? null,
      voicemailUrl: options.voicemailUrl ?? completeCall.voicemail?.url ?? null,
      transcriptStatus: completeCall.transcript?.status ?? null,
      nextSteps: completeCall.summary?.nextSteps ?? [],
      jobs: completeCall.summary?.jobs ?? null,
    },
  };

  await recordInteraction(env, logger, {
    id: completeCall.call.id,
    canvasId,
    interactionType: 'call',
    occurredAt,
    summary: summaryText ?? `Call ${completeCall.call.direction}`,
    direction: completeCall.call.direction,
    sentiment,
    leadScore,
    notionPageId: options.notionPageId ?? null,
    openphoneId: completeCall.call.id,
    metadata: interaction.metadata,
  });

  return interaction;
}

export async function syncMessageToD1(
  message: Message,
  env: Env,
  notionClient: NotionClient,
  logger: Logger,
  options: MessageSyncOptions = {}
): Promise<MerchantInteraction | null> {
  const canvasId = await notionClient.resolveCanvasForMessage(message);
  if (!canvasId) {
    logger.debug('Skipping D1 message sync - no Canvas match', {
      messageId: message.id,
    });
    return null;
  }

  const canvasPage = await getCanvasPage(env, notionClient, canvasId, logger);
  if (!canvasPage) {
    return null;
  }

  const occurredAt = new Date(message.createdAt).getTime();
  const summary = message.text?.slice(0, 500) ?? '';

  const merchantContext: MerchantUpsertContext = {
    interactionTimestamp: occurredAt,
    interactionType: 'message',
    summary,
  };

  await upsertMerchantFromCanvasPage(env, logger, canvasPage, merchantContext);

  const merchantMetadata = await resolveMerchantMetadata(env, logger, {
    canvasId,
    notionClient,
  });

  const interaction: MerchantInteraction = {
    id: message.id,
    type: 'message',
    occurredAt,
    summary,
    direction: message.direction,
    merchant: {
      canvasId,
      merchantUuid: merchantMetadata.merchantUuid ?? canvasId,
      merchantName: merchantMetadata.merchantName ?? null,
    },
    notionPageId: options.notionPageId ?? null,
    sources: {
      openphoneId: message.id,
      phoneNumberId: message.phoneNumberId,
    },
    metadata: {
      from: message.from,
      to: message.to,
      status: message.status,
      media: message.media ?? [],
      phoneNumberId: message.phoneNumberId,
    },
  };

  await recordInteraction(env, logger, {
    id: message.id,
    canvasId,
    interactionType: 'message',
    occurredAt,
    summary,
    direction: message.direction,
    notionPageId: options.notionPageId ?? null,
    openphoneId: message.id,
    metadata: interaction.metadata,
  });

  return interaction;
}

export async function syncMailToD1(
  mail: MailSyncInput,
  env: Env,
  notionClient: NotionClient,
  logger: Logger,
  options: MailSyncOptions = {}
): Promise<MerchantInteraction | null> {
  const normalizedDirection = typeof mail.direction === 'string'
    ? mail.direction.toLowerCase()
    : undefined;

  const resolvedCanvasId = mail.canvasId
    ?? (await notionClient.resolveCanvasForMail({
      direction: normalizedDirection,
      from: mail.from ?? '',
      to: mail.to ?? [],
    }));

  if (!resolvedCanvasId) {
    logger.debug('Skipping D1 mail sync - no Canvas match', {
      mailId: mail.id,
    });
    return null;
  }

  const canvasPage = await getCanvasPage(env, notionClient, resolvedCanvasId, logger);
  if (!canvasPage) {
    return null;
  }

  const occurredAt = new Date(mail.createdAt).getTime();
  const merchantContext: MerchantUpsertContext = {
    interactionTimestamp: occurredAt,
    interactionType: 'mail',
    summary: mail.subject,
  };

  await upsertMerchantFromCanvasPage(env, logger, canvasPage, merchantContext);

  const merchantMetadata = await resolveMerchantMetadata(env, logger, {
    canvasId: resolvedCanvasId,
    notionClient,
  });

  const interaction: MerchantInteraction = {
    id: mail.id,
    type: 'mail',
    occurredAt,
    summary: mail.subject,
    direction: normalizedDirection ?? null,
    merchant: {
      canvasId: resolvedCanvasId,
      merchantUuid: merchantMetadata.merchantUuid ?? resolvedCanvasId,
      merchantName: merchantMetadata.merchantName ?? null,
    },
    notionPageId: options.notionPageId ?? null,
    sources: {
      mailThreadId: mail.threadId ?? null,
    },
    metadata: {
      from: mail.from,
      to: mail.to,
      status: mail.status,
      body: mail.body,
      extra: mail.metadata ?? null,
    },
  };

  await recordInteraction(env, logger, {
    id: mail.id,
    canvasId: resolvedCanvasId,
    interactionType: 'mail',
    occurredAt,
    summary: mail.subject,
    direction: normalizedDirection ?? null,
    notionPageId: options.notionPageId ?? null,
    metadata: interaction.metadata,
  });

  if (mail.threadId) {
    await upsertMailThread(env, logger, {
      threadId: mail.threadId,
      canvasId: resolvedCanvasId,
      subject: mail.subject,
      lastMessagePreview: mail.body?.slice(0, 200) ?? null,
      lastMessageAt: occurredAt,
      messageCount: undefined,
      participants: [mail.from, ...(mail.to ?? [])].filter(Boolean) as string[],
      metadata: mail.metadata ?? undefined,
    });
  }

  return interaction;
}
