# OpenPhone-Notion Integration: Comprehensive Architecture Overview

## Project Summary
A headless Cloudflare Workers integration that syncs OpenPhone call and message data in real-time to Notion databases, with recordings stored in R2 and analytics tracked in D1.

**Repository**: `/home/user/openphone-notion-live`
**Git Branch**: `claude/session-011CUYYtfLgwTwyBpQhCqr5g`

---

## 1. PROJECT STRUCTURE & KEY FILES

```
openphone-notion-live/
├── src/
│   ├── index.ts                           # Main Worker entry point
│   ├── durable-objects/
│   │   └── phone-number-sync.ts           # Per-phone-number state coordination
│   ├── processors/
│   │   ├── webhook-processor.ts           # Queue consumer for webhook events
│   │   └── scheduled-tasks.ts             # Cron job handler (every 6 hours)
│   ├── types/
│   │   ├── env.ts                         # Cloudflare environment types
│   │   ├── notion.ts                      # Notion API property types
│   │   └── openphone.ts                   # OpenPhone API types
│   └── utils/
│       ├── logger.ts                      # Structured logging
│       ├── helpers.ts                     # Utility functions (retry, cache, dedupe)
│       ├── rate-limiter.ts                # Token bucket rate limiter
│       ├── openphone-client.ts            # OpenPhone API wrapper
│       ├── notion-client.ts               # Notion API wrapper (822 lines)
│       ├── notion-fetch-client.ts         # Low-level Notion HTTP client
│       └── r2-client.ts                   # R2 storage wrapper
├── migrations/
│   └── 0001_initial_schema.sql            # D1 database schema
├── wrangler.jsonc                         # Cloudflare Workers config
└── package.json
```

---

## 2. DURABLE OBJECTS IMPLEMENTATION

**File**: `/home/user/openphone-notion-live/src/durable-objects/phone-number-sync.ts`

### Purpose
One Durable Object instance per OpenPhone phone number. Coordinates real-time sync, manages state, and caches Canvas lookups.

### Key Features
- **In-memory State Management**:
  - `phoneNumberId`: Phone number ID
  - `phoneNumber`: E.164 format number
  - `lastCallSync`: Unix timestamp of last call sync
  - `lastMessageSync`: Unix timestamp of last message sync
  - `canvasCache`: In-memory cache mapping `phone:xxx` or `email:xxx` → Canvas ID
  - `totalCallsSynced`, `totalMessagesSynced`: Running counters

- **Core Methods**:
  - `ensureInitialized()`: Loads state from storage or initializes new
  - `saveState()`: Persists state to durable storage
  - `syncCalls()`: Fetches and syncs new calls since last sync
  - `syncMessages()`: Fetches and syncs new messages
  - `processCall()`: Handles individual call with Canvas lookup and recording upload
  - `handleWebhook()`: Processes real-time webhook events
  - `getCanvasId()`: Queries or retrieves cached Canvas relations
  
- **Async Logging** (using `ctx.waitUntil()`):
  - `logToD1()`: Generic D1 insertion
  - `logSyncHistory()`: Records sync success/failure
  - `logCanvasCache()`: Tracks cached Canvas lookups
  - `logPerformanceMetric()`: Performance monitoring
  - `updateCanvasCacheHit()`: Updates hit counts

### API Endpoints
- `POST /init`: Initialize DO with phone number
- `POST /sync/calls`: Trigger call sync
- `POST /sync/messages`: Trigger message sync
- `POST /webhook`: Handle real-time webhook
- `GET /state`: Debug state inspection

### Files to Modify for Optimization
- **phone-number-sync.ts**: Primary target for batch sync optimization
  - Pagination handling in `syncCalls()` and `syncMessages()`
  - Canvas cache efficiency improvements
  - Parallel processing opportunities

---

## 3. QUEUE & WEBHOOK PROCESSING

### Webhook Flow
```
OpenPhone API → POST /webhooks/openphone → handleWebhook()
                                               ↓
                                    Validate signature (if configured)
                                               ↓
                                    Check for duplicates (KV)
                                               ↓
                                    WEBHOOK_EVENTS queue
                                               ↓
                                    queue() handler
                                               ↓
                                    processWebhookEvent()
```

**Files**:
- `/home/user/openphone-notion-live/src/index.ts` (lines 24-229): HTTP webhook receiver
- `/home/user/openphone-notion-live/src/processors/webhook-processor.ts`: Event routing and handling

### Queue Configuration (wrangler.jsonc)
```jsonc
"queues": {
  "producers": [{
    "binding": "WEBHOOK_EVENTS",
    "queue": "openphone-webhook-events"
  }],
  "consumers": [{
    "queue": "openphone-webhook-events",
    "max_batch_size": 10,
    "max_batch_timeout": 30,
    "max_retries": 3,
    "dead_letter_queue": "openphone-webhook-events-dlq"
  }]
}
```

### Event Types Handled
- `call.completed`: Full call data sync
- `call.recording.completed`: Recording upload trigger
- `call.transcript.completed`: Transcript update
- `call.summary.completed`: AI summary update
- `message.received`: Message sync
- `message.delivered`: Message delivery status

### Deduplication Strategy
- **Key**: `event:{eventId}` in KV `SYNC_STATE` namespace
- **TTL**: 7 days
- Located in `/home/user/openphone-notion-live/src/utils/helpers.ts` (lines 188-208)

### Files to Modify for Optimization
- **webhook-processor.ts**: Event processing logic
  - Recording download and upload optimization
  - Notion API batch operations
  - Error handling and retry logic

---

## 4. KV NAMESPACE USAGE PATTERNS

**Configuration** (wrangler.jsonc lines 29-45):

### SYNC_STATE (id: efb60e5bf6a848b9abb9e4cef4fe1540)
**Purpose**: Track resource sync status and webhook deduplication

**Key Patterns**:
- `sync:{resourceId}` → SyncState (TTL: 30 days)
- `event:{eventId}` → Timestamp string (TTL: 7 days)

**SyncState Structure** (src/types/env.ts):
```typescript
{
  resourceId: string;
  resourceType: 'call' | 'message';
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  notionPageId?: string;
  attempts: number;
  lastAttempt: string; // ISO 8601
  error?: string;
  metadata?: Record<string, any>;
}
```

**Usage in Code**:
- `helpers.ts` (lines 70-130): `getSyncState()`, `setSyncState()`, `markAsSynced()`, `markAsFailed()`
- `index.ts` (lines 193-200): Webhook deduplication
- `webhook-processor.ts` (lines 119-190): Sync state tracking
- `scheduled-tasks.ts` (lines 110-300): Checking sync status during backfill

### RATE_LIMITS (id: 3e1d50017a4440e7bb11c9622ed55903)
**Purpose**: Token bucket rate limiting for OpenPhone API (10 req/sec)

**Key Pattern**:
- `openphone_rate_limit` → RateLimitState (TTL: 60 seconds, auto-refill)

**RateLimitState Structure** (src/types/env.ts):
```typescript
{
  tokens: number;
  lastRefill: number; // Unix timestamp in ms
}
```

**Implementation**: `/home/user/openphone-notion-live/src/utils/rate-limiter.ts`
- Token bucket algorithm with exponential backoff
- Used by OpenPhoneClient in all API requests

### CACHE (id: 30047d365c3c40ed85ce8b67fdde690f)
**Purpose**: General purpose caching (phone numbers, users, etc.)

**Key Pattern**:
- `cache:{key}` → CacheEntry<T> (with expiration)

**CacheEntry Structure** (src/types/env.ts):
```typescript
{
  data: T;
  cachedAt: string; // ISO 8601
  expiresAt: string; // ISO 8601
}
```

**Helpers** (helpers.ts lines 139-179):
- `getCache<T>()`: Retrieve with expiration check
- `setCache<T>()`: Store with TTL (default 3600s)

### Files to Modify for Optimization
- **rate-limiter.ts**: Rate limiting strategy refinement
- **helpers.ts**: Cache invalidation and TTL tuning
- Durable Object canvas cache to KV coordination

---

## 5. R2 BUCKET USAGE PATTERNS

**Configuration** (wrangler.jsonc lines 20-26):
- **Binding**: `RECORDINGS_BUCKET`
- **Production**: `openphone-recordings`
- **Preview**: `openphone-recordings-dev`

**Directory Structure**:
```
recordings/YYYY/MM/DD/{callId}-{timestamp}.mp3
voicemails/YYYY/MM/DD/{callId}-{timestamp}.mp3
```

**Implementation**: `/home/user/openphone-notion-live/src/utils/r2-client.ts`

**Key Methods**:
- `uploadRecording()`: Store call recordings with metadata
- `uploadVoicemail()`: Store voicemail audio with transcription
- `exists()`: Check if file already exists
- `get()`: Retrieve file as ArrayBuffer
- `delete()`: Remove file
- `list()`: List files with prefix
- `getStats()`: Calculate storage usage (used in cleanup)

**Custom Metadata Storage**:
```
{
  callId: string;
  timestamp: string;
  duration: string;
  uploadedAt: string; // ISO 8601
  transcription: string; // voicemails only
}
```

**Public URL Generation**:
- Currently returns placeholder `https://r2.example.com/{key}`
- Should be configured with R2 public bucket or custom domain
- Presigned URLs not yet implemented (noted as future feature)

### Files to Modify for Optimization
- **r2-client.ts**: Streaming uploads, concurrent transfers
- **webhook-processor.ts** and **phone-number-sync.ts**: Download-upload flow optimization

---

## 6. D1 DATABASE SCHEMA & USAGE

**Configuration** (wrangler.jsonc lines 75-81):
- **Binding**: `DB`
- **Database Name**: `openphone-sync-db`
- **Database ID**: `bd3d363a-f18e-4dcf-8b80-928c83664d3e`

**Migration**: `/home/user/openphone-notion-live/migrations/0001_initial_schema.sql`

### Tables

#### `phone_numbers`
```sql
id TEXT PRIMARY KEY                    -- PN{id}
number TEXT NOT NULL                   -- E.164 format
name TEXT
first_seen_at INTEGER NOT NULL
last_call_sync_at INTEGER
last_message_sync_at INTEGER
total_calls_synced INTEGER DEFAULT 0
total_messages_synced INTEGER DEFAULT 0
is_active INTEGER DEFAULT 1
created_at INTEGER NOT NULL
updated_at INTEGER NOT NULL
```
**Usage**: Tracks per-phone-number sync state and statistics

#### `sync_history`
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
phone_number_id TEXT NOT NULL (FK)
resource_type TEXT                     -- 'call', 'message', 'mail'
resource_id TEXT NOT NULL              -- AC{id}
direction TEXT                         -- 'incoming', 'outgoing'
notion_page_id TEXT
canvas_id TEXT
sync_status TEXT                       -- 'success', 'failed', 'skipped'
error_message TEXT
processing_time_ms INTEGER
synced_at INTEGER NOT NULL             -- Unix timestamp
```
**Usage**: Audit trail and analytics; indexed on `(phone_number_id, synced_at)`, `(resource_type, resource_id)`, `(synced_at DESC)`

#### `canvas_cache`
```sql
lookup_key TEXT PRIMARY KEY            -- normalized phone or email
lookup_type TEXT NOT NULL              -- 'phone' or 'email'
canvas_id TEXT NOT NULL                -- Notion page ID
canvas_name TEXT
cached_at INTEGER NOT NULL
hit_count INTEGER DEFAULT 1
last_used_at INTEGER NOT NULL
```
**Usage**: Persistent cache of Canvas lookups; speeds up subsequent queries

#### `performance_metrics`
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
metric_type TEXT NOT NULL              -- 'api_call', 'notion_query', 'canvas_lookup'
operation TEXT NOT NULL
duration_ms INTEGER NOT NULL
success INTEGER NOT NULL               -- 1 or 0
phone_number_id TEXT
timestamp INTEGER NOT NULL
```
**Usage**: Performance monitoring and optimization opportunities

### Views
- `sync_stats_today`: Daily sync statistics grouped by phone, resource type, and status
- `canvas_cache_stats`: Cache hit ratio and effectiveness

**Writing to D1**:
- Durable Object uses `ctx.waitUntil()` for async writes (doesn't block main sync flow)
- Located in phone-number-sync.ts lines 342-404
- Generic `logToD1()` method: lines 342-354

### Files to Modify for Optimization
- **phone-number-sync.ts**: D1 write operations (batch inserts)
- **scheduled-tasks.ts**: Analytics and monitoring queries

---

## 7. OVERALL PROJECT STRUCTURE & PROCESSING FLOW

### Request Flow

#### A. Webhook Reception (Real-time)
```
1. OpenPhone sends POST to /webhooks/openphone
   ↓
2. index.ts:handleWebhook()
   - Parse payload
   - Validate signature (optional)
   - Check KV for duplicate (event:{id})
   - Mark event as processed in KV
   ↓
3. Queue message: WEBHOOK_EVENTS.send(QueuedWebhookEvent)
   ↓
4. Return 200 OK immediately
```

#### B. Queue Processing (Batched)
```
1. Queue consumer triggered (batch_size: 10, timeout: 30s)
   ↓
2. index.ts:queue() handler
   - Process 10 messages in parallel
   - Call processWebhookEvent() for each
   ↓
3. webhook-processor.ts:processWebhookEvent()
   - Route to handler (call.completed, message.received, etc.)
   - Download recordings/voicemails from OpenPhone
   - Upload to R2
   - Check if Notion page exists
   - Create or update Notion page
   ↓
4. message.ack() or message.retry()
   - Success: ack
   - Retry count < 3: retry()
   - Retry count >= 3: ack() → dead-letter-queue
```

#### C. Scheduled Backfill (Every 6 hours)
```
1. Cron trigger: "0 */6 * * *"
   ↓
2. index.ts:scheduled() handler
   ↓
3. scheduled-tasks.ts:runScheduledTasks()
   - backfillRecentCalls() - last 24 hours
   - backfillRecentMessages() - last 24 hours
   - updatePendingCallData() - last 7 days
   - cleanupOldSyncState() - R2 statistics
```

#### D. Durable Object Sync (Future/Optimized)
```
1. Cron can invoke per-phone-number Durable Objects
   ↓
2. PhoneNumberSync.fetch(/sync/calls, POST)
   - Fetch new calls since lastCallSync
   - Process each call
   - Update lastCallSync timestamp
   ↓
3. In-memory canvas cache used for lookups
   - Fast: no Notion query needed
   - Persistent: saved to DO state
```

### Key Entry Points

| File | Handler | Trigger | Purpose |
|------|---------|---------|---------|
| index.ts | `fetch()` | HTTP POST | Webhook receiver + health check |
| index.ts | `queue()` | Queue message | Batch webhook processing |
| index.ts | `scheduled()` | Cron job | Periodic backfill |
| phone-number-sync.ts | `fetch()` | DO request | Per-phone sync coordination |
| webhook-processor.ts | `processWebhookEvent()` | Queue consumer | Event-specific handlers |
| scheduled-tasks.ts | `runScheduledTasks()` | Cron handler | Backfill and cleanup |

---

## 8. WRANGLER.JSONC CONFIGURATION

**Location**: `/home/user/openphone-notion-live/wrangler.jsonc`

```jsonc
{
  "name": "openphone-notion-sync",
  "main": "src/index.ts",
  "compatibility_date": "2025-03-07",
  "compatibility_flags": ["nodejs_compat"],
  "account_id": "506f4c81d1f66559b4df239fd1e39394",
  
  // Observability
  "observability": {
    "enabled": true,
    "head_sampling_rate": 1   // 100% tracing
  },
  
  // Environment variables
  "vars": {
    "OPENPHONE_API_BASE": "https://api.openphone.com/v1",
    "LOG_LEVEL": "info",
    "WEBHOOK_PATH": "/webhooks/openphone"
  },
  
  // Bindings: R2, KV, Queues, Analytics, D1, Durable Objects
  // ... (see wrangler.jsonc for full details)
}
```

### Key Configuration Points
- **Compatibility Date**: 2025-03-07 (recent)
- **nodejs_compat**: Enabled for Node.js APIs
- **Observability**: 100% head sampling for debugging
- **Cron**: `0 */6 * * *` (every 6 hours)

### Secret Management
Secrets set via `wrangler secret put`:
- `OPENPHONE_API_KEY`
- `NOTION_API_KEY`
- `NOTION_CALLS_DATABASE_ID`
- `NOTION_MESSAGES_DATABASE_ID`
- `NOTION_CANVAS_DATABASE_ID`
- `NOTION_MAIL_DATABASE_ID`
- `WEBHOOK_SECRET` (optional)
- `ALERT_WEBHOOK_URL` (optional)

---

## 9. NOTION CLIENT ARCHITECTURE

**File**: `/home/user/openphone-notion-live/src/utils/notion-client.ts` (822 lines)

### Databases
- **Calls**: Synced call records with recordings, transcripts, summaries
- **Messages**: SMS/text message records
- **Canvas**: Customer/prospect contact records (lookup target)
- **Mail**: Email records (future, partially implemented)

### Key Methods

#### Call Operations
- `createCallPage()`: Create new call record with all enrichments
- `updateCallPage()`: Update existing call with new data
- `callPageExists()`: Check by OpenPhone call ID

#### Message Operations
- `createMessagePage()`: Create SMS message record
- `updateMessagePage()`: Update message record
- `messagePageExists()`: Check by OpenPhone message ID

#### Canvas Lookups
- `findCanvasByPhone()`: Search Canvas by phone number (lines 573-692)
  - Tries multiple formats: `XXX-XXX-XXXX`, `XXXXXXXXXX`, `+1XXXXXXXXXX`
  - Primary: phone_number field type (exact match)
  - Fallback: rich_text field type (contains match)
  - Returns first match or null
  - No caching (that's in Durable Object)

- `findCanvasByEmail()`: Search Canvas by email (lines 697-738)
  - Exact match on Email field type
  - Case-insensitive normalization

#### Debug Operations
- `getDebugInfo()`: Retrieve database schema and sample records

### Property Types Handled
All Notion property types mapped in `/home/user/openphone-notion-live/src/types/notion.ts`:
- Title, RichText, Number, Select, MultiSelect
- Date, Checkbox, URL, PhoneNumber, Email
- Files (external), Relation (Canvas links)

### Performance Considerations
- **Canvas Lookup Optimization Opportunity**:
  - Currently queries Notion for every new participant
  - Durable Object cache prevents redundant lookups (same phone in session)
  - First-time lookups still hit Notion API (slow)
  - Persistent D1 cache could reduce subsequent lookups

- **Notion API Rate Limits**:
  - Not explicitly rate-limited in code
  - Could be bottleneck under high call volume
  - Consider batch operations or queue-based updates

### Files to Modify for Optimization
- **notion-client.ts**: 
  - Canvas lookup optimization (caching)
  - Batch page creation/updates
  - Parallel property population

---

## 10. FILES REQUIRING MODIFICATION FOR OPTIMIZATIONS

### Priority 1: Durable Objects & Batch Sync
1. **phone-number-sync.ts**
   - Optimize `syncCalls()` pagination and batching
   - Optimize `syncMessages()` similarly
   - Canvas cache efficiency
   - Parallel processing of multiple calls

### Priority 2: Webhook & Queue Processing
2. **webhook-processor.ts**
   - Batch Notion API operations
   - Streaming R2 uploads
   - Concurrent recording downloads

3. **index.ts** (lines 96-140)
   - Queue consumer optimization
   - Error handling refinement

### Priority 3: Utilities & Clients
4. **notion-client.ts**
   - Canvas lookup batching
   - Persistent cache lookups (D1)
   - Parallel property processing

5. **openphone-client.ts**
   - Pagination improvements
   - Concurrent endpoint calls

6. **r2-client.ts**
   - Streaming upload implementation
   - Concurrent transfers

7. **rate-limiter.ts**
   - Burst handling for batch operations

### Priority 4: Scheduled Tasks & Analytics
8. **scheduled-tasks.ts**
   - Pagination optimization
   - Parallel phone number processing
   - Efficient backfill queries

9. **helpers.ts**
   - Batch cache operations
   - Improved deduplication

### Priority 5: Configuration & Schema
10. **wrangler.jsonc**
    - Cron frequency adjustment
    - Queue batch size tuning
    - Additional KV namespaces if needed

11. **migrations/0001_initial_schema.sql**
    - Additional indexes for batch queries
    - Partitioning strategy for large datasets
    - View optimization

---

## 11. PERFORMANCE CHARACTERISTICS & BOTTLENECKS

### Current Limitations
1. **Canvas Lookups**: Queries Notion for each new participant (no persistent cache)
2. **Sequential Processing**: One call at a time in webhook processor
3. **Recording Downloads**: Not parallelized within batch
4. **Rate Limiting**: Token bucket may not optimize for bursts
5. **Cron Frequency**: 6-hour backfill window may miss some data
6. **D1 Writes**: Async but not batched; each sync_history entry is individual INSERT

### Scaling Challenges
- OpenPhone API: 10 req/sec limit (enforced by rate limiter)
- Notion API: Undocumented but likely ~100 req/min per database
- R2: Likely high concurrency available
- D1: SQLite-based, potential write contention

### Optimization Opportunities
1. Persistent Canvas cache (D1 instead of memory-only)
2. Batch Notion API operations
3. Parallel recording downloads and R2 uploads
4. DO-based rate limiting aggregation across phone numbers
5. Efficient pagination for large datasets (10k+ calls)
6. Streaming R2 uploads for large files

---

## SUMMARY TABLE

| Component | File(s) | Purpose | Criticality |
|-----------|---------|---------|-------------|
| **Entry Point** | index.ts | Webhook receiver, queue handler, cron trigger | Critical |
| **Durable Objects** | phone-number-sync.ts | Per-phone coordination & caching | High |
| **Queue Consumer** | webhook-processor.ts | Enrich and sync webhook events | High |
| **Scheduled Tasks** | scheduled-tasks.ts | Periodic backfill & cleanup | Medium |
| **Notion Client** | notion-client.ts | Database operations & Canvas lookups | High |
| **OpenPhone Client** | openphone-client.ts | API wrapper with rate limiting | High |
| **R2 Client** | r2-client.ts | Recording/voicemail storage | Medium |
| **Rate Limiter** | rate-limiter.ts | Token bucket for API throttling | High |
| **Types & Helpers** | types/*, helpers.ts | Shared utilities | Medium |
| **Database Schema** | migrations/0001_initial_schema.sql | Analytics & cache | Medium |
| **Configuration** | wrangler.jsonc | Cloudflare resource bindings | Critical |

---

**Document Generated**: 2025-10-27
**Last Updated**: Based on recent git commits including Canvas lookup filtering

