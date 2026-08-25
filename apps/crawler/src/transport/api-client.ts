import { createHash, createHmac, randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type {
  IngestPayload,
  RunCompletePayload,
  SourceCompletePayload,
} from "@remote-job-radar/contracts";
import type { CrawlerConfig } from "../config";
import type { CrawlPlan } from "../types";

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; details?: unknown };
  requestId?: string;
}

export class RemoteApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "RemoteApiError";
  }
}

export class RadarApiClient {
  constructor(private readonly config: CrawlerConfig) {}

  private commonHeaders(): Headers {
    const headers = new Headers({
      Accept: "application/json",
      Authorization: `Bearer ${this.config.bearerToken}`,
      "User-Agent": "RemoteJobRadar-Crawler/0.1",
    });
    if (this.config.accessClientId && this.config.accessClientSecret) {
      headers.set("CF-Access-Client-Id", this.config.accessClientId);
      headers.set("CF-Access-Client-Secret", this.config.accessClientSecret);
    }
    return headers;
  }

  private async fetchJson<T>(
    url: string,
    init: RequestInit,
    acceptedErrorCodes: string[] = [],
    maxRetries = 2,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20_000);
        let response: Response;
        try {
          response = await fetch(url, { ...init, signal: controller.signal });
        } finally {
          clearTimeout(timer);
        }
        const payload = await response.json().catch(() => null) as Envelope<T> | null;
        if (!response.ok || !payload?.ok) {
          const code = payload?.error?.code ?? `HTTP_${response.status}`;
          if (acceptedErrorCodes.includes(code)) return (payload?.data ?? ({} as T));
          if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
            await sleep(500 * 2 ** attempt);
            continue;
          }
          throw new RemoteApiError(
            response.status,
            code,
            payload?.error?.message ?? `Remote API returned HTTP ${response.status}`,
            payload?.error?.details,
          );
        }
        return payload.data as T;
      } catch (error) {
        lastError = error;
        if (error instanceof RemoteApiError || attempt >= maxRetries) throw error;
        await sleep(500 * 2 ** attempt);
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Remote API request failed");
  }

  async getCrawlPlan(runner: "fast" | "browser", limit = 200): Promise<CrawlPlan> {
    const headers = this.commonHeaders();
    headers.set("X-GitHub-Run-Id", this.config.githubRunId);
    headers.set("X-GitHub-Event", this.config.githubEventName);
    headers.set("X-Crawl-Request-Id", randomUUID());
    return this.fetchJson<CrawlPlan>(
      `${this.config.appBaseUrl}/api/internal/crawl-plan?runner=${runner}&limit=${limit}`,
      { method: "GET", headers },
    );
  }

  private async signedPost<T>(
    pathname: string,
    payload: unknown,
    idempotencyKey?: string,
    acceptedErrorCodes: string[] = [],
  ): Promise<T> {
    const body = JSON.stringify(payload);
    const bodyHash = createHash("sha256").update(body, "utf8").digest("hex");
    let lastError: unknown;

    for (let attempt = 0; attempt <= 2; attempt += 1) {
      const timestamp = Math.floor(Date.now() / 1_000).toString();
      const nonce = randomUUID();
      const canonical = ["POST", pathname, timestamp, nonce, bodyHash].join("\n");
      const signature = createHmac("sha256", this.config.hmacSecret)
        .update(canonical, "utf8")
        .digest("base64url");
      const headers = this.commonHeaders();
      headers.set("Content-Type", "application/json");
      headers.set("X-Timestamp", timestamp);
      headers.set("X-Nonce", nonce);
      headers.set("X-Body-SHA256", bodyHash);
      headers.set("X-Signature", signature);
      if (idempotencyKey) headers.set("X-Idempotency-Key", idempotencyKey);

      try {
        return await this.fetchJson<T>(`${this.config.appBaseUrl}${pathname}`, {
          method: "POST",
          headers,
          body,
        }, acceptedErrorCodes, 0);
      } catch (error) {
        lastError = error;
        const retryable = !(error instanceof RemoteApiError) || error.status === 429 || error.status >= 500;
        if (!retryable || attempt >= 2) throw error;
        await sleep(500 * 2 ** attempt);
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Signed API request failed");
  }

  postIngest(payload: IngestPayload): Promise<{ batchId: string; acceptedJobs: number }> {
    return this.signedPost(
      "/api/internal/ingest",
      payload,
      payload.batchId,
      ["BATCH_ALREADY_RECEIVED"],
    );
  }

  postSourceComplete(payload: SourceCompletePayload): Promise<Record<string, unknown>> {
    return this.signedPost("/api/internal/source-complete", payload);
  }

  postRunComplete(payload: RunCompletePayload): Promise<Record<string, unknown>> {
    const path = payload.status === "failed" ? "/api/internal/run-failed" : "/api/internal/run-complete";
    return this.signedPost(path, payload);
  }
}
