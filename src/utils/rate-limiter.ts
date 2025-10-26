/**
 * Token Bucket Rate Limiter
 * OpenPhone API limit: 10 requests per second
 */

import type { KVNamespace } from '@cloudflare/workers-types';
import type { RateLimitState } from '../types/env';
import { Logger } from './logger';

export class RateLimiter {
  private kv: KVNamespace;
  private logger: Logger;
  private key: string;
  private maxTokens: number;
  private refillRate: number; // tokens per second

  constructor(
    kv: KVNamespace,
    logger: Logger,
    options: {
      key?: string;
      maxTokens?: number;
      refillRate?: number;
    } = {}
  ) {
    this.kv = kv;
    this.logger = logger;
    this.key = options.key || 'openphone_rate_limit';
    this.maxTokens = options.maxTokens || 10; // OpenPhone limit
    this.refillRate = options.refillRate || 10; // 10 tokens per second
  }

  /**
   * Acquire a token to make a request
   * Returns true if token was acquired, false if rate limit exceeded
   */
  async acquire(tokens: number = 1): Promise<boolean> {
    const now = Date.now();
    const state = await this.getState();

    // Calculate tokens to add based on time elapsed
    const timeSinceLastRefill = (now - state.lastRefill) / 1000; // seconds
    const tokensToAdd = Math.floor(timeSinceLastRefill * this.refillRate);
    const newTokens = Math.min(state.tokens + tokensToAdd, this.maxTokens);

    // Check if we have enough tokens
    if (newTokens >= tokens) {
      // Consume tokens
      const updatedState: RateLimitState = {
        tokens: newTokens - tokens,
        lastRefill: now,
      };
      await this.setState(updatedState);
      this.logger.debug('Rate limit token acquired', {
        tokensRemaining: updatedState.tokens,
        tokensConsumed: tokens,
      });
      return true;
    }

    // Rate limit exceeded
    this.logger.warn('Rate limit exceeded', {
      tokensAvailable: newTokens,
      tokensRequested: tokens,
      maxTokens: this.maxTokens,
    });
    return false;
  }

  /**
   * Wait until a token is available (with timeout)
   */
  async waitForToken(tokens: number = 1, timeoutMs: number = 5000): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      if (await this.acquire(tokens)) {
        return true;
      }
      // Wait before retrying (exponential backoff)
      const elapsed = Date.now() - startTime;
      const waitTime = Math.min(100 * Math.pow(2, Math.floor(elapsed / 1000)), 1000);
      await this.sleep(waitTime);
    }

    return false;
  }

  /**
   * Get current rate limit state
   */
  private async getState(): Promise<RateLimitState> {
    const stored = await this.kv.get<RateLimitState>(this.key, 'json');
    if (stored) {
      return stored;
    }

    // Initialize with full tokens
    return {
      tokens: this.maxTokens,
      lastRefill: Date.now(),
    };
  }

  /**
   * Save rate limit state
   */
  private async setState(state: RateLimitState): Promise<void> {
    // Store with 60 second expiration (will auto-refill if unused)
    await this.kv.put(this.key, JSON.stringify(state), {
      expirationTtl: 60,
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get estimated wait time in milliseconds until tokens are available
   */
  async getWaitTime(tokens: number = 1): Promise<number> {
    const state = await this.getState();
    const now = Date.now();
    const timeSinceLastRefill = (now - state.lastRefill) / 1000;
    const currentTokens = Math.min(
      state.tokens + Math.floor(timeSinceLastRefill * this.refillRate),
      this.maxTokens
    );

    if (currentTokens >= tokens) {
      return 0;
    }

    const tokensNeeded = tokens - currentTokens;
    return Math.ceil((tokensNeeded / this.refillRate) * 1000);
  }
}
