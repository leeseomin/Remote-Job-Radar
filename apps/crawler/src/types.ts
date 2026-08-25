import type { AdapterKind, SourceConfig } from "@remote-job-radar/contracts";

export interface CrawlSource {
  id: string;
  companyId: string;
  companyName: string;
  adapter: AdapterKind;
  url: string;
  adapterKey: string | null;
  config: SourceConfig;
  etag: string | null;
  lastModified: string | null;
  previousJobCount: number;
  browserRequired: boolean;
}

export interface CrawlPlan {
  runId: string;
  runner: "fast" | "browser";
  leaseExpiresAt: number;
  sources: CrawlSource[];
}

export interface RawSalary {
  currency: string | null;
  min: number | null;
  max: number | null;
  interval: string | null;
}

export interface RawJob {
  externalId: string | null;
  canonicalUrl: string;
  title: string;
  companyName: string;
  department: string | null;
  locationText: string | null;
  employmentType: string | null;
  descriptionText: string;
  postedAt: string | number | null;
  salary?: RawSalary | null;
}

export interface HttpResult {
  status: number;
  url: string;
  body: string;
  contentType: string;
  etag: string | null;
  lastModified: string | null;
  notModified: boolean;
}

export interface AdapterOutput {
  status: "healthy" | "not_modified";
  httpStatus: number | null;
  jobs: RawJob[];
  responseHash: string | null;
  etag: string | null;
  lastModified: string | null;
  signals: string[];
}

export interface AdapterContext {
  http: {
    get(url: string, options?: {
      etag?: string | null | undefined;
      lastModified?: string | null | undefined;
      headers?: Record<string, string> | undefined;
    }): Promise<HttpResult>;
  };
  artifactsDir: string;
}

export interface JobSourceAdapter {
  readonly kind: AdapterKind;
  collect(source: CrawlSource, context: AdapterContext): Promise<AdapterOutput>;
}
