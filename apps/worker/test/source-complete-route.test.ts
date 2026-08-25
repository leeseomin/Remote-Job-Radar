import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AppEnv, Bindings } from "../src/env";
import { sourceCompleteRoutes } from "../src/routes/internal/source-complete";

interface CapturedStatement {
  sql: string;
  values: unknown[];
}

function workerWithFakeDb() {
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
              lease_owner: "run_fast_test",
              source_run_status: "running",
              source_run_completed_at: null,
            };
          }
          if (sql.includes("FROM ingest_batches")) return { count: 0 };
          return null;
        },
      };
      return statement;
    },
    async batch(statements: unknown[]) {
      return statements.map(() => ({ meta: { changes: 1 } }));
    },
  } as unknown as D1Database;

  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("requestId", "request_test");
    c.set("rawBody", await c.req.text());
    await next();
  });
  app.route("/", sourceCompleteRoutes);

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

    const sourceRunUpdate = captured.find((statement) => statement.sql.includes("INSERT INTO source_runs"));
    expect(sourceRunUpdate?.sql).toContain("'failed'");
  });
});
