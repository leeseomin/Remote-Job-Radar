import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv } from "./env";
import { ApiError } from "./lib/errors";
import { accessUserMiddleware } from "./middleware/access-user";
import { requestIdMiddleware } from "./middleware/request-id";
import { companiesRoutes } from "./routes/companies";
import { dashboardRoutes } from "./routes/dashboard";
import { healthRoutes } from "./routes/health";
import { internalRoutes } from "./routes/internal";
import { jobsRoutes } from "./routes/jobs";
import { sourcesRoutes } from "./routes/sources";

const app = new Hono<AppEnv>();

app.use("*", requestIdMiddleware);
app.use("*", secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:", "https:"],
    connectSrc: ["'self'"],
    frameAncestors: ["'none'"],
  },
  referrerPolicy: "strict-origin-when-cross-origin",
}));

app.get("/api", (c) => c.json({ ok: true, service: "remote-job-radar" }));
app.route("/api/health", healthRoutes);
app.route("/api/internal", internalRoutes);

const userApi = new Hono<AppEnv>();
userApi.use("*", accessUserMiddleware);
userApi.route("/jobs", jobsRoutes);
userApi.route("/companies", companiesRoutes);
userApi.route("/sources", sourcesRoutes);
userApi.route("/dashboard", dashboardRoutes);
app.route("/api", userApi);

app.notFound(async (c) => {
  if (new URL(c.req.url).pathname.startsWith("/api/")) {
    return c.json({
      ok: false,
      error: { code: "NOT_FOUND", message: "API 경로를 찾을 수 없습니다." },
      requestId: c.get("requestId"),
    }, 404);
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

app.onError((error, c) => {
  console.error(JSON.stringify({
    level: "error",
    requestId: c.get("requestId"),
    path: new URL(c.req.url).pathname,
    message: error.message,
    stack: error.stack,
  }));
  if (error instanceof ApiError) {
    return c.json({
      ok: false,
      error: { code: error.code, message: error.message, details: error.details },
      requestId: c.get("requestId"),
    }, error.status);
  }
  return c.json({
    ok: false,
    error: { code: "INTERNAL_ERROR", message: "서버 처리 중 오류가 발생했습니다." },
    requestId: c.get("requestId"),
  }, 500);
});

export default app;
