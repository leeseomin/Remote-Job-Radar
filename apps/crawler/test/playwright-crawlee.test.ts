import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlaywrightCrawlerOptions } from "@crawlee/playwright";
import type { Page } from "playwright";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BROWSER_MAX_CONCURRENCY,
  BROWSER_MAX_REQUEST_RETRIES,
  MAX_DETAIL_REQUESTS_PER_SOURCE,
  MAX_LIST_JOBS,
  PlaywrightAdapter,
  protectPage,
  type BrowserCrawlerFactory,
} from "../src/adapters/playwright";
import type { AdapterContext, CrawlSource } from "../src/types";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function source(id: string): CrawlSource {
  return {
    id,
    companyId: `company_${id}`,
    companyName: `Company ${id}`,
    adapter: "playwright",
    url: `https://93.184.216.34/${id}/jobs`,
    adapterKey: null,
    config: {
      listSelector: ".job",
      titleSelector: ".title",
      linkSelector: "a",
      detailDescriptionSelector: ".description",
    },
    etag: null,
    lastModified: null,
    contentFingerprint: null,
    snapshotRunId: null,
    previousJobCount: 0,
    browserRequired: true,
  };
}

function context(artifactsDir = "artifacts"): AdapterContext {
  return {
    artifactsDir,
    http: {
      get: vi.fn<AdapterContext["http"]["get"]>(),
    },
  };
}

function listPage(
  sourceId: string,
  urls = Array.from({ length: MAX_LIST_JOBS + 1 }, (_, index) => `https://93.184.216.34/${sourceId}/jobs/${index}`),
): Page {
  const cards = urls.map((url, index) => {
    const link = { href: url };
    const title = { textContent: `Job ${index}` };
    return {
      id: "",
      textContent: `Job ${index}`,
      getAttribute: (name: string) => name === "data-job-id" ? String(index) : null,
      matches: () => false,
      querySelector: (selector: string) => {
        if (selector === "a") return link;
        if (selector === ".title") return title;
        return null;
      },
    };
  });
  return {
    url: () => `https://93.184.216.34/${sourceId}/jobs`,
    waitForSelector: vi.fn(async () => undefined),
    content: vi.fn(async () => `<html><body>${"job ".repeat(40)}</body></html>`),
    locator: vi.fn(() => ({
      evaluateAll: async (handler: (values: unknown[], config: unknown) => unknown, config: unknown) => handler(cards, config),
    })),
  } as unknown as Page;
}

describe("PlaywrightAdapter Crawlee runtime", () => {
  it("uses one run-scoped crawler for multiple sources and preserves crawl limits", async () => {
    const capturedOptions: PlaywrightCrawlerOptions[] = [];
    let initialRequestCount = 0;
    const detailRequests: unknown[] = [];
    const factory = vi.fn<BrowserCrawlerFactory>((createdOptions) => {
      capturedOptions.push(createdOptions);
      return {
        run: async (requests) => {
          initialRequestCount = requests.length;
          for (const request of requests) {
            const addRequests = vi.fn(async (values: unknown[]) => {
              detailRequests.push(...values);
              return {};
            });
            await createdOptions.requestHandler!({
              request: { url: request.url, userData: request.userData },
              page: listPage(request.userData.sourceId),
              response: { status: () => 200 },
              addRequests,
            } as never);
          }
        },
      };
    });
    const adapter = new PlaywrightAdapter(factory);

    const results = await adapter.collectMany([source("one"), source("two")], context());

    expect(factory).toHaveBeenCalledTimes(1);
    expect(initialRequestCount).toBe(2);
    expect(detailRequests).toHaveLength(2 * MAX_DETAIL_REQUESTS_PER_SOURCE);
    const first = results.get("one");
    const second = results.get("two");
    expect(first?.ok).toBe(true);
    expect(second?.ok).toBe(true);
    if (!first?.ok || !second?.ok) throw new Error("Expected successful browser collection results");
    expect(first.output.jobs).toHaveLength(MAX_LIST_JOBS);
    expect(second.output.jobs).toHaveLength(MAX_LIST_JOBS);
    const options = capturedOptions[0]!;
    expect(options).toMatchObject({
      minConcurrency: BROWSER_MAX_CONCURRENCY,
      maxConcurrency: BROWSER_MAX_CONCURRENCY,
      maxRequestRetries: BROWSER_MAX_REQUEST_RETRIES,
      maxRequestsPerCrawl: 2 * (1 + MAX_DETAIL_REQUESTS_PER_SOURCE),
      respectRobotsTxtFile: true,
      retryOnBlocked: false,
      useSessionPool: false,
      launchContext: {
        useIncognitoPages: true,
        launchOptions: { headless: true },
      },
      browserPoolOptions: {
        maxOpenPagesPerBrowser: BROWSER_MAX_CONCURRENCY,
        retireBrowserAfterPageCount: 2 * (1 + MAX_DETAIL_REQUESTS_PER_SOURCE),
        useFingerprints: false,
      },
    });
    expect(options.proxyConfiguration).toBeUndefined();
  });

  it("skips an unsafe detail URL without failing the source", async () => {
    const addedDetails: unknown[] = [];
    const factory: BrowserCrawlerFactory = (options) => ({
      run: async (requests) => {
        const request = requests[0]!;
        await options.requestHandler!({
          request: { url: request.url, userData: request.userData },
          page: listPage("unsafe", [
            "http://127.0.0.1/private-job",
            "https://93.184.216.34/unsafe/jobs/safe-job",
          ]),
          response: { status: () => 200 },
          addRequests: async (values: unknown[]) => {
            addedDetails.push(...values);
            return {};
          },
        } as never);
      },
    });

    const result = (await new PlaywrightAdapter(factory).collectMany([source("unsafe")], context())).get("unsafe");

    expect(result?.ok).toBe(true);
    if (!result?.ok) throw new Error("Expected unsafe detail URL to be isolated from the source result");
    expect(addedDetails).toHaveLength(1);
    expect(result.output.signals).toContain(
      "detail-fetch-failed:http://127.0.0.1/private-job:Blocked private IP: 127.0.0.1",
    );
  });

  it("keeps final list-page HTML and screenshot evidence", async () => {
    const artifactsDir = await mkdtemp(join(tmpdir(), "remote-job-radar-browser-"));
    temporaryDirectories.push(artifactsDir);
    const screenshot = vi.fn(async () => undefined);
    const page = {
      screenshot,
      content: vi.fn(async () => "<html>failed browser page</html>"),
    } as unknown as Page;
    const factory: BrowserCrawlerFactory = (options) => ({
      run: async (requests) => {
        const request = requests[0]!;
        await options.failedRequestHandler!({
          request: { url: request.url, userData: request.userData },
          page,
        } as never, new Error("navigation failed"));
      },
    });

    const result = (await new PlaywrightAdapter(factory).collectMany([source("failure")], context(artifactsDir)))
      .get("failure");

    expect(result).toMatchObject({ ok: false, error: { message: "navigation failed" } });
    expect(screenshot).toHaveBeenCalledWith({
      path: join(artifactsDir, "failure-failure.png"),
      fullPage: true,
    });
    await expect(readFile(join(artifactsDir, "failure-failure.html"), "utf8"))
      .resolves.toBe("<html>failed browser page</html>");
  });
});

describe("Playwright request interception", () => {
  it("blocks heavy resources and private network requests", async () => {
    let handler: ((route: unknown) => Promise<void>) | null = null;
    const page = {
      route: vi.fn(async (_pattern: string, routeHandler: (route: unknown) => Promise<void>) => {
        handler = routeHandler;
      }),
    } as unknown as Page;
    await protectPage(page);

    const imageAbort = vi.fn(async () => undefined);
    await handler!({
      request: () => ({ resourceType: () => "image", url: () => "https://93.184.216.34/image.png" }),
      abort: imageAbort,
      continue: vi.fn(),
    });
    expect(imageAbort).toHaveBeenCalledOnce();

    const dataContinue = vi.fn(async () => undefined);
    await handler!({
      request: () => ({ resourceType: () => "document", url: () => "data:text/plain,ok" }),
      abort: vi.fn(),
      continue: dataContinue,
    });
    expect(dataContinue).toHaveBeenCalledOnce();

    const privateAbort = vi.fn(async () => undefined);
    await handler!({
      request: () => ({ resourceType: () => "document", url: () => "http://127.0.0.1/private" }),
      abort: privateAbort,
      continue: vi.fn(),
    });
    expect(privateAbort).toHaveBeenCalledWith("blockedbyclient");
  });
});
