# Deployment Guide: Canvas Database Relationships

This guide will help you deploy the OpenPhone-Notion sync worker with Canvas database relationships properly configured.

## Prerequisites

1. Cloudflare account with Workers enabled
2. Notion integration with access to Canvas, Calls, and Messages databases  
3. OpenPhone API key
4. Cloudflare API token (for deployment)

## Step 1: Set Required Secrets

The Canvas database ID and other Notion database IDs must be set as Cloudflare secrets. Run these commands:

```bash
# Set Canvas database ID (REQUIRED)
echo "data-source-95" | npx wrangler secret put NOTION_CANVAS_DATABASE_ID

# Set other required Notion database IDs
npx wrangler secret put NOTION_CALLS_DATABASE_ID
# When prompted, enter: your-calls-database-id

npx wrangler secret put NOTION_MESSAGES_DATABASE_ID
# When prompted, enter: your-messages-database-id

# Set API keys
npx wrangler secret put NOTION_API_KEY
# When prompted, paste your Notion integration token

npx wrangler secret put OPENPHONE_API_KEY
# When prompted, paste your OpenPhone API key
```

## Step 2: Verify Notion Database Setup

Make sure your Notion databases have the Canvas relation property:

### In Calls Database (data-source-29):
1. Open the database in Notion
2. Add a new property called `Canvas`
3. Type: **Relation**
4. Link to: Canvas database (data-source-95)

### In Messages Database (data-source-120):
1. Open the database in Notion
2. Add a new property called `Canvas`  
3. Type: **Relation**
4. Link to: Canvas database (data-source-95)

### In Canvas Database (data-source-95):
Ensure it has:
- `Phone` property (Rich Text or Phone Number type)
- `Email` property (Email type)

## Step 3: Deploy

Once all secrets are set:

```bash
npm run deploy
```

## Step 4: Verify Deployment

Test the worker:

```bash
# Check health endpoint
curl https://your-worker-url.workers.dev/health

# View logs
npm run tail
```

## Step 5: Test Canvas Relationships

1. Make a test call or send a message to a phone number that exists in your Canvas database
2. Check the Calls/Messages database in Notion
3. The `Canvas` relation should be automatically populated

## Troubleshooting

### Error: "NOTION_CANVAS_DATABASE_ID is missing or empty"

The Canvas database ID secret wasn't set properly. Run:
```bash
echo "data-source-95" | npx wrangler secret put NOTION_CANVAS_DATABASE_ID
```

### Canvas relations not working

1. Verify the Canvas database ID in Notion matches `data-source-95`
2. Check that the Phone property exists in Canvas database
3. Ensure phone numbers are stored in the correct format
4. Check worker logs: `npm run tail`

### Deployment authentication errors

Make sure you're logged in to Cloudflare:
```bash
npx wrangler login
```

## Database IDs Reference

- **Canvas**: `data-source-95`
- **OpenPhone Calls**: `data-source-29`
- **OpenPhone Messages**: `data-source-120`
- **Your OpenPhone Number**: `+13365185544`

## How It Works

- **Calls**: System finds the "other participant" (not your OpenPhone number) and searches Canvas by phone
- **Messages**: For incoming, uses the "from" number; for outgoing, uses the "to" number
- **Phone matching**: Numbers are normalized (removes +1, spaces, special chars)
- **No match**: If no Canvas record found, creates empty relation (no errors)

## Quick Setup Script

For convenience, use the provided script:

```bash
./setup-secrets.sh
```

This will prompt you to set all required secrets interactively.
