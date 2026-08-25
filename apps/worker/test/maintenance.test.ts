import { describe, expect, it } from "vitest";
import type { Bindings } from "../src/env";
import { maintenanceRoutes } from "../src/routes/internal/maintenance";

describe("retention cleanup", () => {
  it("removes expired ingest batch idempotency records", async () => {
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
        };
        return statement;
      },
      async batch(statements: unknown[]) {
        return statements.map((_statement, index) => ({ meta: { changes: index + 1 } }));
      },
    } as unknown as D1Database;

    const response = await maintenanceRoutes.request("http://worker.test/cleanup", {
      method: "POST",
    }, { DB: db } as unknown as Bindings);

    expect(response.status).toBe(200);
    const body = await response.json() as {
      data: { removedIngestBatches: number; removedClosedJobs: number };
    };
    expect(body.data.removedIngestBatches).toBe(2);
    expect(body.data.removedClosedJobs).toBe(6);

    const batchCleanup = queries.find((query) => query.sql.includes("DELETE FROM ingest_batches"));
    expect(batchCleanup?.sql).toContain("received_at < ?");
    expect(batchCleanup?.values).toHaveLength(1);
  });
});
