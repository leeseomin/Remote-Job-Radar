import { describe, expect, it } from "vitest";
import { sanitizeSourceHeaders } from "../src/fetch/http-client";
import { assertSafeUrl, isPrivateIp } from "../src/security/ssrf";

describe("SSRF protection", () => {
  it("blocks private address ranges", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    expect(isPrivateIp("10.0.0.1")).toBe(true);
    expect(isPrivateIp("192.168.1.10")).toBe(true);
    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("::ffff:7f00:1")).toBe(true);
    expect(isPrivateIp("8.8.8.8")).toBe(false);
  });

  it("blocks localhost and loopback literal URLs", async () => {
    await expect(assertSafeUrl("http://localhost:8080/jobs")).rejects.toThrow(/Blocked/);
    await expect(assertSafeUrl("http://[::1]/jobs")).rejects.toThrow(/Blocked/);
  });
});

describe("source request headers", () => {
  it("rejects credentials and hop-by-hop overrides", () => {
    expect(() => sanitizeSourceHeaders({ Authorization: "Bearer secret" })).toThrow(/Blocked/);
    expect(() => sanitizeSourceHeaders({ Cookie: "session=secret" })).toThrow(/Blocked/);
    expect(sanitizeSourceHeaders({ "Accept-Language": "en-US" })).toEqual({ "Accept-Language": "en-US" });
  });
});
