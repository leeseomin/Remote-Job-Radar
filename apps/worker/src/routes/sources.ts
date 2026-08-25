import { Hono, type Context } from "hono";
import { sourceInputSchema, type SourceInput } from "@remote-job-radar/contracts";
import type { AppEnv } from "../env";
import { parseJson, unixNow } from "../lib/db";
import { ApiError } from "../lib/errors";
import { jsonOk } from "../lib/http";

export const sourcesRoutes = new Hono<AppEnv>();

function validateAdapterRequirements(input: SourceInput): void {
  if (["greenhouse", "lever", "ashby"].includes(input.kind) && !input.adapterKey?.trim()) {
    throw new ApiError(422, "ADAPTER_KEY_REQUIRED", `${input.kind} 소스에는 adapterKey가 필요합니다.`);
  }
  if ((input.kind === "static-html" || input.kind === "playwright") &&
      (!input.config.listSelector || !input.config.titleSelector)) {
    throw new ApiError(422, "SELECTORS_REQUIRED", `${input.kind} 소스에는 listSelector와 titleSelector가 필요합니다.`);
  }
}

async function ensureCompanyExists(c: Context<AppEnv>, companyId: string): Promise<void> {
  const company = await c.env.DB.prepare("SELECT id FROM companies WHERE id = ?").bind(companyId).first();
  if (!company) throw new ApiError(404, "COMPANY_NOT_FOUND", "기업을 찾을 수 없습니다.");
}

sourcesRoutes.get("/", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT
    s.*, c.name AS company_name, c.active AS company_active,
    (SELECT sr.http_status FROM source_runs sr WHERE sr.source_id = s.id ORDER BY sr.started_at DESC LIMIT 1) AS last_http_status,
    (SELECT sr.error_code FROM source_runs sr WHERE sr.source_id = s.id ORDER BY sr.started_at DESC LIMIT 1) AS last_error_code,
    (SELECT sr.error_message FROM source_runs sr WHERE sr.source_id = s.id ORDER BY sr.started_at DESC LIMIT 1) AS last_error_message
    FROM sources s JOIN companies c ON c.id = s.company_id
    ORDER BY c.priority DESC, c.name ASC, s.kind ASC`).all<Record<string, unknown>>();
  return jsonOk(c, (rows.results ?? []).map((row) => ({
    ...row,
    config: parseJson(row.config_json, {}),
    config_json: undefined,
  })));
});

sourcesRoutes.post("/", async (c) => {
  const parsed = sourceInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(422, "INVALID_SOURCE", "소스 입력이 올바르지 않습니다.", parsed.error.flatten());
  validateAdapterRequirements(parsed.data);
  await ensureCompanyExists(c, parsed.data.companyId);
  const now = unixNow();
  const id = `source_${crypto.randomUUID()}`;
  const browserRequired = parsed.data.kind === "playwright" || parsed.data.browserRequired;
  await c.env.DB.prepare(`INSERT INTO sources
    (id, company_id, kind, url, adapter_key, config_json, browser_required,
     crawl_interval_minutes, next_due_at, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      id,
      parsed.data.companyId,
      parsed.data.kind,
      parsed.data.url,
      parsed.data.adapterKey?.trim() || null,
      JSON.stringify(parsed.data.config),
      browserRequired ? 1 : 0,
      parsed.data.crawlIntervalMinutes,
      now,
      parsed.data.active ? "active" : "paused",
      now,
      now,
    )
    .run();
  return jsonOk(c, { id, ...parsed.data, browserRequired, nextDueAt: now }, 201);
});

sourcesRoutes.patch("/:id", async (c) => {
  const patch = sourceInputSchema.partial().safeParse(await c.req.json().catch(() => null));
  if (!patch.success) throw new ApiError(422, "INVALID_SOURCE", "소스 입력이 올바르지 않습니다.", patch.error.flatten());
  const current = await c.env.DB.prepare("SELECT * FROM sources WHERE id = ?")
    .bind(c.req.param("id"))
    .first<Record<string, unknown>>();
  if (!current) throw new ApiError(404, "SOURCE_NOT_FOUND", "소스를 찾을 수 없습니다.");

  const kindChanged = patch.data.kind !== undefined && patch.data.kind !== current.kind;
  const candidate = sourceInputSchema.safeParse({
    companyId: patch.data.companyId ?? current.company_id,
    kind: patch.data.kind ?? current.kind,
    url: patch.data.url ?? current.url,
    adapterKey: patch.data.adapterKey === undefined ? current.adapter_key : patch.data.adapterKey,
    config: patch.data.config ?? parseJson(current.config_json, {}),
    browserRequired: patch.data.browserRequired ??
      (kindChanged ? patch.data.kind === "playwright" : Boolean(current.browser_required)),
    crawlIntervalMinutes: patch.data.crawlIntervalMinutes ?? current.crawl_interval_minutes,
    active: patch.data.active ?? current.status === "active",
  });
  if (!candidate.success) {
    throw new ApiError(422, "INVALID_SOURCE", "변경 후 소스 구성이 올바르지 않습니다.", candidate.error.flatten());
  }
  validateAdapterRequirements(candidate.data);
  await ensureCompanyExists(c, candidate.data.companyId);

  const now = unixNow();
  const nextBrowserRequired = candidate.data.kind === "playwright" || candidate.data.browserRequired ? 1 : 0;
  const nextStatus = patch.data.active === undefined
    ? String(current.status)
    : patch.data.active ? "active" : "paused";
  await c.env.DB.prepare(`UPDATE sources SET
      company_id = ?, kind = ?, url = ?, adapter_key = ?, config_json = ?, browser_required = ?,
      crawl_interval_minutes = ?, status = ?, next_due_at = ?, updated_at = ?
      WHERE id = ?`)
    .bind(
      candidate.data.companyId,
      candidate.data.kind,
      candidate.data.url,
      candidate.data.adapterKey?.trim() || null,
      JSON.stringify(candidate.data.config),
      nextBrowserRequired,
      candidate.data.crawlIntervalMinutes,
      nextStatus,
      patch.data.active === true ? now : current.next_due_at,
      now,
      c.req.param("id"),
    )
    .run();
  return jsonOk(c, { id: c.req.param("id"), updatedAt: now });
});

sourcesRoutes.post("/:id/test", async (c) => {
  const now = unixNow();
  const result = await c.env.DB.prepare(`UPDATE sources SET status = 'active', next_due_at = ?, lease_owner = NULL,
    lease_until = NULL, updated_at = ? WHERE id = ?`).bind(now, now, c.req.param("id")).run();
  if ((result.meta.changes ?? 0) === 0) throw new ApiError(404, "SOURCE_NOT_FOUND", "소스를 찾을 수 없습니다.");
  return jsonOk(c, { id: c.req.param("id"), queuedForNextCrawler: true, nextDueAt: now });
});

sourcesRoutes.post("/:id/reset-health", async (c) => {
  const now = unixNow();
  const result = await c.env.DB.prepare(`UPDATE sources SET status = 'active', consecutive_failures = 0,
    lease_owner = NULL, lease_until = NULL, next_due_at = ?, updated_at = ? WHERE id = ?`)
    .bind(now, now, c.req.param("id"))
    .run();
  if ((result.meta.changes ?? 0) === 0) throw new ApiError(404, "SOURCE_NOT_FOUND", "소스를 찾을 수 없습니다.");
  return jsonOk(c, { id: c.req.param("id"), status: "active", nextDueAt: now });
});
