import * as cheerio from "cheerio";
import pLimit from "p-limit";
import type { AdapterContext, AdapterOutput, CrawlSource, JobSourceAdapter, RawJob } from "../types";
import { htmlToText, outputFromHttp, resolveUrl } from "./helpers";

const MAX_DETAIL_REQUESTS = 60;

function requiredSelector(value: string | undefined, name: string): string {
  if (!value) throw new Error(`static-html source requires config.${name}`);
  return value;
}

export async function parseStaticHtml(
  body: string,
  source: CrawlSource,
  context: AdapterContext,
): Promise<{ jobs: RawJob[]; signals: string[] }> {
  const $ = cheerio.load(body);
  const listSelector = requiredSelector(source.config.listSelector, "listSelector");
  const titleSelector = requiredSelector(source.config.titleSelector, "titleSelector");
  const linkSelector = source.config.linkSelector ?? "a";
  const cards = $(listSelector).toArray().slice(0, 300);
  const signals: string[] = [];
  if (cards.length === 0) signals.push("required-selector-not-found");

  const preliminary = cards.map((card) => {
    const element = $(card);
    const linkElement = element.is(linkSelector) ? element : element.find(linkSelector).first();
    const href = linkElement.attr("href");
    const url = resolveUrl(href, source.url);
    const inlineDescription = source.config.detailDescriptionSelector
      ? element.find(source.config.detailDescriptionSelector).html()
      : element.html();
    return {
      externalId: element.attr("data-job-id") ?? element.attr("data-id") ?? element.attr("id") ?? href ?? null,
      canonicalUrl: url,
      title: element.find(titleSelector).first().text().trim() || (element.is(titleSelector) ? element.text().trim() : ""),
      companyName: source.companyName,
      department: source.config.departmentSelector
        ? element.find(source.config.departmentSelector).first().text().trim() || null
        : null,
      locationText: source.config.locationSelector
        ? element.find(source.config.locationSelector).first().text().trim() || null
        : null,
      employmentType: null,
      descriptionText: htmlToText(inlineDescription ?? ""),
      postedAt: element.find("time").first().attr("datetime") ?? null,
    } satisfies RawJob;
  });

  if (!source.config.detailDescriptionSelector) return { jobs: preliminary, signals };
  const detailCandidates = preliminary.filter((job) => job.canonicalUrl && job.descriptionText.length < 200);
  const allowedDetails = new Set(detailCandidates.slice(0, MAX_DETAIL_REQUESTS));
  if (detailCandidates.length > MAX_DETAIL_REQUESTS) {
    signals.push(`detail-fetch-capped:${detailCandidates.length - MAX_DETAIL_REQUESTS}`);
  }
  const limit = pLimit(1);
  const jobs = await Promise.all(preliminary.map((job) => limit(async () => {
    if (!allowedDetails.has(job)) return job;
    try {
      const detail = await context.http.get(job.canonicalUrl, { headers: source.config.headers });
      const detail$ = cheerio.load(detail.body);
      const html = detail$(source.config.detailDescriptionSelector!).first().html();
      if (!html) {
        signals.push(`detail-selector-not-found:${job.canonicalUrl}`);
        return job;
      }
      return { ...job, descriptionText: htmlToText(html) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      signals.push(`detail-fetch-failed:${job.canonicalUrl}:${message}`);
      return job;
    }
  })));
  return { jobs, signals };
}

export class StaticHtmlAdapter implements JobSourceAdapter {
  readonly kind = "static-html" as const;

  async collect(source: CrawlSource, context: AdapterContext): Promise<AdapterOutput> {
    const result = await context.http.get(source.url, {
      etag: source.etag,
      lastModified: source.lastModified,
      headers: source.config.headers,
    });
    if (result.notModified) return outputFromHttp(result, []);
    const parsed = await parseStaticHtml(result.body, source, context);
    return outputFromHttp(result, parsed.jobs, parsed.signals);
  }
}
