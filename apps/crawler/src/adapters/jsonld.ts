import * as cheerio from "cheerio";
import type { AdapterContext, AdapterOutput, CrawlSource, JobSourceAdapter, RawJob, RawSalary } from "../types";
import { htmlToText, outputFromHttp, parseSalary, resolveUrl } from "./helpers";

function hasJobPostingType(value: unknown): boolean {
  const types = Array.isArray(value) ? value : [value];
  return types.some((type) => typeof type === "string" && type.toLocaleLowerCase("en-US") === "jobposting");
}

function collectJobPostings(value: unknown, output: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectJobPostings(item, output);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (hasJobPostingType(record["@type"])) output.push(record);
  for (const child of Object.values(record)) {
    if (child && typeof child === "object") collectJobPostings(child, output);
  }
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    const parts = value.map(stringValue).filter((item): item is string => Boolean(item));
    return parts.length ? parts.join(" · ") : null;
  }
  return null;
}

function locationValue(value: unknown): string | null {
  const entries = Array.isArray(value) ? value : value ? [value] : [];
  const locations: string[] = [];
  for (const entry of entries) {
    if (typeof entry === "string") {
      locations.push(entry);
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.name === "string") locations.push(record.name);
    const address = record.address;
    if (address && typeof address === "object") {
      const addressRecord = address as Record<string, unknown>;
      const parts = [
        addressRecord.addressLocality,
        addressRecord.addressRegion,
        typeof addressRecord.addressCountry === "object"
          ? (addressRecord.addressCountry as Record<string, unknown>).name
          : addressRecord.addressCountry,
      ].filter((part): part is string => typeof part === "string" && part.length > 0);
      if (parts.length) locations.push(parts.join(", "));
    }
  }
  return [...new Set(locations)].join(" · ") || null;
}

function identifierValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return stringValue(record.value) ?? stringValue(record.name);
}

function schemaSalary(value: unknown): RawSalary | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const inner = record.value && typeof record.value === "object"
    ? record.value as Record<string, unknown>
    : record;
  return parseSalary({
    currency: record.currency,
    minValue: inner.minValue,
    maxValue: inner.maxValue,
    value: inner.value,
    unitText: inner.unitText,
  });
}

export function parseJsonLd(body: string, source: CrawlSource): RawJob[] {
  const $ = cheerio.load(body);
  const postings: Record<string, unknown>[] = [];
  $('script[type="application/ld+json"]').each((_index, element) => {
    const text = $(element).text().trim();
    if (!text) return;
    try {
      collectJobPostings(JSON.parse(text) as unknown, postings);
    } catch {
      // Other valid scripts should still be considered.
    }
  });

  return postings.map((job) => {
    const hiringOrganization = job.hiringOrganization && typeof job.hiringOrganization === "object"
      ? job.hiringOrganization as Record<string, unknown>
      : null;
    const remoteType = stringValue(job.jobLocationType);
    const applicantLocations = locationValue(job.applicantLocationRequirements);
    const physicalLocations = locationValue(job.jobLocation);
    const location = [remoteType, applicantLocations, physicalLocations].filter(Boolean).join(" · ") || null;
    const url = resolveUrl(stringValue(job.url) ?? undefined, source.url);
    return {
      externalId: identifierValue(job.identifier) ?? url,
      canonicalUrl: url,
      title: stringValue(job.title) ?? "",
      companyName: stringValue(hiringOrganization?.name) ?? source.companyName,
      department: stringValue(job.industry) ?? null,
      locationText: location,
      employmentType: stringValue(job.employmentType),
      descriptionText: htmlToText(stringValue(job.description) ?? ""),
      postedAt: stringValue(job.datePosted),
      salary: schemaSalary(job.baseSalary),
    };
  });
}

export class JsonLdAdapter implements JobSourceAdapter {
  readonly kind = "jsonld" as const;

  async collect(source: CrawlSource, context: AdapterContext): Promise<AdapterOutput> {
    const result = await context.http.get(source.url, {
      etag: source.etag,
      lastModified: source.lastModified,
      headers: source.config.headers,
    });
    const jobs = result.notModified ? [] : parseJsonLd(result.body, source);
    const signals = !result.notModified && jobs.length === 0 ? ["jsonld-jobposting-not-found"] : [];
    return outputFromHttp(result, jobs, signals);
  }
}
