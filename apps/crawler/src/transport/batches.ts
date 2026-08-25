import type { IngestPayload, NormalizedJob } from "@remote-job-radar/contracts";

const MAX_BODY_BYTES = 256 * 1024;
const SAFE_BODY_BYTES = MAX_BODY_BYTES - 2_048;
const MAX_JOBS_PER_BATCH = 10;

function bodySize(payload: IngestPayload): number {
  return Buffer.byteLength(JSON.stringify(payload), "utf8");
}

export function createIngestBatches(
  runId: string,
  sourceId: string,
  jobs: NormalizedJob[],
  fetchedAt: number,
): IngestPayload[] {
  const groups: NormalizedJob[][] = [];
  let current: NormalizedJob[] = [];
  const provisionalPayload = (candidate: NormalizedJob[]): IngestPayload => ({
    schemaVersion: 1,
    runId,
    sourceId,
    batchId: `${runId}-${sourceId}-9999`,
    sequence: 9_999,
    totalBatches: 9_999,
    fetchedAt,
    jobs: candidate,
  });

  for (const job of jobs) {
    const candidate = [...current, job];
    if (candidate.length > MAX_JOBS_PER_BATCH || bodySize(provisionalPayload(candidate)) > SAFE_BODY_BYTES) {
      if (current.length === 0 || bodySize(provisionalPayload([job])) > SAFE_BODY_BYTES) {
        throw new Error(`Single normalized job exceeds ingest body limit: ${job.title}`);
      }
      groups.push(current);
      current = [job];
    } else {
      current = candidate;
    }
  }
  if (current.length) groups.push(current);
  return groups.map((group, index) => ({
    schemaVersion: 1,
    runId,
    sourceId,
    batchId: `${runId}-${sourceId}-${String(index + 1).padStart(4, "0")}`,
    sequence: index + 1,
    totalBatches: groups.length,
    fetchedAt,
    jobs: group,
  }));
}
