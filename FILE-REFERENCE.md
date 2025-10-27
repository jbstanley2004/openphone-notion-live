# OpenPhone-Notion Integration: Quick File Reference

## Critical Files for Optimization

### 1. Entry Point & Handlers
- **`src/index.ts`** (271 lines)
  - Webhook receiver (`handleWebhook()`)
  - Queue consumer (`queue()`)
  - Cron scheduler handler (`scheduled()`)
  - Status: Core, needs queue optimization
  - Optimize: Parallel message processing, error handling

### 2. Durable Objects
- **`src/durable-objects/phone-number-sync.ts`** (465 lines)
  - Per-phone-number state coordination
  - Canvas lookup caching
  - Call/message sync with pagination
  - D1 async logging
  - Status: High priority for batch optimization
  - Optimize: Pagination, parallel call processing, batch D1 writes

### 3. Queue & Webhook Processing
- **`src/processors/webhook-processor.ts`** (349 lines)
  - Event routing and handling
  - Recording download and R2 upload
  - Notion page creation/updates
  - Status: Performance-critical
  - Optimize: Batch Notion operations, concurrent downloads, error handling

- **`src/processors/scheduled-tasks.ts`** (454 lines)
  - Periodic backfill (calls, messages)
  - Pending data updates
  - R2 cleanup and statistics
  - Status: Handles large volumes
  - Optimize: Pagination, parallel phone number processing

### 4. API Clients
- **`src/utils/openphone-client.ts`** (298 lines)
  - OpenPhone API wrapper
  - Rate limit enforcement
  - Calls, messages, phone numbers APIs
  - Status: API-critical
  - Optimize: Concurrent endpoint calls, pagination

- **`src/utils/notion-client.ts`** (822 lines) **LARGEST FILE**
  - Notion database operations
  - Canvas lookup with multiple format attempts
  - Page creation/updates
  - Schema inspection
  - Status: Performance bottleneck for Canvas lookups
  - Optimize: Persistent caching, batch operations, parallel property handling

- **`src/utils/r2-client.ts`** (234 lines)
  - Recording and voicemail uploads
  - File management
  - Storage statistics
  - Status: Handles large files
  - Optimize: Streaming uploads, concurrent transfers

### 5. Utilities & Infrastructure
- **`src/utils/rate-limiter.ts`** (138 lines)
  - Token bucket rate limiting
  - OpenPhone API throttling (10 req/sec)
  - Status: Works well but could optimize bursts
  - Optimize: Burst handling, DO aggregation

- **`src/utils/logger.ts`** (105 lines)
  - Structured logging with context
  - Status: Solid implementation
  - No changes needed

- **`src/utils/helpers.ts`** (375 lines)
  - Retry logic with exponential backoff
  - Sync state management (KV operations)
  - Caching helpers
  - Data validation and formatting
  - Status: Utility layer
  - Optimize: Batch cache operations, deduplication efficiency

### 6. Type Definitions
- **`src/types/env.ts`** (118 lines)
  - Cloudflare environment types
  - Queue, KV, Database types
  - Status: Stable
  - No changes needed

- **`src/types/openphone.ts`** (200+ lines)
  - OpenPhone API types
  - Call, message, recording types
  - Status: Stable
  - No changes needed

- **`src/types/notion.ts`** (100+ lines)
  - Notion API property types
  - Status: Stable
  - No changes needed

### 7. Configuration & Schema
- **`wrangler.jsonc`** (116 lines)
  - Cloudflare Workers configuration
  - KV, R2, Queue, D1, DO bindings
  - Cron schedule: `0 */6 * * *` (every 6 hours)
  - Queue config: batch_size=10, timeout=30s
  - Status: Requires tuning
  - Optimize: Adjust cron frequency, queue batch size

- **`migrations/0001_initial_schema.sql`** (85 lines)
  - D1 database schema
  - 4 tables: phone_numbers, sync_history, canvas_cache, performance_metrics
  - 2 views: sync_stats_today, canvas_cache_stats
  - Status: Needs additional indexes
  - Optimize: Add indexes for batch queries, partitioning

- **`migrations/` (directory)**
  - Only one migration file currently
  - Add new migrations for future schema changes

### 8. Auxiliary Files
- **`src/utils/notion-fetch-client.ts`** (100 lines)
  - Low-level Notion HTTP client wrapper
  - Status: Stable
  - No changes needed

- **`package.json`** (32 lines)
  - Dependencies: @notionhq/client ^2.2.15
  - Dev dependencies: wrangler, typescript, vitest
  - Status: Updated
  - No changes needed

---

## File Dependency Graph

```
index.ts (main entry point)
├── webhook-processor.ts
│   ├── openphone-client.ts → rate-limiter.ts
│   ├── notion-client.ts → notion-fetch-client.ts
│   └── r2-client.ts
├── scheduled-tasks.ts
│   ├── openphone-client.ts
│   ├── notion-client.ts
│   └── r2-client.ts
├── phone-number-sync.ts (Durable Object)
│   ├── openphone-client.ts
│   ├── notion-client.ts
│   └── r2-client.ts
└── helpers.ts
    └── (used by all)
```

---

## Files by Modification Priority

### Priority 1: MUST OPTIMIZE
1. **phone-number-sync.ts** - Pagination, batching, parallel processing
2. **webhook-processor.ts** - Batch Notion ops, concurrent downloads
3. **notion-client.ts** - Canvas caching, batch operations
4. **wrangler.jsonc** - Queue tuning, cron adjustment

### Priority 2: SHOULD OPTIMIZE
5. **scheduled-tasks.ts** - Parallel processing, pagination
6. **openphone-client.ts** - Concurrent calls, pagination
7. **r2-client.ts** - Streaming uploads
8. **index.ts** - Queue consumer optimization

### Priority 3: COULD OPTIMIZE
9. **rate-limiter.ts** - Burst handling
10. **helpers.ts** - Batch operations
11. **migrations/0001_initial_schema.sql** - Indexes, partitioning

### Priority 4: STABLE (No changes)
- logger.ts
- types/* (all type definitions)
- notion-fetch-client.ts
- package.json

---

## Key Code Patterns

### File Operations
- All KV operations in `helpers.ts` (lines 70-130)
- All R2 operations in `r2-client.ts` (lines 50-234)
- All D1 writes in `phone-number-sync.ts` (lines 342-404)

### Rate Limiting
- Token bucket in `rate-limiter.ts` (lines 37-68)
- Used in `openphone-client.ts` (line 57)

### Sync State Tracking
- KV key pattern: `sync:{resourceId}`
- Event deduplication: `event:{eventId}`
- Implemented in `helpers.ts` (lines 70-130)

### Canvas Lookup Flow
- Input: Phone number or email
- Primary method: `notion-client.ts` (lines 573-692 for phone, 697-738 for email)
- Cache: In-memory in Durable Object, persistent in D1
- Multiple format attempts for phone numbers

### Webhook Processing Flow
1. HTTP POST to index.ts:handleWebhook()
2. Validate and deduplicate
3. Queue to WEBHOOK_EVENTS
4. Batch processed by index.ts:queue()
5. Route to webhook-processor handlers
6. Write to Notion and R2

### Cron Processing Flow
1. Cron trigger at index.ts:scheduled()
2. Call scheduled-tasks.ts:runScheduledTasks()
3. Backfill calls and messages (last 24 hours)
4. Update pending data (last 7 days)
5. Cleanup and statistics (R2)

---

## File Size Summary

```
notion-client.ts         822 lines ← LARGEST, Canvas lookups
phone-number-sync.ts     465 lines
scheduled-tasks.ts       454 lines
webhook-processor.ts     349 lines
openphone-client.ts      298 lines
r2-client.ts             234 lines
helpers.ts               375 lines
index.ts                 271 lines
rate-limiter.ts          138 lines
logger.ts                105 lines
notion-fetch-client.ts   100 lines
─────────────────────────────────
Total: ~3,610 lines of application code
```

---

## Configuration IDs & Bindings

### KV Namespaces
- SYNC_STATE: `efb60e5bf6a848b9abb9e4cef4fe1540` (prod), `d363298bccf245ca84708e42273d7e66` (preview)
- RATE_LIMITS: `3e1d50017a4440e7bb11c9622ed55903` (prod), `a9f4b0d06c5346df9e998f22e884517d` (preview)
- CACHE: `30047d365c3c40ed85ce8b67fdde690f` (prod), `8d900aca21444ccbb7a53fed9c3e2818` (preview)

### R2 Buckets
- RECORDINGS_BUCKET: `openphone-recordings` (prod), `openphone-recordings-dev` (preview)

### Queues
- WEBHOOK_EVENTS: `openphone-webhook-events` (batch_size: 10, timeout: 30s, retries: 3)
- Dead-letter: `openphone-webhook-events-dlq`

### Database
- DB: `openphone-sync-db` (id: `bd3d363a-f18e-4dcf-8b80-928c83664d3e`)

### Durable Objects
- PHONE_SYNC: `PhoneNumberSync` class

### Analytics
- ANALYTICS: `openphone_sync_events` dataset

### Account
- Account ID: `506f4c81d1f66559b4df239fd1e39394`

---

**Last Updated**: 2025-10-27
**Branch**: claude/session-011CUYYtfLgwTwyBpQhCqr5g
