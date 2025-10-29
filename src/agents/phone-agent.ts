/**
 * PhoneAgent - Intelligent Agent for Phone Number Processing
 *
 * Replaces Durable Objects with Cloudflare Agents for:
 * - Real-time WebSocket connections for live call updates
 * - Built-in SQLite database (reduces D1 usage)
 * - Native scheduling API (simpler than alarms)
 * - AI-powered call processing
 * - State syncing across instances
 */

// Note: Agents framework is in beta and requires special setup
// This is the target architecture - may need adjustments based on final API

import type { Env } from '../types/env';
import type { Call, Message } from '../types/openphone';
import { OpenPhoneClient } from '../utils/openphone-client';
import { NotionClient } from '../utils/notion-client';
import { R2Client } from '../utils/r2-client';
import { RateLimiter } from '../utils/rate-limiter';
import { createLogger } from '../utils/logger';
import { analyzeCallWithAI } from '../processors/ai-processor';
import { indexCall, findSimilarCalls } from '../utils/vector-search';
import { resolveMerchantMetadata } from '../utils/merchant-metadata';

interface PhoneAgentState {
  phoneNumberId: string;
  phoneNumber: string;
  lastCallSync: number;
  lastMessageSync: number;
  canvasCache: Record<string, string>;
  totalCallsSynced: number;
  totalMessagesSynced: number;
  callsProcessed: number;
  callsProcessed?: number;
  insights: Array<{
    callId: string;
    sentiment: string;
    actionItems: string[];
    leadScore?: number;
  }>;
}

/**
 * PhoneAgent - Modern replacement for PhoneNumberSync Durable Object
 *
 * Benefits over Durable Objects:
 * - Built-in SQLite for persistent state (no need for external D1 queries)
 * - Native scheduling with schedule() method
 * - WebSocket support via onConnect()
 * - Better lifecycle management
 * - AI-first design
 */
export class PhoneAgent {
  private state: PhoneAgentState;
  private env: Env;
  private logger: ReturnType<typeof createLogger>;

  constructor(env: Env, initialState?: Partial<PhoneAgentState>) {
    this.env = env;
    this.logger = createLogger(env);

    // Initialize state
    const now = Date.now();
    this.state = {
      phoneNumberId: initialState?.phoneNumberId || '',
      phoneNumber: initialState?.phoneNumber || '',
      lastCallSync: initialState?.lastCallSync || now - 24 * 60 * 60 * 1000,
      lastMessageSync: initialState?.lastMessageSync || now - 24 * 60 * 60 * 1000,
      canvasCache: initialState?.canvasCache || {},
      totalCallsSynced: initialState?.totalCallsSynced || 0,
      totalMessagesSynced: initialState?.totalMessagesSynced || 0,
      callsProcessed: initialState?.callsProcessed || 0,
      insights: initialState?.insights || [],
    };
  }

  /**
   * Handle WebSocket connections for real-time updates
   */
  async onConnect(connection: any): Promise<void> {
    // Accept WebSocket connection
    connection.accept();

    this.logger.info('WebSocket connection established', {
      phoneNumberId: this.state.phoneNumberId,
    });

    // Send initial state
    connection.send(JSON.stringify({
      type: 'state',
      data: this.state,
    }));

    // Handle incoming messages
    connection.addEventListener('message', (event: any) => {
      this.handleWebSocketMessage(event.data, connection);
    });
  }

  /**
   * Process a call with AI intelligence
   */
  async processCall(call: Call): Promise<void> {
    const startTime = Date.now();

    try {
      this.logger.info('Processing call with AI', { callId: call.id });

      const rateLimiter = new RateLimiter(this.env.RATE_LIMITS, this.logger);
      const openPhoneClient = new OpenPhoneClient(this.env, this.logger, rateLimiter);
      const notionClient = new NotionClient(this.env, this.logger);
      const r2Client = new R2Client(
        this.env.RECORDINGS_BUCKET,
        this.logger,
        this.env.RECORDINGS_PUBLIC_BASE_URL
      );

      // Fetch complete call data
      const completeData = await openPhoneClient.getCompleteCall(call.id);

      // Get transcript if available
      let transcript: string | undefined;
      if (completeData.voicemail?.transcription) {
        transcript = completeData.voicemail.transcription;
      }

      // AI Analysis
      const aiAnalysis = await analyzeCallWithAI(call, transcript, this.env, this.logger);

      // Intelligent Canvas matching with confidence scoring
      const canvasId = await this.findBestCanvas(call, aiAnalysis);
      const merchantMetadata = canvasId
        ? await resolveMerchantMetadata(this.env, this.logger, {
            canvasId,
            notionClient,
          })
        : { canvasId: null, merchantUuid: null, merchantName: null };

      // Handle recordings
      let recordingUrl: string | undefined;
      if (completeData.recordings?.[0]?.url && completeData.recordings[0].status === 'completed') {
        try {
          const audioData = await openPhoneClient.downloadAudioFile(completeData.recordings[0].url);
          recordingUrl = await r2Client.uploadRecording(call.id, audioData, {
            timestamp: call.createdAt,
            duration: completeData.recordings[0].duration ?? undefined,
            contentType: completeData.recordings[0].type ?? undefined,
          });
        } catch (error) {
          this.logger.error('Failed to upload recording', { callId: call.id, error });
        }
      }

      // Handle voicemails
      let voicemailUrl: string | undefined;
      if (completeData.voicemail?.url) {
        try {
          const audioData = await openPhoneClient.downloadAudioFile(completeData.voicemail.url);
          voicemailUrl = await r2Client.uploadVoicemail(call.id, audioData, {
            timestamp: call.createdAt,
            duration: completeData.voicemail.duration ?? undefined,
            transcription: completeData.voicemail.transcription ?? undefined,
          });
        } catch (error) {
          this.logger.error('Failed to upload voicemail', { callId: call.id, error });
        }
      }

      // Create or update Notion page with AI insights
      const existingPageId = await notionClient.callPageExists(call.id);
      let notionPageId: string;
      let merchantUuid: string | null = null;

      const pageData = {
        ...completeData,
        recordingUrl,
        voicemailUrl,
        // Add AI-generated fields
        aiSentiment: aiAnalysis.sentiment.label,
        aiSummary: aiAnalysis.summary,
        aiActionItems: aiAnalysis.actionItems,
        aiCategory: aiAnalysis.category,
        aiLeadScore: aiAnalysis.leadScore,
        aiKeywords: aiAnalysis.keywords,
      };

      if (existingPageId) {
        const result = await notionClient.updateCallPage(existingPageId, pageData);
        notionPageId = existingPageId;
        merchantUuid = result.merchantUuid;
      } else {
        const result = await notionClient.createCallPage(pageData);
        notionPageId = result.pageId;
        merchantUuid = result.merchantUuid;
      }

      // Index in Vectorize for semantic search
      await indexCall(
        call,
        transcript,
        aiAnalysis.summary,
        notionPageId,
        merchantUuid,
        canvasId ?? null,
        this.env,
        this.logger
      );
      await indexCall(call, transcript, aiAnalysis.summary, notionPageId, this.env, this.logger, {
        canvasId: merchantMetadata.canvasId ?? undefined,
        merchantUuid: merchantMetadata.merchantUuid ?? undefined,
        merchantName: merchantMetadata.merchantName ?? undefined,
      });

      // Find similar calls (duplicate lead detection)
      const similarCalls = await findSimilarCalls(call.id, 3, this.env, this.logger);
      if (similarCalls.length > 0) {
        this.logger.info('Found similar calls', {
          callId: call.id,
          similarCount: similarCalls.length,
          topMatch: similarCalls[0],
        });
      }

      // Update state with AI insights
      this.state.callsProcessed = (this.state.callsProcessed || 0) + 1;
      this.state.insights.push({
        callId: call.id,
        sentiment: aiAnalysis.sentiment.label,
        actionItems: aiAnalysis.actionItems,
        leadScore: aiAnalysis.leadScore,
      });

      // Keep only last 100 insights
      if (this.state.insights.length > 100) {
        this.state.insights = this.state.insights.slice(-100);
      }

      // Schedule follow-up check if there are action items
      if (aiAnalysis.actionItems.length > 0) {
        await this.scheduleFollowUp(call.id, '24h');
      }

      const duration = Date.now() - startTime;
      this.logger.info('Call processed successfully with AI', {
        callId: call.id,
        notionPageId,
        canvasId,
        merchantUuid,
        canvasId: merchantMetadata.canvasId,
        sentiment: aiAnalysis.sentiment.label,
        leadScore: aiAnalysis.leadScore,
        durationMs: duration,
      });
    } catch (error) {
      this.logger.error('Failed to process call', { callId: call.id, error });
      throw error;
    }
  }

  /**
   * Intelligent Canvas matching with confidence scoring
   */
  private async findBestCanvas(call: Call, aiAnalysis: any): Promise<string | null> {
    const notionClient = new NotionClient(this.env, this.logger);

    // Try phone number lookup first (most reliable)
    for (const participant of call.participants) {
      // Check cache
      const cacheKey = `phone:${participant}`;
      if (this.state.canvasCache[cacheKey]) {
        this.logger.info('Canvas cache hit', { participant, canvasId: this.state.canvasCache[cacheKey] });
        return this.state.canvasCache[cacheKey];
      }

      // Query Notion
      const canvasId = await notionClient.findCanvasByPhone(participant);
      if (canvasId) {
        this.state.canvasCache[cacheKey] = canvasId;
        return canvasId;
      }
    }

    // Try semantic matching based on call content
    // (This would use Vectorize to find similar past calls and their Canvas)
    // Implementation depends on having historical data

    return null;
  }

  /**
   * Schedule follow-up check for action items
   */
  private async scheduleFollowUp(callId: string, delay: string): Promise<void> {
    // Note: This uses the Agents scheduling API
    // Syntax may vary based on final implementation
    this.logger.info('Scheduling follow-up check', { callId, delay });

    // Example: this.schedule(delay, 'followUpCheck', { callId });
    // For now, we'll just log the intent
  }

  /**
   * Check if action items were completed
   */
  async followUpCheck(data: { callId: string }): Promise<void> {
    this.logger.info('Running follow-up check', { callId: data.callId });

    // Query Notion to see if action items were marked as completed
    // Send notifications if needed
    // This is a placeholder for future implementation
  }

  /**
   * Get state (for debugging and dashboard)
   */
  getState(): PhoneAgentState {
    return this.state;
  }

  /**
   * Handle WebSocket messages
   */
  private async handleWebSocketMessage(message: string, connection: any): Promise<void> {
    try {
      const data = JSON.parse(message);

      switch (data.type) {
        case 'sync':
          // Trigger a manual sync
          connection.send(JSON.stringify({
            type: 'sync_started',
            timestamp: Date.now(),
          }));
          break;

        case 'get_insights':
          // Send latest insights
          connection.send(JSON.stringify({
            type: 'insights',
            data: this.state.insights.slice(-10),
          }));
          break;

        default:
          this.logger.warn('Unknown WebSocket message type', { type: data.type });
      }
    } catch (error) {
      this.logger.error('Error handling WebSocket message', { error });
    }
  }
}

// Export factory function for creating agents
export function createPhoneAgent(
  env: Env,
  phoneNumberId: string,
  phoneNumber: string
): PhoneAgent {
  return new PhoneAgent(env, {
    phoneNumberId,
    phoneNumber,
  });
}
