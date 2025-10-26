# OpenPhone to Notion Sync

A robust, headless integration that automatically syncs all OpenPhone call and message data to Notion databases, hosted on Cloudflare Workers.

## Features

- **Real-time Webhook Processing**: Captures OpenPhone events as they happen
- **Complete Data Capture**:
  - Call records with metadata
  - Call recordings (stored in R2)
  - Call transcripts with speaker identification
  - AI-generated call summaries and action items
  - Voicemails with transcriptions
  - SMS/text messages with full content
- **Automatic Storage**: Recordings and voicemails stored in Cloudflare R2
- **Reliable Processing**: Queue-based system with automatic retries
- **Rate Limiting**: Respects OpenPhone API limits (10 req/sec)
- **Historical Backfill**: Scheduled jobs to catch missed data
- **Deduplication**: Prevents duplicate entries
- **Monitoring**: Built-in analytics and logging

## Architecture

```
OpenPhone Webhooks
        ↓
Cloudflare Worker (Webhook Receiver)
        ↓
Cloudflare Queue
        ↓
Data Enrichment Worker
        ↓
Cloudflare R2 (Recordings) + Notion API
```

## Prerequisites

1. **OpenPhone Account**
   - Active subscription with API access
   - Admin or Owner role
   - API key generated from dashboard

2. **Notion Account**
   - Notion workspace
   - Integration created with permissions
   - Two databases created (Calls and Messages)

3. **Cloudflare Account**
   - Workers paid plan ($5/month minimum)
   - R2 enabled (for recordings)

## Setup Instructions

### 1. Clone and Install

```bash
git clone <your-repo>
cd openphone-notion-sync
npm install
```

### 2. Configure Cloudflare Resources

#### Create KV Namespaces

```bash
# Create production KV namespaces
wrangler kv:namespace create "SYNC_STATE"
wrangler kv:namespace create "RATE_LIMITS"
wrangler kv:namespace create "CACHE"

# Create preview KV namespaces
wrangler kv:namespace create "SYNC_STATE" --preview
wrangler kv:namespace create "RATE_LIMITS" --preview
wrangler kv:namespace create "CACHE" --preview
```

Copy the IDs output by these commands and update `wrangler.jsonc`:

```jsonc
"kv_namespaces": [
  {
    "binding": "SYNC_STATE",
    "id": "your_sync_state_id_here",
    "preview_id": "your_sync_state_preview_id_here"
  },
  // ... repeat for other namespaces
]
```

#### Create R2 Bucket

```bash
# Create production bucket
wrangler r2 bucket create openphone-recordings

# Create preview bucket
wrangler r2 bucket create openphone-recordings-dev
```

#### Create Queue

```bash
# Queues are created automatically on first deploy
# Or create manually:
wrangler queues create openphone-webhook-events
wrangler queues create openphone-webhook-events-dlq
```

### 3. Set Up Notion Databases

Follow the detailed instructions in [docs/notion-database-schema.md](./docs/notion-database-schema.md) to:

1. Create two Notion databases (Calls and Messages)
2. Add all required properties
3. Share databases with your Notion integration
4. Copy the database IDs

### 4. Configure Secrets

Create a `.dev.vars` file (for local development):

```bash
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` and fill in your values:

```ini
OPENPHONE_API_KEY=your_openphone_api_key
NOTION_API_KEY=your_notion_integration_token
NOTION_CALLS_DATABASE_ID=your_calls_database_id
NOTION_MESSAGES_DATABASE_ID=your_messages_database_id
WEBHOOK_SECRET=optional_webhook_signature_secret
ALERT_WEBHOOK_URL=optional_slack_webhook_url
```

Set production secrets:

```bash
wrangler secret put OPENPHONE_API_KEY
wrangler secret put NOTION_API_KEY
wrangler secret put NOTION_CALLS_DATABASE_ID
wrangler secret put NOTION_MESSAGES_DATABASE_ID
# Optional:
wrangler secret put WEBHOOK_SECRET
wrangler secret put ALERT_WEBHOOK_URL
```

### 5. Deploy to Cloudflare

```bash
# Deploy to production
npm run deploy

# Or deploy to dev for testing
npm run dev
```

After deployment, note the Worker URL (e.g., `https://openphone-notion-sync.your-subdomain.workers.dev`)

### 6. Configure OpenPhone Webhooks

1. Log in to OpenPhone dashboard
2. Navigate to Settings → API → Webhooks
3. Click "Create Webhook"
4. Enter your Worker URL + webhook path:
   ```
   https://your-worker-url.workers.dev/webhooks/openphone
   ```
5. Select all event types:
   - call.ringing
   - call.completed
   - call.recording.completed
   - call.transcript.completed
   - call.summary.completed
   - message.received
   - message.delivered
6. Save the webhook

### 7. Test the Integration

#### Test Webhook Reception

Make a test call or send a test message through OpenPhone. You should see:

1. New page created in Notion Calls/Messages database
2. Logs in Cloudflare Workers dashboard
3. Recordings uploaded to R2 (if applicable)

#### View Logs

```bash
# Tail live logs
npm run tail

# Or view in Cloudflare dashboard:
# Workers & Pages → Your Worker → Logs
```

#### Health Check

```bash
curl https://your-worker-url.workers.dev/health
```

Should return:
```json
{
  "status": "healthy",
  "timestamp": "2025-01-..."
}
```

## Usage

Once deployed, the system runs automatically:

### Real-time Sync

- **Incoming calls/messages**: Synced immediately via webhooks
- **Call recordings**: Downloaded and stored in R2 when available
- **Transcripts**: Added to Notion page when processing completes
- **Summaries**: Updated in Notion when AI analysis finishes

### Scheduled Tasks

Every 15 minutes, the worker:

1. **Backfills recent data** (last 24 hours) to catch any missed webhooks
2. **Updates pending transcripts/summaries** for recent calls
3. **Cleans up old cache entries**
4. **Logs storage statistics**

### Manual Operations

#### Trigger Manual Backfill

You can manually trigger a backfill by invoking the scheduled handler:

```bash
wrangler triggers schedule openphone-notion-sync
```

#### Check Sync Status

Sync status is stored in the `SYNC_STATE` KV namespace:

```bash
# Get sync state for a specific resource
wrangler kv:key get --namespace-id=<your_namespace_id> "sync:AC123..."
```

#### View Failed Syncs

Check Worker logs for errors:

```bash
wrangler tail --format=json | grep "error"
```

## Configuration

### Environment Variables

Edit `wrangler.jsonc` to customize:

```jsonc
{
  "vars": {
    "OPENPHONE_API_BASE": "https://api.openphone.com/v1",
    "LOG_LEVEL": "info",  // debug, info, warn, error
    "WEBHOOK_PATH": "/webhooks/openphone"
  }
}
```

### Cron Schedule

Modify the cron trigger in `wrangler.jsonc`:

```jsonc
{
  "triggers": {
    "crons": [
      "*/15 * * * *"  // Every 15 minutes
    ]
  }
}
```

### Rate Limits

The system automatically handles OpenPhone's 10 req/sec limit. To adjust:

Edit `src/utils/rate-limiter.ts`:

```typescript
this.maxTokens = 10; // Max requests per second
this.refillRate = 10; // Tokens added per second
```

## Monitoring

### Cloudflare Workers Analytics

View metrics in Cloudflare dashboard:
- Request count
- Error rate
- Execution time
- Success rate

### Custom Analytics

The worker tracks:
- Webhook events received
- Processing success/failure
- Event types
- Resource IDs

Query analytics:

```bash
curl "https://api.cloudflare.com/client/v4/accounts/{account_id}/analytics_engine/sql" \
  --header "Authorization: Bearer <API_TOKEN>" \
  --data "SELECT * FROM openphone_sync_events LIMIT 100"
```

### Logging

Structured JSON logs are output for all operations. View in:

1. **Real-time**: `npm run tail`
2. **Cloudflare Dashboard**: Workers → Logs
3. **Log retention**: 24 hours (free), longer with Workers Paid

### Alerts

Configure alerts in Cloudflare dashboard:
- Worker error rate threshold
- Request rate anomalies
- Queue depth alerts

Or use the optional `ALERT_WEBHOOK_URL` for Slack/Discord notifications.

## Troubleshooting

### Webhooks Not Receiving

1. **Check webhook configuration** in OpenPhone dashboard
2. **Verify URL** is correct and accessible
3. **Check Worker logs** for incoming requests
4. **Test webhook** manually:

```bash
curl -X POST https://your-worker-url.workers.dev/webhooks/openphone \
  -H "Content-Type: application/json" \
  -d '{"id":"TEST","type":"call.completed","data":{"object":{}}}'
```

### Notion Pages Not Creating

1. **Verify Notion API key** is correct
2. **Check database IDs** are correct
3. **Ensure databases are shared** with integration
4. **Check logs** for Notion API errors
5. **Verify database schema** matches expected properties

### Recordings Not Uploading

1. **Check R2 bucket** exists and is accessible
2. **Verify R2 bindings** in wrangler.jsonc
3. **Check recording URLs** from OpenPhone are valid
4. **View R2 bucket contents**:

```bash
wrangler r2 object list openphone-recordings --prefix recordings/
```

### Rate Limit Errors

1. **Check rate limiter** is working (logs show "token acquired")
2. **Adjust backoff strategy** if needed
3. **Reduce concurrent processing** in queue handler
4. **Contact OpenPhone** for rate limit increase

### Queue Backlog

If queue builds up:

1. **Check Worker execution time** (timeout issues?)
2. **View queue metrics** in Cloudflare dashboard
3. **Manually process DLQ** if needed
4. **Scale up Worker resources** (increase limits)

### Missing Historical Data

Run manual backfill:

```bash
# Trigger scheduled task
wrangler triggers schedule openphone-notion-sync

# Or modify the backfill date range in:
# src/processors/scheduled-tasks.ts
```

## Development

### Local Development

```bash
# Run locally with preview bindings
npm run dev

# Runs on http://localhost:8787
```

### Type Checking

```bash
npm run typecheck
```

### Testing Webhooks Locally

Use a tool like ngrok to expose your local dev server:

```bash
ngrok http 8787

# Copy the ngrok URL and use it in OpenPhone webhook config
```

## Cost Estimates

### Cloudflare

**Workers:**
- Free tier: 100,000 requests/day
- Paid: $5/mo + $0.50/million requests
- **Estimate**: $5-15/month

**R2 Storage:**
- Storage: $0.015/GB/month
- Operations: Minimal cost
- **Estimate**: $1-10/month (depends on call volume)

**KV:**
- Free: 100k reads/day, 1k writes/day
- **Estimate**: $0-5/month

**Queues:**
- Included in Workers paid plan
- **Estimate**: $0/month

**Total**: ~$10-30/month depending on usage

### OpenPhone

Check your plan for API limits and costs.

### Notion

Notion API is free for integrations.

## Security Best Practices

1. **Never commit secrets** - Use `.gitignore` for `.dev.vars`
2. **Rotate API keys** regularly
3. **Use webhook signatures** if OpenPhone provides them
4. **Limit Worker access** - Use least privilege for bindings
5. **Monitor for anomalies** - Set up alerts
6. **Regular backups** - Export Notion databases periodically
7. **Audit logs** - Review Worker logs for suspicious activity

## Advanced Features

### Custom Domain

Add a custom domain in `wrangler.jsonc`:

```jsonc
{
  "routes": [
    {
      "pattern": "openphone.yourdomain.com/*",
      "custom_domain": true
    }
  ]
}
```

### AI Enhancements

Use Cloudflare AI Workers to add:
- Sentiment analysis
- Entity extraction
- Custom categorization

See `src/utils/ai-enhancements.ts` (create as needed)

### Multi-Workspace Support

Modify the code to support multiple OpenPhone/Notion workspaces by routing based on webhook source.

## License

MIT

## Support

- **Issues**: [GitHub Issues](https://github.com/your-repo/issues)
- **Docs**: See `/docs` folder
- **OpenPhone API**: https://openphone.com/docs
- **Notion API**: https://developers.notion.com
- **Cloudflare Workers**: https://developers.cloudflare.com/workers

## Credits

Built with:
- [Cloudflare Workers](https://workers.cloudflare.com)
- [Notion SDK](https://github.com/makenotion/notion-sdk-js)
- [OpenPhone API](https://openphone.com/api)
