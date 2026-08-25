PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO companies
  (id, slug, name, careers_url, remote_policy_url, priority, active, created_at, updated_at)
VALUES
  ('company_vector_forge', 'vector-forge', 'Vector Forge', 'https://example.invalid/vector-forge/careers', NULL, 90, 1, 1786579200, 1786579200),
  ('company_open_canvas', 'open-canvas-labs', 'Open Canvas Labs', 'https://example.invalid/open-canvas/jobs', NULL, 80, 1, 1786579200, 1786579200),
  ('company_northstar', 'northstar-tools', 'Northstar Tools', 'https://example.invalid/northstar/careers', NULL, 70, 1, 1786579200, 1786579200);

INSERT OR IGNORE INTO sources
  (id, company_id, kind, url, adapter_key, config_json, browser_required, crawl_interval_minutes,
   previous_job_count, consecutive_failures, next_due_at, status, created_at, updated_at)
VALUES
  ('source_vector_forge', 'company_vector_forge', 'greenhouse', 'https://example.invalid/vector-forge/careers', 'vectorforge', '{}', 0, 720, 2, 0, 4102444800, 'paused', 1786579200, 1786579200),
  ('source_open_canvas', 'company_open_canvas', 'jsonld', 'https://example.invalid/open-canvas/jobs', NULL, '{}', 0, 720, 1, 0, 4102444800, 'paused', 1786579200, 1786579200),
  ('source_northstar', 'company_northstar', 'playwright', 'https://example.invalid/northstar/careers', NULL, '{"listSelector":".job-card","titleSelector":".title","linkSelector":"a"}', 1, 1440, 1, 1, 4102444800, 'quarantined', 1786579200, 1786579200);

INSERT OR IGNORE INTO jobs
  (id, source_id, company_id, external_id, dedupe_key, canonical_url, title, company_name, department,
   location_text, employment_type, description_text, search_text, skills_text, workplace_type,
   remote_scope, eligible_from_korea, async_level, required_timezone, required_overlap_hours,
   salary_currency, salary_min, salary_max, salary_interval, posted_at, first_seen_at, last_seen_at,
   last_seen_run_id, missing_count, status, closed_at, score, confidence, evidence_json, content_hash,
   created_at, updated_at)
VALUES
  ('job_demo_1', 'source_vector_forge', 'company_vector_forge', 'vf-frontend-1', 'vector-forge|frontend-graphics|worldwide',
   'https://example.invalid/jobs/vf-frontend-1', 'Frontend Engineer — Graphics', 'Vector Forge', 'Product Engineering',
   'Remote — Worldwide', 'Full-time',
   'Build browser-based creative tools with Vue, TypeScript, Three.js, WebGL and GLSL. We are async-first with no core hours. Own features from 0→1. Salary range USD 120,000–160,000.',
   'frontend graphics vue typescript three.js webgl glsl remote worldwide async-first no core hours product ownership salary',
   'Vue TypeScript Three.js WebGL GLSL', 'remote', 'worldwide', 'yes', 'explicit', NULL, NULL,
   'USD', 120000, 160000, 'year', 1786406400, 1786492800, 1786579200, 'seed_run', 0, 'open', NULL, 100, 0.96,
   '[{"field":"eligibleFromKorea","effect":30,"text":"Worldwide Remote","source":"location"},{"field":"asyncLevel","effect":25,"text":"Async-first with no core hours","source":"job-description"},{"field":"skills","effect":15,"text":"Three.js · WebGL · GLSL","source":"job-description"}]',
   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 1786492800, 1786579200),
  ('job_demo_2', 'source_vector_forge', 'company_vector_forge', 'vf-product-2', 'vector-forge|product-engineer|apac',
   'https://example.invalid/jobs/vf-product-2', 'Product Engineer', 'Vector Forge', 'Product Engineering',
   'Remote — APAC', 'Full-time',
   'Ship customer-facing product workflows. Documentation-first team with flexible schedules. TypeScript, Vue, Canvas and SVG.',
   'product engineer remote apac documentation-first flexible schedule typescript vue canvas svg',
   'TypeScript Vue Canvas SVG', 'remote', 'apac', 'likely', 'strong', NULL, NULL,
   NULL, NULL, NULL, NULL, 1786320000, 1786406400, 1786579200, 'seed_run', 0, 'open', NULL, 80, 0.86,
   '[{"field":"eligibleFromKorea","effect":22,"text":"APAC Remote","source":"location"},{"field":"asyncLevel","effect":20,"text":"Documentation-first with flexible schedules","source":"job-description"}]',
   'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 1786406400, 1786579200),
  ('job_demo_3', 'source_open_canvas', 'company_open_canvas', 'oc-visualization-3', 'open-canvas|visualization-engineer|global',
   'https://example.invalid/jobs/oc-visualization-3', 'Visualization Engineer', 'Open Canvas Labs', 'R&D',
   'Global Remote', 'Contract',
   'Create WebGPU visualization prototypes and reusable TypeScript components. Written communication is preferred.',
   'visualization engineer webgpu typescript global remote written communication',
   'WebGPU TypeScript Visualization', 'remote', 'worldwide', 'yes', 'weak', NULL, NULL,
   'USD', 80, 120, 'hour', 1786233600, 1786320000, 1786579200, 'seed_run', 0, 'open', NULL, 83, 0.84,
   '[{"field":"skills","effect":15,"text":"WebGPU · Visualization","source":"job-description"}]',
   'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', 1786320000, 1786579200),
  ('job_demo_4', 'source_open_canvas', 'company_open_canvas', 'oc-backend-4', 'open-canvas|backend|us-only',
   'https://example.invalid/jobs/oc-backend-4', 'Backend Product Engineer', 'Open Canvas Labs', 'Platform',
   'Remote within the United States only', 'Full-time',
   'Backend systems role. Must overlap 5 hours with PST and attend a daily stand-up.',
   'backend product engineer remote united states only overlap pst daily stand-up',
   'Backend', 'remote', 'region-limited', 'no', 'synchronous', 'PST', 5,
   'USD', 150000, 190000, 'year', 1786147200, 1786233600, 1786579200, 'seed_run', 0, 'open', NULL, 0, 0.82,
   '[{"field":"eligibleFromKorea","effect":-40,"text":"United States only","source":"location"},{"field":"timezoneOverlap","effect":-15,"text":"PST 5 hours overlap","source":"job-description"}]',
   'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', 1786233600, 1786579200);

INSERT OR IGNORE INTO job_versions(job_id, content_hash, snapshot_json, observed_at)
SELECT id, content_hash, json_object('title', title, 'descriptionText', description_text, 'score', score), updated_at
FROM jobs;

INSERT OR IGNORE INTO job_actions(job_id, action, dismiss_reason, notes, applied_at, updated_at)
VALUES ('job_demo_2', 'saved', NULL, '포트폴리오의 Vue/Canvas 경험과 잘 맞음', NULL, 1786579200);
