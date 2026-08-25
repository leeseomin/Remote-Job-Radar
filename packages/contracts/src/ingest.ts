import { z } from "zod";
import { normalizedJobSchema } from "./job";

export const ingestPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1).max(200),
  sourceId: z.string().min(1).max(200),
  batchId: z.string().min(1).max(300),
  sequence: z.number().int().min(1),
  totalBatches: z.number().int().min(1).max(10_000),
  fetchedAt: z.number().int().positive(),
  jobs: z.array(normalizedJobSchema).max(10),
});

export const sourceCompleteSchema = z.object({
  runId: z.string().min(1).max(200),
  sourceId: z.string().min(1).max(200),
  status: z.enum(["healthy", "not_modified", "quarantined", "failed"]),
  httpStatus: z.number().int().min(0).max(599).nullable(),
  fetchedJobCount: z.number().int().min(0),
  previousJobCount: z.number().int().min(0),
  receivedBatchCount: z.number().int().min(0),
  expectedBatchCount: z.number().int().min(0),
  responseHash: z.string().max(128).nullable(),
  contentFingerprint: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  etag: z.string().max(1_000).nullable(),
  lastModified: z.string().max(1_000).nullable(),
  errorCode: z.string().max(100).nullable().optional(),
  errorMessage: z.string().max(2_000).nullable().optional(),
  signals: z.array(z.string().max(300)).max(20).default([]),
});

export const runCompleteSchema = z.object({
  runId: z.string().min(1).max(200),
  status: z.enum(["completed", "partial", "failed"]),
  completedSourceCount: z.number().int().min(0),
  failedSourceCount: z.number().int().min(0),
});

export type IngestPayload = z.infer<typeof ingestPayloadSchema>;
export type SourceCompletePayload = z.infer<typeof sourceCompleteSchema>;
export type RunCompletePayload = z.infer<typeof runCompleteSchema>;
