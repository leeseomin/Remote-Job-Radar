import { describe, expect, it } from "vitest";
import { parseAshby } from "../src/adapters/ashby";
import { parseGreenhouse } from "../src/adapters/greenhouse";
import { parseJsonLd } from "../src/adapters/jsonld";
import { parseLever } from "../src/adapters/lever";
import type { CrawlSource } from "../src/types";

const source: CrawlSource = {
  id: "source_test",
  companyId: "company_test",
  companyName: "Example",
  adapter: "greenhouse",
  url: "https://example.com/jobs",
  adapterKey: "example",
  config: {},
  etag: null,
  lastModified: null,
  previousJobCount: 0,
  browserRequired: false,
};

describe("ATS adapters", () => {
  it("parses Greenhouse", () => {
    const jobs = parseGreenhouse(JSON.stringify({ jobs: [{
      id: 1,
      title: "Frontend Engineer",
      absolute_url: "https://example.com/jobs/1",
      location: { name: "Remote" },
      content: "<p>Three.js</p>",
    }] }), source);
    expect(jobs[0]?.title).toBe("Frontend Engineer");
    expect(jobs[0]?.descriptionText).toBe("Three.js");
  });

  it("parses Lever", () => {
    const jobs = parseLever(JSON.stringify([{ id: "1", text: "Product Engineer", hostedUrl: "https://example.com/1", descriptionPlain: "Async-first" }]), source);
    expect(jobs).toHaveLength(1);
  });

  it("parses Ashby", () => {
    const jobs = parseAshby(JSON.stringify({ jobs: [{ id: "1", title: "Graphics Engineer", jobUrl: "https://example.com/1", descriptionHtml: "<b>WebGPU</b>" }] }), source);
    expect(jobs[0]?.descriptionText).toContain("WebGPU");
  });

  it("parses JobPosting JSON-LD", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "JobPosting",
      title: "Visualization Engineer",
      description: "<p>WebGL</p>",
      url: "https://example.com/jobs/visualization",
      jobLocationType: "TELECOMMUTE",
      applicantLocationRequirements: { "@type": "Country", name: "Worldwide" },
    })}</script>`;
    const jobs = parseJsonLd(html, source);
    expect(jobs[0]?.title).toBe("Visualization Engineer");
    expect(jobs[0]?.locationText).toContain("Worldwide");
  });
});
