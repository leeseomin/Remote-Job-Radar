import { describe, expect, it } from "vitest";
import {
  canonicalSignatureInput,
  sha256Hex,
  verifyHmac,
} from "../src/lib/crypto";

const encoder = new TextEncoder();

describe("ingest signature", () => {
  it("verifies the canonical HMAC", async () => {
    const secret = "test-secret";
    const bodyHash = await sha256Hex('{"ok":true}');
    const canonical = canonicalSignatureInput(
      "POST",
      "/api/internal/ingest",
      "1786579200",
      "nonce-123456789",
      bodyHash,
    );
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(canonical)));
    await expect(verifyHmac(secret, canonical, signature)).resolves.toBe(true);
    await expect(verifyHmac("wrong", canonical, signature)).resolves.toBe(false);
  });
});
