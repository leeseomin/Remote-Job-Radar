import { describe, expect, it } from "vitest";
import {
  canReuseContentSnapshot,
  createContentFingerprint,
} from "../src/normalize/content-fingerprint";

const alpha = { externalId: "alpha", contentHash: "a".repeat(64) };
const beta = { externalId: "beta", contentHash: "b".repeat(64) };

describe("source content fingerprint", () => {
  it("is stable when an adapter returns the same normalized jobs in a different order", () => {
    const first = createContentFingerprint([alpha, beta]);
    const reordered = createContentFingerprint([beta, alpha]);

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(reordered).toBe(first);
  });

  it("changes when normalized job content changes", () => {
    const before = createContentFingerprint([alpha, beta]);
    const after = createContentFingerprint([
      alpha,
      { ...beta, contentHash: "c".repeat(64) },
    ]);

    expect(after).not.toBe(before);
  });

  it("reuses ingest only for an initialized, anomaly-free matching snapshot", () => {
    const fingerprint = createContentFingerprint([alpha]);

    expect(canReuseContentSnapshot(fingerprint, "run_full_1", fingerprint, null)).toBe(true);
    expect(canReuseContentSnapshot(fingerprint, null, fingerprint, null)).toBe(false);
    expect(canReuseContentSnapshot(null, "run_full_1", fingerprint, null)).toBe(false);
    expect(canReuseContentSnapshot(fingerprint, "run_full_1", fingerprint, "captcha-page")).toBe(false);
  });
});
