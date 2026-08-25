import { setTimeout as sleep } from "node:timers/promises";
import { assertSafeUrl } from "../security/ssrf";
import type { HttpResult } from "../types";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 20_000;
const ALLOWED_CONTENT_TYPES = [
  "text/html",
  "application/xhtml+xml",
  "application/json",
  "application/ld+json",
  "text/plain",
];

const FORBIDDEN_SOURCE_HEADERS = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "cf-access-client-id",
  "cf-access-client-secret",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
]);

export function sanitizeSourceHeaders(values: Record<string, string> | undefined): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [name, value] of Object.entries(values ?? {})) {
    const normalized = name.trim().toLocaleLowerCase("en-US");
    if (!normalized || FORBIDDEN_SOURCE_HEADERS.has(normalized)) {
      throw new Error(`Blocked source request header: ${name}`);
    }
    if (/[\r\n]/.test(name) || /[\r\n]/.test(value)) {
      throw new Error(`Invalid source request header: ${name}`);
    }
    output[name] = value;
  }
  return output;
}

async function readBodyBounded(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel("response too large");
      throw new Error(`Response exceeded ${MAX_BYTES} bytes`);
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(combined);
}

function retryDelay(response: Response | null, attempt: number): number {
  const retryAfter = response?.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(30_000, seconds * 1_000);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.min(30_000, Math.max(0, date - Date.now()));
  }
  return 500 * 2 ** attempt + Math.floor(Math.random() * 250);
}

export class SafeHttpClient {
  async get(
    value: string,
    options: {
      etag?: string | null | undefined;
      lastModified?: string | null | undefined;
      headers?: Record<string, string> | undefined;
    } = {},
  ): Promise<HttpResult> {
    let current = await assertSafeUrl(value);
    const headers = new Headers({
      Accept: "application/json, application/ld+json, text/html;q=0.9, text/plain;q=0.8",
      "User-Agent": "RemoteJobRadar/0.1 (+personal-public-job-monitor)",
      ...sanitizeSourceHeaders(options.headers),
    });
    if (options.etag) headers.set("If-None-Match", options.etag);
    if (options.lastModified) headers.set("If-Modified-Since", options.lastModified);

    let redirects = 0;
    for (let attempt = 0; attempt <= 2; attempt += 1) {
      let response: Response | null = null;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
        try {
          response = await fetch(current, {
            method: "GET",
            headers,
            redirect: "manual",
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }

        if ([301, 302, 303, 307, 308].includes(response.status)) {
          if (redirects >= MAX_REDIRECTS) throw new Error("Too many redirects");
          const location = response.headers.get("location");
          if (!location) throw new Error("Redirect response omitted Location");
          current = await assertSafeUrl(new URL(location, current).toString());
          redirects += 1;
          attempt -= 1;
          continue;
        }

        if (response.status === 304) {
          return {
            status: 304,
            url: current.toString(),
            body: "",
            contentType: response.headers.get("content-type") ?? "",
            etag: response.headers.get("etag") ?? options.etag ?? null,
            lastModified: response.headers.get("last-modified") ?? options.lastModified ?? null,
            notModified: true,
          };
        }

        if ((response.status === 429 || response.status >= 500) && attempt < 2) {
          await sleep(retryDelay(response, attempt));
          continue;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status} for ${current}`);

        const contentType = (response.headers.get("content-type") ?? "").toLocaleLowerCase("en-US");
        if (!ALLOWED_CONTENT_TYPES.some((allowed) => contentType.includes(allowed))) {
          throw new Error(`Unsupported Content-Type: ${contentType || "missing"}`);
        }
        const length = Number(response.headers.get("content-length") ?? 0);
        if (Number.isFinite(length) && length > MAX_BYTES) throw new Error("Response Content-Length exceeds 5MB");
        return {
          status: response.status,
          url: current.toString(),
          body: await readBodyBounded(response),
          contentType,
          etag: response.headers.get("etag"),
          lastModified: response.headers.get("last-modified"),
          notModified: false,
        };
      } catch (error) {
        if (attempt >= 2) throw error;
        await sleep(retryDelay(response, attempt));
      }
    }
    throw new Error("Unreachable HTTP retry state");
  }
}
