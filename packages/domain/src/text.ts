export function normalizeWhitespace(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[\t\r ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeForMatch(value: string): string {
  return normalizeWhitespace(value)
    .toLocaleLowerCase("en-US")
    .replace(/[‐‑‒–—]/g, "-");
}

export function uniqueCaseInsensitive(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = normalizeWhitespace(raw);
    const key = value.toLocaleLowerCase("en-US");
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function findSnippet(
  original: string,
  needle: string,
  radius = 120,
): string {
  const lower = original.toLocaleLowerCase("en-US");
  const index = lower.indexOf(needle.toLocaleLowerCase("en-US"));
  if (index < 0) return truncate(normalizeWhitespace(original), radius * 2);
  const start = Math.max(0, index - radius);
  const end = Math.min(original.length, index + needle.length + radius);
  return truncate(normalizeWhitespace(original.slice(start, end)), 500);
}
