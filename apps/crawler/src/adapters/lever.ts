import type { AdapterContext, AdapterOutput, CrawlSource, JobSourceAdapter, RawJob } from "../types";
import { htmlToText, outputFromHttp } from "./helpers";

interface LeverPosting {
  id?: string;
  text?: string;
  hostedUrl?: string;
  applyUrl?: string;
  createdAt?: number;
  description?: string;
  descriptionPlain?: string;
  additional?: string;
  lists?: Array<{ text?: string; content?: string }>;
  categories?: { location?: string; team?: string; department?: string; commitment?: string };
}

export function parseLever(body: string, source: CrawlSource): RawJob[] {
  const payload = JSON.parse(body) as LeverPosting[];
  if (!Array.isArray(payload)) throw new Error("Lever response must be an array");
  return payload.map((job) => ({
    externalId: job.id ?? null,
    canonicalUrl: job.hostedUrl ?? job.applyUrl ?? source.url,
    title: job.text?.trim() ?? "",
    companyName: source.companyName,
    department: job.categories?.department ?? job.categories?.team ?? null,
    locationText: job.categories?.location ?? null,
    employmentType: job.categories?.commitment ?? null,
    descriptionText: job.descriptionPlain?.trim() || htmlToText([
      job.description ?? "",
      ...(job.lists ?? []).map((item) => `<h3>${item.text ?? ""}</h3>${item.content ?? ""}`),
      job.additional ?? "",
    ].join("\n")),
    postedAt: job.createdAt ?? null,
  }));
}

export class LeverAdapter implements JobSourceAdapter {
  readonly kind = "lever" as const;

  async collect(source: CrawlSource, context: AdapterContext): Promise<AdapterOutput> {
    if (!source.adapterKey) throw new Error("Lever source requires adapterKey (site name)");
    const url = `https://api.lever.co/v0/postings/${encodeURIComponent(source.adapterKey)}?mode=json`;
    const result = await context.http.get(url, { etag: source.etag, lastModified: source.lastModified });
    return outputFromHttp(result, result.notModified ? [] : parseLever(result.body, source));
  }
}
