import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import {
  base64UrlToBytes,
  canonicalSignatureInput,
  constantTimeEqual,
  sha256Hex,
  verifyHmac,
} from "../lib/crypto";
import { ApiError } from "../lib/errors";
import { unixNow } from "../lib/db";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_CLOCK_SKEW_SECONDS = 300;

export const signedBodyMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const contentType = c.req.header("Content-Type") ?? "";
  if (!contentType.toLocaleLowerCase("en-US").startsWith("application/json")) {
    throw new ApiError(415, "JSON_REQUIRED", "Content-Type은 application/json이어야 합니다.");
  }

  const lengthHeader = Number(c.req.header("Content-Length") ?? 0);
  if (Number.isFinite(lengthHeader) && lengthHeader > MAX_BODY_BYTES) {
    throw new ApiError(413, "BODY_TOO_LARGE", "요청 본문은 256KB를 넘을 수 없습니다.");
  }

  const bytes = new Uint8Array(await c.req.raw.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) {
    throw new ApiError(413, "BODY_TOO_LARGE", "요청 본문은 256KB를 넘을 수 없습니다.");
  }

  const timestamp = c.req.header("X-Timestamp") ?? "";
  const nonce = c.req.header("X-Nonce") ?? "";
  const expectedHash = c.req.header("X-Body-SHA256") ?? "";
  const encodedSignature = c.req.header("X-Signature") ?? "";
  if (!/^\d{10,13}$/.test(timestamp) || !/^[a-zA-Z0-9_-]{12,200}$/.test(nonce)) {
    throw new ApiError(401, "INVALID_SIGNATURE_METADATA", "timestamp 또는 nonce 형식이 올바르지 않습니다.");
  }

  const requestTime = Number(timestamp);
  if (Math.abs(unixNow() - requestTime) > MAX_CLOCK_SKEW_SECONDS) {
    throw new ApiError(401, "EXPIRED_REQUEST", "요청 timestamp가 허용 범위를 벗어났습니다.");
  }

  const actualHash = await sha256Hex(bytes);
  if (!constantTimeEqual(actualHash, expectedHash)) {
    throw new ApiError(401, "BODY_HASH_MISMATCH", "본문 SHA-256이 일치하지 않습니다.");
  }

  let signature: Uint8Array;
  try {
    signature = base64UrlToBytes(encodedSignature);
  } catch {
    throw new ApiError(401, "INVALID_SIGNATURE", "HMAC 서명 형식이 올바르지 않습니다.");
  }

  const canonical = canonicalSignatureInput(
    c.req.method,
    new URL(c.req.url).pathname,
    timestamp,
    nonce,
    actualHash,
  );
  const currentValid = c.env.INGEST_HMAC_SECRET_CURRENT
    ? await verifyHmac(c.env.INGEST_HMAC_SECRET_CURRENT, canonical, signature)
    : false;
  const previousValid = !currentValid && c.env.INGEST_HMAC_SECRET_PREVIOUS
    ? await verifyHmac(c.env.INGEST_HMAC_SECRET_PREVIOUS, canonical, signature)
    : false;
  if (!currentValid && !previousValid) {
    throw new ApiError(401, "INVALID_SIGNATURE", "HMAC 서명이 올바르지 않습니다.");
  }

  const nonceResult = await c.env.DB.prepare(
    "INSERT OR IGNORE INTO ingest_nonces(nonce, used_at) VALUES (?, ?)",
  )
    .bind(nonce, unixNow())
    .run();
  if ((nonceResult.meta.changes ?? 0) === 0) {
    throw new ApiError(409, "NONCE_REUSED", "이미 사용된 nonce입니다.");
  }

  c.set("rawBody", new TextDecoder().decode(bytes));
  await next();
});
