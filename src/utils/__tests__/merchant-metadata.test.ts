import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Env } from '../../types/env';
import { resolveMerchantMetadata } from '../merchant-metadata';
import { getMerchantRow } from '../d1-merchants';

vi.mock('../d1-merchants', async () => {
  const actual = await vi.importActual<typeof import('../d1-merchants')>('../d1-merchants');
  return {
    ...actual,
    getMerchantRow: vi.fn(),
  };
});

const getMerchantRowMock = vi.mocked(getMerchantRow);

function createEnv(): Env {
  return {
    DB: {} as any,
    AI: {} as any,
    CALL_VECTORS: {} as any,
    CACHE: {} as any,
  } as Env;
}

const logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
} as any;

describe('resolveMerchantMetadata', () => {
  beforeEach(() => {
    getMerchantRowMock.mockReset();
  });

  it('returns metadata from D1 when available', async () => {
    getMerchantRowMock.mockResolvedValue({
      canvas_id: 'canvas-1',
      merchant_uuid: 'merchant-1',
      name: 'Merchant One',
    } as any);

    const metadata = await resolveMerchantMetadata(createEnv(), logger, {
      canvasId: 'canvas-1',
    });

    expect(metadata).toEqual({
      canvasId: 'canvas-1',
      merchantUuid: 'merchant-1',
      merchantName: 'Merchant One',
    });
  });

  it('falls back to canvasId when no merchant found', async () => {
    getMerchantRowMock.mockResolvedValue(null);

    const metadata = await resolveMerchantMetadata(createEnv(), logger, {
      canvasId: 'canvas-2',
      fallbackToNotion: false,
    });

    expect(metadata).toEqual({
      canvasId: 'canvas-2',
      merchantUuid: 'canvas-2',
      merchantName: null,
    });
  });
});
