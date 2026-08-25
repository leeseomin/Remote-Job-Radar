import { createHash, createHmac, randomUUID } from "node:crypto";

const pathname = process.argv[2];
const body = process.argv[3] ?? "{}";
if (!pathname?.startsWith("/api/internal/")) {
  console.error("Usage: node scripts/signed-post.mjs /api/internal/<path> '<json>'");
  process.exit(2);
}
try {
  JSON.parse(body);
} catch {
  console.error("The body argument must be valid JSON.");
  process.exit(2);
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

const baseUrl = required("APP_BASE_URL").replace(/\/$/, "");
const bearer = required("INGEST_BEARER_TOKEN");
const secret = required("INGEST_HMAC_SECRET");
const timestamp = Math.floor(Date.now() / 1000).toString();
const nonce = randomUUID();
const bodyHash = createHash("sha256").update(body, "utf8").digest("hex");
const canonical = ["POST", pathname, timestamp, nonce, bodyHash].join("\n");
const signature = createHmac("sha256", secret).update(canonical, "utf8").digest("base64url");
const headers = {
  Accept: "application/json",
  "Content-Type": "application/json",
  Authorization: `Bearer ${bearer}`,
  "X-Timestamp": timestamp,
  "X-Nonce": nonce,
  "X-Body-SHA256": bodyHash,
  "X-Signature": signature,
};
if (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
  headers["CF-Access-Client-Id"] = process.env.CF_ACCESS_CLIENT_ID;
  headers["CF-Access-Client-Secret"] = process.env.CF_ACCESS_CLIENT_SECRET;
}

const response = await fetch(`${baseUrl}${pathname}`, { method: "POST", headers, body });
const text = await response.text();
console.log(text);
if (!response.ok) process.exitCode = 1;
