# Metrics & Monitoring

This document summarizes the current observability surfaces for the OpenPhone → Notion Worker and provides ready-to-run Workers Analytics queries that map to key reliability KPIs.

## Dashboards

- **Workers Analytics (Dashboard > Workers > openphone-notion-sync)**
  - Panels: Requests, CPU time, Errors
  - Queue consumer success/failure counts (use `script_name:"openphone-notion-sync"` filter)
- **Queues Analytics**
  - Queue: `openphone-webhook-events`
  - Widgets: backlog depth, consumer rate, dead-letter arrival rate
- **D1 Monitoring**
  - Dataset: `openphone-sync-db`
  - View query latency via prepared statements logged in Worker (see `d1.query` log entries)

## Workers Analytics Queries

Run these queries from the [Workers Analytics](https://dash.cloudflare.com/?to=/:account/workers/analytics) SQL console.

### Webhook Throughput (last 24 hours)

```sql
SELECT
  bin(timestamp, 5m) AS interval,
  SUM(IF(request_source = 'queues', 0, 1)) AS http_events,
  SUM(IF(request_source = 'queues', 1, 0)) AS queue_events,
  SUM(IF(status >= 500, 1, 0)) AS errors
FROM workers_requests
WHERE service_name = 'openphone-notion-sync'
  AND timestamp > NOW() - INTERVAL '24 hours'
GROUP BY interval
ORDER BY interval;
```

### Queue Backlog & DLQ Entries (last 24 hours)

```sql
SELECT
  bin(timestamp, 5m) AS interval,
  SUM(queued_messages) AS enqueued,
  SUM(processed_messages) AS processed,
  SUM(dead_lettered_messages) AS dead_lettered
FROM queues_messages
WHERE queue_name IN ('openphone-webhook-events', 'openphone-webhook-events-dlq')
  AND timestamp > NOW() - INTERVAL '24 hours'
GROUP BY interval
ORDER BY interval;
```

### D1 Query Latency Distribution (last 24 hours)

Leverages the structured `d1.query` logs emitted by the Worker.

```sql
SELECT
  data:operation AS operation,
  APPROX_PERCENTILE(data:durationMs, 0.50) AS p50_ms,
  APPROX_PERCENTILE(data:durationMs, 0.95) AS p95_ms,
  COUNT(*) AS executions
FROM logs
WHERE service = 'openphone-notion-sync'
  AND data:event = 'd1.query'
  AND timestamp > NOW() - INTERVAL '24 hours'
GROUP BY operation
ORDER BY p95_ms DESC;
```

### KV Deduplication Hit Rate (last 24 hours)

```sql
SELECT
  bin(timestamp, 15m) AS interval,
  SUM(IF(data:action = 'get' AND data:hit = true, 1, 0)) AS hits,
  SUM(IF(data:action = 'get' AND data:hit = false, 1, 0)) AS misses
FROM logs
WHERE service = 'openphone-notion-sync'
  AND data:event = 'kv.operation'
  AND timestamp > NOW() - INTERVAL '24 hours'
GROUP BY interval
ORDER BY interval;
```

### Workflow Failures (last 24 hours)

```sql
SELECT
  data:workflow AS workflow,
  data:step AS step,
  COUNT(*) AS failures
FROM logs
WHERE service = 'openphone-notion-sync'
  AND data:event = 'workflow.step'
  AND data:status = 'failure'
  AND timestamp > NOW() - INTERVAL '24 hours'
GROUP BY workflow, step
ORDER BY failures DESC;
```

These queries align with the enhanced logging emitted by the Worker entry points and workflows to provide visibility into pipeline health before introducing new automations.
