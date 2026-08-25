import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const initialMigration = new URL("../migrations/0001_initial.sql", import.meta.url);
const ftsMigration = new URL("../migrations/0002_fts_and_retention.sql", import.meta.url);

function totalChanges(db: DatabaseSync): number {
  const row = db.prepare("SELECT total_changes() AS changes").get() as { changes: number };
  return Number(row.changes);
}

describe("guarded jobs FTS update trigger", () => {
  it("does not rewrite FTS for presence-only or unchanged-content updates", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(readFileSync(initialMigration, "utf8"));
      db.exec(readFileSync(ftsMigration, "utf8"));
      db.exec(`
        INSERT INTO companies (id, slug, name, created_at, updated_at)
        VALUES ('company_test', 'test', 'Test Company', 1, 1);
        INSERT INTO sources (id, company_id, kind, url, next_due_at, created_at, updated_at)
        VALUES ('source_test', 'company_test', 'greenhouse', 'https://example.com/jobs', 1, 1, 1);
        INSERT INTO jobs (
          id, source_id, company_id, external_id, dedupe_key, canonical_url,
          title, company_name, description_text, search_text, content_hash,
          first_seen_at, last_seen_at, created_at, updated_at
        ) VALUES (
          'job_test', 'source_test', 'company_test', 'external_test', 'dedupe_test',
          'https://example.com/jobs/1', 'Alpha Engineer', 'Test Company',
          'Alpha description', 'alpha engineer', 'hash_alpha', 1, 1, 1, 1
        );
      `);

      const beforePresenceUpdate = totalChanges(db);
      db.exec(`UPDATE jobs SET
        last_seen_at = 2,
        last_seen_run_id = 'run_2',
        missing_count = 0,
        status = 'open',
        updated_at = 2
        WHERE id = 'job_test'`);
      expect(totalChanges(db) - beforePresenceUpdate).toBe(1);

      const beforeUnchangedUpsertShape = totalChanges(db);
      db.exec(`UPDATE jobs SET
        title = title,
        company_name = company_name,
        location_text = location_text,
        skills_text = skills_text,
        search_text = search_text,
        last_seen_at = 3,
        last_seen_run_id = 'run_3',
        updated_at = 3
        WHERE id = 'job_test'`);
      expect(totalChanges(db) - beforeUnchangedUpsertShape).toBe(1);

      const beforeContentUpdate = totalChanges(db);
      db.exec(`UPDATE jobs SET
        title = 'Beta Engineer',
        search_text = 'beta engineer',
        content_hash = 'hash_beta',
        last_seen_at = 4,
        last_seen_run_id = 'run_4',
        updated_at = 4
        WHERE id = 'job_test'`);
      expect(totalChanges(db) - beforeContentUpdate).toBeGreaterThan(1);

      const beta = db.prepare("SELECT rowid FROM jobs_fts WHERE jobs_fts MATCH 'beta'").all();
      const alpha = db.prepare("SELECT rowid FROM jobs_fts WHERE jobs_fts MATCH 'alpha'").all();
      expect(beta).toHaveLength(1);
      expect(alpha).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it("normalizes legacy schedule and browser flags without changing custom intervals", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(readFileSync(initialMigration, "utf8"));
      db.exec(`
        INSERT INTO companies (id, slug, name, created_at, updated_at)
        VALUES ('company_test', 'test', 'Test Company', 1, 1);
        INSERT INTO sources (
          id, company_id, kind, url, browser_required, crawl_interval_minutes,
          next_due_at, created_at, updated_at
        ) VALUES
          ('source_fast', 'company_test', 'greenhouse', 'https://example.com/fast', 1, 360, 1, 1, 1),
          ('source_browser', 'company_test', 'playwright', 'https://example.com/browser', 0, 360, 1, 1, 1),
          ('source_custom', 'company_test', 'static-html', 'https://example.com/custom', 1, 180, 1, 1, 1);
      `);

      db.exec(readFileSync(ftsMigration, "utf8"));
      const rows = db.prepare(`SELECT id, crawl_interval_minutes, browser_required
        FROM sources ORDER BY id`).all() as Array<{
          id: string;
          crawl_interval_minutes: number;
          browser_required: number;
        }>;

      expect(rows.map((row) => ({ ...row }))).toEqual([
        { id: "source_browser", crawl_interval_minutes: 720, browser_required: 1 },
        { id: "source_custom", crawl_interval_minutes: 180, browser_required: 0 },
        { id: "source_fast", crawl_interval_minutes: 720, browser_required: 0 },
      ]);
    } finally {
      db.close();
    }
  });
});
