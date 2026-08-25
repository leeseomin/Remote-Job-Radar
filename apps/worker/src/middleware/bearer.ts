import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import { constantTimeEqual } from "../lib/crypto";
import { ApiError } from "../lib/errors";

export const bearerMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  if (c.env.DEV_BYPASS_AUTH === "true" && !c.req.header("Authorization")) {
    await next();
    return;
  }
  const configured = c.env.INGEST_BEARER_TOKEN;
  if (!configured) throw new ApiError(500, "SECRET_MISSING", "INGEST_BEARER_TOKEN이 설정되지 않았습니다.");
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !constantTimeEqual(token, configured)) {
    throw new ApiError(401, "INVALID_BEARER", "내부 API Bearer Token이 올바르지 않습니다.");
  }
  await next();
});
