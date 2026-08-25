import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AppEnv, Bindings } from "../src/env";
import { ApiError } from "../src/lib/errors";
import { signedBodyMiddleware } from "../src/middleware/hmac";

function testApp() {
  const app = new Hono<AppEnv>();
  app.use("/signed", signedBodyMiddleware);
  app.post("/signed", (c) => c.json({ ok: true }));
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json({ code: error.code, message: error.message }, error.status);
    }
    throw error;
  });
  return app;
}

describe("signed body size limit", () => {
  it("rejects request bodies larger than 256KB before signature validation", async () => {
    const response = await testApp().request("http://worker.test/signed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "x".repeat(256 * 1024 + 1),
    }, {} as Bindings);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      code: "BODY_TOO_LARGE",
      message: "요청 본문은 256KB를 넘을 수 없습니다.",
    });
  });
});
