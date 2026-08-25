import { Hono } from "hono";
import type { AppEnv } from "../env";
import { jsonOk } from "../lib/http";

export const dashboardRoutes = new Hono<AppEnv>();

dashboardRoutes.get("/", async (c) => {
  const results = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open,
      SUM(CASE WHEN status = 'open' AND NOT EXISTS (SELECT 1 FROM job_actions ja WHERE ja.job_id = jobs.id) THEN 1 ELSE 0 END) AS new,
      SUM(CASE WHEN status = 'open' AND score >= 85 THEN 1 ELSE 0 END) AS top_matches,
      SUM(CASE WHEN status = 'open' AND eligible_from_korea IN ('yes','likely') THEN 1 ELSE 0 END) AS korea_eligible,
      SUM(CASE WHEN status = 'open' AND async_level IN ('explicit','strong') THEN 1 ELSE 0 END) AS async_friendly
      FROM jobs`),
    c.env.DB.prepare(`SELECT
      SUM(CASE WHEN action = 'saved' THEN 1 ELSE 0 END) AS saved,
      SUM(CASE WHEN action = 'dismissed' THEN 1 ELSE 0 END) AS dismissed,
      SUM(CASE WHEN action = 'applied' THEN 1 ELSE 0 END) AS applied
      FROM job_actions`),
    c.env.DB.prepare(`SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN s.status = 'active' AND c.active = 1 THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN s.status = 'quarantined' THEN 1 ELSE 0 END) AS quarantined,
      SUM(CASE WHEN s.status = 'active' AND c.active = 1 AND s.next_due_at < ? THEN 1 ELSE 0 END) AS overdue
      FROM sources s JOIN companies c ON c.id = s.company_id`).bind(Math.floor(Date.now() / 1_000)),
    c.env.DB.prepare(`SELECT id, runner_type, status, planned_source_count,
      completed_source_count, failed_source_count, started_at, completed_at
      FROM crawl_runs ORDER BY started_at DESC LIMIT 5`),
  ]);

  return jsonOk(c, {
    jobs: results[0]?.results?.[0] ?? {},
    actions: results[1]?.results?.[0] ?? {},
    sources: results[2]?.results?.[0] ?? {},
    recentRuns: results[3]?.results ?? [],
  });
});
