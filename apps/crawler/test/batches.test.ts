import { describe, expect, it } from "vitest";
import type { NormalizedJob } from "@remote-job-radar/contracts";
import { createIngestBatches } from "../src/transport/batches";

function job(index: number): NormalizedJob {
  return {
    externalId: String(index),
    canonicalUrl: `https://example.com/${index}`,
    title: `Job ${index}`,
    companyName: "Example",
    department: null,
    locationText: "Remote",
    employmentType: null,
    descriptionText: "x".repeat(1_000),
    searchText: "x".repeat(1_000),
    skills: [],
    workplaceType: "remote",
    remoteScope: "worldwide",
    eligibleFromKorea: "yes",
    asyncLevel: "unknown",
    requiredTimezone: null,
    requiredOverlapHours: null,
    salaryCurrency: null,
    salaryMin: null,
    salaryMax: null,
    salaryInterval: null,
    postedAt: null,
    score: 30,
    confidence: 0.5,
    evidence: [],
    contentHash: "a".repeat(64),
  };
}

describe("ingest batching", () => {
  it("caps batches at 20 jobs", () => {
    const batches = createIngestBatches("run", "source", Array.from({ length: 45 }, (_, index) => job(index)), 1);
    expect(batches.map((batch) => batch.jobs.length)).toEqual([20, 20, 5]);
    expect(batches.every((batch) => Buffer.byteLength(JSON.stringify(batch)) <= 512 * 1024)).toBe(true);
  });

  it("rejects a single job that cannot fit safely", () => {
    const oversized = { ...job(1), descriptionText: "x".repeat(510 * 1024) };
    expect(() => createIngestBatches("run", "source", [job(0), oversized], 1))
      .toThrow(/Single normalized job exceeds ingest body limit/);
  });
});
