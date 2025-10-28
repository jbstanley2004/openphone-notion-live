import type { Fetcher } from '@cloudflare/workers-types';
import type { Env } from '../types/env';
import type { Logger } from '../utils/logger';
import type { Mail, OpenPhoneID } from '../types/openphone';
import { CallProcessingWorkflow } from './call-processing';
import { MessageProcessingWorkflow } from './message-processing';
import { MailProcessingWorkflow } from './mail-processing';
import { createInMemoryStep } from './modules/step-runner';

interface TriggerOptions {
  fallback?: boolean;
}

async function invokeRemoteWorkflow<T>(
  fetcher: Fetcher | undefined,
  workflowPath: string,
  payload: Record<string, any>,
  logger: Logger
): Promise<T | null> {
  if (!fetcher) {
    return null;
  }

  try {
    const response = await fetcher.fetch(workflowPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      logger.warn('Workflow fetcher returned non-OK response', {
        path: workflowPath,
        status: response.status,
      });
      return null;
    }

    if (response.headers.get('content-type')?.includes('application/json')) {
      return (await response.json()) as T;
    }

    return null;
  } catch (error) {
    logger.warn('Failed to invoke remote workflow, using fallback', {
      path: workflowPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function triggerCallWorkflow(
  env: Env,
  logger: Logger,
  params: { callId: string; phoneNumberId?: string | null },
  options: TriggerOptions = {}
): Promise<any> {
  const remoteResult = await invokeRemoteWorkflow<any>(
    env.CALL_PROCESSING_WORKFLOW,
    'https://workflow/call-processing',
    { params },
    logger
  );

  if (remoteResult && !options.fallback) {
    return remoteResult;
  }

  const workflow = new CallProcessingWorkflow();
  const step = createInMemoryStep(logger, 'call-processing');
  const typedParams = {
    callId: params.callId as OpenPhoneID<'AC'>,
    phoneNumberId: (params.phoneNumberId ?? null) as OpenPhoneID<'PN'> | null,
  };
  return workflow.run({ params: typedParams }, step, env);
}

export async function triggerMessageWorkflow(
  env: Env,
  logger: Logger,
  params: { messageId: string; phoneNumberId?: string | null },
  options: TriggerOptions = {}
): Promise<any> {
  const remoteResult = await invokeRemoteWorkflow<any>(
    env.MESSAGE_PROCESSING_WORKFLOW,
    'https://workflow/message-processing',
    { params },
    logger
  );

  if (remoteResult && !options.fallback) {
    return remoteResult;
  }

  const workflow = new MessageProcessingWorkflow();
  const step = createInMemoryStep(logger, 'message-processing');
  const typedParams = {
    messageId: params.messageId as OpenPhoneID<'AC'>,
    phoneNumberId: (params.phoneNumberId ?? null) as OpenPhoneID<'PN'> | null,
  };
  return workflow.run({ params: typedParams }, step, env);
}

export async function triggerMailWorkflow(
  env: Env,
  logger: Logger,
  params: { mail: Mail },
  options: TriggerOptions = {}
): Promise<any> {
  const remoteResult = await invokeRemoteWorkflow<any>(
    env.MAIL_PROCESSING_WORKFLOW,
    'https://workflow/mail-processing',
    { params },
    logger
  );

  if (remoteResult && !options.fallback) {
    return remoteResult;
  }

  const workflow = new MailProcessingWorkflow();
  const step = createInMemoryStep(logger, 'mail-processing');
  return workflow.run({ params }, step, env);
}
