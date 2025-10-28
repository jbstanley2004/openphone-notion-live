/**
 * Structured Logger for Cloudflare Workers
 * Provides consistent logging with context and levels
 */

import type { Env } from '../types/env';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface LogContext {
  requestId?: string;
  webhookEventId?: string;
  resourceId?: string;
  resourceType?: string;
  userId?: string;
  [key: string]: any;
}

export class Logger {
  private level: LogLevel;
  private context: LogContext;

  constructor(env: Env, context: LogContext = {}) {
    this.level = env.LOG_LEVEL || 'info';
    this.context = context;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>) {
    if (!this.shouldLog(level)) {
      return;
    }

    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...this.context,
      ...(data && Object.keys(data).length > 0 ? { data } : {}),
    };

    // Use appropriate console method
    const consoleMethod = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    consoleMethod(JSON.stringify(logEntry));
  }

  debug(message: string, data?: any) {
    this.log('debug', message, data);
  }

  info(message: string, data?: any) {
    this.log('info', message, data);
  }

  warn(message: string, data?: any) {
    this.log('warn', message, data);
  }

  error(message: string, error?: Error | any, data: Record<string, unknown> = {}) {
    const errorData = error instanceof Error
      ? {
          error: error.message,
          stack: error.stack,
          name: error.name,
        }
      : error
        ? { error }
        : {};

    this.log('error', message, { ...data, ...errorData });
  }

  withContext(additionalContext: LogContext): Logger {
    return new Logger(
      { LOG_LEVEL: this.level } as Env,
      { ...this.context, ...additionalContext }
    );
  }

  startTimer(operation: string, data: Record<string, unknown> = {}) {
    const startedAt = Date.now();
    this.log('debug', 'timer.started', { operation, ...data });

    return (
      status: 'success' | 'error',
      extra: Record<string, unknown> = {},
      error?: unknown,
    ) => {
      const durationMs = Date.now() - startedAt;
      const payload = { operation, durationMs, status, ...data, ...extra };

      if (status === 'success') {
        this.log('info', 'timer.completed', payload);
      } else {
        const errorPayload = error instanceof Error
          ? { error: error.message, stack: error.stack, name: error.name }
          : error
            ? { error }
            : {};

        this.log('error', 'timer.failed', { ...payload, ...errorPayload });
      }
    };
  }

  logKVOperation(
    binding: string,
    action: 'get' | 'put' | 'delete',
    details: Record<string, unknown> = {}
  ) {
    this.log('info', 'kv.operation', {
      event: 'kv.operation',
      binding,
      action,
      ...details,
    });
  }

  logD1Query(
    operation: string,
    durationMs: number,
    status: 'success' | 'error',
    details: Record<string, unknown> = {}
  ) {
    const level: LogLevel = status === 'success' ? 'info' : 'error';
    this.log(level, 'd1.query', {
      event: 'd1.query',
      operation,
      durationMs,
      status,
      ...details,
    });
  }

  logWorkflowStep(
    workflow: string,
    step: string,
    status: 'start' | 'success' | 'failure',
    details: Record<string, unknown> = {}
  ) {
    const level: LogLevel = status === 'failure' ? 'error' : 'info';
    this.log(level, 'workflow.step', {
      event: 'workflow.step',
      workflow,
      step,
      status,
      ...details,
    });
  }
}

/**
 * Create a logger instance with request context
 */
export function createLogger(env: Env, request?: Request, context?: LogContext): Logger {
  const requestContext: LogContext = {
    ...context,
  };

  if (request) {
    requestContext.requestId = crypto.randomUUID();
    requestContext.method = request.method;
    requestContext.url = request.url;
    requestContext.userAgent = request.headers.get('user-agent') || undefined;
  }

  return new Logger(env, requestContext);
}
