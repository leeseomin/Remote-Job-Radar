import { createHash } from "node:crypto";
import type { NormalizedJob } from "@remote-job-radar/contracts";

type FingerprintJob = Pick<NormalizedJob, "externalId" | "contentHash">;

/**
 * Hash only the stable identity and normalized content of each job. Sorting the
 * tuples makes the source snapshot independent of the order returned by an ATS.
 */
export function createContentFingerprint(jobs: readonly FingerprintJob[]): string {
  const entries = jobs
    .map((job) => [job.externalId, job.contentHash] as const)
    .sort(([leftId, leftHash], [rightId, rightHash]) => {
      if (leftId !== rightId) return leftId < rightId ? -1 : 1;
      if (leftHash !== rightHash) return leftHash < rightHash ? -1 : 1;
      return 0;
    });

  return createHash("sha256")
    .update(JSON.stringify(entries), "utf8")
    .digest("hex");
}

export function canReuseContentSnapshot(
  storedFingerprint: string | null,
  snapshotRunId: string | null,
  currentFingerprint: string,
  anomaly: string | null,
): boolean {
  return anomaly === null
    && snapshotRunId !== null
    && storedFingerprint === currentFingerprint;
}
