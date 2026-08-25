import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { parseJson, unixNow } from "../../lib/db";
import { ApiError } from "../../lib/errors";
import { jsonOk, parsePositiveInt } from "../../lib/http";

interface PlannedSourceRow extends Record<string, unknown> {
  id: string;
  company_id: string;
  company_name: string;
  kind: string;
  url: string;
  adapter_key: string | null;
  config_json: string;
  etag: string | null;
  last_modified: string | null;
  content_fingerprint: string | null;
  snapshot_run_id: string | null;
  previous_job_count: number;
  browser_required: number;
}

export const crawlPlanRoutes = new Hono<AppEnv>();

crawlPlanRoutes.get("/crawl-plan", async (c) => {
  const runner = c.req.query("runner") ?? "fast";
  if (runner !== "fast" && runner !== "browser") {
    throw new ApiError(422, "INVALID_RUNNER", "runner는 fast 또는 browser여야 합니다.");
  }
  const limit = parsePositiveInt(c.req.query("limit"), 200, 1, 200);
  const now = unixNow();
  const crawlRequestId = c.req.header("X-Crawl-Request-Id") ?? crypto.randomUUID();
  if (!/^[a-zA-Z0-9_-]{12,120}$/.test(crawlRequestId)) {
    throw new ApiError(422, "INVALID_CRAWL_REQUEST_ID", "X-Crawl-Request-Id 형식이 올바르지 않습니다.");
  }
  const runId = `run_${runner}_${crawlRequestId}`;
  // Keep the lease longer than the corresponding Actions job timeout so a
  // second scheduled run cannot reclaim a source while it is still ingesting.
  const leaseSeconds = runner === "browser" ? 90 * 60 : 60 * 60;
  const githubRunId = c.req.header("X-GitHub-Run-Id") ?? null;
  const triggerType = c.req.header("X-GitHub-Event") ?? "manual";
  const browserRequired = runner === "browser" ? 1 : 0;

  // An expired lease means the previous crawler stopped before source-complete
  // could prove that every batch was committed. Force a full response/ingest
  // before the source is leased again so a partial snapshot cannot be reused.
  await c.env.DB.prepare(`UPDATE sources SET
      etag = NULL, last_modified = NULL, content_fingerprint = NULL, snapshot_run_id = NULL,
      lease_owner = NULL, lease_until = NULL, updated_at = ?
    WHERE lease_owner IS NOT NULL AND (lease_until IS NULL OR lease_until < ?)`)
    .bind(now, now)
    .run();

  await c.env.DB.prepare(`INSERT OR IGNORE INTO crawl_runs
    (id, runner_type, trigger_type, github_run_id, started_at, status)
    VALUES (?, ?, ?, ?, ?, 'running')`)
    .bind(runId, runner, triggerType, githubRunId, now)
    .run();

  await c.env.DB.prepare(`UPDATE sources SET
      lease_owner = ?, lease_until = ?, updated_at = ?
    WHERE id IN (
      SELECT id FROM sources
      WHERE status = 'active'
        AND next_due_at <= ?
        AND (lease_owner = ? OR lease_until IS NULL OR lease_until < ?)
        AND browser_required = ?
        AND company_id IN (SELECT id FROM companies WHERE active = 1)
      ORDER BY next_due_at ASC, id ASC
      LIMIT ?
    )`)
    .bind(runId, now + leaseSeconds, now, now, runId, now, browserRequired, limit)
    .run();

  const planned = await c.env.DB.prepare(`SELECT
      s.id, s.company_id, c.name AS company_name, s.kind, s.url, s.adapter_key,
      s.config_json, s.etag, s.last_modified, s.content_fingerprint, s.snapshot_run_id,
      s.previous_job_count, s.browser_required
    FROM sources s JOIN companies c ON c.id = s.company_id
    WHERE s.lease_owner = ?
    ORDER BY c.priority DESC, s.next_due_at ASC, s.id ASC`)
    .bind(runId)
    .all<PlannedSourceRow>();

  await c.env.DB.prepare(`INSERT OR IGNORE INTO source_runs
      (id, run_id, source_id, status, previous_job_count, started_at)
    SELECT ? || ':' || id, ?, id, 'running', previous_job_count, ?
    FROM sources WHERE lease_owner = ?`)
    .bind(runId, runId, now, runId)
    .run();

  const sources = (planned.results ?? []).map((row) => ({
    id: row.id,
    companyId: row.company_id,
    companyName: row.company_name,
    adapter: row.kind,
    url: row.url,
    adapterKey: row.adapter_key,
    config: parseJson(row.config_json, {}),
    // A migrated source has no known full snapshot yet. Suppressing validators
    // forces one full response so snapshot_run_id and content_fingerprint can
    // be initialized instead of receiving HTTP 304 forever.
    etag: row.snapshot_run_id && row.content_fingerprint ? row.etag : null,
    lastModified: row.snapshot_run_id && row.content_fingerprint ? row.last_modified : null,
    contentFingerprint: row.content_fingerprint,
    snapshotRunId: row.snapshot_run_id,
    previousJobCount: Number(row.previous_job_count ?? 0),
    browserRequired: Boolean(row.browser_required),
  }));

  await c.env.DB.prepare(`UPDATE crawl_runs SET planned_source_count = ? WHERE id = ?`)
    .bind(sources.length, runId)
    .run();

  return jsonOk(c, {
    runId,
    runner,
    leaseExpiresAt: now + leaseSeconds,
    sources,
  });
});
