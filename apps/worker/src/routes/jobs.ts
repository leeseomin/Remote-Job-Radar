import { Hono } from "hono";
import { jobActionSchema } from "@remote-job-radar/contracts";
import type { AppEnv } from "../env";
import { decodeCursor, encodeCursor } from "../lib/cursor";
import { parseJson, placeholders, unixNow } from "../lib/db";
import { ApiError } from "../lib/errors";
import { csv, jsonOk, parsePositiveInt, safeFtsQuery } from "../lib/http";

interface JobRow extends Record<string, unknown> {
  id: string;
  score: number;
  first_seen_at: number;
  evidence_json: string;
  action: string | null;
}

function serializeJob(row: JobRow) {
  return {
    ...row,
    evidence: parseJson(row.evidence_json, []),
    evidence_json: undefined,
  };
}

export const jobsRoutes = new Hono<AppEnv>();

jobsRoutes.get("/", async (c) => {
  const query = c.req.query();
  const limit = parsePositiveInt(query.limit, 50, 1, 100);
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  const search = (query.q ?? "").trim();
  const from = search
    ? "FROM jobs_fts JOIN jobs j ON j.rowid = jobs_fts.rowid LEFT JOIN job_actions ja ON ja.job_id = j.id"
    : "FROM jobs j LEFT JOIN job_actions ja ON ja.job_id = j.id";

  if (search) {
    const fts = safeFtsQuery(search);
    if (fts) {
      conditions.push("jobs_fts MATCH ?");
      bindings.push(fts);
    }
  }

  const status = query.status ?? "open";
  if (status !== "all") {
    conditions.push("j.status = ?");
    bindings.push(status);
  }
  if (query.minScore) {
    conditions.push("j.score >= ?");
    bindings.push(parsePositiveInt(query.minScore, 0, 0, 100));
  }

  const eligibility = csv(query.eligibility);
  if (eligibility.length > 0) {
    conditions.push(`j.eligible_from_korea IN (${placeholders(eligibility.length)})`);
    bindings.push(...eligibility);
  }
  const asyncLevels = csv(query.async);
  if (asyncLevels.length > 0) {
    conditions.push(`j.async_level IN (${placeholders(asyncLevels.length)})`);
    bindings.push(...asyncLevels);
  }
  const scopes = csv(query.remoteScope);
  if (scopes.length > 0) {
    conditions.push(`j.remote_scope IN (${placeholders(scopes.length)})`);
    bindings.push(...scopes);
  }
  if (query.companyId) {
    conditions.push("j.company_id = ?");
    bindings.push(query.companyId);
  }
  if (query.action === "none") {
    conditions.push("ja.action IS NULL");
  } else if (query.action) {
    conditions.push("ja.action = ?");
    bindings.push(query.action);
  }
  const skills = csv(query.skills).slice(0, 10);
  if (skills.length > 0) {
    conditions.push(`(${skills.map(() => "LOWER(j.skills_text) LIKE ?").join(" OR ")})`);
    bindings.push(...skills.map((skill) => `%${skill.toLocaleLowerCase("en-US")}%`));
  }
  if (query.changed === "true") {
    conditions.push("(SELECT COUNT(*) FROM job_versions v WHERE v.job_id = j.id) > 1");
  }

  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    conditions.push(`(
      j.score < ? OR
      (j.score = ? AND j.first_seen_at < ?) OR
      (j.score = ? AND j.first_seen_at = ? AND j.id < ?)
    )`);
    bindings.push(
      cursor.score,
      cursor.score,
      cursor.firstSeenAt,
      cursor.score,
      cursor.firstSeenAt,
      cursor.id,
    );
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const sql = `SELECT
    j.id, j.source_id, j.company_id, j.external_id, j.canonical_url,
    j.title, j.company_name, j.department, j.location_text, j.employment_type,
    j.workplace_type, j.remote_scope, j.eligible_from_korea, j.async_level,
    j.required_timezone, j.required_overlap_hours, j.salary_currency,
    j.salary_min, j.salary_max, j.salary_interval, j.posted_at,
    j.first_seen_at, j.last_seen_at, j.status, j.score, j.confidence,
    j.skills_text, j.evidence_json, j.content_hash,
    ja.action, ja.dismiss_reason, ja.notes, ja.applied_at, ja.updated_at AS action_updated_at,
    (SELECT COUNT(*) FROM job_versions v WHERE v.job_id = j.id) AS version_count
    ${from} ${where}
    ORDER BY j.score DESC, j.first_seen_at DESC, j.id DESC
    LIMIT ?`;
  bindings.push(limit + 1);

  const result = await c.env.DB.prepare(sql).bind(...bindings).all<JobRow>();
  const rows = result.results ?? [];
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map(serializeJob);
  const last = rows[Math.min(limit, rows.length) - 1];
  const nextCursor = hasMore && last
    ? encodeCursor({ score: Number(last.score), firstSeenAt: Number(last.first_seen_at), id: String(last.id) })
    : null;
  return jsonOk(c, { items, nextCursor });
});

jobsRoutes.get("/:id", async (c) => {
  const row = await c.env.DB.prepare(`SELECT
    j.*, ja.action, ja.dismiss_reason, ja.notes, ja.applied_at,
    (SELECT COUNT(*) FROM job_versions v WHERE v.job_id = j.id) AS version_count,
    c.careers_url, c.remote_policy_url,
    s.kind AS source_kind, s.url AS source_url, s.status AS source_status
    FROM jobs j
    LEFT JOIN job_actions ja ON ja.job_id = j.id
    JOIN companies c ON c.id = j.company_id
    JOIN sources s ON s.id = j.source_id
    WHERE j.id = ?`).bind(c.req.param("id")).first<JobRow>();
  if (!row) throw new ApiError(404, "JOB_NOT_FOUND", "공고를 찾을 수 없습니다.");
  return jsonOk(c, serializeJob(row));
});

jobsRoutes.get("/:id/versions", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT content_hash, snapshot_json, observed_at
    FROM job_versions WHERE job_id = ? ORDER BY observed_at DESC LIMIT 20`)
    .bind(c.req.param("id"))
    .all<{ content_hash: string; snapshot_json: string; observed_at: number }>();
  return jsonOk(c, (rows.results ?? []).map((row) => ({
    contentHash: row.content_hash,
    snapshot: parseJson(row.snapshot_json, {}),
    observedAt: row.observed_at,
  })));
});

jobsRoutes.patch("/:id/action", async (c) => {
  const parsed = jobActionSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(422, "INVALID_ACTION", "공고 상태 입력이 올바르지 않습니다.", parsed.error.flatten());
  const exists = await c.env.DB.prepare("SELECT id FROM jobs WHERE id = ?").bind(c.req.param("id")).first();
  if (!exists) throw new ApiError(404, "JOB_NOT_FOUND", "공고를 찾을 수 없습니다.");
  const now = unixNow();
  const appliedAt = parsed.data.action === "applied" ? parsed.data.appliedAt ?? now : null;
  await c.env.DB.prepare(`INSERT INTO job_actions(job_id, action, dismiss_reason, notes, applied_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(job_id) DO UPDATE SET
      action = excluded.action,
      dismiss_reason = excluded.dismiss_reason,
      notes = excluded.notes,
      applied_at = excluded.applied_at,
      updated_at = excluded.updated_at`)
    .bind(
      c.req.param("id"),
      parsed.data.action,
      parsed.data.dismissReason ?? null,
      parsed.data.notes ?? null,
      appliedAt,
      now,
    )
    .run();
  return jsonOk(c, { jobId: c.req.param("id"), ...parsed.data, appliedAt, updatedAt: now });
});

jobsRoutes.delete("/:id/action", async (c) => {
  await c.env.DB.prepare("DELETE FROM job_actions WHERE job_id = ?").bind(c.req.param("id")).run();
  return jsonOk(c, { jobId: c.req.param("id"), removed: true });
});
