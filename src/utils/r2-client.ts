/**
 * R2 Storage Client
 * Handles uploading and managing call recordings and voicemails in Cloudflare R2
 */

import type { R2Bucket } from '@cloudflare/workers-types';
import type { OpenPhoneID } from '../types/openphone';
import { Logger } from './logger';

export class R2Client {
  private bucket: R2Bucket;
  private logger: Logger;
  private publicBaseUrl?: string;

  constructor(bucket: R2Bucket, logger: Logger, publicBaseUrl?: string) {
    this.bucket = bucket;
    this.logger = logger;
    this.publicBaseUrl = publicBaseUrl;
  }

  /**
   * Generate a structured key for storing recordings
   * Format: recordings/YYYY/MM/DD/{callId}-{timestamp}.mp3
   */
  private generateRecordingKey(callId: OpenPhoneID<'AC'>, timestamp: string): string {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const unixTime = date.getTime();

    return `recordings/${year}/${month}/${day}/${callId}-${unixTime}.mp3`;
  }

  /**
   * Generate a structured key for storing voicemails
   * Format: voicemails/YYYY/MM/DD/{callId}-{timestamp}.mp3
   */
  private generateVoicemailKey(callId: OpenPhoneID<'AC'>, timestamp: string): string {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const unixTime = date.getTime();

    return `voicemails/${year}/${month}/${day}/${callId}-${unixTime}.mp3`;
  }

  /**
   * Upload a recording to R2
   */
  async uploadRecording(
    callId: OpenPhoneID<'AC'>,
    audioData: ArrayBuffer,
    metadata: {
      timestamp: string;
      duration?: number;
      contentType?: string;
    }
  ): Promise<string> {
    const key = this.generateRecordingKey(callId, metadata.timestamp);

    this.logger.info('Uploading recording to R2', { callId, key });

    try {
      await this.bucket.put(key, audioData, {
        httpMetadata: {
          contentType: metadata.contentType || 'audio/mpeg',
        },
        customMetadata: {
          callId,
          timestamp: metadata.timestamp,
          duration: metadata.duration?.toString() || '',
          uploadedAt: new Date().toISOString(),
        },
      });

      const url = await this.getPublicUrl(key);
      this.logger.info('Recording uploaded successfully', { callId, key, url });

      return url;
    } catch (error) {
      this.logger.error('Failed to upload recording', error);
      throw error;
    }
  }

  /**
   * Upload a voicemail to R2
   */
  async uploadVoicemail(
    callId: OpenPhoneID<'AC'>,
    audioData: ArrayBuffer,
    metadata: {
      timestamp: string;
      duration?: number;
      contentType?: string;
      transcription?: string;
    }
  ): Promise<string> {
    const key = this.generateVoicemailKey(callId, metadata.timestamp);

    this.logger.info('Uploading voicemail to R2', { callId, key });

    try {
      await this.bucket.put(key, audioData, {
        httpMetadata: {
          contentType: metadata.contentType || 'audio/mpeg',
        },
        customMetadata: {
          callId,
          timestamp: metadata.timestamp,
          duration: metadata.duration?.toString() || '',
          transcription: metadata.transcription || '',
          uploadedAt: new Date().toISOString(),
        },
      });

      const url = await this.getPublicUrl(key);
      this.logger.info('Voicemail uploaded successfully', { callId, key, url });

      return url;
    } catch (error) {
      this.logger.error('Failed to upload voicemail', error);
      throw error;
    }
  }

  /**
   * Check if a file exists in R2
   */
  async exists(key: string): Promise<boolean> {
    try {
      const object = await this.bucket.head(key);
      return object !== null;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get a file from R2
   */
  async get(key: string): Promise<ArrayBuffer | null> {
    try {
      const object = await this.bucket.get(key);
      if (object === null) {
        return null;
      }
      return object.arrayBuffer();
    } catch (error) {
      this.logger.error('Failed to get file from R2', error);
      return null;
    }
  }

  /**
   * Delete a file from R2
   */
  async delete(key: string): Promise<void> {
    try {
      await this.bucket.delete(key);
      this.logger.info('File deleted from R2', { key });
    } catch (error) {
      this.logger.error('Failed to delete file from R2', error);
      throw error;
    }
  }

  /**
   * List files with a prefix
   */
  async list(prefix: string, limit: number = 1000): Promise<string[]> {
    try {
      const listed = await this.bucket.list({
        prefix,
        limit,
      });

      return listed.objects.map((obj) => obj.key);
    } catch (error) {
      this.logger.error('Failed to list files from R2', error);
      return [];
    }
  }

  /**
   * Get public URL for an R2 object
   * Note: This requires R2 bucket to be configured with public access
   * or custom domain. Adjust based on your setup.
   */
  private async getPublicUrl(key: string): Promise<string> {
    if (this.publicBaseUrl) {
      const normalizedBase = this.publicBaseUrl.replace(/\/+$/, '');
      return `${normalizedBase}/${key}`;
    }

    const maybeCreateSignedUrl = (this.bucket as unknown as {
      createSignedUrl?: (options: { key: string; expires: Date }) => Promise<any>;
    }).createSignedUrl;

    if (typeof maybeCreateSignedUrl === 'function') {
      const expires = new Date(Date.now() + 15 * 60 * 1000);
      const result = await maybeCreateSignedUrl.call(this.bucket, { key, expires });

      if (typeof result === 'string') {
        return result;
      }

      if (result && typeof result === 'object') {
        if (typeof (result as { url?: string }).url === 'string') {
          return (result as { url: string }).url;
        }

        if (typeof (result as { signedUrl?: string }).signedUrl === 'string') {
          return (result as { signedUrl: string }).signedUrl;
        }
      }
    }

    throw new Error(
      'Unable to generate public URL for R2 object. Configure RECORDINGS_PUBLIC_BASE_URL or ensure R2 signed URLs are supported.'
    );
  }

  /**
   * Generate a presigned URL for temporary access
   */
  async getPresignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    if (this.publicBaseUrl) {
      return this.getPublicUrl(key);
    }

    const maybeCreateSignedUrl = (this.bucket as unknown as {
      createSignedUrl?: (options: { key: string; expires: Date }) => Promise<any>;
    }).createSignedUrl;

    if (typeof maybeCreateSignedUrl !== 'function') {
      throw new Error('R2 bucket does not support signed URLs. Configure RECORDINGS_PUBLIC_BASE_URL for public access.');
    }

    const expires = new Date(Date.now() + expiresIn * 1000);
    const result = await maybeCreateSignedUrl.call(this.bucket, { key, expires });

    if (typeof result === 'string') {
      return result;
    }

    if (result && typeof result === 'object') {
      if (typeof (result as { url?: string }).url === 'string') {
        return (result as { url: string }).url;
      }

      if (typeof (result as { signedUrl?: string }).signedUrl === 'string') {
        return (result as { signedUrl: string }).signedUrl;
      }
    }

    throw new Error('Unexpected response when generating signed URL from R2.');
  }

  /**
   * Get storage statistics
   */
  async getStats(prefix: string = ''): Promise<{
    count: number;
    totalSize: number;
  }> {
    try {
      const listed = await this.bucket.list({ prefix });

      const totalSize = listed.objects.reduce((sum, obj) => sum + obj.size, 0);

      return {
        count: listed.objects.length,
        totalSize,
      };
    } catch (error) {
      this.logger.error('Failed to get R2 stats', error);
      return { count: 0, totalSize: 0 };
    }
  }
}
