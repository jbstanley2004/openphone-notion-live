/**
 * PhoneNumberSync Durable Object
 *
 * One instance per OpenPhone phone number.
 * Manages real-time sync state, coordinates webhooks, and caches Canvas lookups.
 *
 * Benefits:
 * - In-memory state for fast access
 * - Strong consistency (single-threaded)
 * - Canvas lookup caching per phone number
 * - Coordinates webhooks + scheduled backfill
 */

import type { DurableObjectState } from '@cloudflare/workers-types';
import type { Env } from '../types/env';
import type { Call, Message } from '../types/openphone';
import { Logger, createLogger } from '../utils/logger';
import { OpenPhoneClient } from '../utils/openphone-client';
import { NotionClient } from '../utils/notion-client';
import { R2Client } from '../utils/r2-client';
import { RateLimiter } from '../utils/rate-limiter';

interface PhoneNumberState {
  phoneNumberId: string;
  phoneNumber: string;
  lastCallSync: number;      // Unix timestamp in ms
  lastMessageSync: number;   // Unix timestamp in ms
  canvasCache: Record<string, string>; // phone/email -> canvas ID
  totalCallsSynced: number;
  totalMessagesSynced: number;
}

export class PhoneNumberSync {
  private ctx: DurableObjectState;
  private env: Env;
  private state: PhoneNumberState | null = null;
  private logger: Logger;
  private syncInProgress = false;

  constructor(state: DurableObjectState, env: Env) {
    this.ctx = state;
    this.env = env;
    this.logger = createLogger(env);
  }

  /**
   * Initialize state from durable storage
   */
  private async ensureInitialized(phoneNumberId: string, phoneNumber: string): Promise<void> {
    if (this.state) return;

    // Load state from durable storage
    const stored = await this.ctx.storage.get<PhoneNumberState>('state');

    if (stored) {
      this.state = stored;
      this.logger = this.logger.withContext({ phoneNumberId: this.state.phoneNumberId });
      this.logger.info('Loaded state from durable storage', {
        lastCallSync: new Date(this.state.lastCallSync).toISOString(),
        lastMessageSync: new Date(this.state.lastMessageSync).toISOString(),
        cacheSize: Object.keys(this.state.canvasCache).length
      });
    } else {
      // Initialize new state
      const now = Date.now();
      this.state = {
        phoneNumberId,
        phoneNumber,
        lastCallSync: now - 24 * 60 * 60 * 1000, // Start with last 24 hours
        lastMessageSync: now - 24 * 60 * 60 * 1000,
        canvasCache: {},
        totalCallsSynced: 0,
        totalMessagesSynced: 0,
      };
      this.logger = this.logger.withContext({ phoneNumberId });
      await this.saveState();

      // Log to D1 for analytics
      this.logToD1('phone_numbers', {
        id: phoneNumberId,
        number: phoneNumber,
        first_seen_at: now,
        created_at: now,
        updated_at: now,
      });
    }
  }

  /**
   * Save state to durable storage
   */
  private async saveState(): Promise<void> {
    if (!this.state) return;
    await this.ctx.storage.put('state', this.state);
  }

  /**
   * Get Canvas ID from cache or fetch
   */
  private async getCanvasId(lookup: string, type: 'phone' | 'email', notionClient: NotionClient): Promise<string | null> {
    if (!this.state) return null;

    // Check in-memory cache first
    const cacheKey = `${type}:${lookup}`;
    if (this.state.canvasCache[cacheKey]) {
      this.logger.info('Canvas cache hit', { lookup, type, canvasId: this.state.canvasCache[cacheKey] });

      // Update D1 cache stats (async, don't wait)
      this.ctx.waitUntil(this.updateCanvasCacheHit(lookup, type));

      return this.state.canvasCache[cacheKey];
    }

    // Cache miss - query Notion
    this.logger.info('Canvas cache miss, querying Notion', { lookup, type });
    const startTime = Date.now();

    let canvasId: string | null = null;
    if (type === 'phone') {
      canvasId = await notionClient.findCanvasByPhone(lookup);
    } else {
      canvasId = await notionClient.findCanvasByEmail(lookup);
    }

    const duration = Date.now() - startTime;

    if (canvasId) {
      // Cache the result
      this.state.canvasCache[cacheKey] = canvasId;
      await this.saveState();

      // Log to D1 (async)
      this.ctx.waitUntil(this.logCanvasCache(lookup, type, canvasId));
    }

    // Log performance metric
    this.ctx.waitUntil(this.logPerformanceMetric('canvas_lookup', type, duration, !!canvasId));

    return canvasId;
  }

  /**
   * Sync new calls for this phone number
   */
  async syncCalls(env: Env): Promise<{ synced: number; failed: number }> {
    await this.ensureInitialized(this.state?.phoneNumberId || '', this.state?.phoneNumber || '');
    if (!this.state || this.syncInProgress) {
      return { synced: 0, failed: 0 };
    }

    this.syncInProgress = true;
    const startTime = Date.now();

    try {
      const rateLimiter = new RateLimiter(env.RATE_LIMITS, this.logger);
      const openPhoneClient = new OpenPhoneClient(env, this.logger, rateLimiter);
      const notionClient = new NotionClient(env, this.logger);
      const r2Client = new R2Client(env.RECORDINGS_BUCKET, this.logger);

      // Fetch only NEW calls since last sync
      const since = new Date(this.state.lastCallSync).toISOString();
      this.logger.info('Syncing calls', { since, phoneNumberId: this.state.phoneNumberId });

      const response = await openPhoneClient.listCalls({
        phoneNumberId: this.state.phoneNumberId as any,
        participants: [],
        maxResults: 100,
      });

      // Filter to only new calls
      const newCalls = response.data.filter(call => {
        const callTime = new Date(call.createdAt).getTime();
        return callTime > this.state!.lastCallSync;
      });

      this.logger.info('Found new calls', { total: response.data.length, new: newCalls.length });

      let synced = 0;
      let failed = 0;

      for (const call of newCalls) {
        try {
          await this.processCall(call, openPhoneClient, notionClient, r2Client, env);
          synced++;
        } catch (error) {
          failed++;
          this.logger.error('Failed to process call', { callId: call.id, error: String(error) });
        }
      }

      // Update last sync time
      if (newCalls.length > 0) {
        const latestCallTime = Math.max(...newCalls.map(c => new Date(c.createdAt).getTime()));
        this.state.lastCallSync = latestCallTime;
        this.state.totalCallsSynced += synced;
        await this.saveState();

        // Update D1 (async)
        this.ctx.waitUntil(this.updateD1SyncState('calls', latestCallTime, this.state.totalCallsSynced));
      }

      const duration = Date.now() - startTime;
      this.logger.info('Call sync completed', { synced, failed, durationMs: duration });

      return { synced, failed };
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Process individual call
   */
  private async processCall(
    call: Call,
    openPhoneClient: OpenPhoneClient,
    notionClient: NotionClient,
    r2Client: R2Client,
    env: Env
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // Fetch complete call data
      const completeData = await openPhoneClient.getCompleteCall(call.id);

      // Get Canvas relation using cached lookup
      let canvasId: string | null = null;
      if (call.direction === 'incoming' || call.direction === 'outgoing') {
        for (const participant of call.participants) {
          canvasId = await this.getCanvasId(participant, 'phone', notionClient);
          if (canvasId) break;
        }
      }

      // Handle recordings/voicemails (same as before)
      let recordingUrl: string | undefined;
      if (completeData.recordings.length > 0 && completeData.recordings[0].url && completeData.recordings[0].status === 'completed') {
        try {
          const audioData = await openPhoneClient.downloadAudioFile(completeData.recordings[0].url);
          recordingUrl = await r2Client.uploadRecording(call.id, audioData, {
            timestamp: call.createdAt,
            duration: completeData.recordings[0].duration || undefined,
            contentType: completeData.recordings[0].type || undefined,
          });
        } catch (error) {
          this.logger.error('Failed to upload recording', { callId: call.id, error: String(error) });
        }
      }

      let voicemailUrl: string | undefined;
      if (completeData.voicemail && completeData.voicemail.url) {
        try {
          const audioData = await openPhoneClient.downloadAudioFile(completeData.voicemail.url);
          voicemailUrl = await r2Client.uploadVoicemail(call.id, audioData, {
            timestamp: call.createdAt,
            duration: completeData.voicemail.duration || undefined,
            contentType: completeData.voicemail.type || undefined,
            transcription: completeData.voicemail.transcription || undefined,
          });
        } catch (error) {
          this.logger.error('Failed to upload voicemail', { callId: call.id, error: String(error) });
        }
      }

      // Create or update Notion page
      const existingPageId = await notionClient.callPageExists(call.id);
      let notionPageId: string;

      if (existingPageId) {
        await notionClient.updateCallPage(existingPageId, { ...completeData, recordingUrl, voicemailUrl });
        notionPageId = existingPageId;
      } else {
        notionPageId = await notionClient.createCallPage({ ...completeData, recordingUrl, voicemailUrl });
      }

      const duration = Date.now() - startTime;

      // Log to D1 (async)
      this.ctx.waitUntil(this.logSyncHistory({
        phone_number_id: this.state!.phoneNumberId,
        resource_type: 'call',
        resource_id: call.id,
        direction: call.direction,
        notion_page_id: notionPageId,
        canvas_id: canvasId,
        sync_status: 'success',
        processing_time_ms: duration,
        synced_at: Date.now(),
      }));

      this.logger.info('Call processed successfully', { callId: call.id, notionPageId, canvasId, durationMs: duration });
    } catch (error) {
      const duration = Date.now() - startTime;

      // Log failure to D1
      this.ctx.waitUntil(this.logSyncHistory({
        phone_number_id: this.state!.phoneNumberId,
        resource_type: 'call',
        resource_id: call.id,
        direction: call.direction,
        notion_page_id: null,
        canvas_id: null,
        sync_status: 'failed',
        error_message: String(error),
        processing_time_ms: duration,
        synced_at: Date.now(),
      }));

      throw error;
    }
  }

  /**
   * Sync new messages for this phone number
   */
  async syncMessages(env: Env): Promise<{ synced: number; failed: number }> {
    // Similar to syncCalls, but for messages
    await this.ensureInitialized(this.state?.phoneNumberId || '', this.state?.phoneNumber || '');
    if (!this.state || this.syncInProgress) {
      return { synced: 0, failed: 0 };
    }

    // Implementation similar to syncCalls
    // TODO: Implement message sync with Canvas caching
    return { synced: 0, failed: 0 };
  }

  /**
   * Handle webhook event for this phone number
   */
  async handleWebhook(event: any, env: Env): Promise<void> {
    // Process webhook in real-time
    // Use cached Canvas lookups
    // TODO: Implement webhook handling
  }

  // ========================================================================
  // D1 Logging Methods (async, don't block main flow)
  // ========================================================================

  private async logToD1(table: string, data: Record<string, any>): Promise<void> {
    try {
      const columns = Object.keys(data).join(', ');
      const placeholders = Object.keys(data).map(() => '?').join(', ');
      const values = Object.values(data);

      await this.env.DB.prepare(
        `INSERT OR REPLACE INTO ${table} (${columns}) VALUES (${placeholders})`
      ).bind(...values).run();
    } catch (error) {
      this.logger.error('Failed to log to D1', { table, error: String(error) });
    }
  }

  private async logSyncHistory(data: any): Promise<void> {
    await this.logToD1('sync_history', data);
  }

  private async logCanvasCache(lookup: string, type: string, canvasId: string): Promise<void> {
    const now = Date.now();
    await this.logToD1('canvas_cache', {
      lookup_key: lookup,
      lookup_type: type,
      canvas_id: canvasId,
      cached_at: now,
      hit_count: 1,
      last_used_at: now,
    });
  }

  private async updateCanvasCacheHit(lookup: string, type: string): Promise<void> {
    try {
      await this.env.DB.prepare(
        `UPDATE canvas_cache SET hit_count = hit_count + 1, last_used_at = ? WHERE lookup_key = ?`
      ).bind(Date.now(), lookup).run();
    } catch (error) {
      this.logger.error('Failed to update canvas cache hit', { error: String(error) });
    }
  }

  private async logPerformanceMetric(metricType: string, operation: string, durationMs: number, success: boolean): Promise<void> {
    await this.logToD1('performance_metrics', {
      metric_type: metricType,
      operation,
      duration_ms: durationMs,
      success: success ? 1 : 0,
      phone_number_id: this.state?.phoneNumberId,
      timestamp: Date.now(),
    });
  }

  private async updateD1SyncState(type: 'calls' | 'messages', lastSync: number, totalSynced: number): Promise<void> {
    try {
      const column = type === 'calls' ? 'last_call_sync_at' : 'last_message_sync_at';
      const countColumn = type === 'calls' ? 'total_calls_synced' : 'total_messages_synced';

      await this.env.DB.prepare(
        `UPDATE phone_numbers SET ${column} = ?, ${countColumn} = ?, updated_at = ? WHERE id = ?`
      ).bind(lastSync, totalSynced, Date.now(), this.state?.phoneNumberId).run();
    } catch (error) {
      this.logger.error('Failed to update D1 sync state', { error: String(error) });
    }
  }

  // ========================================================================
  // Durable Object Fetch Handler
  // ========================================================================

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Initialize endpoint - called once when DO is first created
      if (path === '/init' && request.method === 'POST') {
        const body = await request.json() as { phoneNumberId: string; phoneNumber: string };
        await this.ensureInitialized(body.phoneNumberId, body.phoneNumber);
        return new Response(JSON.stringify({ status: 'initialized', state: this.state }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Sync calls endpoint
      if (path === '/sync/calls' && request.method === 'POST') {
        const result = await this.syncCalls(this.env);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Sync messages endpoint
      if (path === '/sync/messages' && request.method === 'POST') {
        const result = await this.syncMessages(this.env);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Webhook event endpoint
      if (path === '/webhook' && request.method === 'POST') {
        const event = await request.json();
        await this.handleWebhook(event, this.env);
        return new Response(JSON.stringify({ status: 'processed' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Get state endpoint (for debugging)
      if (path === '/state' && request.method === 'GET') {
        return new Response(JSON.stringify(this.state), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('Not Found', { status: 404 });
    } catch (error) {
      this.logger.error('Error in Durable Object fetch', { path, error: String(error) });
      return new Response(JSON.stringify({ error: String(error) }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }
}
