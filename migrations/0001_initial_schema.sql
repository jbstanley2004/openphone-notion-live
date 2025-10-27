-- Initial D1 Database Schema for OpenPhone Sync Analytics
-- This database stores analytics and history, NOT real-time state

-- Phone numbers metadata and sync state
CREATE TABLE IF NOT EXISTS phone_numbers (
  id TEXT PRIMARY KEY,                    -- OpenPhone phone number ID (e.g., PN123...)
  number TEXT NOT NULL,                   -- E.164 format phone number
  name TEXT,                              -- Phone number name/label
  first_seen_at INTEGER NOT NULL,         -- Unix timestamp
  last_call_sync_at INTEGER,              -- Last successful call sync
  last_message_sync_at INTEGER,           -- Last successful message sync
  total_calls_synced INTEGER DEFAULT 0,   -- Total calls synced for this number
  total_messages_synced INTEGER DEFAULT 0,-- Total messages synced for this number
  is_active INTEGER DEFAULT 1,            -- 1 = active, 0 = inactive
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Sync history for auditing and analytics
CREATE TABLE IF NOT EXISTS sync_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_number_id TEXT NOT NULL,          -- Which phone number
  resource_type TEXT NOT NULL,            -- 'call', 'message', 'mail'
  resource_id TEXT NOT NULL,              -- OpenPhone ID (e.g., AC123...)
  direction TEXT,                         -- 'incoming' or 'outgoing'
  notion_page_id TEXT,                    -- Notion page ID created
  canvas_id TEXT,                         -- Canvas relation found (if any)
  sync_status TEXT NOT NULL,              -- 'success', 'failed', 'skipped'
  error_message TEXT,                     -- Error details if failed
  processing_time_ms INTEGER,             -- How long it took
  synced_at INTEGER NOT NULL,             -- Unix timestamp

  FOREIGN KEY (phone_number_id) REFERENCES phone_numbers(id)
);

-- Canvas lookup cache (persistent, with TTL)
CREATE TABLE IF NOT EXISTS canvas_cache (
  lookup_key TEXT PRIMARY KEY,            -- Phone number or email (normalized)
  lookup_type TEXT NOT NULL,              -- 'phone' or 'email'
  canvas_id TEXT NOT NULL,                -- Canvas page ID
  canvas_name TEXT,                       -- Optional: canvas record name
  cached_at INTEGER NOT NULL,             -- Unix timestamp
  hit_count INTEGER DEFAULT 1,            -- How many times used
  last_used_at INTEGER NOT NULL           -- Last time this cache was hit
);

-- Performance metrics for monitoring
CREATE TABLE IF NOT EXISTS performance_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  metric_type TEXT NOT NULL,              -- 'api_call', 'notion_query', 'canvas_lookup'
  operation TEXT NOT NULL,                -- Specific operation name
  duration_ms INTEGER NOT NULL,           -- How long it took
  success INTEGER NOT NULL,               -- 1 = success, 0 = failure
  phone_number_id TEXT,                   -- Optional: which phone number
  timestamp INTEGER NOT NULL
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_sync_history_phone ON sync_history(phone_number_id, synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_history_resource ON sync_history(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_sync_history_time ON sync_history(synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_canvas_cache_type ON canvas_cache(lookup_type, cached_at DESC);
CREATE INDEX IF NOT EXISTS idx_performance_metrics_type ON performance_metrics(metric_type, timestamp DESC);

-- Create views for common analytics queries
CREATE VIEW IF NOT EXISTS sync_stats_today AS
SELECT
  phone_number_id,
  resource_type,
  sync_status,
  COUNT(*) as count,
  AVG(processing_time_ms) as avg_processing_time_ms
FROM sync_history
WHERE synced_at > (strftime('%s', 'now') - 86400) * 1000
GROUP BY phone_number_id, resource_type, sync_status;

CREATE VIEW IF NOT EXISTS canvas_cache_stats AS
SELECT
  lookup_type,
  COUNT(*) as total_entries,
  SUM(hit_count) as total_hits,
  AVG(hit_count) as avg_hits_per_entry
FROM canvas_cache
GROUP BY lookup_type;
