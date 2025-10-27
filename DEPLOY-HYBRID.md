# Hybrid Architecture Deployment Guide

This guide explains how to deploy the **hybrid architecture** that uses:
- ✅ **Durable Objects** for real-time, per-phone-number sync coordination
- ✅ **D1 Database** for analytics, reporting, and sync history
- ✅ Existing KV, Queues, R2, and Analytics Engine

## Architecture Benefits

### Durable Objects (Real-Time State)
- **In-memory speed**: <1ms state access
- **Strong consistency**: No race conditions
- **Canvas caching**: Per-phone-number cached lookups
- **Event coordination**: Webhooks + scheduled sync work together
- **Auto-scaling**: Handles unlimited phone numbers

### D1 Database (Analytics & History)
- **SQL queries**: Complex reporting and analytics
- **Sync history**: Track every sync event
- **Performance metrics**: Monitor API call durations
- **Canvas cache stats**: See hit rates and popular lookups

## Prerequisites

- Cloudflare Workers account
- Wrangler CLI installed
- Existing secrets configured (API keys, database IDs)

## Step 1: Create D1 Database

```bash
# Create the D1 database
wrangler d1 create openphone-sync-db

# You'll get output like:
# [[d1_databases]]
# binding = "DB"
# database_name = "openphone-sync-db"
# database_id = "abc123..."

# Copy the database_id and update wrangler.jsonc
# Find the "d1_databases" section and paste the database_id
```

## Step 2: Run Database Migrations

```bash
# Apply the initial schema
wrangler d1 execute openphone-sync-db --file=./migrations/0001_initial_schema.sql

# Verify it worked
wrangler d1 execute openphone-sync-db --command="SELECT name FROM sqlite_master WHERE type='table'"
```

You should see:
- `phone_numbers`
- `sync_history`
- `canvas_cache`
- `performance_metrics`

## Step 3: Deploy Worker with Durable Objects

```bash
# Deploy the worker (this also deploys Durable Objects)
wrangler deploy

# The first deploy creates the Durable Object class
```

## Step 4: Verify Deployment

```bash
# Check worker status
wrangler deployments list

# Test health endpoint
curl https://openphone-notion-sync.jstanley82.workers.dev/health

# Check D1 database
wrangler d1 execute openphone-sync-db --command="SELECT COUNT(*) FROM phone_numbers"
```

## How It Works

### 1. Webhook Arrives
```
OpenPhone → Worker fetch() → Queue → Queue consumer → Durable Object
                                                     ↓
                                              Process Event
                                                     ↓
                                  Notion (create/update) + D1 (log history)
```

### 2. Scheduled Backfill (Every 6 Hours)
```
Cron trigger → Get all phone numbers → For each phone:
                                       ↓
                              Durable Object.syncCalls()
                                       ↓
                        Fetch only NEW calls since last sync
                                       ↓
                        Process + Log to D1
```

### 3. Canvas Lookup Caching
```
First lookup: Phone → Notion API query (slow) → Cache in DO + D1
                                               ↓
                                        Return canvas ID

Next lookup:  Phone → DO in-memory cache (fast) → Return canvas ID
                                                 ↓
                                     Update D1 hit counter
```

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      Cloudflare Workers                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐         ┌──────────────────────────────┐ │
│  │   Webhooks   │────────>│  Durable Object (per phone)  │ │
│  └──────────────┘         │  - In-memory state          │ │
│                            │  - Canvas cache             │ │
│  ┌──────────────┐         │  - Sync coordination        │ │
│  │  Cron (6hr)  │────────>│  - Incremental fetch        │ │
│  └──────────────┘         └───────────┬──────────────────┘ │
│                                        │                     │
│                            ┌───────────┴──────────────┐    │
│                            │                          │    │
│                            ▼                          ▼    │
│                   ┌─────────────────┐      ┌──────────────┐│
│                   │  Notion API     │      │  D1 Database ││
│                   │  - Create pages │      │  - History   ││
│                   │  - Update pages │      │  - Analytics ││
│                   │  - Canvas query │      │  - Cache     ││
│                   └─────────────────┘      └──────────────┘│
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## Querying Analytics

### Check sync stats for today
```bash
wrangler d1 execute openphone-sync-db --command="SELECT * FROM sync_stats_today"
```

### View Canvas cache performance
```bash
wrangler d1 execute openphone-sync-db --command="SELECT * FROM canvas_cache_stats"
```

### Get recent sync history
```bash
wrangler d1 execute openphone-sync-db --command="
SELECT
  phone_number_id,
  resource_type,
  sync_status,
  COUNT(*) as count,
  AVG(processing_time_ms) as avg_time_ms
FROM sync_history
WHERE synced_at > (strftime('%s', 'now') - 3600) * 1000
GROUP BY phone_number_id, resource_type, sync_status
"
```

### Find slow operations
```bash
wrangler d1 execute openphone-sync-db --command="
SELECT
  metric_type,
  operation,
  AVG(duration_ms) as avg_duration,
  MAX(duration_ms) as max_duration,
  COUNT(*) as count
FROM performance_metrics
WHERE timestamp > (strftime('%s', 'now') - 86400) * 1000
GROUP BY metric_type, operation
ORDER BY avg_duration DESC
"
```

## Cost Estimates

### Small Scale (1-5 phone numbers, ~100 events/day)
- **Durable Objects**: ~30K requests/month = **FREE** (under 1M limit)
- **D1 Database**: ~100K reads/month = **FREE** (under 5M limit)
- **Workers**: ~3K requests/month = **FREE**
- **Total**: **$0/month**

### Medium Scale (10-50 phone numbers, ~1000 events/day)
- **Durable Objects**: ~300K requests/month = **FREE**
- **D1 Database**: ~1M reads/month = **FREE**
- **Workers**: ~30K requests/month = **FREE**
- **Total**: **$0/month**

### Large Scale (100+ phone numbers, ~10K events/day)
- **Durable Objects**: ~3M requests/month = **$0.30** ($0.15 per million above 1M)
- **D1 Database**: ~10M reads/month = **$5.00** ($0.001 per 1K rows)
- **Workers**: ~300K requests/month = **FREE**
- **Total**: **~$5.30/month**

## Monitoring

### Worker Logs
```bash
# Real-time logs
wrangler tail --format pretty

# Filter for errors only
wrangler tail --format pretty --status error
```

### Durable Object State
```bash
# Get state of a specific phone number DO
curl https://openphone-notion-sync.jstanley82.workers.dev/phone/PNabc123/state
```

### D1 Query Tools
- **Wrangler CLI**: `wrangler d1 execute`
- **Dashboard**: https://dash.cloudflare.com → D1 → openphone-sync-db
- **SQL Browser**: Built-in query interface

## Troubleshooting

### "Durable Object class not found"
- Make sure you exported it: `export { PhoneNumberSync }` in index.ts
- Redeploy: `wrangler deploy`

### "D1 database not found"
- Check database_id in wrangler.jsonc matches created database
- Run: `wrangler d1 list` to see all databases

### Canvas lookups not caching
- Check DO state: `curl .../phone/PNxxx/state`
- Verify Canvas database ID is correct
- Check Notion API logs in D1

### High costs
- Check D1 query counts: Too many queries?
- Optimize: Reduce cron frequency (already at 6 hours)
- Consider: Adding more aggressive caching

## Rollback Plan

If you need to rollback to the previous architecture:

```bash
# Deploy previous version
git revert HEAD
wrangler deploy

# The D1 database and Durable Objects will remain but won't be used
# Your data is safe
```

## Next Steps

1. ✅ Monitor logs for first 24 hours
2. ✅ Query D1 to see sync history accumulating
3. ✅ Check Canvas cache hit rates
4. ✅ Verify webhook processing is faster
5. ✅ Review cost metrics after 1 week

## Support

- **Cloudflare Docs**: https://developers.cloudflare.com/
- **D1 Docs**: https://developers.cloudflare.com/d1/
- **Durable Objects Docs**: https://developers.cloudflare.com/durable-objects/
