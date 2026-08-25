import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PlaywrightCrawler, type PlaywrightCrawlerOptions } from "@crawlee/playwright";
import { chromium, type Page } from "playwright";
import { assertSafeUrl } from "../security/ssrf";
import type { AdapterContext, AdapterOutput, CrawlSource, JobSourceAdapter, RawJob } from "../types";
import { suspiciousSignals } from "./helpers";

const USER_AGENT = "RemoteJobRadar/0.1 (+personal-public-job-monitor)";
const MAX_PLAN_SOURCES = 200;
export const MAX_LIST_JOBS = 300;
export const MAX_DETAIL_REQUESTS_PER_SOURCE = 60;
export const MAX_BROWSER_REQUESTS_PER_CRAWL = MAX_PLAN_SOURCES * (1 + MAX_DETAIL_REQUESTS_PER_SOURCE);
export const BROWSER_MAX_CONCURRENCY = 1;
export const BROWSER_MAX_REQUEST_RETRIES = 2;

type BrowserRequestData = {
  kind: "list" | "detail";
  sourceId: string;
  jobIndex?: number;
};

interface BrowserSourceState {
  source: CrawlSource;
  jobs: RawJob[] | null;
  detailSignals: string[];
  httpStatus: number | null;
  html: string | null;
  error: Error | null;
}

export type BrowserCollectionResult =
  | { ok: true; output: AdapterOutput }
  | { ok: false; error: Error };

interface BrowserCrawlerLike {
  run(requests: Array<{
    url: string;
    uniqueKey: string;
    userData: BrowserRequestData;
  }>): Promise<unknown>;
}

export type BrowserCrawlerFactory = (options: PlaywrightCrawlerOptions) => BrowserCrawlerLike;

function defaultBrowserCrawlerFactory(options: PlaywrightCrawlerOptions): BrowserCrawlerLike {
  const crawler = new PlaywrightCrawler(options);
  return {
    run: (requests) => crawler.run(requests),
  };
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function requestData(value: Record<string, unknown>): BrowserRequestData {
  const kind = value.kind;
  const sourceId = value.sourceId;
  const jobIndex = value.jobIndex;
  if ((kind !== "list" && kind !== "detail") || typeof sourceId !== "string") {
    throw new Error("Invalid browser request metadata");
  }
  if (kind === "detail" && (!Number.isInteger(jobIndex) || Number(jobIndex) < 0)) {
    throw new Error("Invalid detail request job index");
  }
  return {
    kind,
    sourceId,
    ...(typeof jobIndex === "number" ? { jobIndex } : {}),
  };
}

export async function protectPage(page: Page): Promise<void> {
  const validatedHosts = new Map<string, Promise<void>>();
  await page.route("**/*", async (route) => {
    const request = route.request();
    const resourceType = request.resourceType();
    if (["image", "media", "font"].includes(resourceType)) {
      await route.abort();
      return;
    }
    const value = request.url();
    if (value.startsWith("data:") || value.startsWith("blob:")) {
      await route.continue();
      return;
    }
    try {
      const url = new URL(value);
      let validation = validatedHosts.get(url.hostname);
      if (!validation) {
        validation = assertSafeUrl(value).then(() => undefined);
        validatedHosts.set(url.hostname, validation);
      }
      await validation;
      await route.continue();
    } catch {
      await route.abort("blockedbyclient");
    }
  });
}

async function writeFailureEvidence(page: Page, source: CrawlSource, artifactsDir: string): Promise<void> {
  await mkdir(artifactsDir, { recursive: true });
  await page.screenshot({
    path: join(artifactsDir, `${source.id}-failure.png`),
    fullPage: true,
  }).catch(() => undefined);
  const html = await page.content().catch(() => "");
  await writeFile(join(artifactsDir, `${source.id}-failure.html`), html, "utf8").catch(() => undefined);
}

async function extractListJobs(page: Page, source: CrawlSource): Promise<RawJob[]> {
  const listSelector = source.config.listSelector;
  const titleSelector = source.config.titleSelector;
  if (!listSelector || !titleSelector) {
    throw new Error("playwright source requires listSelector and titleSelector");
  }

  const jobs = await page.locator(listSelector).evaluateAll((cards, config) => cards
    .slice(0, config.maxListJobs)
    .map((card) => {
      const query = (selector?: string) => selector ? card.querySelector(selector) : null;
      const link = query(config.linkSelector || "a") as HTMLAnchorElement | null;
      const title = query(config.titleSelector)?.textContent?.trim() ||
        (card.matches(config.titleSelector) ? card.textContent?.trim() : "") || "";
      return {
        externalId: card.getAttribute("data-job-id") || card.getAttribute("data-id") || card.id || link?.href || null,
        canonicalUrl: link?.href || location.href,
        title,
        department: query(config.departmentSelector)?.textContent?.trim() || null,
        locationText: query(config.locationSelector)?.textContent?.trim() || null,
        descriptionText: config.detailDescriptionSelector
          ? query(config.detailDescriptionSelector)?.textContent?.trim() || ""
          : card.textContent?.trim() || "",
        postedAt: (card.querySelector("time") as HTMLTimeElement | null)?.dateTime || null,
      };
    }), {
    maxListJobs: MAX_LIST_JOBS,
    titleSelector,
    linkSelector: source.config.linkSelector,
    departmentSelector: source.config.departmentSelector,
    locationSelector: source.config.locationSelector,
    detailDescriptionSelector: source.config.detailDescriptionSelector,
  });

  return jobs.map((job) => ({
    ...job,
    companyName: source.companyName,
    employmentType: null,
  }));
}

function detailFailureSignal(url: string, error: Error): string {
  return /HTTP\s+\d{3}/i.test(error.message)
    ? `detail-http-failed:${url}`
    : `detail-fetch-failed:${url}:${error.message}`;
}

export class PlaywrightAdapter implements JobSourceAdapter {
  readonly kind = "playwright" as const;

  constructor(private readonly createCrawler: BrowserCrawlerFactory = defaultBrowserCrawlerFactory) {}

  async collect(source: CrawlSource, context: AdapterContext): Promise<AdapterOutput> {
    const result = (await this.collectMany([source], context)).get(source.id);
    if (!result) throw new Error(`Browser crawler omitted source result: ${source.id}`);
    if (!result.ok) throw result.error;
    return result.output;
  }

  async collectMany(
    sources: CrawlSource[],
    context: AdapterContext,
  ): Promise<Map<string, BrowserCollectionResult>> {
    const states = new Map<string, BrowserSourceState>();
    const initialRequests: Array<{ url: string; uniqueKey: string; userData: BrowserRequestData }> = [];

    for (const source of sources) {
      const state: BrowserSourceState = {
        source,
        jobs: null,
        detailSignals: [],
        httpStatus: null,
        html: null,
        error: null,
      };
      states.set(source.id, state);
      try {
        await assertSafeUrl(source.url);
        if (!source.config.listSelector || !source.config.titleSelector) {
          throw new Error("playwright source requires listSelector and titleSelector");
        }
        initialRequests.push({
          url: source.url,
          uniqueKey: `list:${source.id}:${source.url}`,
          userData: { kind: "list", sourceId: source.id },
        });
      } catch (error) {
        state.error = asError(error);
      }
    }

    if (initialRequests.length > 0) {
      const maxRequestsPerCrawl = Math.min(
        MAX_BROWSER_REQUESTS_PER_CRAWL,
        initialRequests.length * (1 + MAX_DETAIL_REQUESTS_PER_SOURCE),
      );
      const options: PlaywrightCrawlerOptions = {
        headless: true,
        launchContext: {
          launcher: chromium,
          useIncognitoPages: true,
          userAgent: USER_AGENT,
          launchOptions: { headless: true },
        },
        browserPoolOptions: {
          maxOpenPagesPerBrowser: BROWSER_MAX_CONCURRENCY,
          retireBrowserAfterPageCount: maxRequestsPerCrawl,
          useFingerprints: false,
          prePageCreateHooks: [(_pageId, _browserController, pageOptions) => {
            if (!pageOptions) return;
            pageOptions.userAgent = USER_AGENT;
            pageOptions.serviceWorkers = "block";
            pageOptions.javaScriptEnabled = true;
          }],
        },
        minConcurrency: BROWSER_MAX_CONCURRENCY,
        maxConcurrency: BROWSER_MAX_CONCURRENCY,
        maxRequestRetries: BROWSER_MAX_REQUEST_RETRIES,
        maxRequestsPerCrawl,
        navigationTimeoutSecs: 30,
        requestHandlerTimeoutSecs: 45,
        respectRobotsTxtFile: true,
        retryOnBlocked: false,
        useSessionPool: false,
        preNavigationHooks: [async ({ page, request }, gotoOptions) => {
          const data = requestData(request.userData);
          await assertSafeUrl(request.url);
          await protectPage(page);
          gotoOptions.waitUntil = "domcontentloaded";
          gotoOptions.timeout = data.kind === "detail" ? 20_000 : 30_000;
        }],
        requestHandler: async ({ request, page, response, addRequests }) => {
          const data = requestData(request.userData);
          const state = states.get(data.sourceId);
          if (!state) throw new Error(`Browser request references unknown source: ${data.sourceId}`);
          if (!response) throw new Error(`Playwright navigation returned no response for ${request.url}`);
          if (response.status() >= 400) throw new Error(`HTTP ${response.status()} for ${request.url}`);
          await assertSafeUrl(page.url());

          if (data.kind === "detail") {
            const jobIndex = data.jobIndex!;
            const job = state.jobs?.[jobIndex];
            if (!job) throw new Error(`Detail request references missing job index: ${jobIndex}`);
            const detailSelector = state.source.config.detailDescriptionSelector;
            if (!detailSelector) throw new Error("Detail request omitted detailDescriptionSelector");
            const locator = page.locator(detailSelector).first();
            if (await locator.count()) job.descriptionText = (await locator.innerText()).trim();
            else state.detailSignals.push(`detail-selector-not-found:${job.canonicalUrl}`);
            return;
          }

          const listSelector = state.source.config.listSelector!;
          await page.waitForSelector(state.source.config.waitForSelector ?? listSelector, { timeout: 10_000 });
          const jobs = await extractListJobs(page, state.source);
          const html = await page.content();
          state.jobs = jobs;
          state.httpStatus = response.status();
          state.html = html;
          state.error = null;

          if (!state.source.config.detailDescriptionSelector) return;
          const detailRequests = jobs
            .map((job, jobIndex) => ({ job, jobIndex }))
            .filter(({ job }) => job.descriptionText.length < 200 && job.canonicalUrl !== page.url())
            .slice(0, MAX_DETAIL_REQUESTS_PER_SOURCE)
            .map(({ job, jobIndex }) => ({
              url: job.canonicalUrl,
              uniqueKey: `detail:${state.source.id}:${jobIndex}:${job.canonicalUrl}`,
              userData: { kind: "detail" as const, sourceId: state.source.id, jobIndex },
            }));
          const safeDetailRequests: typeof detailRequests = [];
          for (const detail of detailRequests) {
            try {
              await assertSafeUrl(detail.url);
              safeDetailRequests.push(detail);
            } catch (error) {
              state.detailSignals.push(detailFailureSignal(detail.url, asError(error)));
            }
          }
          if (safeDetailRequests.length > 0) await addRequests(safeDetailRequests);
        },
        errorHandler: async ({ request, page }) => {
          const data = requestData(request.userData);
          if (data.kind !== "list") return;
          const state = states.get(data.sourceId);
          if (state) await writeFailureEvidence(page, state.source, context.artifactsDir);
        },
        failedRequestHandler: async ({ request, page }, error) => {
          const data = requestData(request.userData);
          const state = states.get(data.sourceId);
          if (!state) return;
          const failure = asError(error);
          if (data.kind === "list") {
            await writeFailureEvidence(page, state.source, context.artifactsDir);
            state.error = failure;
            return;
          }
          const job = state.jobs?.[data.jobIndex!];
          state.detailSignals.push(detailFailureSignal(job?.canonicalUrl ?? request.url, failure));
        },
      };

      try {
        await this.createCrawler(options).run(initialRequests);
      } catch (error) {
        const failure = asError(error);
        for (const request of initialRequests) {
          const state = states.get(request.userData.sourceId);
          if (state && !state.error && !state.jobs) state.error = failure;
        }
      }
    }

    const results = new Map<string, BrowserCollectionResult>();
    for (const [sourceId, state] of states) {
      if (state.error) {
        results.set(sourceId, { ok: false, error: state.error });
        continue;
      }
      if (!state.jobs || state.html === null) {
        results.set(sourceId, {
          ok: false,
          error: new Error(`Browser crawler did not complete source: ${sourceId}`),
        });
        continue;
      }
      const signals = [
        ...suspiciousSignals(state.html, state.jobs.length),
        ...state.detailSignals,
      ];
      if (state.jobs.length === 0) signals.push("required-selector-not-found");
      results.set(sourceId, {
        ok: true,
        output: {
          status: "healthy",
          httpStatus: state.httpStatus,
          jobs: state.jobs,
          responseHash: createHash("sha256").update(state.html, "utf8").digest("hex"),
          etag: null,
          lastModified: null,
          signals,
        },
      });
    }
    return results;
  }
}
