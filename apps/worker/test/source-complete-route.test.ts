import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AppEnv, Bindings } from "../src/env";
import { sourceCompleteRoutes } from "../src/routes/internal/source-complete";

interface CapturedStatement {
  sql: string;
  values: unknown[];
}

class SqliteD1Statement {
  private values: unknown[] = [];

  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]): this {
    this.values = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    const row = this.database.prepare(this.sql).get(...this.values as never[]);
    return (row as T | undefined) ?? null;
  }

  async all<T>(): Promise<{ results: T[]; success: true; meta: Record<string, unknown> }> {
    const rows = this.database.prepare(this.sql).all(...this.values as never[]);
    return { results: rows as T[], success: true, meta: {} };
  }

  async run(): Promise<{ success: true; meta: { changes: number } }> {
    const result = this.database.prepare(this.sql).run(...this.values as never[]);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

class SqliteD1Adapter {
  constructor(private readonly database: DatabaseSync) {}

  prepare(sql: string): SqliteD1Statement {
    return new SqliteD1Statement(this.database, sql);
  }

  async batch(statements: D1PreparedStatement[]): Promise<Array<{ success: true; meta: { changes: number } }>> {
    const results = [];
    for (const statement of statements) {
      results.push(await (statement as unknown as SqliteD1Statement).run());
    }
    return results;
  }
}

function routeApp() {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("requestId", "request_test");
    c.set("rawBody", await c.req.text());
    await next();
  });
  app.route("/", sourceCompleteRoutes);
  return app;
}

function workerWithFakeDb(storedBatches = 0) {
  const captured: CapturedStatement[] = [];
  const db = {
    prepare(sql: string) {
      const capture: CapturedStatement = { sql, values: [] };
      captured.push(capture);
      const statement = {
        bind(...values: unknown[]) {
          capture.values = values;
          return statement;
        },
        async first() {
          if (sql.includes("FROM sources s")) {
            return {
              id: "source_test",
              crawl_interval_minutes: 720,
              previous_job_count: 10,
              content_fingerprint: "a".repeat(64),
              snapshot_run_id: "run_previous",
              lease_owner: "run_fast_test",
              source_run_status: "running",
              source_run_completed_at: null,
            };
          }
          if (sql.includes("FROM ingest_batches")) return { count: storedBatches };
          return null;
        },
      };
      return statement;
    },
    async batch(statements: unknown[]) {
      return statements.map(() => ({ meta: { changes: 1 } }));
    },
  } as unknown as D1Database;

  const app = routeApp();

  const bindings = { DB: db } as unknown as Bindings;
  return { app, bindings, captured };
}

describe("source-complete retry transition", () => {
  it("keeps a transiently failed source active for crawl-plan retry", async () => {
    const { app, bindings, captured } = workerWithFakeDb();
    const before = Math.floor(Date.now() / 1_000);
    const response = await app.request("http://worker.test/source-complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runId: "run_fast_test",
        sourceId: "source_test",
        status: "failed",
        httpStatus: 503,
        fetchedJobCount: 0,
        previousJobCount: 10,
        receivedBatchCount: 0,
        expectedBatchCount: 0,
        responseHash: null,
        etag: null,
        lastModified: null,
        contentFingerprint: null,
        errorCode: "crawler-error",
        errorMessage: "HTTP 503",
        signals: [],
      }),
    }, bindings);

    expect(response.status).toBe(200);
    const body = await response.json() as {
      data: { status: string; reason: string; retryAt: number };
    };
    expect(body.data).toMatchObject({ status: "retry_scheduled", reason: "http-503" });
    expect(body.data.retryAt).toBeGreaterThanOrEqual(before + 12 * 60 * 60);
    expect(body.data.retryAt).toBeLessThanOrEqual(before + 12 * 60 * 60 + 1);

    const sourceUpdate = captured.find((statement) =>
      statement.sql.includes("UPDATE sources SET") && statement.sql.includes("consecutive_failures"));
    expect(sourceUpdate?.sql).toContain("status = 'active'");
    expect(sourceUpdate?.sql).not.toContain("status = 'quarantined'");
    expect(sourceUpdate?.sql).not.toContain("content_fingerprint");

    const sourceRunUpdate = captured.find((statement) => statement.sql.includes("INSERT INTO source_runs"));
    expect(sourceRunUpdate?.sql).toContain("'failed'");
  });

  it("stores fingerprint and snapshot run only after a healthy completion", async () => {
    const { app, bindings, captured } = workerWithFakeDb();
    const fingerprint = "b".repeat(64);
    const response = await app.request("http://worker.test/source-complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runId: "run_fast_test",
        sourceId: "source_test",
        status: "healthy",
        httpStatus: 200,
        fetchedJobCount: 10,
        previousJobCount: 10,
        receivedBatchCount: 0,
        expectedBatchCount: 0,
        responseHash: "response-hash",
        etag: null,
        lastModified: null,
        contentFingerprint: fingerprint,
        errorCode: null,
        errorMessage: null,
        signals: [],
      }),
    }, bindings);

    expect(response.status).toBe(200);
    const sourceUpdate = captured.find((statement) =>
      statement.sql.includes("UPDATE sources SET") && statement.sql.includes("snapshot_run_id"));
    expect(sourceUpdate?.sql).toContain("content_fingerprint = COALESCE(?, content_fingerprint)");
    expect(sourceUpdate?.values).toContain(fingerprint);
    expect(sourceUpdate?.values).toContain("run_fast_test");
  });

  it("invalidates snapshot metadata after a partially ingested failed run", async () => {
    const { app, bindings, captured } = workerWithFakeDb(1);
    const response = await app.request("http://worker.test/source-complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runId: "run_fast_test",
        sourceId: "source_test",
        status: "failed",
        httpStatus: null,
        fetchedJobCount: 10,
        previousJobCount: 10,
        receivedBatchCount: 1,
        expectedBatchCount: 2,
        responseHash: "response-hash",
        etag: "etag-new",
        lastModified: "last-modified-new",
        contentFingerprint: null,
        errorCode: "crawler-error",
        errorMessage: "second ingest batch failed",
        signals: [],
      }),
    }, bindings);

    expect(response.status).toBe(200);
    const sourceUpdate = captured.find((statement) =>
      statement.sql.includes("UPDATE sources SET") && statement.sql.includes("consecutive_failures"));
    expect(sourceUpdate?.sql).toContain("etag = NULL");
    expect(sourceUpdate?.sql).toContain("last_modified = NULL");
    expect(sourceUpdate?.sql).toContain("content_fingerprint = NULL");
    expect(sourceUpdate?.sql).toContain("snapshot_run_id = NULL");
  });

  it("rejects an unproven not-modified snapshot and schedules a full retry", async () => {
    const { app, bindings, captured } = workerWithFakeDb();
    const response = await app.request("http://worker.test/source-complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runId: "run_fast_test",
        sourceId: "source_test",
        status: "not_modified",
        httpStatus: 200,
        fetchedJobCount: 10,
        previousJobCount: 10,
        receivedBatchCount: 0,
        expectedBatchCount: 0,
        responseHash: "response-hash",
        etag: "etag-new",
        lastModified: "last-modified-new",
        contentFingerprint: "b".repeat(64),
        errorCode: null,
        errorMessage: null,
        signals: [],
      }),
    }, bindings);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        status: "retry_scheduled",
        reason: "not-modified-snapshot-mismatch",
      },
    });
    const sourceUpdate = captured.find((statement) =>
      statement.sql.includes("UPDATE sources SET") && statement.sql.includes("consecutive_failures"));
    expect(sourceUpdate?.sql).toContain("content_fingerprint = NULL");
    expect(sourceUpdate?.sql).toContain("snapshot_run_id = NULL");
  });
});

describe("source-complete unchanged snapshot", () => {
  it("keeps present jobs open and closes a job missing from the same snapshot twice", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      for (const migration of [
        "../../../packages/db/migrations/0001_initial.sql",
        "../../../packages/db/migrations/0002_fts_and_retention.sql",
        "../../../packages/db/migrations/0003_source_content_fingerprint.sql",
      ]) {
        database.exec(readFileSync(new URL(migration, import.meta.url), "utf8"));
      }

      const fingerprint = "a".repeat(64);
      database.exec(`
        INSERT INTO companies (id, slug, name, created_at, updated_at)
        VALUES ('company_test', 'test', 'Test Company', 1, 1);
        INSERT INTO sources (
          id, company_id, kind, url, previous_job_count, next_due_at,
          lease_owner, lease_until, content_fingerprint, snapshot_run_id,
          created_at, updated_at
        ) VALUES (
          'source_test', 'company_test', 'greenhouse', 'https://example.com/jobs', 1, 1,
          'run_same_2', 9999999999, '${fingerprint}', 'run_full_1', 1, 1
        );
        INSERT INTO crawl_runs (id, runner_type, trigger_type, started_at, status)
        VALUES ('run_same_2', 'fast', 'test', 1, 'running');
        INSERT INTO source_runs (id, run_id, source_id, status, previous_job_count, started_at)
        VALUES ('run_same_2:source_test', 'run_same_2', 'source_test', 'running', 1, 1);
        INSERT INTO jobs (
          id, source_id, company_id, external_id, dedupe_key, canonical_url,
          title, company_name, description_text, search_text, content_hash,
          first_seen_at, last_seen_at, last_seen_run_id, missing_count,
          created_at, updated_at
        ) VALUES
          ('job_present', 'source_test', 'company_test', 'present', 'present',
           'https://example.com/jobs/present', 'Present', 'Test Company', 'Present',
           'present', 'hash_present', 1, 1, 'run_full_1', 0, 1, 1),
          ('job_missing', 'source_test', 'company_test', 'missing', 'missing',
           'https://example.com/jobs/missing', 'Missing', 'Test Company', 'Missing',
           'missing', 'hash_missing', 1, 1, 'run_before_full_1', 1, 1, 1);
      `);

      const app = routeApp();
      const bindings = {
        DB: new SqliteD1Adapter(database) as unknown as D1Database,
      } as unknown as Bindings;
      const response = await app.request("http://worker.test/source-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: "run_same_2",
          sourceId: "source_test",
          status: "not_modified",
          httpStatus: 200,
          fetchedJobCount: 1,
          previousJobCount: 1,
          receivedBatchCount: 0,
          expectedBatchCount: 0,
          responseHash: "response-hash",
          contentFingerprint: fingerprint,
          etag: null,
          lastModified: null,
          errorCode: null,
          errorMessage: null,
          signals: [],
        }),
      }, bindings);

      expect(response.status).toBe(200);
      const jobs = database.prepare(`SELECT id, status, missing_count, last_seen_run_id
        FROM jobs ORDER BY id`).all() as Array<{
          id: string;
          status: string;
          missing_count: number;
          last_seen_run_id: string;
        }>;
      expect(jobs.map((row) => ({ ...row }))).toEqual([
        {
          id: "job_missing",
          status: "closed",
          missing_count: 2,
          last_seen_run_id: "run_before_full_1",
        },
        {
          id: "job_present",
          status: "open",
          missing_count: 0,
          last_seen_run_id: "run_full_1",
        },
      ]);
      const source = database.prepare(`SELECT content_fingerprint, snapshot_run_id
        FROM sources WHERE id = 'source_test'`).get() as {
          content_fingerprint: string;
          snapshot_run_id: string;
        };
      expect({ ...source }).toEqual({
        content_fingerprint: fingerprint,
        snapshot_run_id: "run_full_1",
      });
    } finally {
      database.close();
    }
  });
});
