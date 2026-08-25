import { Hono } from "hono";
import { ingestPayloadSchema, type NormalizedJob } from "@remote-job-radar/contracts";
import { stableStringify } from "@remote-job-radar/shared";
import type { AppEnv } from "../../env";
import { deterministicId, sha256Hex } from "../../lib/crypto";
import { unixNow } from "../../lib/db";
import { ApiError } from "../../lib/errors";
import { jsonOk } from "../../lib/http";

const UPSERT_JOB_SQL = `INSERT INTO jobs (
  id, source_id, company_id, external_id, dedupe_key, canonical_url,
  title, company_name, department, location_text, employment_type,
  description_text, search_text, skills_text,
  workplace_type, remote_scope, eligible_from_korea, async_level,
  required_timezone, required_overlap_hours,
  salary_currency, salary_min, salary_max, salary_interval,
  posted_at, first_seen_at, last_seen_at, last_seen_run_id,
  missing_count, status, closed_at, score, confidence, evidence_json, content_hash,
  created_at, updated_at
) VALUES (
  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
)
ON CONFLICT(source_id, external_id) DO UPDATE SET
  dedupe_key = excluded.dedupe_key,
  canonical_url = excluded.canonical_url,
  title = excluded.title,
  company_name = excluded.company_name,
  department = excluded.department,
  location_text = excluded.location_text,
  employment_type = excluded.employment_type,
  description_text = excluded.description_text,
  search_text = excluded.search_text,
  skills_text = excluded.skills_text,
  workplace_type = excluded.workplace_type,
  remote_scope = excluded.remote_scope,
  eligible_from_korea = excluded.eligible_from_korea,
  async_level = excluded.async_level,
  required_timezone = excluded.required_timezone,
  required_overlap_hours = excluded.required_overlap_hours,
  salary_currency = excluded.salary_currency,
  salary_min = excluded.salary_min,
  salary_max = excluded.salary_max,
  salary_interval = excluded.salary_interval,
  posted_at = excluded.posted_at,
  last_seen_at = excluded.last_seen_at,
  last_seen_run_id = excluded.last_seen_run_id,
  missing_count = 0,
  status = 'open',
  closed_at = NULL,
  score = excluded.score,
  confidence = excluded.confidence,
  evidence_json = excluded.evidence_json,
  content_hash = excluded.content_hash,
  updated_at = excluded.updated_at`;

function snapshot(job: NormalizedJob): string {
  return stableStringify({
    title: job.title,
    department: job.department,
    locationText: job.locationText,
    employmentType: job.employmentType,
    descriptionText: job.descriptionText,
    workplaceType: job.workplaceType,
    remoteScope: job.remoteScope,
    eligibleFromKorea: job.eligibleFromKorea,
    asyncLevel: job.asyncLevel,
    requiredTimezone: job.requiredTimezone,
    requiredOverlapHours: job.requiredOverlapHours,
    salaryCurrency: job.salaryCurrency,
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    salaryInterval: job.salaryInterval,
    score: job.score,
    confidence: job.confidence,
    skills: job.skills,
    evidence: job.evidence,
  });
}

export const ingestRoutes = new Hono<AppEnv>();

ingestRoutes.post("/ingest", async (c) => {
  let raw: unknown;
  try {
    raw = JSON.parse(c.get("rawBody")) as unknown;
  } catch {
    throw new ApiError(422, "INVALID_JSON", "수집 payload가 JSON 형식이 아닙니다.");
  }
  const parsed = ingestPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(422, "INVALID_INGEST_PAYLOAD", "수집 payload가 스키마와 일치하지 않습니다.", parsed.error.flatten());
  }
  const payload = parsed.data;
  const idempotencyKey = c.req.header("X-Idempotency-Key") ?? "";
  if (idempotencyKey !== payload.batchId) {
    throw new ApiError(409, "IDEMPOTENCY_MISMATCH", "X-Idempotency-Key와 batchId가 일치하지 않습니다.");
  }

  const duplicate = await c.env.DB.prepare(`SELECT batch_id, run_id, source_id, job_count
    FROM ingest_batches WHERE batch_id = ?`)
    .bind(payload.batchId)
    .first<{ batch_id: string; run_id: string; source_id: string; job_count: number }>();
  if (duplicate) {
    if (duplicate.run_id !== payload.runId || duplicate.source_id !== payload.sourceId) {
      throw new ApiError(409, "IDEMPOTENCY_COLLISION", "batchId가 다른 run 또는 source에서 이미 사용되었습니다.");
    }
    throw new ApiError(409, "BATCH_ALREADY_RECEIVED", "이미 처리된 batchId입니다.");
  }

  const source = await c.env.DB.prepare(`SELECT
      s.company_id, s.lease_owner,
      sr.status AS source_run_status,
      cr.status AS crawl_run_status
    FROM sources s
    LEFT JOIN source_runs sr ON sr.run_id = ? AND sr.source_id = s.id
    LEFT JOIN crawl_runs cr ON cr.id = ?
    WHERE s.id = ?`)
    .bind(payload.runId, payload.runId, payload.sourceId)
    .first<{
      company_id: string;
      lease_owner: string | null;
      source_run_status: string | null;
      crawl_run_status: string | null;
    }>();
  if (!source) throw new ApiError(404, "SOURCE_NOT_FOUND", "수집 소스를 찾을 수 없습니다.");
  if (source.lease_owner !== payload.runId) {
    throw new ApiError(409, "LEASE_MISMATCH", "현재 수집 lease와 runId가 일치하지 않습니다.");
  }
  if (source.source_run_status !== "running" || source.crawl_run_status !== "running") {
    throw new ApiError(409, "RUN_NOT_ACTIVE", "활성 상태의 crawl/source run이 아닙니다.");
  }

  const now = unixNow();
  const statements: D1PreparedStatement[] = [];
  for (const job of payload.jobs) {
    const jobId = await deterministicId("job", `${payload.sourceId}\n${job.externalId}`);
    const dedupeKey = await sha256Hex(
      `${job.companyName.toLocaleLowerCase("en-US")}\n${job.title.toLocaleLowerCase("en-US")}\n${job.locationText ?? ""}`,
    );
    statements.push(
      c.env.DB.prepare(UPSERT_JOB_SQL).bind(
        jobId,
        payload.sourceId,
        source.company_id,
        job.externalId,
        dedupeKey,
        job.canonicalUrl,
        job.title,
        job.companyName,
        job.department,
        job.locationText,
        job.employmentType,
        job.descriptionText,
        job.searchText,
        job.skills.join(" "),
        job.workplaceType,
        job.remoteScope,
        job.eligibleFromKorea,
        job.asyncLevel,
        job.requiredTimezone,
        job.requiredOverlapHours,
        job.salaryCurrency,
        job.salaryMin,
        job.salaryMax,
        job.salaryInterval,
        job.postedAt,
        now,
        payload.fetchedAt,
        payload.runId,
        0,
        "open",
        null,
        job.score,
        job.confidence,
        JSON.stringify(job.evidence),
        job.contentHash,
        now,
        now,
      ),
    );
    statements.push(
      c.env.DB.prepare(`INSERT OR IGNORE INTO job_versions
        (job_id, content_hash, snapshot_json, observed_at) VALUES (?, ?, ?, ?)`)
        .bind(jobId, job.contentHash, snapshot(job), payload.fetchedAt),
    );
  }
  statements.push(
    c.env.DB.prepare(`INSERT INTO ingest_batches
      (batch_id, run_id, source_id, job_count, received_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(payload.batchId, payload.runId, payload.sourceId, payload.jobs.length, now),
  );

  await c.env.DB.batch(statements);
  return jsonOk(c, {
    batchId: payload.batchId,
    sourceId: payload.sourceId,
    acceptedJobs: payload.jobs.length,
    sequence: payload.sequence,
    totalBatches: payload.totalBatches,
  });
});
