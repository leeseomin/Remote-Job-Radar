import { describe, expect, it, vi } from "vitest";
import { parseGreenhouse } from "../src/adapters/greenhouse";
import { createContentFingerprint } from "../src/normalize/content-fingerprint";
import { normalizeRawJob } from "../src/normalize/normalize-job";
import { processSource } from "../src/runners/run";
import type { CrawlSource, HttpResult } from "../src/types";
import type { RadarApiClient } from "../src/transport/api-client";
import type { SafeHttpClient } from "../src/fetch/http-client";

describe("crawler fingerprint fast path", () => {
  it("skips ingest and reports not_modified for the same anomaly-free snapshot", async () => {
    const baseSource: CrawlSource = {
      id: "source_test",
      companyId: "company_test",
      companyName: "Example",
      adapter: "greenhouse",
      url: "https://example.com/jobs",
      adapterKey: "example",
      config: {},
      etag: null,
      lastModified: null,
      contentFingerprint: null,
      snapshotRunId: "run_full_1",
      previousJobCount: 1,
      browserRequired: false,
    };
    const body = JSON.stringify({ jobs: [{
      id: 1,
      title: "Frontend Engineer",
      absolute_url: "https://example.com/jobs/1",
      location: { name: "Remote Worldwide" },
      content: `<p>${"Async TypeScript WebGL work. ".repeat(10)}</p>`,
    }] });
    const rawJob = parseGreenhouse(body, baseSource)[0];
    expect(rawJob).toBeDefined();
    const normalized = await normalizeRawJob(rawJob!, baseSource);
    const fingerprint = createContentFingerprint([normalized]);
    const source = { ...baseSource, contentFingerprint: fingerprint };
    const postIngest = vi.fn(async () => ({ batchId: "unused", acceptedJobs: 0 }));
    const postSourceComplete = vi.fn(async () => ({}));
    const api = { postIngest, postSourceComplete } as unknown as RadarApiClient;
    const httpResult: HttpResult = {
      status: 200,
      url: "https://boards-api.greenhouse.io/v1/boards/example/jobs?content=true",
      body,
      contentType: "application/json",
      etag: null,
      lastModified: null,
      notModified: false,
    };
    const http = { get: vi.fn(async () => httpResult) } as unknown as SafeHttpClient;

    const outcome = await processSource(source, "run_same_2", api, http, "/tmp");

    expect(postIngest).not.toHaveBeenCalled();
    expect(postSourceComplete).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run_same_2",
      sourceId: "source_test",
      status: "not_modified",
      expectedBatchCount: 0,
      receivedBatchCount: 0,
      contentFingerprint: fingerprint,
    }));
    expect(outcome).toMatchObject({ status: "not_modified", jobCount: 1, batchCount: 0 });
  });
});
