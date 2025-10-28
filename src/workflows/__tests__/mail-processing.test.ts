import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mail } from '../../types/openphone';
import type { Env } from '../../types/env';
import { MailProcessingWorkflow } from '../mail-processing';
import type { WorkflowStep } from '../types';
import { analyzeMailWithAI } from '../../processors/ai-processor';
import { indexMail } from '../../utils/vector-search';
import {
  resolveMerchantContextForMail,
  withMerchantUuid,
} from '../modules/merchant';
import { publishMerchantInteraction } from '../modules/merchant-interaction';

vi.mock('../../utils/logger', () => {
  const logger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    startTimer: vi.fn(() => vi.fn()),
    logWorkflowStep: vi.fn(),
  };

  return {
    createLogger: vi.fn(() => logger),
  };
});

vi.mock('../../processors/ai-processor', () => ({
  analyzeMailWithAI: vi.fn(),
}));

vi.mock('../../utils/vector-search', () => ({
  indexMail: vi.fn(),
}));

vi.mock('../modules/merchant', () => ({
  resolveMerchantContextForMail: vi.fn(),
  withMerchantUuid: vi.fn((context) => context),
}));

vi.mock('../modules/merchant-interaction', () => ({
  publishMerchantInteraction: vi.fn(),
}));

const { notionClientMock, createNotionClientMock } = vi.hoisted(() => {
  const mock = {
    mailPageExists: vi.fn<[string], Promise<string | null>>(),
    createMailPage: vi.fn<[Mail], Promise<string>>(),
    updateMailPage: vi.fn<[string, Mail], Promise<void>>(),
  };

  return {
    notionClientMock: mock,
    createNotionClientMock: vi.fn(() => mock),
  };
});

vi.mock('../modules/resources', () => ({
  createNotionClient: createNotionClientMock,
}));

const analyzeMailWithAIMock = vi.mocked(analyzeMailWithAI);
const indexMailMock = vi.mocked(indexMail);
const resolveMerchantContextForMailMock = vi.mocked(resolveMerchantContextForMail);
const withMerchantUuidMock = vi.mocked(withMerchantUuid);
const publishMerchantInteractionMock = vi.mocked(publishMerchantInteraction);

function createEnv(): Env {
  return {
    NOTION_API_KEY: 'test-key',
    NOTION_CALLS_DATABASE_ID: 'calls',
    NOTION_MESSAGES_DATABASE_ID: 'messages',
    NOTION_CANVAS_DATABASE_ID: 'canvas',
    NOTION_MAIL_DATABASE_ID: 'mail',
  } as unknown as Env;
}

function createWorkflowStep(): WorkflowStep {
  return {
    do: vi.fn(async (_name, fn) => fn()),
    sleep: vi.fn(),
  };
}

describe('MailProcessingWorkflow', () => {
  beforeEach(() => {
    analyzeMailWithAIMock.mockResolvedValue({
      sentiment: { label: 'neutral', score: 0.5 },
      summary: 'Mail summary',
      actionItems: [],
      category: 'general',
    });
    indexMailMock.mockResolvedValue(undefined);
    resolveMerchantContextForMailMock.mockResolvedValue({
      canvasId: 'canvas-123',
      merchantUuid: 'merchant-123',
      merchantName: 'Acme Corp',
    });
    withMerchantUuidMock.mockImplementation((context) =>
      context.merchantUuid ? context : { ...context, merchantUuid: context.canvasId }
    );
    publishMerchantInteractionMock.mockResolvedValue(undefined);
    createNotionClientMock.mockClear();
    createNotionClientMock.mockReturnValue(notionClientMock);

    notionClientMock.mailPageExists.mockReset();
    notionClientMock.createMailPage.mockReset();
    notionClientMock.updateMailPage.mockReset();
    analyzeMailWithAIMock.mockClear();
    indexMailMock.mockClear();
    resolveMerchantContextForMailMock.mockClear();
    withMerchantUuidMock.mockClear();
    publishMerchantInteractionMock.mockClear();
  });

  it('updates an existing Notion mail page on the second event', async () => {
    const workflow = new MailProcessingWorkflow();
    const step = createWorkflowStep();
    const env = createEnv();

    const baseMail: Mail = {
      id: 'mail-1',
      object: 'mail',
      from: 'sender@example.com',
      to: ['recipient@example.com'],
      subject: 'Quarterly Update',
      body: 'Hello there',
      direction: 'incoming',
      status: 'sent',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      attachments: [],
      threadId: 'thread-1',
      metadata: { mimeMessageId: 'mime-1' },
    };

    notionClientMock.mailPageExists
      .mockResolvedValueOnce(null)
      .mockResolvedValue('notion-page-123');
    notionClientMock.createMailPage.mockResolvedValue('notion-page-123');
    notionClientMock.updateMailPage.mockResolvedValue();

    await workflow.run({ params: { mail: baseMail } }, step, env);

    const updatedMail: Mail = {
      ...baseMail,
      status: 'delivered',
      updatedAt: '2024-01-01T01:00:00.000Z',
    };

    await workflow.run({ params: { mail: updatedMail } }, step, env);

    expect(notionClientMock.mailPageExists).toHaveBeenNthCalledWith(1, baseMail.id);
    expect(notionClientMock.mailPageExists).toHaveBeenNthCalledWith(2, baseMail.id);
    expect(notionClientMock.createMailPage).toHaveBeenCalledTimes(1);
    expect(notionClientMock.updateMailPage).toHaveBeenCalledTimes(1);
    expect(notionClientMock.updateMailPage).toHaveBeenCalledWith(
      'notion-page-123',
      expect.objectContaining({ id: baseMail.id })
    );
  });
});
