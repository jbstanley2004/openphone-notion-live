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

  private log(level: LogLevel, message: string, data?: any) {
    if (!this.shouldLog(level)) {
      return;
    }

    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...this.context,
      ...(data && { data }),
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

  error(message: string, error?: Error | any) {
    const errorData = error instanceof Error
      ? {
          error: error.message,
          stack: error.stack,
          name: error.name,
        }
      : { error };

    this.log('error', message, errorData);
  }

  withContext(additionalContext: LogContext): Logger {
    return new Logger(
      { LOG_LEVEL: this.level } as Env,
      { ...this.context, ...additionalContext }
    );
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
