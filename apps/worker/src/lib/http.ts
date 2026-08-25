import type { Context } from "hono";
import type { AppEnv } from "../env";

export function jsonOk<T>(c: Context<AppEnv>, data: T, status: 200 | 201 = 200) {
  c.header("Cache-Control", "no-store");
  return c.json({ ok: true, data, requestId: c.get("requestId") }, status);
}

export function parsePositiveInt(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

export function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function safeFtsQuery(value: string): string {
  const tokens = value
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/["']/g, "").slice(0, 80))
    .filter(Boolean)
    .slice(0, 12);
  return tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(" AND ");
}
