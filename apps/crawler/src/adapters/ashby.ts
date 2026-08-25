import type { AdapterContext, AdapterOutput, CrawlSource, JobSourceAdapter, RawJob } from "../types";
import { htmlToText, outputFromHttp } from "./helpers";

interface AshbyJob {
  id?: string;
  title?: string;
  location?: string;
  department?: string;
  team?: string;
  employmentType?: string;
  descriptionHtml?: string;
  descriptionPlain?: string;
  jobUrl?: string;
  applyUrl?: string;
  publishedAt?: string;
  isRemote?: boolean;
}

export function parseAshby(body: string, source: CrawlSource): RawJob[] {
  const payload = JSON.parse(body) as { jobs?: AshbyJob[] };
  if (!Array.isArray(payload.jobs)) throw new Error("Ashby response omitted jobs[]");
  return payload.jobs.map((job) => ({
    externalId: job.id ?? job.jobUrl ?? null,
    canonicalUrl: job.jobUrl ?? job.applyUrl ?? source.url,
    title: job.title?.trim() ?? "",
    companyName: source.companyName,
    department: job.department ?? job.team ?? null,
    locationText: [job.location, job.isRemote ? "Remote" : null].filter(Boolean).join(" · ") || null,
    employmentType: job.employmentType ?? null,
    descriptionText: job.descriptionPlain?.trim() || htmlToText(job.descriptionHtml ?? ""),
    postedAt: job.publishedAt ?? null,
  }));
}

export class AshbyAdapter implements JobSourceAdapter {
  readonly kind = "ashby" as const;

  async collect(source: CrawlSource, context: AdapterContext): Promise<AdapterOutput> {
    if (!source.adapterKey) throw new Error("Ashby source requires adapterKey (job board name)");
    const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(source.adapterKey)}`;
    const result = await context.http.get(url, { etag: source.etag, lastModified: source.lastModified });
    return outputFromHttp(result, result.notModified ? [] : parseAshby(result.body, source));
  }
}
