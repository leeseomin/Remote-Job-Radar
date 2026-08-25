import { describe, expect, it } from "vitest";
import { ingestPayloadSchema, sourceCompleteSchema } from "../src/ingest";

const normalizedJob = {
  externalId: "job-1",
  canonicalUrl: "https://example.com/jobs/1",
  title: "Engineer",
  companyName: "Example",
  department: null,
  locationText: "Remote",
  employmentType: null,
  descriptionText: "Description",
  searchText: "Engineer Remote",
  skills: [],
  workplaceType: "remote" as const,
  remoteScope: "worldwide" as const,
  eligibleFromKorea: "yes" as const,
  asyncLevel: "unknown" as const,
  requiredTimezone: null,
  requiredOverlapHours: null,
  salaryCurrency: null,
  salaryMin: null,
  salaryMax: null,
  salaryInterval: null,
  postedAt: null,
  score: 50,
  confidence: 0.5,
  evidence: [],
  contentHash: "a".repeat(64),
};

describe("ingest contracts", () => {
  it("accepts at most 10 jobs per ingest batch", () => {
    const payload = {
      schemaVersion: 1,
      runId: "run-1",
      sourceId: "source-1",
      batchId: "batch-1",
      sequence: 1,
      totalBatches: 1,
      fetchedAt: 1,
    };

    expect(ingestPayloadSchema.safeParse({ ...payload, jobs: Array(10).fill(normalizedJob) }).success).toBe(true);
    expect(ingestPayloadSchema.safeParse({ ...payload, jobs: Array(11).fill(normalizedJob) }).success).toBe(false);
  });

  it("accepts a nullable 64-character lowercase hex content fingerprint", () => {
    const payload = {
      runId: "run-1",
      sourceId: "source-1",
      status: "healthy",
      httpStatus: 200,
      fetchedJobCount: 1,
      previousJobCount: 0,
      receivedBatchCount: 1,
      expectedBatchCount: 1,
      responseHash: "response-hash",
      etag: null,
      lastModified: null,
      signals: [],
    };

    expect(sourceCompleteSchema.safeParse({ ...payload, contentFingerprint: "b".repeat(64) }).success).toBe(true);
    expect(sourceCompleteSchema.safeParse({ ...payload, contentFingerprint: null }).success).toBe(true);
    expect(sourceCompleteSchema.safeParse({ ...payload, contentFingerprint: "not-a-fingerprint" }).success).toBe(false);
    const legacyResult = sourceCompleteSchema.safeParse(payload);
    expect(legacyResult.success).toBe(true);
    if (legacyResult.success) expect(legacyResult.data.contentFingerprint).toBeNull();
  });
});
