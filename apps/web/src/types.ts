export interface Evidence {
  field: string;
  effect: number;
  text: string;
  source: string;
}

export interface JobSummary {
  id: string;
  source_id: string;
  company_id: string;
  external_id: string;
  canonical_url: string;
  title: string;
  company_name: string;
  department: string | null;
  location_text: string | null;
  employment_type: string | null;
  workplace_type: "remote" | "hybrid" | "onsite" | "unknown";
  remote_scope: "worldwide" | "apac" | "country-list" | "region-limited" | "unknown";
  eligible_from_korea: "yes" | "likely" | "unknown" | "no";
  async_level: "explicit" | "strong" | "weak" | "synchronous" | "unknown";
  required_timezone: string | null;
  required_overlap_hours: number | null;
  salary_currency: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_interval: string | null;
  posted_at: number | null;
  first_seen_at: number;
  last_seen_at: number;
  status: "open" | "closed";
  score: number;
  confidence: number;
  skills_text: string;
  evidence: Evidence[];
  content_hash: string;
  action: "saved" | "dismissed" | "applied" | null;
  dismiss_reason: string | null;
  notes: string | null;
  applied_at: number | null;
  version_count: number;
}

export interface JobDetail extends JobSummary {
  description_text: string;
  search_text: string;
  source_kind: string;
  source_url: string;
  source_status: string;
  careers_url: string | null;
  remote_policy_url: string | null;
}

export interface JobsPage {
  items: JobSummary[];
  nextCursor: string | null;
}

export interface Dashboard {
  jobs: Record<string, number>;
  actions: Record<string, number>;
  sources: Record<string, number>;
  recentRuns: Array<Record<string, unknown>>;
}

export interface CompanyRow {
  id: string;
  slug: string;
  name: string;
  careers_url: string | null;
  remote_policy_url: string | null;
  priority: number;
  active: number;
  source_count: number;
  open_job_count: number;
}

export interface SourceRow {
  id: string;
  company_id: string;
  company_name: string;
  company_active: number;
  kind: string;
  url: string;
  adapter_key: string | null;
  config: Record<string, unknown>;
  browser_required: number;
  crawl_interval_minutes: number;
  etag: string | null;
  last_modified: string | null;
  previous_job_count: number;
  consecutive_failures: number;
  last_success_at: number | null;
  last_failure_at: number | null;
  next_due_at: number;
  status: "active" | "paused" | "quarantined" | "disabled";
  last_http_status: number | null;
  last_error_code: string | null;
  last_error_message: string | null;
}

export interface JobFilters {
  q: string;
  status: string;
  minScore: number;
  eligibility: string[];
  async: string[];
  remoteScope: string[];
  skills: string[];
  action: string;
  changed: boolean;
}
