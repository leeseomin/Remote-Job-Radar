import { mkdir } from "node:fs/promises";
import pLimit, { type LimitFunction } from "p-limit";
import type { NormalizedJob, SourceCompletePayload } from "@remote-job-radar/contracts";
import { loadConfig } from "../config";
import { writeJsonArtifact } from "../artifacts";
import { getAdapter } from "../adapters";
import { PlaywrightAdapter, type BrowserCollectionResult } from "../adapters/playwright";
import { SafeHttpClient } from "../fetch/http-client";
import { normalizeRawJob } from "../normalize/normalize-job";
import { RadarApiClient } from "../transport/api-client";
import { createIngestBatches } from "../transport/batches";
import type { AdapterOutput, CrawlSource } from "../types";

interface SourceOutcome {
  sourceId: string;
  status: "healthy" | "not_modified" | "quarantined" | "failed";
  jobCount: number;
  batchCount: number;
  reason?: string;
}

function adapterHostname(source: CrawlSource): string {
  if (source.adapter === "greenhouse") return "boards-api.greenhouse.io";
  if (source.adapter === "lever") return "api.lever.co";
  if (source.adapter === "ashby") return "api.ashbyhq.com";
  try {
    return new URL(source.url).hostname;
  } catch {
    return `invalid-source-${source.id}`;
  }
}

function severeSignal(signals: string[]): string | null {
  for (const signal of signals) {
    if (/captcha/i.test(signal)) return "captcha-page";
    if (/login/i.test(signal)) return "login-page";
    if (/required-selector-not-found/i.test(signal)) return "required-selector-not-found";
    if (/jsonld-jobposting-not-found/i.test(signal)) return "jsonld-jobposting-not-found";
    if (/response-too-short/i.test(signal)) return "response-too-short";
    if (/empty-title|schema/i.test(signal)) return "schema-invalid";
  }
  return null;
}

function countDropReason(source: CrawlSource, current: number): string | null {
  if (source.previousJobCount >= 5 && current === 0) return "unexpected-zero-jobs";
  if (source.previousJobCount >= 5 && current <= Math.floor(source.previousJobCount * 0.2)) {
    return "job-count-dropped-80-percent";
  }
  return null;
}

function httpStatusFromError(error: unknown): number | null {
  const match = error instanceof Error ? error.message.match(/HTTP\s+(\d{3})/) : null;
  return match?.[1] ? Number(match[1]) : null;
}

function limitSignals(values: string[]): string[] {
  return values
    .map((value) => value.replace(/[\r\n]+/g, " ").trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, 20);
}

function boundedHeader(value: string | null): string | null {
  return value ? value.slice(0, 1_000) : null;
}

async function processSource(
  source: CrawlSource,
  runId: string,
  api: RadarApiClient,
  http: SafeHttpClient,
  artifactsDir: string,
  browserResult?: BrowserCollectionResult,
): Promise<SourceOutcome> {
  const fetchedAt = Math.floor(Date.now() / 1_000);
  let output: AdapterOutput | null = null;
  let sentBatches = 0;
  let expectedBatches = 0;
  try {
    if (browserResult) {
      if (!browserResult.ok) throw browserResult.error;
      output = browserResult.output;
    } else {
      const adapter = getAdapter(source.adapter);
      output = await adapter.collect(source, { http, artifactsDir });
    }
    if (output.status === "not_modified") {
      const payload: SourceCompletePayload = {
        runId,
        sourceId: source.id,
        status: "not_modified",
        httpStatus: output.httpStatus,
        fetchedJobCount: source.previousJobCount,
        previousJobCount: source.previousJobCount,
        receivedBatchCount: 0,
        expectedBatchCount: 0,
        responseHash: output.responseHash,
        etag: boundedHeader(output.etag),
        lastModified: boundedHeader(output.lastModified),
        signals: [],
      };
      await api.postSourceComplete(payload);
      return { sourceId: source.id, status: "not_modified", jobCount: source.previousJobCount, batchCount: 0 };
    }

    const signals = [...output.signals];
    const normalized: NormalizedJob[] = [];
    for (const raw of output.jobs) {
      try {
        normalized.push(await normalizeRawJob(raw, source));
      } catch (error) {
        signals.push(`normalize-error:${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (output.jobs.length > 0 && normalized.length === 0) signals.push("all-title-or-schema-invalid");

    // D1 identifies jobs by (source_id, external_id), so the in-run key must match it.
    // Keeping two URL variants of the same external ID would inflate fetchedJobCount
    // even though the Worker ultimately stores a single row.
    const deduped = [...new Map(normalized.map((job) => [job.externalId, job])).values()];
    const anomaly = severeSignal(signals) ?? countDropReason(source, deduped.length);
    const batches = anomaly ? [] : createIngestBatches(runId, source.id, deduped, fetchedAt);
    expectedBatches = batches.length;
    for (const batch of batches) {
      await api.postIngest(batch);
      sentBatches += 1;
    }

    const status: SourceCompletePayload["status"] = anomaly ? "quarantined" : "healthy";
    await api.postSourceComplete({
      runId,
      sourceId: source.id,
      status,
      httpStatus: output.httpStatus,
      fetchedJobCount: deduped.length,
      previousJobCount: source.previousJobCount,
      receivedBatchCount: sentBatches,
      expectedBatchCount: expectedBatches,
      responseHash: output.responseHash,
      etag: boundedHeader(output.etag),
      lastModified: boundedHeader(output.lastModified),
      errorCode: anomaly,
      errorMessage: anomaly ? `Source quarantined: ${anomaly}` : null,
      signals: limitSignals(signals),
    });

    return {
      sourceId: source.id,
      status: anomaly ? "quarantined" : "healthy",
      jobCount: deduped.length,
      batchCount: sentBatches,
      ...(anomaly ? { reason: anomaly } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await writeJsonArtifact(artifactsDir, `${source.id}-failure`, {
        source: { ...source, config: source.config },
        runId,
        message,
        stack: error instanceof Error ? error.stack : undefined,
        output: output ? { ...output, jobs: `omitted:${output.jobs.length}` } : null,
        sentBatches,
        expectedBatches,
        occurredAt: new Date().toISOString(),
      });
    } catch (artifactError) {
      console.error(`Could not write failure artifact for ${source.id}:`, artifactError);
    }
    try {
      await api.postSourceComplete({
        runId,
        sourceId: source.id,
        status: "failed",
        httpStatus: httpStatusFromError(error),
        fetchedJobCount: output?.jobs.length ?? 0,
        previousJobCount: source.previousJobCount,
        receivedBatchCount: sentBatches,
        expectedBatchCount: expectedBatches,
        responseHash: output?.responseHash ?? null,
        etag: boundedHeader(output?.etag ?? null),
        lastModified: boundedHeader(output?.lastModified ?? null),
        errorCode: "crawler-error",
        errorMessage: message.slice(0, 2_000),
        signals: limitSignals(output?.signals ?? []),
      });
    } catch (reportError) {
      await writeJsonArtifact(artifactsDir, `${source.id}-report-failure`, {
        originalError: message,
        reportError: reportError instanceof Error ? reportError.message : String(reportError),
      });
    }
    return { sourceId: source.id, status: "failed", jobCount: 0, batchCount: sentBatches, reason: message };
  }
}

export async function runCrawler(runner: "fast" | "browser"): Promise<void> {
  const config = loadConfig();
  await mkdir(config.artifactsDir, { recursive: true });
  const api = new RadarApiClient(config);
  const http = new SafeHttpClient();
  const plan = await api.getCrawlPlan(runner, 200);
  const browserResults = new Map<string, BrowserCollectionResult>();
  if (runner === "browser") {
    const browserSources = plan.sources.filter((source) => source.adapter === "playwright");
    if (browserSources.length > 0) {
      const adapter = getAdapter("playwright");
      if (!(adapter instanceof PlaywrightAdapter)) throw new Error("Playwright adapter does not support run-scoped collection");
      const collected = await adapter.collectMany(browserSources, { http, artifactsDir: config.artifactsDir });
      for (const [sourceId, result] of collected) browserResults.set(sourceId, result);
    }
  }
  const globalLimit = pLimit(6);
  const hostLimits = new Map<string, LimitFunction>();
  const getHostLimit = (host: string): LimitFunction => {
    const existing = hostLimits.get(host);
    if (existing) return existing;
    const created = pLimit(1);
    hostLimits.set(host, created);
    return created;
  };

  const outcomes = await Promise.all(plan.sources.map((source) =>
    globalLimit(() => getHostLimit(adapterHostname(source))(() =>
      processSource(source, plan.runId, api, http, config.artifactsDir, browserResults.get(source.id)),
    )),
  ));
  const completed = outcomes.filter((outcome) => outcome.status === "healthy" || outcome.status === "not_modified").length;
  const failed = outcomes.length - completed;
  const status = failed === 0 ? "completed" : completed === 0 && outcomes.length > 0 ? "failed" : "partial";

  await api.postRunComplete({
    runId: plan.runId,
    status,
    completedSourceCount: completed,
    failedSourceCount: failed,
  });
  await writeJsonArtifact(config.artifactsDir, "run-summary", {
    runId: plan.runId,
    runner,
    planned: plan.sources.length,
    completed,
    failed,
    status,
    outcomes,
    completedAt: new Date().toISOString(),
  });
  console.log(JSON.stringify({ runId: plan.runId, runner, completed, failed, outcomes }, null, 2));
  if (failed > 0) process.exitCode = 1;
}
