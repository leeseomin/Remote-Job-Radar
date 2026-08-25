import { z } from "zod";

const httpUrlSchema = z.string().url().max(2_000).refine((value) => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}, "http 또는 https URL이어야 합니다.");


const forbiddenSourceHeaders = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "cf-access-client-id",
  "cf-access-client-secret",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
]);

const sourceHeadersSchema = z.record(
  z.string().min(1).max(100).regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/),
  z.string().max(2_000).refine((value) => !/[\r\n]/.test(value), "헤더 값에 줄바꿈을 넣을 수 없습니다."),
).refine(
  (headers) => !Object.keys(headers).some((name) => forbiddenSourceHeaders.has(name.toLocaleLowerCase("en-US"))),
  "인증·쿠키·프록시 관련 헤더는 수집 소스에 저장할 수 없습니다.",
);

export const adapterKindSchema = z.enum([
  "greenhouse",
  "lever",
  "ashby",
  "jsonld",
  "static-html",
  "playwright",
]);

export const sourceConfigSchema = z.object({
  listSelector: z.string().max(500).optional(),
  titleSelector: z.string().max(500).optional(),
  locationSelector: z.string().max(500).optional(),
  linkSelector: z.string().max(500).optional(),
  departmentSelector: z.string().max(500).optional(),
  detailDescriptionSelector: z.string().max(500).optional(),
  browserRequired: z.boolean().optional(),
  waitForSelector: z.string().max(500).optional(),
  headers: sourceHeadersSchema.optional(),
});

export const companyInputSchema = z.object({
  name: z.string().min(1).max(300),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(200),
  careersUrl: httpUrlSchema.nullable().optional(),
  remotePolicyUrl: httpUrlSchema.nullable().optional(),
  priority: z.number().int().min(0).max(100).default(50),
  active: z.boolean().default(true),
});

export const sourceInputSchema = z.object({
  companyId: z.string().min(1).max(200),
  kind: adapterKindSchema,
  url: httpUrlSchema,
  adapterKey: z.string().max(500).nullable().optional(),
  config: sourceConfigSchema.default({}),
  browserRequired: z.boolean().default(false),
  crawlIntervalMinutes: z.number().int().min(30).max(43_200).default(360),
  active: z.boolean().default(true),
});

export type AdapterKind = z.infer<typeof adapterKindSchema>;
export type SourceConfig = z.infer<typeof sourceConfigSchema>;
export type CompanyInput = z.infer<typeof companyInputSchema>;
export type SourceInput = z.infer<typeof sourceInputSchema>;
