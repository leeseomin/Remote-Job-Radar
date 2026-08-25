import { describe, expect, it } from "vitest";
import { UPSERT_JOB_SQL } from "../src/routes/internal/ingest";

describe("job ingest upsert", () => {
  it("moves an existing job when its source is assigned to another company", () => {
    expect(UPSERT_JOB_SQL).toContain("company_id = excluded.company_id");
  });
});
