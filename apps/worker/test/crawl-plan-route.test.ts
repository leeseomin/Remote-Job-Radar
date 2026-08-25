import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AppEnv, Bindings } from "../src/env";
import { crawlPlanRoutes } from "../src/routes/internal/crawl-plan";

describe("crawl-plan expired lease recovery", () => {
  it("invalidates an unproven snapshot before leasing the source again", async () => {
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
          async run() {
            return { meta: { changes: 0 } };
          },
          async all() {
            return { results: [], success: true, meta: {} };
          },
        };
        return statement;
      },
    } as unknown as D1Database;

    const app = new Hono<AppEnv>();
    app.route("/", crawlPlanRoutes);
    const response = await app.request(
      "http://worker.test/crawl-plan?runner=fast",
      { headers: { "X-Crawl-Request-Id": "request_123456" } },
      { DB: db } as unknown as Bindings,
    );

    expect(response.status).toBe(200);
    const expiredLeaseCleanup = queries.find((query) =>
      query.sql.includes("UPDATE sources SET") && query.sql.includes("lease_until < ?"));
    expect(expiredLeaseCleanup?.sql).toContain("etag = NULL");
    expect(expiredLeaseCleanup?.sql).toContain("last_modified = NULL");
    expect(expiredLeaseCleanup?.sql).toContain("content_fingerprint = NULL");
    expect(expiredLeaseCleanup?.sql).toContain("snapshot_run_id = NULL");
    expect(expiredLeaseCleanup?.sql).toContain("lease_owner = NULL");
  });
});
