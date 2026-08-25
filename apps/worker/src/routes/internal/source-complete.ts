import { Hono } from "hono";
import { sourceCompleteSchema } from "@remote-job-radar/contracts";
import type { AppEnv } from "../../env";
import { unixNow } from "../../lib/db";
import { ApiError } from "../../lib/errors";
import { jsonOk } from "../../lib/http";

interface SourceState {
  id: string;
  crawl_interval_minutes: number;
  previous_job_count: number;
  lease_owner: string | null;
  source_run_status: string | null;
  source_run_completed_at: number | null;
}

function quarantineReason(payload: ReturnType<typeof sourceCompleteSchema.parse>, storedBatches: number): string | null {
  if (payload.status === "failed" || payload.status === "quarantined") {
    return payload.errorCode ?? payload.signals[0] ?? "crawler-reported-failure";
  }
  if (payload.status === "not_modified") return null;
  if (payload.httpStatus !== null && (payload.httpStatus === 403 || payload.httpStatus === 429 || payload.httpStatus >= 500)) {
    return `http-${payload.httpStatus}`;
  }
  if (payload.expectedBatchCount !== payload.receivedBatchCount || storedBatches !== payload.expectedBatchCount) {
    return "batch-count-mismatch";
  }
  if (payload.previousJobCount >= 5 && payload.fetchedJobCount === 0) return "unexpected-zero-jobs";
  if (payload.previousJobCount >= 5 && payload.fetchedJobCount <= Math.floor(payload.previousJobCount * 0.2)) {
    return "job-count-dropped-80-percent";
  }
  const suspicious = payload.signals.find((signal) =>
    /captcha|login|required-selector-not-found|jsonld-jobposting-not-found|schema-invalid|all-title|empty-title|response-too-short/i.test(signal),
  );
  return suspicious ?? null;
}

export const sourceCompleteRoutes = new Hono<AppEnv>();

sourceCompleteRoutes.post("/source-complete", async (c) => {
  let raw: unknown;
  try {
    raw = JSON.parse(c.get("rawBody")) as unknown;
  } catch {
    throw new ApiError(422, "INVALID_JSON", "소스 완료 payload가 JSON 형식이 아닙니다.");
  }
  const parsed = sourceCompleteSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(422, "INVALID_SOURCE_COMPLETE", "소스 완료 payload가 올바르지 않습니다.", parsed.error.flatten());
  }
  const payload = parsed.data;
  const state = await c.env.DB.prepare(`SELECT s.id, s.crawl_interval_minutes, s.previous_job_count,
      s.lease_owner, sr.status AS source_run_status, sr.completed_at AS source_run_completed_at
    FROM sources s
    LEFT JOIN source_runs sr ON sr.run_id = ? AND sr.source_id = s.id
    WHERE s.id = ?`)
    .bind(payload.runId, payload.sourceId)
    .first<SourceState>();
  if (!state) throw new ApiError(404, "SOURCE_NOT_FOUND", "수집 소스를 찾을 수 없습니다.");
  if (state.source_run_completed_at) {
    return jsonOk(c, {
      sourceId: payload.sourceId,
      status: state.source_run_status ?? "completed",
      alreadyCompleted: true,
      completedAt: state.source_run_completed_at,
    });
  }
  if (!state.source_run_status) {
    throw new ApiError(409, "SOURCE_RUN_NOT_FOUND", "해당 run에 계획된 source가 아닙니다.");
  }
  if (state.lease_owner !== payload.runId) {
    throw new ApiError(409, "LEASE_MISMATCH", "현재 수집 lease와 runId가 일치하지 않습니다.");
  }

  const batchCount = await c.env.DB.prepare(`SELECT COUNT(*) AS count
    FROM ingest_batches WHERE run_id = ? AND source_id = ?`)
    .bind(payload.runId, payload.sourceId)
    .first<{ count: number }>();
  const storedBatches = Number(batchCount?.count ?? 0);
  const reason = quarantineReason(payload, storedBatches);
  const now = unixNow();
  const nextDueAt = now + Number(state.crawl_interval_minutes) * 60;
  const sourceRunId = `${payload.runId}:${payload.sourceId}`;

  if (payload.status === "not_modified" && !reason) {
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE sources SET
        etag = COALESCE(?, etag), last_modified = COALESCE(?, last_modified),
        last_success_at = ?, consecutive_failures = 0, next_due_at = ?,
        lease_owner = NULL, lease_until = NULL, status = 'active', updated_at = ?
        WHERE id = ?`)
        .bind(payload.etag, payload.lastModified, now, nextDueAt, now, payload.sourceId),
      c.env.DB.prepare(`INSERT INTO source_runs
        (id, run_id, source_id, status, http_status, fetched_job_count, previous_job_count,
         response_hash, started_at, completed_at)
        VALUES (?, ?, ?, 'not_modified', ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id, source_id) DO UPDATE SET
          status = excluded.status, http_status = excluded.http_status,
          fetched_job_count = excluded.fetched_job_count, previous_job_count = excluded.previous_job_count,
          response_hash = excluded.response_hash, completed_at = excluded.completed_at`)
        .bind(sourceRunId, payload.runId, payload.sourceId, payload.httpStatus, payload.fetchedJobCount,
          payload.previousJobCount, payload.responseHash, now, now),
      c.env.DB.prepare(`UPDATE crawl_runs SET completed_source_count = completed_source_count + 1 WHERE id = ?`)
        .bind(payload.runId),
    ]);
    return jsonOk(c, { sourceId: payload.sourceId, status: "not_modified", jobsClosed: 0, nextDueAt });
  }

  if (!reason && payload.status === "healthy") {
    const results = await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE jobs SET
        missing_count = missing_count + 1,
        status = CASE WHEN missing_count + 1 >= 2 THEN 'closed' ELSE status END,
        closed_at = CASE WHEN missing_count + 1 >= 2 THEN ? ELSE closed_at END,
        updated_at = ?
        WHERE source_id = ? AND status = 'open'
          AND (last_seen_run_id IS NULL OR last_seen_run_id <> ?)`)
        .bind(now, now, payload.sourceId, payload.runId),
      c.env.DB.prepare(`UPDATE sources SET
        etag = COALESCE(?, etag), last_modified = COALESCE(?, last_modified),
        previous_job_count = ?, last_success_at = ?, consecutive_failures = 0,
        next_due_at = ?, lease_owner = NULL, lease_until = NULL,
        status = 'active', updated_at = ? WHERE id = ?`)
        .bind(payload.etag, payload.lastModified, payload.fetchedJobCount, now, nextDueAt, now, payload.sourceId),
      c.env.DB.prepare(`INSERT INTO source_runs
        (id, run_id, source_id, status, http_status, fetched_job_count, previous_job_count,
         response_hash, started_at, completed_at)
        VALUES (?, ?, ?, 'healthy', ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id, source_id) DO UPDATE SET
          status = excluded.status, http_status = excluded.http_status,
          fetched_job_count = excluded.fetched_job_count, previous_job_count = excluded.previous_job_count,
          response_hash = excluded.response_hash, completed_at = excluded.completed_at`)
        .bind(sourceRunId, payload.runId, payload.sourceId, payload.httpStatus, payload.fetchedJobCount,
          payload.previousJobCount, payload.responseHash, now, now),
      c.env.DB.prepare(`UPDATE crawl_runs SET completed_source_count = completed_source_count + 1 WHERE id = ?`)
        .bind(payload.runId),
    ]);
    return jsonOk(c, {
      sourceId: payload.sourceId,
      status: "healthy",
      affectedMissingJobs: results[0]?.meta.changes ?? 0,
      nextDueAt,
      storedBatches,
    });
  }

  const retryMinutes = Math.max(Number(state.crawl_interval_minutes) * 2, 720);
  const retryAt = now + retryMinutes * 60;
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE sources SET
      consecutive_failures = consecutive_failures + 1,
      last_failure_at = ?, next_due_at = ?, lease_owner = NULL, lease_until = NULL,
      status = 'quarantined', updated_at = ? WHERE id = ?`)
      .bind(now, retryAt, now, payload.sourceId),
    c.env.DB.prepare(`INSERT INTO source_runs
      (id, run_id, source_id, status, http_status, fetched_job_count, previous_job_count,
       response_hash, error_code, error_message, started_at, completed_at)
      VALUES (?, ?, ?, 'quarantined', ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id, source_id) DO UPDATE SET
        status = excluded.status, http_status = excluded.http_status,
        fetched_job_count = excluded.fetched_job_count, previous_job_count = excluded.previous_job_count,
        response_hash = excluded.response_hash, error_code = excluded.error_code,
        error_message = excluded.error_message, completed_at = excluded.completed_at`)
      .bind(sourceRunId, payload.runId, payload.sourceId, payload.httpStatus, payload.fetchedJobCount,
        payload.previousJobCount, payload.responseHash, reason ?? payload.errorCode ?? "unknown",
        payload.errorMessage ?? payload.signals.join("; "), now, now),
    c.env.DB.prepare(`UPDATE crawl_runs SET failed_source_count = failed_source_count + 1 WHERE id = ?`)
      .bind(payload.runId),
  ]);
  return jsonOk(c, {
    sourceId: payload.sourceId,
    status: "quarantined",
    reason: reason ?? "unknown",
    jobsClosed: 0,
    retryAt,
  });
});
