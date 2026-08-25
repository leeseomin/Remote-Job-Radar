import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { createHash } from "node:crypto";
import { assertSafeUrl } from "../security/ssrf";
import type { AdapterContext, AdapterOutput, CrawlSource, JobSourceAdapter, RawJob } from "../types";
import { suspiciousSignals } from "./helpers";

async function protectPage(page: Page): Promise<void> {
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

async function newProtectedPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await protectPage(page);
  return page;
}

export class PlaywrightAdapter implements JobSourceAdapter {
  readonly kind = "playwright" as const;

  async collect(source: CrawlSource, context: AdapterContext): Promise<AdapterOutput> {
    await assertSafeUrl(source.url);
    const listSelector = source.config.listSelector;
    const titleSelector = source.config.titleSelector;
    if (!listSelector || !titleSelector) throw new Error("playwright source requires listSelector and titleSelector");
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext({
      userAgent: "RemoteJobRadar/0.1 (+personal-public-job-monitor)",
      serviceWorkers: "block",
      javaScriptEnabled: true,
    });
    const page = await newProtectedPage(browserContext);
    try {
      const response = await page.goto(source.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      if (!response) throw new Error("Playwright navigation returned no response");
      if (response.status() >= 400) throw new Error(`HTTP ${response.status()} for ${source.url}`);
      await assertSafeUrl(page.url());
      const waitSelector = source.config.waitForSelector ?? listSelector;
      await page.waitForSelector(waitSelector, { timeout: 10_000 });

      const jobs = await page.locator(listSelector).evaluateAll((cards, config) => cards.slice(0, 300).map((card) => {
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
        titleSelector,
        linkSelector: source.config.linkSelector,
        departmentSelector: source.config.departmentSelector,
        locationSelector: source.config.locationSelector,
        detailDescriptionSelector: source.config.detailDescriptionSelector,
      });

      const rawJobs: RawJob[] = jobs.map((job) => ({
        ...job,
        companyName: source.companyName,
        employmentType: null,
      }));

      const detailSignals: string[] = [];
      if (source.config.detailDescriptionSelector) {
        const targets = rawJobs
          .filter((job) => job.descriptionText.length < 200 && job.canonicalUrl !== page.url())
          .slice(0, 60);
        let nextIndex = 0;
        const workerCount = Math.min(3, targets.length);
        await Promise.all(Array.from({ length: workerCount }, async () => {
          const detailPage = await newProtectedPage(browserContext);
          try {
            while (nextIndex < targets.length) {
              const index = nextIndex;
              nextIndex += 1;
              const job = targets[index];
              if (!job) continue;
              try {
                const safeDetailUrl = await assertSafeUrl(job.canonicalUrl);
                const detailResponse = await detailPage.goto(safeDetailUrl.toString(), {
                  waitUntil: "domcontentloaded",
                  timeout: 20_000,
                });
                if (!detailResponse || detailResponse.status() >= 400) {
                  detailSignals.push(`detail-http-failed:${job.canonicalUrl}`);
                  continue;
                }
                await assertSafeUrl(detailPage.url());
                const locator = detailPage.locator(source.config.detailDescriptionSelector!).first();
                if (await locator.count()) job.descriptionText = (await locator.innerText()).trim();
                else detailSignals.push(`detail-selector-not-found:${job.canonicalUrl}`);
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                detailSignals.push(`detail-fetch-failed:${job.canonicalUrl}:${message}`);
              }
            }
          } finally {
            await detailPage.close();
          }
        }));
      }

      const html = await page.content();
      const signals = [...suspiciousSignals(html, rawJobs.length), ...detailSignals];
      if (rawJobs.length === 0) signals.push("required-selector-not-found");
      return {
        status: "healthy",
        httpStatus: response.status(),
        jobs: rawJobs,
        responseHash: createHash("sha256").update(html, "utf8").digest("hex"),
        etag: null,
        lastModified: null,
        signals,
      };
    } catch (error) {
      await mkdir(context.artifactsDir, { recursive: true });
      await page.screenshot({ path: join(context.artifactsDir, `${source.id}-failure.png`), fullPage: true }).catch(() => undefined);
      await writeFile(join(context.artifactsDir, `${source.id}-failure.html`), await page.content().catch(() => ""), "utf8");
      throw error;
    } finally {
      await browserContext.close();
      await browser.close();
    }
  }
}
