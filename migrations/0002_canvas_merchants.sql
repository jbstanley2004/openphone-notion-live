-- D1 Schema Extension for Merchant-Centric Analytics
-- Adds canonical merchant, interaction, and mail thread tables keyed by Canvas ID/UUID

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS merchants (
  canvas_id TEXT PRIMARY KEY,
  merchant_uuid TEXT,
  name TEXT,
  primary_phone TEXT,
  primary_phone_normalized TEXT,
  primary_email TEXT,
  primary_email_normalized TEXT,
  status TEXT,
  segment TEXT,
  owner TEXT,
  first_interaction_at INTEGER,
  last_interaction_at INTEGER,
  total_calls INTEGER DEFAULT 0,
  total_messages INTEGER DEFAULT 0,
  total_mail INTEGER DEFAULT 0,
  last_interaction_type TEXT,
  last_summary TEXT,
  last_synced_at INTEGER NOT NULL,
  metadata TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS interactions (
  id TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL,
  interaction_type TEXT NOT NULL,
  direction TEXT,
  summary TEXT,
  sentiment TEXT,
  lead_score REAL,
  occurred_at INTEGER NOT NULL,
  notion_page_id TEXT,
  openphone_id TEXT,
  mail_thread_id TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (canvas_id) REFERENCES merchants(canvas_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS mail_threads (
  thread_id TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL,
  subject TEXT,
  last_message_preview TEXT,
  last_message_at INTEGER,
  message_count INTEGER DEFAULT 0,
  participants TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (canvas_id) REFERENCES merchants(canvas_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_merchants_phone_norm ON merchants(primary_phone_normalized);
CREATE INDEX IF NOT EXISTS idx_merchants_email_norm ON merchants(primary_email_normalized);
CREATE INDEX IF NOT EXISTS idx_merchants_last_interaction ON merchants(last_interaction_at DESC);
CREATE INDEX IF NOT EXISTS idx_interactions_canvas_time ON interactions(canvas_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_interactions_openphone ON interactions(openphone_id);
CREATE INDEX IF NOT EXISTS idx_interactions_notion_page ON interactions(notion_page_id);
CREATE INDEX IF NOT EXISTS idx_mail_threads_canvas ON mail_threads(canvas_id);
