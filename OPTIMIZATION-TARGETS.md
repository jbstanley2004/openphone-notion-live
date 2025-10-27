# OpenPhone-Notion Integration: Optimization Targets & Strategy

## Executive Summary

The OpenPhone-Notion integration is a Cloudflare Workers application that syncs real-time call and message data to Notion, with recordings stored in R2 and analytics in D1. The system handles webhooks, queued processing, scheduled backfill, and per-phone-number coordination via Durable Objects.

**Architecture Maturity**: Production-ready with clear optimization opportunities
**Codebase Size**: ~3,600 lines of application code
**Critical Path**: Durable Objects → Notion API → Canvas lookups

---

## Key Architecture Components

### 1. Request Processing Pipeline (3-tier)
```
Real-time:     OpenPhone Webhook → Queue → Batch Processing (10 at a time)
Scheduled:     Cron (6-hour) → Backfill recent calls/messages
Coordinated:   Per-phone Durable Objects with in-memory caching
```

### 2. Data Storage Layer
- **KV (sync state, rate limits, cache)**: 3 namespaces, 30-60 day TTL
- **R2 (recordings/voicemails)**: Organized by YYYY/MM/DD, 234-line client
- **D1 (analytics, history, cache)**: 4 tables, 2 views, SQLite-based
- **Notion (source of truth)**: 4 databases (Calls, Messages, Canvas, Mail)

### 3. API Integration Points
- **OpenPhone API**: Rate-limited to 10 req/sec (token bucket)
- **Notion API**: No explicit rate limiting (potential bottleneck)
- **R2 API**: Likely has generous concurrency limits

---

## Primary Optimization Targets

### CRITICAL: Canvas Lookup Performance (Notion bottleneck)

**Current Problem**:
- Every new call participant requires a Canvas lookup
- No persistent caching across sessions
- Multiple format attempts (XXX-XXX-XXXX, XXXXXXXXXX, +1XXXXXXXXXX)
- Both phone_number AND rich_text field attempts
- **Impact**: 1-2 second Notion query per unique participant

**Files to Modify**:
1. `src/utils/notion-client.ts` (lines 573-692 for phone, 697-738 for email)
2. `src/durable-objects/phone-number-sync.ts` (lines 100-140 for caching)

**Optimization Strategy**:
- [x] In-memory cache in Durable Object (already done)
- [ ] Persistent cache in D1 `canvas_cache` table
- [ ] Reduce format attempts (consolidate to 1-2 formats)
- [ ] Batch Canvas lookups where possible
- [ ] Add Notion rate limiting (if not already in place)

**Expected Impact**: 5-10x faster for repeated participants

---

### HIGH PRIORITY: Durable Object Batch Processing

**Current Problem**:
- Processes one call at a time sequentially
- Limited pagination (100 calls per request)
- No parallel processing of multiple calls
- D1 writes are individual INSERTs (not batched)

**Files to Modify**:
1. `src/durable-objects/phone-number-sync.ts` (lines 145-209 for syncCalls)
2. `src/durable-objects/phone-number-sync.ts` (lines 342-404 for D1 logging)

**Optimization Strategy**:
- [ ] Implement efficient pagination with continuation tokens
- [ ] Process multiple calls in parallel (Promise.all)
- [ ] Batch D1 sync_history inserts (bulk insert, 10-20 at a time)
- [ ] Cache Canvas results across call processing
- [ ] Implement backpressure for rate limiting

**Expected Impact**: 3-5x faster call sync, fewer D1 roundtrips

---

### HIGH PRIORITY: Webhook Queue Optimization

**Current Problem**:
- 10 messages per batch is reasonable but could be higher
- Recording downloads are sequential (not parallel)
- No concurrent R2 uploads
- Notion page updates are sequential

**Files to Modify**:
1. `src/processors/webhook-processor.ts` (lines 124-188)
2. `src/index.ts` (lines 96-140)
3. `src/utils/r2-client.ts` (streaming upload)

**Optimization Strategy**:
- [ ] Increase batch size from 10 to 20-50 (test for timeout)
- [ ] Parallel recording downloads within batch (3-4 concurrent)
- [ ] Streaming R2 uploads instead of buffering entire file
- [ ] Batch Notion page operations
- [ ] Implement circuit breaker for rate limit handling

**Expected Impact**: 2-3x faster webhook processing

---

### MEDIUM PRIORITY: Scheduled Backfill Performance

**Current Problem**:
- Processes one phone number at a time
- Pagination limited to 100 calls per request
- Max 10,000 calls per phone (100 pages * 100)
- Sequential call processing within phone number

**Files to Modify**:
1. `src/processors/scheduled-tasks.ts` (lines 43-201 for calls, 206-313 for messages)
2. `wrangler.jsonc` (cron frequency adjustment)

**Optimization Strategy**:
- [ ] Process multiple phone numbers in parallel
- [ ] Implement efficient pagination continuation
- [ ] Batch process calls for same phone number
- [ ] Add monitoring for backfill progress
- [ ] Consider reducing cron frequency (6 hours → 12 hours) if adequate

**Expected Impact**: 3-5x faster backfill completion

---

### MEDIUM PRIORITY: Notion API Batch Operations

**Current Problem**:
- Each page creation is individual API call
- Properties populated one-at-a-time
- No transaction grouping
- Canvas relation queried per call

**Files to Modify**:
1. `src/utils/notion-client.ts` (lines 81-241 for createCallPage)

**Optimization Strategy**:
- [ ] Implement batch creation if Notion API supports
- [ ] Cache property structures to avoid redundant object creation
- [ ] Pre-fetch Canvas relations before bulk operations
- [ ] Add explicit rate limiting for Notion API
- [ ] Consider query result caching

**Expected Impact**: 2-3x faster page creation for bulk operations

---

### LOWER PRIORITY: R2 Upload Optimization

**Current Problem**:
- Entire files buffered in memory
- Single sequential upload per call
- No presigned URL support (placeholder only)
- Stats gathering not optimized

**Files to Modify**:
1. `src/utils/r2-client.ts` (lines 52-127)

**Optimization Strategy**:
- [ ] Implement streaming upload for large files
- [ ] Add multipart upload for files >10MB
- [ ] Concurrent uploads per batch
- [ ] Implement presigned URL generation
- [ ] Compress audio before upload

**Expected Impact**: Better memory efficiency, faster uploads for large files

---

### LOWER PRIORITY: Rate Limiting Optimization

**Current Problem**:
- Token bucket is per-call (not globally coordinated)
- Exponential backoff might waste time
- Bursts not optimized

**Files to Modify**:
1. `src/utils/rate-limiter.ts` (lines 37-87)
2. `src/durable-objects/phone-number-sync.ts` (for DO coordination)

**Optimization Strategy**:
- [ ] Implement DO-based global rate limiting
- [ ] Dynamic burst handling (if under 10 req/sec, allow burst)
- [ ] Proactive rate limit detection
- [ ] Jitter in retry delays to avoid thundering herd

**Expected Impact**: Better throughput during normal operations

---

## Configuration Tuning Opportunities

### Queue Configuration (wrangler.jsonc)
```jsonc
// Current
"max_batch_size": 10,           // Could increase to 20-50
"max_batch_timeout": 30,        // Reasonable
"max_retries": 3,               // Reasonable

// Recommended
"max_batch_size": 25,           // Test 20-50 based on Notion rate limits
"max_batch_timeout": 30,        // Keep as-is
```

### Cron Schedule (wrangler.jsonc)
```jsonc
// Current
"crons": ["0 */6 * * *"]        // Every 6 hours

// Consider
"crons": ["0 */4 * * *"]        // Every 4 hours for faster backfill
```

### Database Schema Optimization
```sql
-- Missing indexes that would help batch queries
CREATE INDEX idx_canvas_cache_hit_rate ON canvas_cache(hit_count DESC);
CREATE INDEX idx_sync_history_status ON sync_history(sync_status, synced_at DESC);

-- Consider partitioning large tables by month
-- ALTER TABLE sync_history PARTITION BY RANGE (synced_at)
```

---

## Performance Baseline Metrics to Track

### Before Optimization
- [ ] Average webhook processing time per call
- [ ] Average Canvas lookup time (first vs cached)
- [ ] D1 write latency
- [ ] Notion API response time
- [ ] Queue processing throughput (calls/sec)
- [ ] Cron backfill completion time

### After Optimization
- Compare above metrics to measure improvement
- Target: 50-70% reduction in processing time

---

## Implementation Roadmap

### Phase 1: Quick Wins (2-3 days)
1. Add D1 persistent Canvas cache lookup
2. Consolidate Canvas lookup formats
3. Add Notion API rate limiting
4. Increase queue batch size and test

### Phase 2: Core Optimization (1 week)
1. Implement batch D1 writes in Durable Object
2. Parallel recording downloads in webhook processor
3. Streaming R2 uploads
4. Batch Notion page operations

### Phase 3: Advanced Optimization (2 weeks)
1. Global rate limiting via Durable Objects
2. Parallel phone number processing in backfill
3. Query result caching in Notion client
4. Performance monitoring and dashboards

### Phase 4: Fine-tuning (ongoing)
1. A/B test batch sizes
2. Profile and optimize hot paths
3. Add distributed tracing
4. Implement adaptive rate limiting

---

## Risk Assessment & Mitigation

### Risk: Breaking Changes in Notion API
- **Mitigation**: Comprehensive logging, gradual rollout, fallback paths

### Risk: Rate Limit Hitting Ceiling
- **Mitigation**: Implement proper rate limiting from start, monitor closely

### Risk: Data Loss During Parallel Processing
- **Mitigation**: Comprehensive error handling, idempotent operations, audit trail in D1

### Risk: Memory Overflow in Workers
- **Mitigation**: Streaming implementations, batch size limits, memory monitoring

---

## Success Criteria

1. **Performance**: 50%+ reduction in average processing time
2. **Reliability**: 99%+ success rate maintained or improved
3. **Scalability**: Handle 10x current call volume without rate limit issues
4. **Maintainability**: Code remains clean and testable
5. **Observability**: Detailed logging and monitoring in place

---

## Implementation Notes

### Key Files Reference
- **Notion Client**: 822 lines - LARGEST, focus on Canvas lookups (lines 573-738)
- **Durable Object**: 465 lines - Pagination and batching (lines 145-209)
- **Webhook Processor**: 349 lines - Download/upload parallelization
- **Scheduled Tasks**: 454 lines - Parallel processing opportunities

### Estimated Impact by Change
| Change | Expected Speedup | Effort | Priority |
|--------|------------------|--------|----------|
| D1 Canvas Cache | 3-5x | Medium | High |
| Batch D1 Writes | 2-3x | Medium | High |
| Parallel Downloads | 3-4x | Medium | High |
| Batch Notion Ops | 2-3x | Medium | High |
| Streaming R2 | 1.5-2x | Low | Medium |
| DO Rate Limiting | 1.5x | High | Low |

---

## Monitoring & Validation

### Key Metrics to Monitor
```
- Canvas lookup cache hit ratio (target: 70%+)
- Average processing time per call (target: <1s)
- Queue processing throughput (target: 50+ calls/sec)
- Notion API response time (target: <500ms p95)
- D1 write latency (target: <50ms p95)
- R2 upload speed (target: >1MB/sec)
```

### Alerting Thresholds
- Canvas lookup failures: >5% of calls
- Queue processing failures: >1%
- Average processing time: >2 seconds
- Notion API errors: >1%
- D1 timeouts: >0.5%

---

## Rollback Strategy

Each optimization should be:
1. Tested in preview environment
2. Deployed behind feature flag if possible
3. Monitored for 24 hours before full rollout
4. Easy to revert with single deployment

---

**Document Generated**: 2025-10-27
**Status**: Ready for implementation planning
**Review Date**: 2025-11-03

