import type { Env } from '../types/env';

export interface WorkflowEvent<TParams = Record<string, any>> {
  params: TParams;
}

export interface WorkflowStep {
  do<T>(name: string, fn: () => Promise<T>): Promise<T>;
  sleep(duration: string): Promise<void>;
}

export type WorkflowExecutor<TEvent extends WorkflowEvent = WorkflowEvent, TResult = any> = (
  event: TEvent,
  step: WorkflowStep,
  env: Env
) => Promise<TResult>;
