-- Persist the normalized source snapshot so unchanged crawls can skip ingest.
ALTER TABLE sources ADD COLUMN content_fingerprint TEXT;

-- The last fully ingested run identifies the jobs present in that snapshot.
-- Unchanged runs can then age only jobs absent from the snapshot, without
-- rewriting every job merely to carry last_seen_run_id forward.
ALTER TABLE sources ADD COLUMN snapshot_run_id TEXT;
