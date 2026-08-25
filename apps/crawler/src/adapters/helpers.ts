import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import type { AdapterOutput, HttpResult, RawSalary } from "../types";

export function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  $("script,style,noscript,svg").remove();
  return $.root().text().replace(/\u00a0/g, " ").replace(/[\t\r ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export function responseHash(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

export function suspiciousSignals(body: string, jobCount: number): string[] {
  const lower = body.toLocaleLowerCase("en-US");
  const signals: string[] = [];
  if (body.trim().length < 100) signals.push("response-too-short");
  if (/captcha|verify you are human|cloudflare challenge/.test(lower)) signals.push("captcha-page");
  if (/sign in to continue|log in to continue|authentication required/.test(lower)) signals.push("login-page");
  if (jobCount > 0 && /<title>\s*(?:login|sign in)/i.test(body)) signals.push("login-title");
  return signals;
}

export function outputFromHttp(result: HttpResult, jobs: AdapterOutput["jobs"], extraSignals: string[] = []): AdapterOutput {
  if (result.notModified) {
    return {
      status: "not_modified",
      httpStatus: result.status,
      jobs: [],
      responseHash: null,
      etag: result.etag,
      lastModified: result.lastModified,
      signals: [],
    };
  }
  return {
    status: "healthy",
    httpStatus: result.status,
    jobs,
    responseHash: responseHash(result.body),
    etag: result.etag,
    lastModified: result.lastModified,
    signals: [...suspiciousSignals(result.body, jobs.length), ...extraSignals],
  };
}

export function parseSalary(value: unknown): RawSalary | null {
  if (!value || typeof value !== "object") return null;
  const salary = value as Record<string, unknown>;
  const currency = typeof salary.currency === "string" ? salary.currency :
    typeof salary.currencyCode === "string" ? salary.currencyCode : null;
  const min = Number(salary.min ?? salary.minValue ?? salary.value);
  const max = Number(salary.max ?? salary.maxValue ?? salary.value);
  return {
    currency,
    min: Number.isFinite(min) ? min : null,
    max: Number.isFinite(max) ? max : null,
    interval: typeof salary.interval === "string" ? salary.interval :
      typeof salary.unitText === "string" ? salary.unitText : null,
  };
}

export function resolveUrl(href: string | undefined, base: string): string {
  return new URL(href || base, base).toString();
}
