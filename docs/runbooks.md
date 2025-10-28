# Operations Runbooks

This guide captures the runbooks for the most common operational responses required to keep the OpenPhone → Notion sync healthy. Each runbook includes prerequisites, the command paths to execute, and the signals to watch before closing out the incident.

---

## Cache Refresh Runbook

**Purpose:** Clear and rebuild stale Canvas cache entries in KV and D1 when lookups begin to miss or merchants resolve to incorrect Canvas pages.

### Preconditions
- Confirm an alert or log entry indicating high `canvas-cache-freshness` staleness (from the scheduled health checks) or manual reports of repeated lookup misses.
- Access to Cloudflare Workers with permission to invoke the scheduled Worker or run a one-off Wrangler command.

### Steps
1. **Trigger the health check snapshot for context**
   ```bash
   wrangler tail --format=json | jq 'select(.task == "system-health-checks")'
   ```
   Validate whether `canvas_cache_stale` or `kvExpirationRatio` exceed the warning threshold.
2. **Run the Canvas cache replication manually**
   ```bash
   wrangler invoke openphone-notion-sync --entry scheduled --local
   ```
   This triggers `replicateCanvasCacheToKV` before the comprehensive backfill.
3. **Spot check KV values**
   ```bash
   wrangler kv:key list --namespace-id <CACHE_NAMESPACE_ID> --prefix canvas: | head -n 10
   ```
   Ensure expirations are at least 6 hours out and values match D1’s `canvas_cache` table.
4. **Invalidate specific mappings (if needed)**
   ```bash
   wrangler kv:key delete --namespace-id <CACHE_NAMESPACE_ID> canvas:phone:+15551234567
   ```
   The next health cycle will rebuild the key from D1 via Notion lookup.
5. **Verify resolution**
   - Confirm the next health report shows lowered stale ratios.
   - Run an end-to-end lookup through the Worker (call or message) and check logs for cache hits.

### Post-actions
- Record the incident in the ops log with stale ratios before/after remediation.
- Flag any merchants repeatedly invalidated for schema fixes in Notion.

---

## D1 Backfill Rerun Runbook

**Purpose:** Rerun the D1 backfill and AI/vector enrichment when historical data is missing or mis-synced.

### Preconditions
- Confirm the health check alert or manual investigation identifies missing merchants/interactions in D1 (e.g., `merchant-uuid-coverage` degraded or high Notion drift).
- Ensure Notion API rate limits are in a healthy state.

### Steps
1. **Run the comprehensive backfill workflow**
   ```bash
   wrangler invoke openphone-notion-sync --entry scheduled --local
   ```
   This runs `runComprehensiveBackfill` with AI, vectorization, and Canvas reconciliation for the last 30 days.
2. **Monitor progress**
   ```bash
   wrangler tail --format=json | jq 'select(.message == "Scheduled comprehensive backfill completed")'
   ```
   Capture synced vs failed counts from the log entry.
3. **Force a deeper window if required**
   ```bash
   wrangler invoke openphone-notion-sync --entry comprehensive-backfill --local --data '{"daysBack":90,"batchSize":5,"includeAI":true,"includeVectorize":true}'
   ```
   Use sparingly to avoid rate limits; smaller batches reduce strain on Notion.
4. **Validate D1 state**
   ```bash
   wrangler d1 execute <DB_BINDING> --command "SELECT COUNT(*) FROM interactions WHERE occurred_at >= strftime('%s','now','-30 days')*1000;"
   ```
   Compare counts to historical baselines and ensure merchants now have UUIDs populated.

### Post-actions
- Update the incident ticket with before/after counts and any follow-up required (e.g., merchants lacking UUIDs in Notion).
- If repeated, open an engineering task to adjust the default backfill window or error handling.

---

## Workflow Failure Recovery Runbook

**Purpose:** Recover from failed Workflow executions (call, message, or mail processors) that impact queue throughput or downstream syncs.

### Preconditions
- Alert from the health checks (queue failures) or Wrangler tail showing repeated `workflow.step` failures.
- Access to Cloudflare Queues dashboard and Wrangler CLI.

### Steps
1. **Identify failing workflow**
   ```bash
   wrangler tail --format=json | jq 'select(.event == "workflow.step" and .status == "failure")'
   ```
   Note the workflow name (`CALL_PROCESSING_WORKFLOW`, `MESSAGE_PROCESSING_WORKFLOW`, etc.) and failing step.
2. **Inspect DLQ (if configured)**
   ```bash
   wrangler queues messages dlq openphone-webhook-events-dlq
   ```
   Determine whether retries are accumulating and fetch representative payloads.
3. **Replay affected messages**
   ```bash
   wrangler queues replay openphone-webhook-events-dlq --queue openphone-webhook-events
   ```
   Replays keep ordering but ensure rate limits can handle the burst.
4. **Run targeted workflow retry**
   ```bash
   wrangler invoke openphone-notion-sync --entry workflows/call-processing --local --data '{"eventId":"<EVENT_ID>"}'
   ```
   Swap the workflow entry path to match the failing processor and provide an event payload pulled from DLQ.
5. **Increase visibility if failures continue**
   - Enable additional logging by bumping `LOG_LEVEL` to `debug` in Wrangler vars.
   - Temporarily pause the producer queue if the backlog grows (`wrangler queues pause`).

### Post-actions
- Document root cause and mitigation in the ops log.
- Open follow-up issues to harden workflows (e.g., improved retries, defensive parsing) when failures recur.

---

## Scheduling & Ownership
- Scheduled health checks run with every cron invocation and publish alerts to the configured `ALERT_WEBHOOK_URL` when degradation is detected.
- The integrations on-call engineer owns execution of these runbooks. If additional support is required, escalate to the platform team after two consecutive failures or if remediation exceeds 2 hours.
