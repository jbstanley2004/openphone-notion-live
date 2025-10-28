-- Migration: Extend canvas_cache table for authoritative mapping metadata
-- Adds versioning, KV replication tracking, and invalidation markers

ALTER TABLE canvas_cache ADD COLUMN source TEXT DEFAULT 'notion';
ALTER TABLE canvas_cache ADD COLUMN version INTEGER DEFAULT 1;
ALTER TABLE canvas_cache ADD COLUMN last_verified_at INTEGER;
ALTER TABLE canvas_cache ADD COLUMN kv_version INTEGER DEFAULT 0;
ALTER TABLE canvas_cache ADD COLUMN kv_written_at INTEGER;
ALTER TABLE canvas_cache ADD COLUMN kv_ttl INTEGER;
ALTER TABLE canvas_cache ADD COLUMN kv_expires_at INTEGER;
ALTER TABLE canvas_cache ADD COLUMN invalidated_at INTEGER;
ALTER TABLE canvas_cache ADD COLUMN metadata TEXT;

CREATE INDEX IF NOT EXISTS idx_canvas_cache_valid ON canvas_cache(invalidated_at, last_verified_at DESC);
