import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Env } from '../../types/env';
import { searchMerchants } from '../merchant-retrieval';
import { semanticSearch } from '../../utils/vector-search';
import { getMerchantRow } from '../../utils/d1-merchants';

vi.mock('../../utils/vector-search', () => ({
  semanticSearch: vi.fn(),
}));

vi.mock('../../utils/d1-merchants', async () => {
  const actual = await vi.importActual<typeof import('../../utils/d1-merchants')>(
    '../../utils/d1-merchants'
  );
  return {
    ...actual,
    getMerchantRow: vi.fn(),
    searchMerchantsInD1: actual.searchMerchantsInD1,
  };
});

const semanticSearchMock = vi.mocked(semanticSearch);
const getMerchantRowMock = vi.mocked(getMerchantRow);

function createEnv(): Env {
  return {
    DB: {
      prepare: vi.fn(() => ({
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({ results: [] }),
      })),
    } as any,
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

describe('searchMerchants', () => {
  beforeEach(() => {
    semanticSearchMock.mockReset();
    getMerchantRowMock.mockReset();
  });

  it('groups vector results by merchant metadata without Notion lookups', async () => {
    const env = createEnv();

    semanticSearchMock.mockResolvedValue([
      {
        id: 'call:1',
        score: 0.92,
        metadata: {
          type: 'call',
          timestamp: '2024-01-01T00:00:00.000Z',
          direction: 'incoming',
          canvasId: 'canvas-123',
          merchantUuid: 'merchant-abc',
          merchantName: 'Acme Co',
        },
      },
      {
        id: 'message:2',
        score: 0.85,
        metadata: {
          type: 'message',
          timestamp: '2024-01-02T00:00:00.000Z',
          direction: 'outgoing',
          canvasId: 'canvas-123',
          merchantUuid: 'merchant-abc',
          merchantName: 'Acme Co',
        },
      },
    ]);

    const results = await searchMerchants('pricing', { topK: 5 }, env, logger);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      canvasId: 'canvas-123',
      merchantUuid: 'merchant-abc',
      merchantName: 'Acme Co',
    });
    expect(semanticSearchMock).toHaveBeenCalled();
    expect(getMerchantRowMock).not.toHaveBeenCalled();
  });
});
