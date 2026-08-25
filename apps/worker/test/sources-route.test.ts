import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AppEnv, Bindings } from "../src/env";
import { sourcesRoutes } from "../src/routes/sources";

interface QueryCapture {
  sql: string;
  values: unknown[];
}

const currentSource = {
  id: "source_test",
  company_id: "company_test",
  kind: "greenhouse",
  url: "https://example.com/jobs",
  adapter_key: "example",
  config_json: "{}",
  browser_required: 0,
  crawl_interval_minutes: 720,
  etag: "etag-old",
  last_modified: "last-modified-old",
  content_fingerprint: "a".repeat(64),
  snapshot_run_id: "run_full_1",
  previous_job_count: 10,
  next_due_at: 12_345,
  status: "active",
};

function patchApp() {
  const queries: QueryCapture[] = [];
  const db = {
    prepare(sql: string) {
      const capture = { sql, values: [] as unknown[] };
      queries.push(capture);
      const statement = {
        bind(...values: unknown[]) {
          capture.values = values;
          return statement;
        },
        async first() {
          if (sql.includes("SELECT * FROM sources")) return currentSource;
          if (sql.includes("SELECT id FROM companies")) return { id: "company_test" };
          return null;
        },
        async run() {
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    },
  } as unknown as D1Database;

  const app = new Hono<AppEnv>();
  app.route("/", sourcesRoutes);
  return { app, bindings: { DB: db } as unknown as Bindings, queries };
}

describe("source identity edits", () => {
  it("clears validators and snapshot metadata and schedules a full crawl", async () => {
    const { app, bindings, queries } = patchApp();
    const response = await app.request("http://worker.test/source_test", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/new-jobs" }),
    }, bindings);

    expect(response.status).toBe(200);
    const update = queries.find((query) => query.sql.includes("UPDATE sources SET"));
    expect(update?.sql).toContain("etag = NULL");
    expect(update?.sql).toContain("last_modified = NULL");
    expect(update?.sql).toContain("content_fingerprint = NULL");
    expect(update?.sql).toContain("snapshot_run_id = NULL");
    expect(update?.sql).toContain("previous_job_count = 0");
    expect(update?.sql).toContain("lease_owner = NULL");
    expect(update?.values[8]).not.toBe(currentSource.next_due_at);
  });

  it("preserves snapshot metadata for schedule-only edits", async () => {
    const { app, bindings, queries } = patchApp();
    const response = await app.request("http://worker.test/source_test", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ crawlIntervalMinutes: 1_440 }),
    }, bindings);

    expect(response.status).toBe(200);
    const update = queries.find((query) => query.sql.includes("UPDATE sources SET"));
    expect(update?.sql).not.toContain("etag = NULL");
    expect(update?.sql).not.toContain("content_fingerprint = NULL");
    expect(update?.sql).not.toContain("snapshot_run_id = NULL");
    expect(update?.values[8]).toBe(currentSource.next_due_at);
  });

  it("releases the current lease when the source is paused without clearing its snapshot", async () => {
    const { app, bindings, queries } = patchApp();
    const response = await app.request("http://worker.test/source_test", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: false }),
    }, bindings);

    expect(response.status).toBe(200);
    const update = queries.find((query) => query.sql.includes("UPDATE sources SET"));
    expect(update?.sql).toContain("lease_owner = NULL");
    expect(update?.sql).toContain("lease_until = NULL");
    expect(update?.sql).not.toContain("content_fingerprint = NULL");
    expect(update?.sql).not.toContain("snapshot_run_id = NULL");
    expect(update?.values[7]).toBe("paused");
  });
});
