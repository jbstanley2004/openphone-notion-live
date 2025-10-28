Overview
You already have a solid Cloudflare-first foundation for keeping OpenPhone calls, messages, and mail aligned with each merchant’s Canvas record. Canvas is correctly positioned as the operational hub that links every communication database through relations, so merchant-centric retrieval is conceptually in place before new reporting databases roll out.

What’s Working Well
Per-number Durable Objects give you consistent sync state, Canvas lookup caching, and coordinated webhook handling without race conditions—exactly the right choice for OpenPhone’s real-time feed.

Vectorize + Workers AI already index call/message content for semantic queries, which is a strong base for richer merchant insights once metadata is tightened up.

Merchant Retrieval APIs assemble Canvas, calls, messages, mail, timeline, and summary in one request, ensuring front ends can reason in terms of a single merchant entity today.

Optimization Opportunities
Move to Merchant-Centric Warehousing in D1

Today, every /api/merchant/... call re-queries three Notion databases, which is expensive and adds latency.

Extend the existing D1 schema (currently analytics-focused) with canonical merchants, interactions, and mail_threads tables keyed by Canvas ID so you can satisfy most merchant lookups directly from D1 and fall back to Notion only for cache misses.

Populate those tables from your queue/Workflow path (or a nightly backfill Worker) so merchant timelines and stats come from D1 first, then augment with live Notion data only when needed.

Promote Canvas Lookups to a Global Cache Layer

Durable Objects cache Canvas IDs per phone number/email, but the cache lives inside one DO instance at a time.

Because Canvas IDs are already logged into the canvas_cache table, hydrate a global KV (or D1 → KV replicator) so all workers can check a shared cache before hitting Notion. This removes repeated Notion queries when the same merchant communicates across multiple phone numbers or via mail.

Enrich Vector Metadata with Canvas IDs

searchMerchants currently has a placeholder because the Vectorize metadata lacks the Canvas relation, forcing a second Notion query.

When you index calls/messages, include canvasId (and maybe merchantName) directly in the metadata payload so vector search can group by merchant without any additional Notion calls.

This also ensures future reporting vectors and Workers AI prompts have merchant context in a single lookup.

Normalize Merchant Identifiers Across Notion

Calls and messages rely on phone/email normalization to find Canvas records, which is brittle when numbers change or multiple contacts exist.

Add a dedicated “Merchant UUID” property in each Notion database (Canvas, Calls, Messages, Mail) so every interaction is linked via a deterministic ID. Once that’s in place, the Worker can skip fuzzy matching and sync the ID straight into D1 and Vectorize metadata.

That identifier becomes the primary key for your future reporting databases as well as RAG/AI summarization flows described in the Notion blueprint.

Leverage Workflows (and Pipelines when stable) for Cross-Asset Assembly

The call-processing Workflow already chains recording uploads, AI analysis, Notion writes, and Vectorize indexing—a good template for multi-step pipelines.

Replicate that pattern for mail and messages so every interaction produces a normalized MerchantInteraction event that is fanned out to D1, Vectorize, and any analytics datasets in one orchestrated job.

When Cloudflare Pipelines exits beta, consider using it for scheduled aggregation (e.g., nightly merchant rollups) so you keep the real-time Worker focused on webhooks while Pipelines do heavy ETL.

Keep Merchant Data Portable for Future Reporting

Canvas already aggregates notes, action items, recordings, and contact info; reinforcing that as the single source of truth will make future reporting databases simpler to hydrate.

Before adding the reporting databases, define the merchant schema (IDs, lifecycle stages, funding metrics) in D1 and backfill them from existing Notion data. That way Cloudflare Workers serve the reporting APIs without expensive on-demand Notion queries once the dashboards go live.

Summary Recommendations
Treat D1 as the primary merchant warehouse, populated via queues/workflows, and query Notion only for delta reconciliation.

Share Canvas lookup results through KV or a dedicated Durable Object so every entry point benefits from cached merchant mappings.

Carry canvasId (or a new merchantId) everywhere: Vectorize metadata, D1 tables, KV caches, and AI prompts. This will guarantee that “data by merchant” retrievals stay fast and consistent even as you add more data sources later.

These adjustments keep you aligned with Cloudflare’s strengths (Workers, Durable Objects, KV, D1, Vectorize, AI, upcoming Pipelines) while ensuring all merchant data remains tightly bound together and queryable at low latency.
