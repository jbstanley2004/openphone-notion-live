-- Migration: Merchant Reporting Schemas and Rollups
-- Defines lifecycle, funding, and communication reporting tables keyed by Merchant UUID
-- Establishes a consolidated view joining Funding, Batches, and interaction metrics via Merchant UUID

PRAGMA foreign_keys = ON;

-- Ensure Merchant UUIDs are unique when present so downstream tables can safely reference them
CREATE UNIQUE INDEX IF NOT EXISTS idx_merchants_uuid_unique
  ON merchants(merchant_uuid)
  WHERE merchant_uuid IS NOT NULL;

-- Core lifecycle profile sourced from Canvas canonical records
CREATE TABLE IF NOT EXISTS merchant_reporting_profiles (
  merchant_uuid TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  canonical_phone TEXT,
  canonical_email TEXT,
  lifecycle_stage TEXT,
  stage_entered_at INTEGER,
  stage_exited_at INTEGER,
  lifecycle_source TEXT DEFAULT 'd1',
  last_refreshed_at INTEGER NOT NULL,
  data_quality TEXT,
  FOREIGN KEY (merchant_uuid) REFERENCES merchants(merchant_uuid) ON DELETE CASCADE,
  FOREIGN KEY (canvas_id) REFERENCES merchants(canvas_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reporting_profiles_canvas
  ON merchant_reporting_profiles(canvas_id);

-- Funding metrics rollup sourced from Funding and Batch processors
CREATE TABLE IF NOT EXISTS merchant_funding_metrics (
  merchant_uuid TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL,
  first_funded_at INTEGER,
  latest_funded_at INTEGER,
  active_advance_count INTEGER DEFAULT 0,
  total_principal_amount REAL DEFAULT 0,
  total_payback_amount REAL DEFAULT 0,
  total_payments REAL DEFAULT 0,
  outstanding_payback_balance REAL DEFAULT 0,
  outstanding_principal_balance REAL DEFAULT 0,
  average_holdback_percent REAL,
  last_batch_date INTEGER,
  last_batch_payments REAL DEFAULT 0,
  lifetime_sales_amount REAL DEFAULT 0,
  lifetime_sales_count INTEGER DEFAULT 0,
  funding_source TEXT DEFAULT 'd1',
  last_refreshed_at INTEGER NOT NULL,
  data_quality TEXT,
  FOREIGN KEY (merchant_uuid) REFERENCES merchants(merchant_uuid) ON DELETE CASCADE,
  FOREIGN KEY (canvas_id) REFERENCES merchants(canvas_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_funding_metrics_canvas
  ON merchant_funding_metrics(canvas_id);

-- Communication metrics rollup sourced from interaction history
CREATE TABLE IF NOT EXISTS merchant_communication_metrics (
  merchant_uuid TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL,
  total_call_count INTEGER DEFAULT 0,
  total_message_count INTEGER DEFAULT 0,
  total_mail_count INTEGER DEFAULT 0,
  first_interaction_at INTEGER,
  last_interaction_at INTEGER,
  last_call_at INTEGER,
  last_message_at INTEGER,
  last_mail_at INTEGER,
  communication_source TEXT DEFAULT 'd1',
  last_refreshed_at INTEGER NOT NULL,
  data_quality TEXT,
  FOREIGN KEY (merchant_uuid) REFERENCES merchants(merchant_uuid) ON DELETE CASCADE,
  FOREIGN KEY (canvas_id) REFERENCES merchants(canvas_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_comm_metrics_canvas
  ON merchant_communication_metrics(canvas_id);

-- Consolidated rollup view keyed by Merchant UUID
CREATE VIEW IF NOT EXISTS merchant_reporting_rollup AS
SELECT
  m.canvas_id,
  m.merchant_uuid,
  COALESCE(mp.canonical_name, m.name) AS canonical_name,
  mp.canonical_phone,
  mp.canonical_email,
  mp.lifecycle_stage,
  mp.stage_entered_at,
  mp.stage_exited_at,
  mp.lifecycle_source,
  mp.last_refreshed_at AS lifecycle_refreshed_at,
  mp.data_quality AS lifecycle_quality,
  fm.first_funded_at,
  fm.latest_funded_at,
  fm.active_advance_count,
  fm.total_principal_amount,
  fm.total_payback_amount,
  fm.total_payments,
  fm.outstanding_payback_balance,
  fm.outstanding_principal_balance,
  fm.average_holdback_percent,
  fm.last_batch_date,
  fm.last_batch_payments,
  fm.lifetime_sales_amount,
  fm.lifetime_sales_count,
  fm.funding_source,
  fm.last_refreshed_at AS funding_refreshed_at,
  fm.data_quality AS funding_quality,
  cm.total_call_count,
  cm.total_message_count,
  cm.total_mail_count,
  cm.first_interaction_at,
  cm.last_interaction_at,
  cm.last_call_at,
  cm.last_message_at,
  cm.last_mail_at,
  cm.communication_source,
  cm.last_refreshed_at AS communication_refreshed_at,
  cm.data_quality AS communication_quality,
  m.last_synced_at AS merchant_last_synced_at
FROM merchants m
LEFT JOIN merchant_reporting_profiles mp ON mp.merchant_uuid = m.merchant_uuid
LEFT JOIN merchant_funding_metrics fm ON fm.merchant_uuid = m.merchant_uuid
LEFT JOIN merchant_communication_metrics cm ON cm.merchant_uuid = m.merchant_uuid;

