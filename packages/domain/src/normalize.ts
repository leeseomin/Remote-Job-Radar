import type { Evidence } from "./types";
import { normalizeWhitespace, truncate, uniqueCaseInsensitive } from "./text";

export interface NormalizableJob {
  descriptionText: string;
  searchText: string;
  skills: string[];
  evidence: Evidence[];
}

export function enforceJobLimits<T extends NormalizableJob>(job: T): T {
  return {
    ...job,
    descriptionText: truncate(normalizeWhitespace(job.descriptionText), 48_000),
    searchText: truncate(normalizeWhitespace(job.searchText), 12_000),
    skills: uniqueCaseInsensitive(job.skills).slice(0, 40),
    evidence: job.evidence.slice(0, 12).map((item) => ({
      ...item,
      text: truncate(normalizeWhitespace(item.text), 500),
    })),
  };
}

export function makeSearchText(parts: Array<string | null | undefined>): string {
  return truncate(
    normalizeWhitespace(parts.filter((part): part is string => Boolean(part)).join("\n")),
    12_000,
  );
}
