import type { WorkflowStep } from '../types';
import type { Logger } from '../../utils/logger';

export type RunStepFunction = <T>(stepName: string, fn: () => Promise<T>) => Promise<T>;

export interface WorkflowContextMetadata {
  [key: string]: unknown;
}

export function createRunStep(
  logger: Logger,
  workflowName: string,
  workflowContext: WorkflowContextMetadata,
  step: WorkflowStep
): RunStepFunction {
  return async <T>(stepName: string, fn: () => Promise<T>): Promise<T> => {
    const stepContext = { ...workflowContext, step: stepName };
    logger.logWorkflowStep(workflowName, stepName, 'start', stepContext);
    const finishStep = logger.startTimer(`workflow.${workflowName}.${stepName}`, stepContext);

    try {
      const result = await step.do(stepName, async () => fn());
      finishStep('success');
      logger.logWorkflowStep(workflowName, stepName, 'success', stepContext);
      return result;
    } catch (error) {
      finishStep('error', {}, error);
      logger.logWorkflowStep(workflowName, stepName, 'failure', stepContext);
      logger.error('Workflow step failed', error, {
        workflow: workflowName,
        ...stepContext,
      });
      throw error;
    }
  };
}

export function createInMemoryStep(logger: Logger, workflowName: string): WorkflowStep {
  return {
    async do<T>(stepName: string, fn: () => Promise<T>): Promise<T> {
      const context = { step: stepName };
      logger.logWorkflowStep(workflowName, stepName, 'start', context);
      const finish = logger.startTimer(`workflow.${workflowName}.${stepName}`, context);
      try {
        const result = await fn();
        finish('success');
        logger.logWorkflowStep(workflowName, stepName, 'success', context);
        return result;
      } catch (error) {
        finish('error', {}, error);
        logger.logWorkflowStep(workflowName, stepName, 'failure', context);
        throw error;
      }
    },
    async sleep(duration: string): Promise<void> {
      const ms = parseDuration(duration);
      if (ms <= 0) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, ms));
    },
  };
}

function parseDuration(duration: string): number {
  const trimmed = duration.trim();
  if (!trimmed) {
    return 0;
  }

  const match = trimmed.match(/^(\d+)(ms|s|m)$/i);
  if (!match) {
    return Number.parseInt(trimmed, 10) || 0;
  }

  const value = Number.parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case 'ms':
      return value;
    case 's':
      return value * 1000;
    case 'm':
      return value * 60 * 1000;
    default:
      return value;
  }
}
