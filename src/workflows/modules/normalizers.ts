import type { Call } from '../../types/openphone';
import type { Message } from '../../types/openphone';
import type { Mail } from '../../types/openphone';
import type { MerchantInteraction } from '../../types/interactions';
import type { MerchantContext } from './merchant';
import type { CallAnalysis, MessageAnalysis, MailAnalysis } from '../../processors/ai-processor';

interface CallNormalizationInput {
  call: Call;
  transcript?: string | null;
  recordingUrl?: string;
  voicemailUrl?: string;
  analysis: CallAnalysis;
  notionPageId: string;
  merchant: MerchantContext;
}

export function normalizeCallInteraction(input: CallNormalizationInput): MerchantInteraction {
  const occurredAt = new Date(input.call.createdAt).getTime();

  return {
    id: input.call.id,
    type: 'call',
    occurredAt,
    summary: input.analysis.summary,
    direction: input.call.direction,
    merchant: normalizeMerchantContext(input.merchant),
    notionPageId: input.notionPageId,
    sources: {
      openphoneId: input.call.id,
      phoneNumberId: input.call.phoneNumberId,
    },
    ai: {
      summary: input.analysis.summary,
      sentiment: input.analysis.sentiment.label,
      sentimentScore: input.analysis.sentiment.score,
      actionItems: input.analysis.actionItems,
      category: input.analysis.category,
      leadScore: input.analysis.leadScore ?? null,
      keywords: input.analysis.keywords,
    },
    metadata: {
      transcript: input.transcript ?? null,
      recordingUrl: input.recordingUrl ?? null,
      voicemailUrl: input.voicemailUrl ?? null,
      duration: input.call.duration,
      participants: input.call.participants,
    },
  };
}

interface MessageNormalizationInput {
  message: Message;
  analysis: MessageAnalysis;
  notionPageId: string;
  merchant: MerchantContext;
}

export function normalizeMessageInteraction(input: MessageNormalizationInput): MerchantInteraction {
  const occurredAt = new Date(input.message.createdAt).getTime();

  return {
    id: input.message.id,
    type: 'message',
    occurredAt,
    summary: input.analysis.summary,
    direction: input.message.direction,
    merchant: normalizeMerchantContext(input.merchant),
    notionPageId: input.notionPageId,
    sources: {
      openphoneId: input.message.id,
      phoneNumberId: input.message.phoneNumberId,
    },
    ai: {
      summary: input.analysis.summary,
      sentiment: input.analysis.sentiment.label,
      sentimentScore: input.analysis.sentiment.score,
      actionItems: input.analysis.actionItems,
      category: input.analysis.category,
    },
    metadata: {
      from: input.message.from,
      to: input.message.to,
      status: input.message.status,
      media: input.message.media ?? [],
    },
  };
}

interface MailNormalizationInput {
  mail: Mail;
  notionPageId: string;
  merchant: MerchantContext;
  analysis?: MailAnalysis;
}

export function normalizeMailInteraction(input: MailNormalizationInput): MerchantInteraction {
  const occurredAt = new Date(input.mail.createdAt).getTime();

  return {
    id: input.mail.id,
    type: 'mail',
    occurredAt,
    summary: input.analysis?.summary ?? input.mail.subject,
    direction: input.mail.direction ?? null,
    merchant: normalizeMerchantContext(input.merchant),
    notionPageId: input.notionPageId,
    sources: {
      mailThreadId: input.mail.threadId ?? input.mail.metadata?.threadId ?? null,
    },
    metadata: {
      subject: input.mail.subject,
      from: input.mail.from,
      to: input.mail.to,
      cc: input.mail.cc ?? [],
      bcc: input.mail.bcc ?? [],
      status: input.mail.status,
      body: input.mail.body,
    },
    ai: input.analysis
      ? {
          summary: input.analysis.summary,
          sentiment: input.analysis.sentiment.label,
          sentimentScore: input.analysis.sentiment.score,
          actionItems: input.analysis.actionItems,
          category: input.analysis.category,
        }
      : undefined,
  };
}

function normalizeMerchantContext(context: MerchantContext): MerchantInteraction['merchant'] {
  const merchantUuid = context.merchantUuid ?? context.canvasId;
  return {
    canvasId: context.canvasId,
    merchantUuid: merchantUuid ?? null,
    merchantName: context.merchantName ?? null,
  };
}
