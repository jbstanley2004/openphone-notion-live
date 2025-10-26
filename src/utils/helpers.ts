/**
 * Helper Utilities
 * Common functions used across the application
 */

import type { KVNamespace } from '@cloudflare/workers-types';
import type { SyncState, CacheEntry } from '../types/env';

// ============================================================================
// Retry Logic
// ============================================================================

export interface RetryOptions {
  maxAttempts?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    backoffMultiplier = 2,
  } = options;

  let lastError: Error | undefined;
  let delay = initialDelay;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === maxAttempts) {
        break;
      }

      // Wait before retrying
      await sleep(delay);
      delay = Math.min(delay * backoffMultiplier, maxDelay);
    }
  }

  throw lastError || new Error('Retry failed');
}

/**
 * Sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Sync State Management
// ============================================================================

/**
 * Get sync state from KV
 */
export async function getSyncState(
  kv: KVNamespace,
  resourceId: string
): Promise<SyncState | null> {
  const key = `sync:${resourceId}`;
  return kv.get<SyncState>(key, 'json');
}

/**
 * Save sync state to KV
 */
export async function setSyncState(
  kv: KVNamespace,
  state: SyncState
): Promise<void> {
  const key = `sync:${state.resourceId}`;
  await kv.put(key, JSON.stringify(state), {
    expirationTtl: 30 * 24 * 60 * 60, // 30 days
  });
}

/**
 * Mark a resource as synced
 */
export async function markAsSynced(
  kv: KVNamespace,
  resourceId: string,
  resourceType: 'call' | 'message',
  notionPageId: string
): Promise<void> {
  const state: SyncState = {
    resourceId,
    resourceType,
    status: 'completed',
    notionPageId,
    attempts: 1,
    lastAttempt: new Date().toISOString(),
  };
  await setSyncState(kv, state);
}

/**
 * Mark a resource as failed
 */
export async function markAsFailed(
  kv: KVNamespace,
  resourceId: string,
  resourceType: 'call' | 'message',
  error: string,
  attempts: number = 1
): Promise<void> {
  const state: SyncState = {
    resourceId,
    resourceType,
    status: 'failed',
    attempts,
    lastAttempt: new Date().toISOString(),
    error,
  };
  await setSyncState(kv, state);
}

// ============================================================================
// Caching
// ============================================================================

/**
 * Get a cached value
 */
export async function getCache<T>(
  kv: KVNamespace,
  key: string
): Promise<T | null> {
  const entry = await kv.get<CacheEntry<T>>(`cache:${key}`, 'json');

  if (!entry) {
    return null;
  }

  // Check if expired
  if (new Date(entry.expiresAt) < new Date()) {
    await kv.delete(`cache:${key}`);
    return null;
  }

  return entry.data;
}

/**
 * Set a cached value
 */
export async function setCache<T>(
  kv: KVNamespace,
  key: string,
  data: T,
  ttlSeconds: number = 3600
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

  const entry: CacheEntry<T> = {
    data,
    cachedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  await kv.put(`cache:${key}`, JSON.stringify(entry), {
    expirationTtl: ttlSeconds,
  });
}

// ============================================================================
// Deduplication
// ============================================================================

/**
 * Check if a webhook event has been processed
 */
export async function isEventProcessed(
  kv: KVNamespace,
  eventId: string
): Promise<boolean> {
  const key = `event:${eventId}`;
  const value = await kv.get(key);
  return value !== null;
}

/**
 * Mark a webhook event as processed
 */
export async function markEventProcessed(
  kv: KVNamespace,
  eventId: string
): Promise<void> {
  const key = `event:${eventId}`;
  await kv.put(key, new Date().toISOString(), {
    expirationTtl: 7 * 24 * 60 * 60, // 7 days
  });
}

// ============================================================================
// Data Validation
// ============================================================================

/**
 * Validate a phone number is in E.164 format
 */
export function isValidPhoneNumber(phone: string): boolean {
  return /^\+[1-9]\d{1,14}$/.test(phone);
}

/**
 * Format a phone number for display
 */
export function formatPhoneNumber(phone: string): string {
  // Simple US formatting: +1 (555) 555-5555
  if (phone.startsWith('+1') && phone.length === 12) {
    return `+1 (${phone.slice(2, 5)}) ${phone.slice(5, 8)}-${phone.slice(8)}`;
  }
  return phone;
}

/**
 * Sanitize text for Notion (remove unsupported characters)
 */
export function sanitizeForNotion(text: string): string {
  if (!text) return '';
  // Remove null bytes and other problematic characters
  return text.replace(/\0/g, '').replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Truncate text to a maximum length
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - 3) + '...';
}

// ============================================================================
// Error Handling
// ============================================================================

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: any): boolean {
  // Network errors
  if (error.name === 'NetworkError' || error.name === 'FetchError') {
    return true;
  }

  // HTTP status codes that should be retried
  if (error.status) {
    const retryableStatuses = [408, 429, 500, 502, 503, 504];
    return retryableStatuses.includes(error.status);
  }

  // Rate limit errors
  if (error.message && error.message.includes('rate limit')) {
    return true;
  }

  return false;
}

/**
 * Extract error message from various error types
 */
export function getErrorMessage(error: any): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object') {
    return JSON.stringify(error);
  }
  return 'Unknown error';
}

// ============================================================================
// URL Utilities
// ============================================================================

/**
 * Build a query string from parameters
 */
export function buildQueryString(params: Record<string, any>): string {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      searchParams.append(key, String(value));
    }
  });

  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

/**
 * Parse a webhook signature header
 */
export function parseWebhookSignature(signature: string): {
  timestamp: string;
  signature: string;
} | null {
  // Format: t=timestamp,v1=signature
  const parts = signature.split(',');
  const data: Record<string, string> = {};

  parts.forEach((part) => {
    const [key, value] = part.split('=');
    if (key && value) {
      data[key] = value;
    }
  });

  if (data.t && data.v1) {
    return {
      timestamp: data.t,
      signature: data.v1,
    };
  }

  return null;
}

// ============================================================================
// Date/Time Utilities
// ============================================================================

/**
 * Format duration in seconds to human readable
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

/**
 * Check if a timestamp is within a time window
 */
export function isWithinTimeWindow(
  timestamp: string,
  windowMinutes: number
): boolean {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = diffMs / (1000 * 60);
  return diffMinutes <= windowMinutes;
}
