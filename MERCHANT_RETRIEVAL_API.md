# Merchant Retrieval API

Complete guide to retrieving and segmenting all data by merchant/Canvas across all 4 databases.

---

## Overview

The Merchant Retrieval API allows you to easily retrieve ALL data for a specific merchant (Canvas record):
- All OpenPhone calls
- All OpenPhone messages
- All mail
- Canvas record
- Combined chronological timeline
- Aggregated statistics
- AI-generated insights

**Example Use Case**: Get every interaction with "Merchant 123" across all channels.

---

## API Endpoints

### 1. Get All Data by Canvas ID

Retrieve complete data for a merchant using their Canvas ID.

**Endpoint**: `POST /api/merchant/canvas`

**Request**:
```json
{
  "canvasId": "fc0e485b-6570-460e-995b-94431b08f0a7"
}
```

**Response**:
```json
{
  "canvasId": "fc0e485b-6570-460e-995b-94431b08f0a7",
  "canvas": { /* Notion Canvas page data */ },
  "calls": [ /* Array of all call pages */ ],
  "messages": [ /* Array of all message pages */ ],
  "mail": [ /* Array of all mail pages */ ],
  "timeline": [
    {
      "type": "call",
      "id": "call_123",
      "timestamp": "2025-10-27T10:30:00Z",
      "notionPageId": "page-id-here",
      "summary": "Customer inquiry about pricing",
      "sentiment": "positive",
      "direction": "incoming"
    }
    /* ... all interactions in chronological order */
  ],
  "stats": {
    "totalCalls": 15,
    "totalMessages": 42,
    "totalMail": 8,
    "totalInteractions": 65,
    "firstInteraction": "2025-09-15T14:20:00Z",
    "lastInteraction": "2025-10-27T16:45:00Z",
    "avgSentiment": "positive",
    "avgLeadScore": 78.5
  }
}
```

**Example**:
```bash
curl -X POST https://your-worker.workers.dev/api/merchant/canvas \
  -H "Content-Type: application/json" \
  -d '{"canvasId": "fc0e485b-6570-460e-995b-94431b08f0a7"}'
```

---

### 2. Get All Data by Phone Number

Retrieve merchant data using a phone number.

**Endpoint**: `POST /api/merchant/phone`

**Request**:
```json
{
  "phoneNumber": "+1234567890"
}
```

**Response**: Same as Canvas ID endpoint

**Example**:
```bash
curl -X POST https://your-worker.workers.dev/api/merchant/phone \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "+1234567890"}'
```

**Note**: Automatically looks up Canvas by phone number, then returns all associated data.

---

### 3. Get All Data by Email

Retrieve merchant data using an email address.

**Endpoint**: `POST /api/merchant/email`

**Request**:
```json
{
  "email": "merchant@example.com"
}
```

**Response**: Same as Canvas ID endpoint

**Example**:
```bash
curl -X POST https://your-worker.workers.dev/api/merchant/email \
  -H "Content-Type": application/json" \
  -d '{"email": "merchant@example.com"}'
```

---

### 4. Search Merchants

Find merchants using semantic search across all interactions.

**Endpoint**: `POST /api/merchant/search`

**Request**:
```json
{
  "query": "merchants interested in enterprise pricing",
  "topK": 10,
  "dateFrom": "2025-10-01",
  "dateTo": "2025-10-27"
}
```

**Response**:
```json
{
  "results": [
    {
      "canvasId": "canvas-id-1",
      "relevance": 0.94,
      "preview": "Match in call from 2025-10-15T14:30:00Z"
    },
    {
      "canvasId": "canvas-id-2",
      "relevance": 0.87,
      "preview": "Match in message from 2025-10-20T09:15:00Z"
    }
    /* ... more results */
  ]
}
```

**Example**:
```bash
curl -X POST https://your-worker.workers.dev/api/merchant/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "pricing discussion enterprise plan",
    "topK": 20,
    "dateFrom": "2025-10-01"
  }'
```

**Use Cases**:
- "Find all merchants who mentioned pricing in the last week"
- "Search for merchants interested in enterprise features"
- "Find merchants with support issues"

---

### 5. Get Merchant Summary

Get a quick summary of a merchant's interactions.

**Endpoint**: `POST /api/merchant/summary`

**Request**:
```json
{
  "canvasId": "fc0e485b-6570-460e-995b-94431b08f0a7"
}
```

**Response**:
```json
{
  "canvasId": "fc0e485b-6570-460e-995b-94431b08f0a7",
  "name": "Acme Corporation",
  "phone": "+1234567890",
  "email": "contact@acme.com",
  "totalInteractions": 65,
  "lastContact": "2025-10-27T16:45:00Z",
  "nextAction": "Send pricing sheet for enterprise plan",
  "sentiment": "positive",
  "leadScore": 78.5,
  "tags": ["sales", "inquiry", "enterprise"]
}
```

**Example**:
```bash
curl -X POST https://your-worker.workers.dev/api/merchant/summary \
  -H "Content-Type: application/json" \
  -d '{"canvasId": "fc0e485b-6570-460e-995b-94431b08f0a7"}'
```

---

## Comprehensive Backfill API

Trigger a comprehensive backfill of all databases with AI analysis and vectorization.

**Endpoint**: `POST /api/backfill/comprehensive`

**Request**:
```json
{
  "daysBack": 30,
  "includeAI": true,
  "includeVectorize": true,
  "reconcileCanvas": true
}
```

**Parameters**:
- `daysBack` (optional, default: 30): How many days of history to backfill
- `includeAI` (optional, default: true): Include AI analysis (sentiment, lead scoring, action items)
- `includeVectorize` (optional, default: true): Create embeddings for semantic search
- `reconcileCanvas` (optional, default: true): Reconcile Canvas relations across all records

**Response**:
```json
{
  "status": "started",
  "message": "Comprehensive backfill started in background",
  "options": {
    "daysBack": 30,
    "includeAI": true,
    "includeVectorize": true,
    "reconcileCanvas": true
  }
}
```

**Example**:
```bash
# Backfill last 60 days with full AI analysis and vectorization
curl -X POST https://your-worker.workers.dev/api/backfill/comprehensive \
  -H "Content-Type: application/json" \
  -d '{
    "daysBack": 60,
    "includeAI": true,
    "includeVectorize": true,
    "reconcileCanvas": true
  }'
```

**What It Does**:
1. Backfills Canvas database (merchants)
2. Backfills Calls with AI analysis (sentiment, summary, action items, lead score)
3. Backfills Messages with AI analysis
4. Backfills Mail database
5. Reconciles Canvas relations across all databases
6. Vectorizes everything for semantic search

**Processing**:
- Runs in background (non-blocking)
- Processes in batches of 10
- Respects rate limits
- Skips already-synced records
- Retries failed records

---

## Use Cases

### 1. View Complete Merchant History

```javascript
// Get all interactions with a specific merchant
const response = await fetch('/api/merchant/phone', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ phoneNumber: '+1234567890' })
});

const data = await response.json();

console.log(`Total interactions: ${data.stats.totalInteractions}`);
console.log(`Calls: ${data.stats.totalCalls}`);
console.log(`Messages: ${data.stats.totalMessages}`);
console.log(`Mail: ${data.stats.totalMail}`);
console.log(`Average sentiment: ${data.stats.avgSentiment}`);
console.log(`Lead score: ${data.stats.avgLeadScore}`);

// View timeline
data.timeline.forEach(item => {
  console.log(`${item.timestamp} - ${item.type}: ${item.summary}`);
});
```

### 2. Find High-Value Leads

```javascript
// Search for merchants interested in enterprise features
const response = await fetch('/api/merchant/search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: 'enterprise pricing interested high volume',
    topK: 50
  })
});

const results = await response.json();

// Get detailed data for each lead
for (const result of results.results) {
  const summary = await fetch('/api/merchant/summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ canvasId: result.canvasId })
  }).then(r => r.json());

  if (summary.leadScore > 75) {
    console.log(`High-value lead: ${summary.name}`);
    console.log(`Lead score: ${summary.leadScore}`);
    console.log(`Next action: ${summary.nextAction}`);
  }
}
```

### 3. Generate Merchant Report

```javascript
// Get comprehensive report for a merchant
async function generateMerchantReport(phoneNumber) {
  const data = await fetch('/api/merchant/phone', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumber })
  }).then(r => r.json());

  return {
    name: data.canvas.properties.Name.title[0].plain_text,
    phone: phoneNumber,
    totalInteractions: data.stats.totalInteractions,
    sentimentBreakdown: {
      positive: data.calls.filter(c =>
        c.properties['AI Sentiment']?.select?.name === 'positive').length,
      negative: data.calls.filter(c =>
        c.properties['AI Sentiment']?.select?.name === 'negative').length,
      neutral: data.calls.filter(c =>
        c.properties['AI Sentiment']?.select?.name === 'neutral').length,
    },
    recentActivity: data.timeline.slice(0, 10),
    leadScore: data.stats.avgLeadScore,
    categories: [...new Set(data.calls.map(c =>
      c.properties['AI Category']?.select?.name).filter(Boolean))],
  };
}
```

### 4. Segment Merchants by Interaction Type

```javascript
// Find merchants with specific interaction patterns
async function findMerchantsWithPattern(pattern) {
  const results = await fetch('/api/merchant/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: pattern, topK: 100 })
  }).then(r => r.json());

  const summaries = await Promise.all(
    results.results.map(r =>
      fetch('/api/merchant/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canvasId: r.canvasId })
      }).then(res => res.json())
    )
  );

  // Group by interaction volume
  return {
    highVolume: summaries.filter(s => s.totalInteractions > 50),
    mediumVolume: summaries.filter(s => s.totalInteractions >= 20 && s.totalInteractions <= 50),
    lowVolume: summaries.filter(s => s.totalInteractions < 20),
  };
}

// Example: Find merchants who asked about pricing
const pricingMerchants = await findMerchantsWithPattern('pricing discussion');
console.log(`High volume pricing inquiries: ${pricingMerchants.highVolume.length}`);
```

---

## Data Reconciliation

### Automatic Canvas Relations

The system automatically:
1. Matches calls/messages to Canvas by phone number
2. Matches mail to Canvas by email address
3. Caches Canvas lookups for performance
4. Reconciles missing relations during backfill

### Manual Reconciliation

Trigger reconciliation to ensure all records have proper Canvas relations:

```bash
curl -X POST https://your-worker.workers.dev/api/backfill/comprehensive \
  -H "Content-Type: application/json" \
  -d '{
    "daysBack": 365,
    "includeAI": false,
    "includeVectorize": false,
    "reconcileCanvas": true
  }'
```

This updates all existing records with Canvas relations without re-running AI analysis.

---

## Performance Considerations

### Caching
- Canvas lookups are cached (sub-millisecond to 5ms)
- Merchant data queries cache in memory
- Timeline building is optimized

### Rate Limiting
- Backfill respects OpenPhone API limits (10 req/sec)
- Batch processing with delays
- Automatic retry on rate limit errors

### Pagination
- Handles large datasets (20,000+ calls per phone number)
- Streams results when possible
- Processes in configurable batch sizes

---

## Error Handling

### 404 - Not Found
```json
{
  "error": "No merchant found for phone number"
}
```

**Cause**: No Canvas record exists for the provided phone/email.

**Solution**: Ensure Canvas database has a record with this phone/email.

### 400 - Bad Request
```json
{
  "error": "canvasId required"
}
```

**Cause**: Missing required parameter.

**Solution**: Provide all required fields in request body.

### 500 - Server Error
```json
{
  "error": "Failed to retrieve merchant data"
}
```

**Cause**: Internal error (Notion API, database, etc.).

**Solution**: Check worker logs for details.

---

## Integration Examples

### Dashboard Widget

```javascript
// Real-time merchant overview widget
async function MerchantOverview({ canvasId }) {
  const summary = await fetch('/api/merchant/summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ canvasId })
  }).then(r => r.json());

  return (
    <div className="merchant-card">
      <h2>{summary.name}</h2>
      <div className="stats">
        <span>📞 {summary.totalInteractions} interactions</span>
        <span>😊 {summary.sentiment}</span>
        <span>⭐ {summary.leadScore}/100</span>
      </div>
      <p><strong>Last contact:</strong> {new Date(summary.lastContact).toLocaleDateString()}</p>
      <p><strong>Next action:</strong> {summary.nextAction}</p>
      <div className="tags">
        {summary.tags.map(tag => <span key={tag} className="tag">{tag}</span>)}
      </div>
    </div>
  );
}
```

### CRM Integration

```javascript
// Sync merchant data to external CRM
async function syncToCRM(canvasId) {
  const data = await fetch('/api/merchant/canvas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ canvasId })
  }).then(r => r.json());

  // Transform to CRM format
  const crmData = {
    id: canvasId,
    name: data.canvas.properties.Name.title[0].plain_text,
    phone: data.canvas.properties.Phone?.phone_number,
    email: data.canvas.properties.Email?.email,
    totalCalls: data.stats.totalCalls,
    totalMessages: data.stats.totalMessages,
    sentiment: data.stats.avgSentiment,
    leadScore: data.stats.avgLeadScore,
    lastContact: data.stats.lastInteraction,
    timeline: data.timeline.map(item => ({
      type: item.type,
      date: item.timestamp,
      summary: item.summary,
      sentiment: item.sentiment
    }))
  };

  // Push to your CRM
  await fetch('https://your-crm.com/api/contacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer YOUR_TOKEN' },
    body: JSON.stringify(crmData)
  });
}
```

---

## Summary

The Merchant Retrieval API provides:
- ✅ Complete merchant data across all 4 databases
- ✅ Canvas-based segmentation and filtering
- ✅ Chronological timeline of all interactions
- ✅ Aggregated statistics and AI insights
- ✅ Semantic search for finding merchants
- ✅ Comprehensive backfill with AI and vectorization
- ✅ Automatic Canvas relation reconciliation

**Everything you need to easily retrieve and segment data by merchant.** 🎯
