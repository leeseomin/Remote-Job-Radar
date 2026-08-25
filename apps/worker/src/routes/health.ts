import { Hono } from "hono";
import type { AppEnv } from "../env";
import { jsonOk } from "../lib/http";

export const healthRoutes = new Hono<AppEnv>();

healthRoutes.get("/", async (c) => {
  const db = await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
  return jsonOk(c, {
    service: "remote-job-radar",
    version: "0.1.0",
    database: db?.ok === 1 ? "ok" : "unknown",
    timestamp: Math.floor(Date.now() / 1_000),
  });
});
