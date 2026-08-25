import { Hono, type Context } from "hono";
import { runCompleteSchema } from "@remote-job-radar/contracts";
import type { AppEnv } from "../../env";
import { unixNow } from "../../lib/db";
import { ApiError } from "../../lib/errors";
import { jsonOk } from "../../lib/http";

interface CrawlRunState {
  id: string;
  planned_source_count: number;
  completed_source_count: number;
  failed_source_count: number;
  completed_at: number | null;
  status: string;
}

export const runRoutes = new Hono<AppEnv>();

async function completeRun(c: Context<AppEnv>) {
  let raw: unknown;
  try {
    raw = JSON.parse(c.get("rawBody")) as unknown;
  } catch {
    throw new ApiError(422, "INVALID_JSON", "run 완료 payload가 JSON 형식이 아닙니다.");
  }
  const parsed = runCompleteSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(422, "INVALID_RUN_COMPLETE", "run 완료 payload가 올바르지 않습니다.", parsed.error.flatten());
  }

  const state = await c.env.DB.prepare(`SELECT id, planned_source_count, completed_source_count,
      failed_source_count, completed_at, status
    FROM crawl_runs WHERE id = ?`)
    .bind(parsed.data.runId)
    .first<CrawlRunState>();
  if (!state) throw new ApiError(404, "RUN_NOT_FOUND", "crawl run을 찾을 수 없습니다.");

  if (state.completed_at !== null) {
    const sameResult = state.status === parsed.data.status &&
      Number(state.completed_source_count) === parsed.data.completedSourceCount &&
      Number(state.failed_source_count) === parsed.data.failedSourceCount;
    if (!sameResult) {
      throw new ApiError(409, "RUN_ALREADY_FINALIZED", "이미 다른 결과로 완료된 crawl run입니다.");
    }
    return jsonOk(c, {
      ...parsed.data,
      completedAt: state.completed_at,
      alreadyCompleted: true,
      danglingSourcesScheduledForRetry: 0,
    });
  }

  const reportedTotal = parsed.data.completedSourceCount + parsed.data.failedSourceCount;
  if (reportedTotal !== Number(state.planned_source_count)) {
    throw new ApiError(409, "RUN_COUNT_MISMATCH", "완료·실패 수의 합이 계획된 소스 수와 일치하지 않습니다.", {
      plannedSourceCount: Number(state.planned_source_count),
      reportedTotal,
    });
  }
  if (parsed.data.status === "completed" && parsed.data.failedSourceCount !== 0) {
    throw new ApiError(422, "INVALID_RUN_STATUS", "completed run에는 실패한 소스가 있을 수 없습니다.");
  }
  if (parsed.data.status === "partial" &&
      (parsed.data.completedSourceCount === 0 || parsed.data.failedSourceCount === 0)) {
    throw new ApiError(422, "INVALID_RUN_STATUS", "partial run에는 성공과 실패 소스가 모두 있어야 합니다.");
  }

  const now = unixNow();
  const dangling = await c.env.DB.prepare(`SELECT COUNT(*) AS count
    FROM source_runs WHERE run_id = ? AND status = 'running'`)
    .bind(parsed.data.runId)
    .first<{ count: number }>();
  const danglingCount = Number(dangling?.count ?? 0);

  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE sources SET
      consecutive_failures = consecutive_failures + 1,
      last_failure_at = ?, next_due_at = ? + MAX(crawl_interval_minutes, 720) * 60,
      lease_owner = NULL, lease_until = NULL,
      status = 'active', updated_at = ?
      WHERE lease_owner = ? AND id IN (
        SELECT source_id FROM source_runs WHERE run_id = ? AND status = 'running'
      )`)
      .bind(now, now, now, parsed.data.runId, parsed.data.runId),
    c.env.DB.prepare(`UPDATE source_runs SET
      status = 'failed', error_code = 'run-finalized-without-source-complete',
      error_message = 'The crawler run ended before source-complete was accepted; retry scheduled.',
      completed_at = ?
      WHERE run_id = ? AND status = 'running'`)
      .bind(now, parsed.data.runId),
    c.env.DB.prepare(`UPDATE crawl_runs SET
      completed_source_count = ?, failed_source_count = ?, completed_at = ?, status = ?
      WHERE id = ? AND completed_at IS NULL`)
      .bind(
        parsed.data.completedSourceCount,
        parsed.data.failedSourceCount,
        now,
        parsed.data.status,
        parsed.data.runId,
      ),
  ]);

  return jsonOk(c, {
    ...parsed.data,
    completedAt: now,
    danglingSourcesScheduledForRetry: danglingCount,
  });
}

runRoutes.post("/run-complete", completeRun);
runRoutes.post("/run-failed", completeRun);
