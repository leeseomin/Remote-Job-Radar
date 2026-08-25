import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import { ApiError } from "../lib/errors";

export const accessUserMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  if (c.env.DEV_BYPASS_AUTH === "true") {
    c.set("authenticatedEmail", c.env.USER_EMAIL ?? "local@example.com");
    await next();
    return;
  }

  if (c.env.REQUIRE_ACCESS_USER !== "true") {
    c.set("authenticatedEmail", null);
    await next();
    return;
  }

  const email = c.req.header("Cf-Access-Authenticated-User-Email") ?? null;
  if (!email) {
    throw new ApiError(401, "ACCESS_REQUIRED", "Cloudflare Access 인증 헤더가 없습니다.");
  }
  if (c.env.USER_EMAIL && email.toLocaleLowerCase("en-US") !== c.env.USER_EMAIL.toLocaleLowerCase("en-US")) {
    throw new ApiError(403, "USER_NOT_ALLOWED", "허용되지 않은 사용자입니다.");
  }
  c.set("authenticatedEmail", email);
  await next();
});
