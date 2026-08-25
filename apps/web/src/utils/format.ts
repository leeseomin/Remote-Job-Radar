export function relativeTime(timestamp: number | null | undefined): string {
  if (!timestamp) return "날짜 미상";
  const seconds = timestamp - Math.floor(Date.now() / 1_000);
  const formatter = new Intl.RelativeTimeFormat("ko", { numeric: "auto" });
  const absolute = Math.abs(seconds);
  if (absolute < 60) return formatter.format(Math.round(seconds), "second");
  if (absolute < 3_600) return formatter.format(Math.round(seconds / 60), "minute");
  if (absolute < 86_400) return formatter.format(Math.round(seconds / 3_600), "hour");
  if (absolute < 2_592_000) return formatter.format(Math.round(seconds / 86_400), "day");
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "short", day: "numeric" })
    .format(new Date(timestamp * 1_000));
}

export function dateTime(timestamp: number | null | undefined): string {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp * 1_000));
}

export function salaryText(
  currency: string | null,
  min: number | null,
  max: number | null,
  interval: string | null,
): string {
  if (min === null && max === null) return "미공개";
  const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const range = min !== null && max !== null
    ? `${formatter.format(min)}–${formatter.format(max)}`
    : formatter.format(min ?? max ?? 0);
  return `${currency ?? ""} ${range}${interval ? ` / ${interval}` : ""}`.trim();
}

export const eligibilityLabel: Record<string, string> = {
  yes: "한국 지원 가능",
  likely: "한국 지원 유력",
  unknown: "지원 지역 불명",
  no: "한국 지원 어려움",
};

export const asyncLabel: Record<string, string> = {
  explicit: "Async 명시",
  strong: "Async 강함",
  weak: "Async 신호",
  synchronous: "동기식 위험",
  unknown: "Async 불명",
};

export const remoteScopeLabel: Record<string, string> = {
  worldwide: "Worldwide",
  apac: "APAC",
  "country-list": "국가 목록",
  "region-limited": "지역 제한",
  unknown: "범위 불명",
};
