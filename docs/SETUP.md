# Complete Setup Guide

This guide walks you through setting up the OpenPhone to Notion sync from scratch.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Step 1: Notion Setup](#step-1-notion-setup)
3. [Step 2: OpenPhone Setup](#step-2-openphone-setup)
4. [Step 3: Cloudflare Setup](#step-3-cloudflare-setup)
5. [Step 4: Deploy Worker](#step-4-deploy-worker)
6. [Step 5: Configure Webhooks](#step-5-configure-webhooks)
7. [Step 6: Verify Installation](#step-6-verify-installation)

---

## Prerequisites

### Required Accounts

- [ ] **Notion** account with a workspace
- [ ] **OpenPhone** account with API access (Business or Scale plan)
- [ ] **Cloudflare** account
- [ ] **Git** installed locally
- [ ] **Node.js** 18+ installed

### Required Access Levels

- [ ] Notion: Admin access to create integrations
- [ ] OpenPhone: Owner or Admin role
- [ ] Cloudflare: Ability to create Workers and R2 buckets

### Cost Considerations

- Cloudflare: ~$10-30/month
- Notion: Free for integrations
- OpenPhone: Check your plan's API limits

---

## Step 1: Notion Setup

### 1.1 Create Notion Integration

1. Go to https://www.notion.so/my-integrations
2. Click "+ New integration"
3. Fill in details:
   - **Name**: OpenPhone Sync
   - **Logo**: (optional)
   - **Associated workspace**: Select your workspace
4. Click "Submit"
5. **Copy the Internal Integration Token** (starts with `secret_`)
6. Save this token securely - you'll need it later

### 1.2 Create Calls Database

1. Open your Notion workspace
2. Create a new page called "OpenPhone Calls"
3. Type `/database` and select "Table - Full page"
4. Add properties one by one (click "+ Add property"):

**Required Properties:**

| Name | Type | Config |
|------|------|--------|
| Call ID | Title | (default) |
| Direction | Select | Options: incoming, outgoing |
| Status | Select | Options: completed, missed, in-progress, etc. |
| Duration | Number | Format: Number |
| Participants | Text | (default) |
| OpenPhone User | Text | (default) |
| Phone Number Used | Text | (default) |
| Phone Number ID | Text | (default) |
| Created At | Date | Include time: Yes |
| Answered At | Date | Include time: Yes |
| Completed At | Date | Include time: Yes |
| Has Recording | Checkbox | (default) |
| Recording URL | URL | (default) |
| Recording Duration | Number | Format: Number |
| Has Transcript | Checkbox | (default) |
| Transcript | Text | (default) |
| Transcript Status | Select | Options: absent, in-progress, completed, failed |
| Has Summary | Checkbox | (default) |
| Summary | Text | (default) |
| Next Steps | Text | (default) |
| Has Voicemail | Checkbox | (default) |
| Voicemail URL | URL | (default) |
| Voicemail Transcript | Text | (default) |
| Call Route | Text | (default) |
| Forwarded From | Text | (default) |
| Forwarded To | Text | (default) |
| Raw Data | Text | (default) |
| Synced At | Date | Include time: Yes |
| Last Updated | Date | Include time: Yes |

### 1.3 Create Messages Database

1. Create another new page called "OpenPhone Messages"
2. Type `/database` and select "Table - Full page"
3. Add these properties:

| Name | Type | Config |
|------|------|--------|
| Message ID | Title | (default) |
| Direction | Select | Options: incoming, outgoing |
| From | Phone number | (default) |
| To | Phone number | (default) |
| Content | Text | (default) |
| Status | Select | Options: queued, sent, delivered, undelivered |
| OpenPhone Number | Text | (default) |
| Phone Number ID | Text | (default) |
| User ID | Text | (default) |
| Created At | Date | Include time: Yes |
| Updated At | Date | Include time: Yes |
| Has Media | Checkbox | (default) |
| Media URLs | Text | (default) |
| Conversation ID | Text | (default) |
| Raw Data | Text | (default) |
| Synced At | Date | Include time: Yes |

### 1.4 Share Databases with Integration

1. Open each database (Calls and Messages)
2. Click the "..." menu in top right
3. Select "Add connections"
4. Find your "OpenPhone Sync" integration
5. Click "Connect"

### 1.5 Get Database IDs

For **each database**:

1. Open the database in full page mode
2. Copy the URL from your browser
3. Extract the database ID:
   ```
   https://www.notion.so/myworkspace/abcd1234efgh5678ijkl?v=...
                                     ^^^^^^^^^^^^^^^^^^^^^^^^
                                     This is your database ID
   ```
4. Save both IDs:
   - Calls Database ID: `________`
   - Messages Database ID: `________`

---

## Step 2: OpenPhone Setup

### 2.1 Generate API Key

1. Log in to OpenPhone at https://app.openphone.com
2. Click your workspace name → Settings
3. Navigate to **API** tab (requires Owner/Admin role)
4. Click "Generate API key"
5. Give it a label: "Notion Sync"
6. **Copy the API key** (starts with `sk_` or similar)
7. Save this key securely - you cannot retrieve it later

### 2.2 Verify API Access

Test your API key:

```bash
curl -H "Authorization: YOUR_API_KEY" \
     https://api.openphone.com/v1/phone-numbers
```

You should get a JSON response with your phone numbers.

### 2.3 Note Your Phone Numbers

Make note of which OpenPhone numbers you want to sync. The integration will sync ALL numbers by default.

---

## Step 3: Cloudflare Setup

### 3.1 Install Wrangler CLI

```bash
npm install -g wrangler

# Login to Cloudflare
wrangler login
```

### 3.2 Clone and Install Project

```bash
git clone <your-repo-url>
cd openphone-notion-sync
npm install
```

### 3.3 Create KV Namespaces

Run these commands and **save the IDs** output:

```bash
# SYNC_STATE
wrangler kv:namespace create "SYNC_STATE"
wrangler kv:namespace create "SYNC_STATE" --preview

# RATE_LIMITS
wrangler kv:namespace create "RATE_LIMITS"
wrangler kv:namespace create "RATE_LIMITS" --preview

# CACHE
wrangler kv:namespace create "CACHE"
wrangler kv:namespace create "CACHE" --preview
```

Example output:
```
{ binding = "SYNC_STATE", id = "abc123...", preview_id = "xyz789..." }
```

### 3.4 Update wrangler.jsonc

Edit `wrangler.jsonc` and replace the placeholder IDs:

```jsonc
{
  "kv_namespaces": [
    {
      "binding": "SYNC_STATE",
      "id": "your_actual_id_here",
      "preview_id": "your_actual_preview_id_here"
    },
    {
      "binding": "RATE_LIMITS",
      "id": "your_actual_id_here",
      "preview_id": "your_actual_preview_id_here"
    },
    {
      "binding": "CACHE",
      "id": "your_actual_id_here",
      "preview_id": "your_actual_preview_id_here"
    }
  ]
}
```

### 3.5 Create R2 Buckets

```bash
# Production bucket
wrangler r2 bucket create openphone-recordings

# Development bucket
wrangler r2 bucket create openphone-recordings-dev
```

### 3.6 Configure Secrets

Create local `.dev.vars` file:

```bash
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars`:

```ini
OPENPHONE_API_KEY=sk_your_openphone_key_here
NOTION_API_KEY=secret_your_notion_key_here
NOTION_CALLS_DATABASE_ID=your_calls_database_id_here
NOTION_MESSAGES_DATABASE_ID=your_messages_database_id_here
```

Set production secrets:

```bash
wrangler secret put OPENPHONE_API_KEY
# Paste your key when prompted

wrangler secret put NOTION_API_KEY
# Paste your key when prompted

wrangler secret put NOTION_CALLS_DATABASE_ID
# Paste your database ID when prompted

wrangler secret put NOTION_MESSAGES_DATABASE_ID
# Paste your database ID when prompted
```

---

## Step 4: Deploy Worker

### 4.1 Test Locally (Optional)

```bash
npm run dev
```

Visit http://localhost:8787/health - should return:
```json
{"status": "healthy", "timestamp": "..."}
```

### 4.2 Deploy to Production

```bash
npm run deploy
```

Expected output:
```
Total Upload: ... KiB
Uploaded openphone-notion-sync (1.23 sec)
Published openphone-notion-sync (0.45 sec)
  https://openphone-notion-sync.your-subdomain.workers.dev
```

**Save your Worker URL!**

### 4.3 Verify Deployment

```bash
# Check health endpoint
curl https://your-worker-url.workers.dev/health

# View logs
npm run tail
```

---

## Step 5: Configure Webhooks

### 5.1 Create Webhook in OpenPhone

1. Go to OpenPhone Settings → API → Webhooks
2. Click "Create Webhook"
3. Configure:
   - **URL**: `https://your-worker-url.workers.dev/webhooks/openphone`
   - **Events**: Select ALL:
     - ☑️ call.ringing
     - ☑️ call.completed
     - ☑️ call.recording.completed
     - ☑️ call.transcript.completed
     - ☑️ call.summary.completed
     - ☑️ message.received
     - ☑️ message.delivered
4. Click "Create"
5. **Test the webhook** using OpenPhone's test button

### 5.2 Verify Webhook

OpenPhone should show "Webhook test successful" or similar.

Check your Worker logs:
```bash
npm run tail
```

You should see:
```json
{
  "level": "info",
  "message": "Received webhook",
  "eventId": "EV...",
  "eventType": "..."
}
```

---

## Step 6: Verify Installation

### 6.1 Make a Test Call

1. Make a test call using OpenPhone
2. Wait for it to complete
3. Check Worker logs:
   ```bash
   npm run tail
   ```
4. Look for:
   - "Received webhook"
   - "Processing webhook event"
   - "Call page created in Notion"

### 6.2 Check Notion Database

1. Open your Calls database in Notion
2. You should see a new entry with:
   - Call ID
   - Duration
   - Timestamps
   - Participant phone numbers

### 6.3 Send a Test Message

1. Send a test SMS via OpenPhone
2. Check Messages database in Notion
3. Verify message content appears

### 6.4 Verify Recordings (if available)

If your test call had a recording:

1. Check R2 bucket:
   ```bash
   wrangler r2 object list openphone-recordings --prefix recordings/
   ```
2. Verify Recording URL in Notion is populated
3. Try accessing the URL (may need R2 public access configured)

### 6.5 Check Analytics

View in Cloudflare Dashboard:
1. Workers & Pages → openphone-notion-sync
2. Click "Metrics" tab
3. Verify requests are being processed

---

## Troubleshooting

### Webhook Not Working

**Symptoms**: No logs, no Notion pages created

**Solutions**:
1. Verify Worker URL is correct in OpenPhone
2. Check Worker is deployed: `curl https://your-url/health`
3. Test webhook manually:
   ```bash
   curl -X POST https://your-url/webhooks/openphone \
        -H "Content-Type: application/json" \
        -d '{"id":"TEST","type":"call.completed","createdAt":"2024-01-01T00:00:00Z","data":{"object":{}}}'
   ```
4. Check Worker logs for errors

### Notion Pages Not Creating

**Symptoms**: Webhook received but no Notion pages

**Solutions**:
1. Verify Notion API key: Test with:
   ```bash
   curl -X POST https://api.notion.com/v1/databases/YOUR_DB_ID/query \
        -H "Authorization: Bearer YOUR_NOTION_KEY" \
        -H "Notion-Version: 2022-06-28"
   ```
2. Verify database IDs are correct
3. Ensure databases are shared with integration
4. Check Worker logs for Notion API errors

### Rate Limit Errors

**Symptoms**: "Rate limit exceeded" in logs

**Solutions**:
1. System should auto-retry with backoff
2. If persistent, reduce cron frequency
3. Contact OpenPhone for rate limit increase

### Missing Historical Data

**Symptoms**: Old calls/messages not in Notion

**Solutions**:
1. Manually trigger backfill:
   ```bash
   wrangler triggers schedule openphone-notion-sync
   ```
2. Adjust backfill window in `src/processors/scheduled-tasks.ts`
3. Run multiple times for older data

---

## Next Steps

✅ **Installation Complete!**

Now you can:

1. **Customize**: Edit views, add tags, create templates
2. **Monitor**: Set up alerts in Cloudflare dashboard
3. **Optimize**: Adjust cron schedule, rate limits
4. **Extend**: Add custom AI processing, additional fields

---

## Getting Help

- **Documentation**: See `/docs` folder
- **Issues**: [GitHub Issues](link)
- **Logs**: `npm run tail` for real-time debugging

---

## Maintenance

### Monthly Tasks

- Review storage usage in R2
- Check error rates in Workers analytics
- Verify all data is syncing properly
- Rotate API keys (every 90 days recommended)

### Updates

```bash
git pull
npm install
npm run deploy
```

---

## Checklist

- [ ] Notion integration created
- [ ] Calls database created with all properties
- [ ] Messages database created with all properties
- [ ] Databases shared with integration
- [ ] Database IDs copied
- [ ] OpenPhone API key generated
- [ ] Cloudflare account set up
- [ ] KV namespaces created
- [ ] R2 buckets created
- [ ] Secrets configured (local and production)
- [ ] Worker deployed
- [ ] Webhook configured in OpenPhone
- [ ] Test call completed successfully
- [ ] Test message sent successfully
- [ ] Notion pages created correctly
- [ ] Recordings stored in R2
