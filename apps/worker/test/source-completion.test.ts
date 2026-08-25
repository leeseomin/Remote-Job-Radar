import { describe, expect, it } from "vitest";
import type { SourceCompletePayload } from "@remote-job-radar/contracts";
import { classifySourceCompletion } from "../src/lib/source-completion";

function payload(overrides: Partial<SourceCompletePayload> = {}): SourceCompletePayload {
  return {
    runId: "run_fast_test",
    sourceId: "source_test",
    status: "healthy",
    httpStatus: 200,
    fetchedJobCount: 10,
    previousJobCount: 10,
    receivedBatchCount: 1,
    expectedBatchCount: 1,
    responseHash: "hash",
    etag: null,
    lastModified: null,
    contentFingerprint: "a".repeat(64),
    errorCode: null,
    errorMessage: null,
    signals: [],
    ...overrides,
  };
}

describe("classifySourceCompletion", () => {
  it("completes a healthy, internally consistent source", () => {
    expect(classifySourceCompletion(payload(), 1)).toEqual({ kind: "complete", reason: null });
  });

  it.each([
    [429, "http-429"],
    [503, "http-503"],
  ])("schedules retryable HTTP %i failures even when no jobs were fetched", (httpStatus, reason) => {
    expect(classifySourceCompletion(payload({
      status: "failed",
      httpStatus,
      fetchedJobCount: 0,
      previousJobCount: 20,
      receivedBatchCount: 0,
      expectedBatchCount: 0,
      errorCode: "crawler-error",
      errorMessage: `HTTP ${httpStatus}`,
    }), 0)).toEqual({ kind: "retry", reason });
  });

  it("schedules an unknown transient crawler failure", () => {
    expect(classifySourceCompletion(payload({
      status: "failed",
      httpStatus: null,
      fetchedJobCount: 0,
      receivedBatchCount: 0,
      expectedBatchCount: 0,
      errorCode: "crawler-error",
      errorMessage: "The operation was aborted",
    }), 0)).toEqual({ kind: "retry", reason: "crawler-error" });
  });

  it("treats a DNS resolution failure as transient", () => {
    expect(classifySourceCompletion(payload({
      status: "failed",
      httpStatus: null,
      fetchedJobCount: 0,
      receivedBatchCount: 0,
      expectedBatchCount: 0,
      errorCode: "crawler-error",
      errorMessage: "Hostname did not resolve: jobs.example.com",
    }), 0)).toEqual({ kind: "retry", reason: "crawler-error" });
  });

  it.each([
    ["captcha-page", "captcha detected", "captcha-page"],
    ["login-page", "login form detected", "login-page"],
    ["required-selector-not-found", "required selector missing", "required-selector-not-found"],
  ])("keeps the severe %s signal quarantined", (signal, errorMessage, reason) => {
    expect(classifySourceCompletion(payload({
      status: "failed",
      fetchedJobCount: 0,
      receivedBatchCount: 0,
      expectedBatchCount: 0,
      errorCode: "crawler-error",
      errorMessage,
      signals: [signal],
    }), 0)).toMatchObject({ kind: "quarantine", reason });
  });

  it("quarantines parser/schema failures instead of retrying them forever", () => {
    expect(classifySourceCompletion(payload({
      status: "failed",
      fetchedJobCount: 0,
      receivedBatchCount: 0,
      expectedBatchCount: 0,
      errorCode: "crawler-error",
      errorMessage: "Greenhouse response omitted jobs[]",
    }), 0)).toEqual({ kind: "quarantine", reason: "schema-invalid" });
  });

  it.each([
    [0, "unexpected-zero-jobs"],
    [4, "job-count-dropped-80-percent"],
  ])("quarantines a severe count drop to %i", (fetchedJobCount, reason) => {
    expect(classifySourceCompletion(payload({
      fetchedJobCount,
      previousJobCount: 20,
      receivedBatchCount: 0,
      expectedBatchCount: 0,
    }), 0)).toEqual({ kind: "quarantine", reason });
  });

  it("keeps explicitly quarantined crawler output quarantined", () => {
    expect(classifySourceCompletion(payload({
      status: "quarantined",
      errorCode: "schema-invalid",
    }), 1)).toEqual({ kind: "quarantine", reason: "schema-invalid" });
  });

  it("quarantines permanent HTTP failures", () => {
    expect(classifySourceCompletion(payload({
      status: "failed",
      httpStatus: 403,
      fetchedJobCount: 0,
      receivedBatchCount: 0,
      expectedBatchCount: 0,
      errorCode: "crawler-error",
      errorMessage: "HTTP 403",
    }), 0)).toEqual({ kind: "quarantine", reason: "http-403" });
  });

  it("retries an ingest batch mismatch without accepting the snapshot", () => {
    expect(classifySourceCompletion(payload({ receivedBatchCount: 0 }), 0)).toEqual({
      kind: "retry",
      reason: "batch-count-mismatch",
    });
  });

  it("does not accept not-modified when any ingest batches are reported", () => {
    expect(classifySourceCompletion(payload({
      status: "not_modified",
      receivedBatchCount: 1,
      expectedBatchCount: 1,
    }), 1)).toEqual({
      kind: "retry",
      reason: "not-modified-batch-count-mismatch",
    });
  });
});
