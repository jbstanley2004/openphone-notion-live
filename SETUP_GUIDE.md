# Setup Guide for OpenPhone-Notion Sync Optimizations

This guide will help you enable all the optimization features in your deployment.

---

## Quick Start

The worker will deploy successfully with basic features enabled. Advanced features (Vectorize, Workflows) need to be enabled separately.

### Currently Enabled
- ✅ Workers AI (sentiment analysis, summarization, action items)
- ✅ Smart Caching with Cache API
- ✅ Enhanced Observability
- ✅ Real-time Dashboard
- ✅ Durable Objects
- ✅ D1 Database
- ✅ R2 Storage
- ✅ KV Namespaces
- ✅ Queues

### Optional Features (Enable When Ready)
- 🔧 Vectorize (semantic search)
- 🔧 Workflows (beta feature)

---

## Step 1: Initial Deployment

Deploy the worker with current configuration:

```bash
npx wrangler deploy
```

This will deploy with:
- Workers AI for intelligent call analysis
- Smart caching for faster Canvas lookups
- Real-time dashboard at your worker URL
- All existing features (Durable Objects, D1, R2, KV, Queues)

---

## Step 2: Enable Vectorize (Optional)

Vectorize enables semantic search like "Find all calls about pricing".

### Prerequisites
- Wrangler 3.x or higher
- Cloudflare account with Vectorize access

### Setup Steps

1. **Create Vectorize Index**
   ```bash
   npx wrangler vectorize create openphone-calls --dimensions=768 --metric=cosine
   ```

2. **Update wrangler.jsonc**

   Uncomment the vectorize configuration:
   ```jsonc
   // Change from:
   // "vectorize": [
   //   {
   //     "binding": "CALL_VECTORS",
   //     "index_name": "openphone-calls"
   //   }
   // ],

   // To:
   "vectorize": [
     {
       "binding": "CALL_VECTORS",
       "index_name": "openphone-calls"
     }
   ],
   ```

3. **Deploy**
   ```bash
   npx wrangler deploy
   ```

4. **Test Semantic Search**
   ```bash
   curl -X POST https://your-worker.workers.dev/api/search \
     -H "Content-Type: application/json" \
     -d '{"query": "pricing discussion"}'
   ```

### Benefits Once Enabled
- Natural language search across all calls and messages
- Duplicate lead detection
- Semantic Canvas matching
- Trend analysis

---

## Step 3: Enable Workflows (Optional - Beta)

Workflows provide multi-step processing with independent retries.

### Prerequisites
- Workflows access (beta feature - may not be available yet)
- Wrangler 4.x or higher

### Setup Steps

1. **Check Workflows Availability**
   ```bash
   npx wrangler workflows list
   ```

   If this command works, Workflows are available.

2. **Update wrangler.jsonc**

   Uncomment the workflows configuration:
   ```jsonc
   // Change from:
   // "workflows": [
   //   {
   //     "binding": "CALL_PROCESSING_WORKFLOW",
   //     "name": "call-processing-workflow",
   //     "class_name": "CallProcessingWorkflow"
   //   }
   // ],

   // To:
   "workflows": [
     {
       "binding": "CALL_PROCESSING_WORKFLOW",
       "name": "call-processing-workflow",
       "class_name": "CallProcessingWorkflow"
     }
   ],
   ```

3. **Deploy**
   ```bash
   npx wrangler deploy
   ```

### Benefits Once Enabled
- Multi-step processing with independent retries
- Better error isolation
- Visual workflow tracking
- Easier debugging

---

## Step 4: Verify Deployment

1. **Check Worker Status**
   ```bash
   curl https://your-worker.workers.dev/health
   ```

2. **View Dashboard**

   Navigate to your worker URL in a browser to see the real-time dashboard.

3. **Test AI Analysis**

   Make a test call through OpenPhone and check the Notion database to see AI-generated fields:
   - AI Sentiment
   - AI Summary
   - AI Action Items
   - AI Category
   - AI Lead Score
   - AI Keywords

4. **Check Logs**
   ```bash
   npx wrangler tail
   ```

---

## Troubleshooting

### Deployment Fails with "vectorize should be an array"

**Solution**: Make sure vectorize configuration is commented out or has the correct format:
```jsonc
"vectorize": [
  {
    "binding": "CALL_VECTORS",
    "index_name": "openphone-calls"
  }
]
```

Not:
```jsonc
"vectorize": {
  "bindings": [...]
}
```

### Workers AI Not Working

**Solution**:
1. Verify AI binding is configured in wrangler.jsonc
2. Check that you're using model names exactly as specified:
   - `@cf/huggingface/distilbert-sst-2-int8` (sentiment)
   - `@cf/facebook/bart-large-cnn` (summarization)
   - `@cf/meta/llama-3-8b-instruct` (action items)

### Dashboard Not Loading

**Solution**:
1. Verify `public/` directory exists with `index.html`
2. Check assets binding in wrangler.jsonc
3. Ensure worker is deployed: `npx wrangler deploy`

### Vectorize Index Not Found

**Solution**:
1. Create the index: `npx wrangler vectorize create openphone-calls --dimensions=768 --metric=cosine`
2. Verify it was created: `npx wrangler vectorize list`
3. Make sure the index_name in wrangler.jsonc matches exactly

### Workflows Not Available

**Solution**: Workflows is a beta feature and may not be available in your account yet. Keep the configuration commented out until it's available.

---

## Performance Monitoring

### Dashboard Metrics

The dashboard at your worker URL shows:
- Total calls and messages synced
- AI analysis statistics
- Cache performance (hit rates)
- Recent activity log
- Semantic search interface (if Vectorize enabled)

### API Endpoints

```bash
# Get statistics
curl https://your-worker.workers.dev/api/stats

# Get cache performance
curl https://your-worker.workers.dev/api/cache

# Semantic search (if Vectorize enabled)
curl -X POST https://your-worker.workers.dev/api/search \
  -H "Content-Type: application/json" \
  -d '{"query": "customer complaints"}'
```

### Cloudflare Dashboard

Monitor your worker in the Cloudflare dashboard:
1. Go to Workers & Pages
2. Select your worker
3. View Metrics, Logs, and Settings

---

## Feature Compatibility Matrix

| Feature | Status | Requirements |
|---------|--------|-------------|
| Workers AI | ✅ Enabled | None |
| Smart Caching | ✅ Enabled | None |
| Dashboard | ✅ Enabled | None |
| Durable Objects | ✅ Enabled | None |
| D1 Database | ✅ Enabled | Database already created |
| R2 Storage | ✅ Enabled | Bucket already created |
| KV Namespaces | ✅ Enabled | Namespaces already created |
| Queues | ✅ Enabled | Queue already created |
| Vectorize | 🔧 Optional | Create index first |
| Workflows | 🔧 Optional | Beta access required |
| Agents | 🔧 Future | Not yet available |

---

## Gradual Feature Enablement

You can enable features gradually as needed:

### Phase 1 (Immediate)
- Workers AI - Already enabled ✅
- Smart Caching - Already enabled ✅
- Dashboard - Already enabled ✅

**Deploy Now**: `npx wrangler deploy`

### Phase 2 (When Ready)
- Vectorize for semantic search
  - Create index: `npx wrangler vectorize create openphone-calls --dimensions=768 --metric=cosine`
  - Uncomment in wrangler.jsonc
  - Deploy: `npx wrangler deploy`

### Phase 3 (Future)
- Workflows when beta is available
- Agents when feature is released

---

## Updating Wrangler

The deployment logs show Wrangler is outdated. To update:

```bash
npm install --save-dev wrangler@latest
```

Then deploy:
```bash
npx wrangler deploy
```

---

## Cost Estimation

### Current Features (Enabled)
- **Workers AI**: Free tier 10,000 requests/day
- **Smart Caching**: Free tier, reduces KV reads by 80-90%
- **Static Assets**: Free tier
- **Existing Services**: Already in use (D1, R2, KV, Queues, Durable Objects)

### Optional Features
- **Vectorize**: $0.04 per million queries (very cost-effective)
- **Workflows**: Pricing TBD (beta feature)

**Expected Savings**: Using Workers AI instead of external APIs (OpenAI/Claude) can save $100-500/month depending on volume.

---

## Next Steps

1. ✅ **Deploy with current configuration** (Workers AI + Smart Caching enabled)
   ```bash
   npx wrangler deploy
   ```

2. 🔍 **Test the dashboard** at your worker URL

3. 📊 **Monitor performance** via dashboard and Cloudflare metrics

4. 🔧 **Enable Vectorize** when ready for semantic search

5. 🔄 **Keep Workflows commented** until beta is available

---

## Support

For issues:
1. Check worker logs: `npx wrangler tail`
2. Review dashboard at `/` for system status
3. Test API endpoints: `/api/stats`, `/api/cache`
4. Consult OPTIMIZATIONS.md for feature details
5. Check Cloudflare documentation for specific features

---

## Summary

**You can deploy immediately** with Workers AI, smart caching, and the dashboard. Vectorize and Workflows can be enabled later when you're ready or when they become available.

The worker is designed to gracefully handle missing optional features - it will simply skip those operations and log a debug message.

**Deploy now**:
```bash
npx wrangler deploy
```

Then access your dashboard at your worker URL to see it in action! 🚀
