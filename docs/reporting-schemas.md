# Merchant Reporting Schemas & Validation

## Overview

Canvas remains the operational source of truth for merchant lifecycle status and canonical naming. To surface reporting-ready
metrics directly from Cloudflare D1 we introduced purpose-built rollup tables keyed by the Merchant UUID so that Funding,
Batches, and interaction telemetry can be joined without relying on ad-hoc name matching. Each rollup table is refreshed by
upstream sync jobs and feeds a consolidated view that powers reporting APIs.

## D1 Schema Extensions

A new migration (`0003_reporting_rollups.sql`) adds three reporting tables and a convenience view:

- `merchant_reporting_profiles` — lifecycle attributes and canonical contact information sourced from Canvas records. Key
  columns:
  - `merchant_uuid` (PRIMARY KEY) plus `canvas_id` foreign key back to `merchants`
  - `canonical_name`, `canonical_phone`, `canonical_email`
  - Lifecycle stage timestamps and optional `data_quality` JSON (quality flags)
- `merchant_funding_metrics` — aggregated Funding + Batches metrics aligned with quality rules in
  `notion_data_structure.md`. Key fields include principal/payback totals, active advance counts, batch cadence, holdback
  averages (stored as decimals), and raw sales aggregates.
- `merchant_communication_metrics` — interaction totals derived from calls, messages, and mail threads with first/last
  touch timestamps.
- `merchant_reporting_rollup` view — left joins the above tables with `merchants` to provide a single record per merchant UUID
  for downstream APIs or dashboard queries.

The migration also enforces a partial unique index on `merchants.merchant_uuid` so the reporting tables can safely reference
it and remain aligned with Canvas-driven canonical naming.

## Retrieval & API Usage

`src/api/merchant-rollup.ts` exposes `getMerchantRollup(...)`, which first attempts to read from D1 via the consolidated
view. When D1 contains a rollup row the function returns it immediately (flagging the response as `source: 'd1'`). If no D1
record exists the helper rebuilds the rollup from Notion on-demand using `buildMerchantRollupFromNotion(...)` and surfaces the
result with `source: 'notion'` and a `fallbackReason`. This ensures Worker/AI prompts receive merchant lifecycle, funding, and
communication metrics directly from D1 whenever possible while documenting the Notion fallback path.

Supporting utilities in `src/utils/merchant-rollup.ts` convert raw D1 rows into strongly typed responses, hydrate data directly
from Notion when fallback logic is triggered, and respect the quality rules from `notion_data_structure.md` (e.g., canonical
merchant naming from Funding, decimal holdbacks, ISO timestamps, and quality flag tracking).

## Validation Routines

To maintain trust ahead of dashboard launches, `src/utils/validation/reporting-validation.ts` provides
`validateMerchantRollup(...)`. The routine pulls both the D1 rollup and a Notion spot check, compares key numeric aggregates
within configurable tolerances, and records any discrepancies (including whether D1 lacks data entirely). Differences are
logged and returned to the caller for alerting or QA workflows.

Running validation periodically or before publishing dashboards keeps the D1 aggregates aligned with Canvas and Notion,
ensuring reporting consumers can trust the summarized metrics.
