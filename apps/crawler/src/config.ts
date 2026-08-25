export interface CrawlerConfig {
  appBaseUrl: string;
  accessClientId: string | null;
  accessClientSecret: string | null;
  bearerToken: string;
  hmacSecret: string;
  githubRunId: string;
  githubEventName: string;
  artifactsDir: string;
}

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function loadConfig(): CrawlerConfig {
  const appBaseUrl = required("APP_BASE_URL").replace(/\/$/, "");
  const local = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(appBaseUrl);
  return {
    appBaseUrl,
    accessClientId: process.env.CF_ACCESS_CLIENT_ID || null,
    accessClientSecret: process.env.CF_ACCESS_CLIENT_SECRET || null,
    bearerToken: required("INGEST_BEARER_TOKEN", local ? "local-development-token" : undefined),
    hmacSecret: required("INGEST_HMAC_SECRET", local ? "local-development-hmac-secret-change-me" : undefined),
    githubRunId: process.env.GITHUB_RUN_ID ?? "local",
    githubEventName: process.env.GITHUB_EVENT_NAME ?? "manual",
    artifactsDir: process.env.ARTIFACTS_DIR ?? "artifacts",
  };
}
