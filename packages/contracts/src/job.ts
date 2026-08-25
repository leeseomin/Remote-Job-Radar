import { z } from "zod";

export const workplaceTypeSchema = z.enum(["remote", "hybrid", "onsite", "unknown"]);
export const remoteScopeSchema = z.enum([
  "worldwide",
  "apac",
  "country-list",
  "region-limited",
  "unknown",
]);
export const eligibilitySchema = z.enum(["yes", "likely", "unknown", "no"]);
export const asyncLevelSchema = z.enum([
  "explicit",
  "strong",
  "weak",
  "synchronous",
  "unknown",
]);

export const evidenceSchema = z.object({
  field: z.string().min(1).max(80),
  effect: z.number().int().min(-100).max(100),
  text: z.string().min(1).max(500),
  source: z.enum(["job-description", "title", "location", "metadata"]),
});

export const normalizedJobSchema = z.object({
  externalId: z.string().min(1).max(300),
  canonicalUrl: z.string().url().max(2_000),
  title: z.string().min(1).max(500),
  companyName: z.string().min(1).max(300),
  department: z.string().max(300).nullable(),
  locationText: z.string().max(500).nullable(),
  employmentType: z.string().max(120).nullable(),
  descriptionText: z.string().max(48_000),
  searchText: z.string().max(12_000),
  skills: z.array(z.string().max(100)).max(40),
  workplaceType: workplaceTypeSchema,
  remoteScope: remoteScopeSchema,
  eligibleFromKorea: eligibilitySchema,
  asyncLevel: asyncLevelSchema,
  requiredTimezone: z.string().max(80).nullable(),
  requiredOverlapHours: z.number().min(0).max(24).nullable(),
  salaryCurrency: z.string().max(10).nullable(),
  salaryMin: z.number().nonnegative().nullable(),
  salaryMax: z.number().nonnegative().nullable(),
  salaryInterval: z.string().max(30).nullable(),
  postedAt: z.number().int().positive().nullable(),
  score: z.number().int().min(0).max(100),
  confidence: z.number().min(0).max(1),
  evidence: z.array(evidenceSchema).max(12),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export const jobActionSchema = z.object({
  action: z.enum(["saved", "dismissed", "applied"]),
  dismissReason: z.string().max(500).nullable().optional(),
  notes: z.string().max(5_000).nullable().optional(),
  appliedAt: z.number().int().positive().nullable().optional(),
});

export type NormalizedJob = z.infer<typeof normalizedJobSchema>;
export type JobActionInput = z.infer<typeof jobActionSchema>;
