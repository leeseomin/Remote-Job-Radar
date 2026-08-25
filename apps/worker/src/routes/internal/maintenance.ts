import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { unixNow } from "../../lib/db";
import { jsonOk } from "../../lib/http";

export const maintenanceRoutes = new Hono<AppEnv>();

maintenanceRoutes.get("/export-user-data", async (c) => {
  const results = await c.env.DB.batch([
    c.env.DB.prepare("SELECT * FROM companies ORDER BY priority DESC, name ASC"),
    c.env.DB.prepare("SELECT * FROM sources ORDER BY company_id, id"),
    c.env.DB.prepare(`SELECT ja.*, j.title, j.company_name, j.canonical_url
      FROM job_actions ja JOIN jobs j ON j.id = ja.job_id ORDER BY ja.updated_at DESC`),
  ]);
  c.header("Content-Disposition", `attachment; filename="remote-job-radar-user-data-${new Date().toISOString().slice(0, 10)}.json"`);
  return jsonOk(c, {
    schemaVersion: 1,
    exportedAt: unixNow(),
    companies: results[0]?.results ?? [],
    sources: results[1]?.results ?? [],
    jobActions: results[2]?.results ?? [],
  });
});

maintenanceRoutes.post("/cleanup", async (c) => {
  const now = unixNow();
  const day = 86_400;
  const results = await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM ingest_nonces WHERE used_at < ?").bind(now - day),
    c.env.DB.prepare("DELETE FROM source_runs WHERE started_at < ?").bind(now - 30 * day),
    c.env.DB.prepare("DELETE FROM crawl_runs WHERE started_at < ?").bind(now - 90 * day),
    c.env.DB.prepare(`DELETE FROM job_versions WHERE rowid IN (
      SELECT rowid FROM (
        SELECT rowid, ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY observed_at DESC) AS rank
        FROM job_versions
      ) WHERE rank > 3
    )`),
    c.env.DB.prepare(`DELETE FROM jobs
      WHERE status = 'closed' AND closed_at < ?
        AND NOT EXISTS (SELECT 1 FROM job_actions ja WHERE ja.job_id = jobs.id)`)
      .bind(now - 180 * day),
  ]);
  return jsonOk(c, {
    removedNonces: results[0]?.meta.changes ?? 0,
    removedSourceRuns: results[1]?.meta.changes ?? 0,
    removedCrawlRuns: results[2]?.meta.changes ?? 0,
    removedVersions: results[3]?.meta.changes ?? 0,
    removedClosedJobs: results[4]?.meta.changes ?? 0,
  });
});
