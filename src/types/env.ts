/**
 * Cloudflare Workers Environment Types
 */

import type {
  Queue,
  R2Bucket,
  KVNamespace,
  AnalyticsEngineDataset,
  D1Database,
  DurableObjectNamespace,
  Vectorize,
  Ai,
  Fetcher,
} from '@cloudflare/workers-types';

export interface Env {
  // ========================================================================
  // Secrets (set via wrangler secret)
  // ========================================================================
  OPENPHONE_API_KEY: string;
  NOTION_API_KEY: string;
  NOTION_CALLS_DATABASE_ID: string;
  NOTION_MESSAGES_DATABASE_ID: string;
  NOTION_CANVAS_DATABASE_ID: string;
  NOTION_MAIL_DATABASE_ID: string;
  NOTION_FUNDING_DATABASE_ID?: string;
  NOTION_BATCHES_DATABASE_ID?: string;
  WEBHOOK_SECRET?: string; // Optional webhook signature validation
  ALERT_WEBHOOK_URL?: string; // Optional alert webhook (Slack, Discord, etc.)

  // ========================================================================
  // Environment Variables (set in wrangler.jsonc vars)
  // ========================================================================
  OPENPHONE_API_BASE: string;
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error';
  WEBHOOK_PATH: string;

  // ========================================================================
  // Bindings
  // ========================================================================

  // R2 Bucket for storing recordings
  RECORDINGS_BUCKET: R2Bucket;

  // KV Namespaces
  SYNC_STATE: KVNamespace; // Tracks sync status and deduplication
  RATE_LIMITS: KVNamespace; // Rate limiting state
  CACHE: KVNamespace; // General caching (phone numbers, users, etc.)

  // Queue for webhook events
  WEBHOOK_EVENTS: Queue<QueuedWebhookEvent>;

  // Analytics Engine
  ANALYTICS: AnalyticsEngineDataset;

  // D1 Database for analytics and history
  DB: D1Database;

  // Durable Object for per-phone-number sync coordination
  PHONE_SYNC: DurableObjectNamespace;

  // Workers AI for intelligent call analysis
  AI: Ai;

  // Vectorize for semantic search - auto-creates embeddings in real-time
  CALL_VECTORS: Vectorize;

  // Workflows for complex multi-step processing
  CALL_PROCESSING_WORKFLOW?: Fetcher;
  MESSAGE_PROCESSING_WORKFLOW?: Fetcher;
  MAIL_PROCESSING_WORKFLOW?: Fetcher;

  // Static Assets for dashboard
  ASSETS: Fetcher;
}

// ========================================================================
// Queue Message Types
// ========================================================================

export interface QueuedWebhookEvent {
  id: string; // Webhook event ID
  type: string; // Event type (call.completed, message.received, etc.)
  timestamp: string; // ISO 8601
  data: any; // Full webhook payload
  retryCount?: number;
}

// ========================================================================
// Sync State Types
// ========================================================================

export interface SyncState {
  resourceId: string; // Call ID or Message ID
  resourceType: 'call' | 'message';
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  notionPageId?: string;
  attempts: number;
  lastAttempt: string; // ISO 8601
  error?: string;
  metadata?: Record<string, any>;
}

// ========================================================================
// Rate Limit Types
// ========================================================================

export interface RateLimitState {
  tokens: number; // Available tokens
  lastRefill: number; // Timestamp in milliseconds
}

// ========================================================================
// Analytics Event Types
// ========================================================================

export interface AnalyticsEvent {
  timestamp: number;
  eventType: string;
  resourceType: 'call' | 'message';
  resourceId: string;
  status: 'success' | 'failure';
  duration?: number; // Processing time in ms
  error?: string;
}

// ========================================================================
// Cache Entry Types
// ========================================================================

export interface CacheEntry<T> {
  data: T;
  cachedAt: string; // ISO 8601
  expiresAt: string; // ISO 8601
}
