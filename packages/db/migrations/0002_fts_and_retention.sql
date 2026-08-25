-- Move sources that still use the former default to the 12-hour default.
-- Non-default intervals are intentionally preserved.
UPDATE sources
SET crawl_interval_minutes = 720
WHERE crawl_interval_minutes = 360;

-- Browser execution is derived from the adapter. Normalize legacy rows that
-- could combine a non-Playwright adapter with browser_required = 1 (or vice versa).
UPDATE sources
SET browser_required = CASE WHEN kind = 'playwright' THEN 1 ELSE 0 END;

-- Presence-only updates (last_seen, missing_count, status, and similar fields)
-- must not rewrite the external-content FTS index. UPSERT still refreshes those
-- presence fields, while this trigger runs only when indexed values truly differ.
DROP TRIGGER IF EXISTS jobs_fts_update;

CREATE TRIGGER jobs_fts_update
AFTER UPDATE OF title, company_name, location_text, skills_text, search_text ON jobs
WHEN OLD.title IS NOT NEW.title
  OR OLD.company_name IS NOT NEW.company_name
  OR OLD.location_text IS NOT NEW.location_text
  OR OLD.skills_text IS NOT NEW.skills_text
  OR OLD.search_text IS NOT NEW.search_text
BEGIN
  INSERT INTO jobs_fts(jobs_fts, rowid, title, company_name, location_text, skills_text, search_text)
  VALUES ('delete', OLD.rowid, OLD.title, OLD.company_name, OLD.location_text, OLD.skills_text, OLD.search_text);
  INSERT INTO jobs_fts(rowid, title, company_name, location_text, skills_text, search_text)
  VALUES (NEW.rowid, NEW.title, NEW.company_name, NEW.location_text, NEW.skills_text, NEW.search_text);
END;

CREATE INDEX IF NOT EXISTS idx_batches_received_at ON ingest_batches(received_at);
