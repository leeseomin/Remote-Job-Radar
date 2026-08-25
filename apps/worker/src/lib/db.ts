import { ApiError } from "./errors";

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function firstOr404<T>(
  statement: D1PreparedStatement,
  message = "대상을 찾을 수 없습니다.",
): Promise<T> {
  const row = await statement.first<T>();
  if (!row) throw new ApiError(404, "NOT_FOUND", message);
  return row;
}

export function placeholders(count: number): string {
  if (count <= 0) throw new Error("placeholder count must be positive");
  return Array.from({ length: count }, () => "?").join(",");
}

export function asBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

export function unixNow(): number {
  return Math.floor(Date.now() / 1_000);
}
