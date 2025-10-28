import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { R2Bucket } from '@cloudflare/workers-types';

import { R2Client } from '../r2-client';
import type { Logger } from '../logger';

describe('R2Client public URL generation', () => {
  const makeLogger = (): Logger => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }) as unknown as Logger;

  const baseTimestamp = '2024-01-02T03:04:05.000Z';
  const recordingKey = 'recordings/2024/01/02/AC123-1704164645000.mp3';
  const voicemailKey = 'voicemails/2024/01/02/AC123-1704164645000.mp3';

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-02T03:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a URL that is resolvable via the configured public base', async () => {
    const bucket = {
      put: vi.fn().mockResolvedValue({}),
    } as unknown as R2Bucket;

    const client = new R2Client(
      bucket,
      makeLogger(),
      'https://cdn.example.com/media/'
    );

    const url = await client.uploadRecording('AC123' as any, new ArrayBuffer(0), {
      timestamp: baseTimestamp,
    });

    expect(url).toBe(`https://cdn.example.com/media/${recordingKey}`);
    expect((bucket as any).put).toHaveBeenCalledWith(
      recordingKey,
      expect.any(ArrayBuffer),
      expect.objectContaining({ customMetadata: expect.any(Object) })
    );
  });

  it('falls back to a signed URL when no public base is configured', async () => {
    const createSignedUrl = vi.fn().mockResolvedValue('https://signed.example.com/path');
    const bucket = {
      put: vi.fn().mockResolvedValue({}),
      createSignedUrl,
    } as unknown as R2Bucket;

    const client = new R2Client(bucket, makeLogger());

    const url = await client.uploadVoicemail('AC123' as any, new ArrayBuffer(0), {
      timestamp: baseTimestamp,
    });

    expect(url).toBe('https://signed.example.com/path');
    expect(createSignedUrl).toHaveBeenCalledWith({
      key: voicemailKey,
      expires: expect.any(Date),
    });
  });

  it('throws a helpful error when no URL strategy is available', async () => {
    const bucket = {
      put: vi.fn().mockResolvedValue({}),
    } as unknown as R2Bucket;

    const client = new R2Client(bucket, makeLogger());

    await expect(
      client.uploadRecording('AC123' as any, new ArrayBuffer(0), {
        timestamp: baseTimestamp,
      })
    ).rejects.toThrow('Unable to generate public URL for R2 object');
  });
});
