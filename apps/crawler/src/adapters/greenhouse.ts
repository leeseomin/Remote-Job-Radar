import type { AdapterContext, AdapterOutput, CrawlSource, JobSourceAdapter, RawJob } from "../types";
import { htmlToText, outputFromHttp } from "./helpers";

interface GreenhouseJob {
  id?: string | number;
  title?: string;
  absolute_url?: string;
  location?: { name?: string };
  departments?: Array<{ name?: string }>;
  content?: string;
  updated_at?: string;
  metadata?: Array<{ name?: string; value?: unknown }>;
}

export function parseGreenhouse(body: string, source: CrawlSource): RawJob[] {
  const payload = JSON.parse(body) as { jobs?: GreenhouseJob[] };
  if (!Array.isArray(payload.jobs)) throw new Error("Greenhouse response omitted jobs[]");
  return payload.jobs.map((job) => {
    const metadata = job.metadata ?? [];
    const employment = metadata.find((item) => /employment|commitment/i.test(item.name ?? ""))?.value;
    return {
      externalId: job.id === undefined ? null : String(job.id),
      canonicalUrl: job.absolute_url ?? source.url,
      title: job.title?.trim() ?? "",
      companyName: source.companyName,
      department: job.departments?.map((department) => department.name).filter(Boolean).join(" · ") || null,
      locationText: job.location?.name?.trim() || null,
      employmentType: typeof employment === "string" ? employment : null,
      descriptionText: htmlToText(job.content ?? ""),
      postedAt: job.updated_at ?? null,
    };
  });
}

export class GreenhouseAdapter implements JobSourceAdapter {
  readonly kind = "greenhouse" as const;

  async collect(source: CrawlSource, context: AdapterContext): Promise<AdapterOutput> {
    if (!source.adapterKey) throw new Error("Greenhouse source requires adapterKey (board token)");
    const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(source.adapterKey)}/jobs?content=true`;
    const result = await context.http.get(url, { etag: source.etag, lastModified: source.lastModified });
    return outputFromHttp(result, result.notModified ? [] : parseGreenhouse(result.body, source));
  }
}
