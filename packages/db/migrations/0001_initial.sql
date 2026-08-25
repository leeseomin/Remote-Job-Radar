PRAGMA foreign_keys = ON;

CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  careers_url TEXT,
  remote_policy_url TEXT,
  priority INTEGER NOT NULL DEFAULT 50,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('greenhouse','lever','ashby','jsonld','static-html','playwright')),
  url TEXT NOT NULL,
  adapter_key TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  browser_required INTEGER NOT NULL DEFAULT 0 CHECK(browser_required IN (0, 1)),
  crawl_interval_minutes INTEGER NOT NULL DEFAULT 360,
  etag TEXT,
  last_modified TEXT,
  previous_job_count INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_success_at INTEGER,
  last_failure_at INTEGER,
  next_due_at INTEGER NOT NULL,
  lease_owner TEXT,
  lease_until INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','quarantined','disabled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE crawl_runs (
  id TEXT PRIMARY KEY,
  runner_type TEXT NOT NULL CHECK(runner_type IN ('fast','browser')),
  trigger_type TEXT NOT NULL,
  github_run_id TEXT,
  planned_source_count INTEGER NOT NULL DEFAULT 0,
  completed_source_count INTEGER NOT NULL DEFAULT 0,
  failed_source_count INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  status TEXT NOT NULL CHECK(status IN ('running','completed','partial','failed'))
);

CREATE TABLE source_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES crawl_runs(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  http_status INTEGER,
  fetched_job_count INTEGER,
  previous_job_count INTEGER,
  response_hash TEXT,
  error_code TEXT,
  error_message TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  UNIQUE(run_id, source_id)
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  title TEXT NOT NULL,
  company_name TEXT NOT NULL,
  department TEXT,
  location_text TEXT,
  employment_type TEXT,
  description_text TEXT NOT NULL,
  search_text TEXT NOT NULL,
  skills_text TEXT NOT NULL DEFAULT '',
  workplace_type TEXT NOT NULL DEFAULT 'unknown',
  remote_scope TEXT NOT NULL DEFAULT 'unknown',
  eligible_from_korea TEXT NOT NULL DEFAULT 'unknown',
  async_level TEXT NOT NULL DEFAULT 'unknown',
  required_timezone TEXT,
  required_overlap_hours REAL,
  salary_currency TEXT,
  salary_min REAL,
  salary_max REAL,
  salary_interval TEXT,
  posted_at INTEGER,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  last_seen_run_id TEXT,
  missing_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  closed_at INTEGER,
  score INTEGER NOT NULL DEFAULT 0 CHECK(score BETWEEN 0 AND 100),
  confidence REAL NOT NULL DEFAULT 0 CHECK(confidence BETWEEN 0 AND 1),
  evidence_json TEXT NOT NULL DEFAULT '[]',
  content_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(source_id, external_id)
);

CREATE TABLE job_versions (
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  PRIMARY KEY(job_id, content_hash)
);

CREATE TABLE job_actions (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK(action IN ('saved','dismissed','applied')),
  dismiss_reason TEXT,
  notes TEXT,
  applied_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE ingest_batches (
  batch_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  job_count INTEGER NOT NULL,
  received_at INTEGER NOT NULL
);

CREATE TABLE ingest_nonces (
  nonce TEXT PRIMARY KEY,
  used_at INTEGER NOT NULL
);

CREATE INDEX idx_sources_due ON sources(status, next_due_at);
CREATE INDEX idx_jobs_inbox ON jobs(status, score DESC, first_seen_at DESC);
CREATE INDEX idx_jobs_company ON jobs(company_id, status, score DESC);
CREATE INDEX idx_jobs_source_seen ON jobs(source_id, last_seen_run_id, status);
CREATE INDEX idx_jobs_remote ON jobs(eligible_from_korea, remote_scope, score DESC);
CREATE INDEX idx_source_runs_health ON source_runs(source_id, started_at DESC);
CREATE INDEX idx_job_versions_recent ON job_versions(job_id, observed_at DESC);
CREATE INDEX idx_nonces_used_at ON ingest_nonces(used_at);
CREATE INDEX idx_batches_run_source ON ingest_batches(run_id, source_id);

CREATE VIRTUAL TABLE jobs_fts USING fts5(
  title,
  company_name,
  location_text,
  skills_text,
  search_text,
  content='jobs',
  content_rowid='rowid',
  tokenize='unicode61'
);

CREATE TRIGGER jobs_fts_insert AFTER INSERT ON jobs BEGIN
  INSERT INTO jobs_fts(rowid, title, company_name, location_text, skills_text, search_text)
  VALUES (new.rowid, new.title, new.company_name, new.location_text, new.skills_text, new.search_text);
END;

CREATE TRIGGER jobs_fts_delete AFTER DELETE ON jobs BEGIN
  INSERT INTO jobs_fts(jobs_fts, rowid, title, company_name, location_text, skills_text, search_text)
  VALUES ('delete', old.rowid, old.title, old.company_name, old.location_text, old.skills_text, old.search_text);
END;

CREATE TRIGGER jobs_fts_update AFTER UPDATE ON jobs BEGIN
  INSERT INTO jobs_fts(jobs_fts, rowid, title, company_name, location_text, skills_text, search_text)
  VALUES ('delete', old.rowid, old.title, old.company_name, old.location_text, old.skills_text, old.search_text);
  INSERT INTO jobs_fts(rowid, title, company_name, location_text, skills_text, search_text)
  VALUES (new.rowid, new.title, new.company_name, new.location_text, new.skills_text, new.search_text);
END;
