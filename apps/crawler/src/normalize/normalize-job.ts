import { createHash } from "node:crypto";
import type { NormalizedJob } from "@remote-job-radar/contracts";
import { classifyJob, enforceJobLimits, makeSearchText, normalizeWhitespace } from "@remote-job-radar/domain";
import { stableStringify } from "@remote-job-radar/shared";
import type { CrawlSource, RawJob, RawSalary } from "../types";

function canonicalizeUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`Unsupported job URL: ${value}`);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:utm_|fbclid|gclid|mc_cid|mc_eid|ref$|source$)/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.toString();
}

function postedAt(value: string | number | null): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value > 10_000_000_000 ? value / 1_000 : value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1_000) : null;
  }
  return null;
}

function salaryFromText(text: string): RawSalary | null {
  const match = text.match(/\b(USD|EUR|GBP|KRW|JPY|CAD|AUD)\s*[$€£₩¥]?\s*([\d,.]+)\s*(?:-|–|—|to)\s*[$€£₩¥]?\s*([\d,.]+)(?:\s*(?:per|\/)\s*(year|month|hour))?/i) ??
    text.match(/([$€£₩¥])\s*([\d,.]+)\s*(?:-|–|—|to)\s*[$€£₩¥]?\s*([\d,.]+)(?:\s*(?:per|\/)\s*(year|month|hour))?/i);
  if (!match) return null;
  const symbolCurrency: Record<string, string> = { "$": "USD", "€": "EUR", "£": "GBP", "₩": "KRW", "¥": "JPY" };
  const currency = symbolCurrency[match[1] ?? ""] ?? (match[1]?.toUpperCase() || null);
  const min = Number((match[2] ?? "").replace(/,/g, ""));
  const max = Number((match[3] ?? "").replace(/,/g, ""));
  return {
    currency,
    min: Number.isFinite(min) ? min : null,
    max: Number.isFinite(max) ? max : null,
    interval: match[4]?.toLocaleLowerCase("en-US") ?? null,
  };
}

export async function normalizeRawJob(raw: RawJob, source: CrawlSource): Promise<NormalizedJob> {
  const title = normalizeWhitespace(raw.title);
  if (!title) throw new Error("Job title is empty");
  const canonicalUrl = canonicalizeUrl(raw.canonicalUrl || source.url);
  const descriptionText = normalizeWhitespace(raw.descriptionText);
  const classification = classifyJob({
    title,
    descriptionText,
    locationText: raw.locationText,
    employmentType: raw.employmentType,
  });
  const salary = raw.salary ?? salaryFromText(descriptionText);
  const externalId = normalizeWhitespace(raw.externalId ?? "") ||
    createHash("sha256").update(canonicalUrl, "utf8").digest("hex");
  const searchText = makeSearchText([
    title,
    raw.companyName || source.companyName,
    raw.department,
    raw.locationText,
    raw.employmentType,
    classification.skills.join(" "),
    descriptionText,
  ]);
  const withoutHash = enforceJobLimits({
    externalId: externalId.slice(0, 300),
    canonicalUrl,
    title: title.slice(0, 500),
    companyName: normalizeWhitespace(raw.companyName || source.companyName).slice(0, 300),
    department: raw.department ? normalizeWhitespace(raw.department).slice(0, 300) : null,
    locationText: raw.locationText ? normalizeWhitespace(raw.locationText).slice(0, 500) : null,
    employmentType: raw.employmentType ? normalizeWhitespace(raw.employmentType).slice(0, 120) : null,
    descriptionText,
    searchText,
    skills: classification.skills,
    workplaceType: classification.workplaceType,
    remoteScope: classification.remoteScope,
    eligibleFromKorea: classification.eligibleFromKorea,
    asyncLevel: classification.asyncLevel,
    requiredTimezone: classification.requiredTimezone,
    requiredOverlapHours: classification.requiredOverlapHours,
    salaryCurrency: salary?.currency ?? null,
    salaryMin: salary?.min ?? null,
    salaryMax: salary?.max ?? null,
    salaryInterval: salary?.interval ?? null,
    postedAt: postedAt(raw.postedAt),
    score: classification.score,
    confidence: classification.confidence,
    evidence: classification.evidence,
  });
  const contentHash = createHash("sha256")
    .update(stableStringify(withoutHash), "utf8")
    .digest("hex");
  return { ...withoutHash, contentHash };
}
