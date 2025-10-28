-- Add merchant UUID tracking to sync history and canvas cache
ALTER TABLE sync_history ADD COLUMN merchant_uuid TEXT;
ALTER TABLE canvas_cache ADD COLUMN merchant_uuid TEXT;
