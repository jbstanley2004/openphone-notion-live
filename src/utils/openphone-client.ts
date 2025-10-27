/**
 * OpenPhone API Client
 * Handles all interactions with the OpenPhone API
 */

import type {
  Call,
  CallRecording,
  CallTranscript,
  CallSummary,
  CallVoicemail,
  Message,
  OpenPhoneNumber,
  User,
  OpenPhoneAPIResponse,
  OpenPhoneAPIListResponse,
  CallsListParams,
  MessagesListParams,
  OpenPhoneID,
} from '../types/openphone';
import type { Env } from '../types/env';
import { Logger } from './logger';
import { RateLimiter } from './rate-limiter';

export class OpenPhoneClient {
  private apiKey: string;
  private baseUrl: string;
  private logger: Logger;
  private rateLimiter: RateLimiter;

  constructor(env: Env, logger: Logger, rateLimiter: RateLimiter) {
    const apiKey = env.OPENPHONE_API_KEY?.trim();
    const baseUrl = env.OPENPHONE_API_BASE?.trim();

    if (!apiKey) {
      throw new Error('OPENPHONE_API_KEY is missing or empty');
    }

    if (!baseUrl) {
      throw new Error('OPENPHONE_API_BASE is missing or empty');
    }

    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.logger = logger;
    this.rateLimiter = rateLimiter;
  }

  /**
   * Make an authenticated request to OpenPhone API
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    // Wait for rate limit token
    const acquired = await this.rateLimiter.waitForToken(1, 10000);
    if (!acquired) {
      throw new Error('Rate limit exceeded and timeout waiting for token');
    }

    const url = `${this.baseUrl}${endpoint}`;
    const headers = new Headers(options.headers);
    headers.set('Authorization', this.apiKey);
    headers.set('Content-Type', 'application/json');

    this.logger.debug('OpenPhone API request', { method: options.method || 'GET', url });

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error('OpenPhone API error', {
        status: response.status,
        statusText: response.statusText,
        body: errorText,
        url,
      });
      throw new Error(`OpenPhone API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  // ========================================================================
  // Calls API
  // ========================================================================

  /**
   * Get a single call by ID
   */
  async getCall(callId: OpenPhoneID<'AC'>): Promise<Call> {
    const response = await this.request<OpenPhoneAPIResponse<Call>>(
      `/calls/${callId}`
    );
    return response.data;
  }

  /**
   * List calls with optional filters
   * Returns full response with pagination info
   */
  async listCalls(params?: CallsListParams): Promise<OpenPhoneAPIListResponse<Call>> {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, String(value));
        }
      });
    }

    const endpoint = `/calls${queryParams.toString() ? `?${queryParams}` : ''}`;
    const response = await this.request<OpenPhoneAPIListResponse<Call>>(endpoint);
    return response;
  }

  /**
   * Get call recordings
   */
  async getCallRecordings(callId: OpenPhoneID<'AC'>): Promise<CallRecording[]> {
    const response = await this.request<OpenPhoneAPIResponse<CallRecording[]>>(
      `/call-recordings/${callId}`
    );
    return response.data;
  }

  /**
   * Get call transcript
   */
  async getCallTranscript(callId: OpenPhoneID<'AC'>): Promise<CallTranscript | null> {
    try {
      const response = await this.request<OpenPhoneAPIResponse<CallTranscript>>(
        `/call-transcripts/${callId}`
      );
      return response.data;
    } catch (error) {
      // Transcript might not exist
      this.logger.warn('Transcript not found', { callId });
      return null;
    }
  }

  /**
   * Get call summary
   */
  async getCallSummary(callId: OpenPhoneID<'AC'>): Promise<CallSummary | null> {
    try {
      const response = await this.request<OpenPhoneAPIResponse<CallSummary>>(
        `/call-summaries/${callId}`
      );
      return response.data;
    } catch (error) {
      // Summary might not exist
      this.logger.warn('Summary not found', { callId });
      return null;
    }
  }

  /**
   * Get call voicemail
   */
  async getCallVoicemail(callId: OpenPhoneID<'AC'>): Promise<CallVoicemail | null> {
    try {
      const response = await this.request<OpenPhoneAPIResponse<CallVoicemail>>(
        `/call-voicemails/${callId}`
      );
      return response.data;
    } catch (error) {
      // Voicemail might not exist
      this.logger.debug('Voicemail not found', { callId });
      return null;
    }
  }

  /**
   * Get complete call data with all enrichments
   */
  async getCompleteCall(callId: OpenPhoneID<'AC'>) {
    this.logger.info('Fetching complete call data', { callId });

    const [call, recordings, transcript, summary, voicemail] = await Promise.all([
      this.getCall(callId),
      this.getCallRecordings(callId),
      this.getCallTranscript(callId),
      this.getCallSummary(callId),
      this.getCallVoicemail(callId),
    ]);

    return {
      call,
      recordings,
      transcript,
      summary,
      voicemail,
    };
  }

  // ========================================================================
  // Messages API
  // ========================================================================

  /**
   * Get a single message by ID
   */
  async getMessage(messageId: OpenPhoneID<'AC'>): Promise<Message> {
    const response = await this.request<OpenPhoneAPIResponse<Message>>(
      `/messages/${messageId}`
    );
    return response.data;
  }

  /**
   * List messages with optional filters
   * Returns full response with pagination info
   */
  async listMessages(params?: MessagesListParams): Promise<OpenPhoneAPIListResponse<Message>> {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, String(value));
        }
      });
    }

    const endpoint = `/messages${queryParams.toString() ? `?${queryParams}` : ''}`;
    const response = await this.request<OpenPhoneAPIListResponse<Message>>(endpoint);
    return response;
  }

  // ========================================================================
  // Phone Numbers API
  // ========================================================================

  /**
   * List all phone numbers
   */
  async listPhoneNumbers(): Promise<OpenPhoneNumber[]> {
    const response = await this.request<OpenPhoneAPIListResponse<OpenPhoneNumber>>(
      '/phone-numbers'
    );
    return response.data;
  }

  /**
   * Get a phone number by ID
   */
  async getPhoneNumber(phoneNumberId: OpenPhoneID<'PN'>): Promise<OpenPhoneNumber> {
    const response = await this.request<OpenPhoneAPIResponse<OpenPhoneNumber>>(
      `/phone-numbers/${phoneNumberId}`
    );
    return response.data;
  }

  // ========================================================================
  // Users API
  // ========================================================================

  /**
   * List all users
   */
  async listUsers(): Promise<User[]> {
    const response = await this.request<OpenPhoneAPIListResponse<User>>('/users');
    return response.data;
  }

  /**
   * Get a user by ID
   */
  async getUser(userId: OpenPhoneID<'US'>): Promise<User> {
    const response = await this.request<OpenPhoneAPIResponse<User>>(
      `/users/${userId}`
    );
    return response.data;
  }

  // ========================================================================
  // Download Helpers
  // ========================================================================

  /**
   * Download a recording or voicemail file
   */
  async downloadAudioFile(url: string): Promise<ArrayBuffer> {
    this.logger.debug('Downloading audio file', { url });

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download audio file: ${response.status}`);
    }

    return response.arrayBuffer();
  }
}
