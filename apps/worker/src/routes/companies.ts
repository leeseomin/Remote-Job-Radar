import { Hono } from "hono";
import { companyInputSchema } from "@remote-job-radar/contracts";
import type { AppEnv } from "../env";
import { unixNow } from "../lib/db";
import { ApiError, isD1ConstraintError } from "../lib/errors";
import { jsonOk } from "../lib/http";

export const companiesRoutes = new Hono<AppEnv>();

companiesRoutes.get("/", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT c.*,
    COUNT(DISTINCT s.id) AS source_count,
    COUNT(DISTINCT CASE WHEN j.status = 'open' THEN j.id END) AS open_job_count
    FROM companies c
    LEFT JOIN sources s ON s.company_id = c.id
    LEFT JOIN jobs j ON j.company_id = c.id
    GROUP BY c.id
    ORDER BY c.priority DESC, c.name ASC`).all();
  return jsonOk(c, rows.results ?? []);
});

companiesRoutes.post("/", async (c) => {
  const parsed = companyInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(422, "INVALID_COMPANY", "기업 입력이 올바르지 않습니다.", parsed.error.flatten());
  const now = unixNow();
  const id = `company_${crypto.randomUUID()}`;
  try {
    await c.env.DB.prepare(`INSERT INTO companies
      (id, slug, name, careers_url, remote_policy_url, priority, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        id,
        parsed.data.slug,
        parsed.data.name,
        parsed.data.careersUrl ?? null,
        parsed.data.remotePolicyUrl ?? null,
        parsed.data.priority,
        parsed.data.active ? 1 : 0,
        now,
        now,
      )
      .run();
  } catch (error) {
    if (isD1ConstraintError(error)) throw new ApiError(409, "COMPANY_EXISTS", "같은 slug의 기업이 이미 있습니다.");
    throw error;
  }
  return jsonOk(c, { id, ...parsed.data, createdAt: now, updatedAt: now }, 201);
});

companiesRoutes.patch("/:id", async (c) => {
  const parsed = companyInputSchema.partial().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(422, "INVALID_COMPANY", "기업 입력이 올바르지 않습니다.", parsed.error.flatten());
  const current = await c.env.DB.prepare("SELECT * FROM companies WHERE id = ?").bind(c.req.param("id")).first<Record<string, unknown>>();
  if (!current) throw new ApiError(404, "COMPANY_NOT_FOUND", "기업을 찾을 수 없습니다.");
  const now = unixNow();
  try {
    await c.env.DB.prepare(`UPDATE companies SET
        slug = ?, name = ?, careers_url = ?, remote_policy_url = ?, priority = ?, active = ?, updated_at = ?
        WHERE id = ?`)
      .bind(
        parsed.data.slug ?? current.slug,
        parsed.data.name ?? current.name,
        parsed.data.careersUrl === undefined ? current.careers_url : parsed.data.careersUrl,
        parsed.data.remotePolicyUrl === undefined ? current.remote_policy_url : parsed.data.remotePolicyUrl,
        parsed.data.priority ?? current.priority,
        parsed.data.active === undefined ? current.active : parsed.data.active ? 1 : 0,
        now,
        c.req.param("id"),
      )
      .run();
  } catch (error) {
    if (isD1ConstraintError(error)) throw new ApiError(409, "COMPANY_EXISTS", "같은 slug의 기업이 이미 있습니다.");
    throw error;
  }
  return jsonOk(c, { id: c.req.param("id"), updatedAt: now });
});
