export interface Bindings {
  DB: D1Database;
  ASSETS: Fetcher;
  INGEST_BEARER_TOKEN: string;
  INGEST_HMAC_SECRET_CURRENT: string;
  INGEST_HMAC_SECRET_PREVIOUS?: string;
  DEV_BYPASS_AUTH?: string;
  REQUIRE_ACCESS_USER?: string;
  USER_EMAIL?: string;
}

export interface Variables {
  requestId: string;
  rawBody: string;
  authenticatedEmail: string | null;
}

export type AppEnv = {
  Bindings: Bindings;
  Variables: Variables;
};
