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
  const leaseSeconds = runner === "browser" ? 45 * 60 : 30 * 60;
  const githubRunId = c.req.header("X-GitHub-Run-Id") ?? null;
  const triggerType = c.req.header("X-GitHub-Event") ?? "manual";
  const browserRequired = runner === "browser" ? 1 : 0;

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
      s.config_json, s.etag, s.last_modified, s.previous_job_count, s.browser_required
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
    etag: row.etag,
    lastModified: row.last_modified,
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
