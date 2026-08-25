import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AppEnv, Bindings } from "../src/env";
import { runRoutes } from "../src/routes/internal/run";

describe("run finalization retry transition", () => {
  it("schedules dangling sources for retry instead of quarantining them", async () => {
    const queries: Array<{ sql: string; values: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        const query = { sql, values: [] as unknown[] };
        queries.push(query);
        const statement = {
          bind(...values: unknown[]) {
            query.values = values;
            return statement;
          },
          async first() {
            if (sql.includes("FROM crawl_runs")) {
              return {
                id: "run_fast_test",
                planned_source_count: 1,
                completed_source_count: 0,
                failed_source_count: 0,
                completed_at: null,
                status: "running",
              };
            }
            if (sql.includes("FROM source_runs")) return { count: 1 };
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
    app.route("/", runRoutes);

    const response = await app.request("http://worker.test/run-failed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runId: "run_fast_test",
        status: "failed",
        completedSourceCount: 0,
        failedSourceCount: 1,
      }),
    }, { DB: db } as unknown as Bindings);

    expect(response.status).toBe(200);
    const body = await response.json() as {
      data: { danglingSourcesScheduledForRetry: number };
    };
    expect(body.data.danglingSourcesScheduledForRetry).toBe(1);

    const sourceUpdate = queries.find((query) =>
      query.sql.includes("UPDATE sources SET") && query.sql.includes("lease_owner"));
    expect(sourceUpdate?.sql).toContain("status = 'active'");
    expect(sourceUpdate?.sql).toContain("MAX(crawl_interval_minutes, 720)");
    expect(sourceUpdate?.sql).not.toContain("status = 'quarantined'");
  });
});
