import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const requiredFiles = [
  "README.md",
  "VALIDATION.md",
  "SECURITY.md",
  "docs/DEPLOY_KO.md",
  "docs/REFERENCE_DESIGN_KO.md",
  "apps/web/src/App.vue",
  "apps/web/src/pages/RadarPage.vue",
  "apps/web/src/pages/SourcesPage.vue",
  "apps/web/src/styles/main.css",
  "apps/worker/src/index.ts",
  "apps/worker/src/routes/sources.ts",
  "apps/worker/src/routes/internal/ingest.ts",
  "apps/worker/src/routes/internal/source-complete.ts",
  "apps/worker/src/routes/internal/run.ts",
  "apps/worker/src/middleware/hmac.ts",
  "apps/crawler/src/runners/run.ts",
  "apps/crawler/src/security/ssrf.ts",
  "apps/crawler/src/transport/batches.ts",
  "apps/crawler/src/adapters/greenhouse.ts",
  "apps/crawler/src/adapters/lever.ts",
  "apps/crawler/src/adapters/ashby.ts",
  "apps/crawler/src/adapters/jsonld.ts",
  "apps/crawler/src/adapters/playwright.ts",
  "packages/domain/src/classify.ts",
  "packages/domain/test/classify.test.ts",
  "packages/db/migrations/0001_initial.sql",
  "packages/db/seed/demo.sql",
  ".github/workflows/test.yml",
  ".github/workflows/crawl-fast.yml",
  ".github/workflows/crawl-browser.yml",
  ".github/workflows/deploy.yml",
  ".github/workflows/backup.yml",
  ".github/workflows/cleanup.yml",
];

for (const file of requiredFiles) {
  const info = await stat(resolve(file));
  if (!info.isFile() || info.size === 0) throw new Error(`Required source file is missing or empty: ${file}`);
}

for (const file of [
  "package.json",
  "apps/web/package.json",
  "apps/worker/package.json",
  "apps/crawler/package.json",
  "packages/contracts/package.json",
  "packages/domain/package.json",
  "packages/shared/package.json",
  "packages/db/package.json",
]) {
  JSON.parse(await readFile(resolve(file), "utf8"));
}

const migration = await readFile(resolve("packages/db/migrations/0001_initial.sql"), "utf8");
for (const token of [
  "CREATE TABLE jobs",
  "CREATE TABLE ingest_nonces",
  "CREATE VIRTUAL TABLE jobs_fts",
  "CREATE TRIGGER jobs_fts_update",
]) {
  if (!migration.includes(token)) throw new Error(`Migration is missing ${token}`);
}

const ingest = await readFile(resolve("apps/worker/src/routes/internal/ingest.ts"), "utf8");
if (!ingest.includes("payload.jobs.length") || !ingest.includes("INGEST")) {
  throw new Error("Ingest implementation looks incomplete.");
}

const sourceText = await Promise.all(requiredFiles.map((file) => readFile(resolve(file), "utf8")));
const implementationText = await Promise.all(
  requiredFiles
    .filter((file) => /\.(?:ts|vue|mjs|sql)$/.test(file))
    .map((file) => readFile(resolve(file), "utf8")),
);
if (implementationText.some((text) => /\b(?:FIXME|IMPLEMENT_ME)\b/.test(text))) {
  throw new Error("Unresolved implementation marker found in required sources.");
}

const suspiciousSecret = /(?:sk-[A-Za-z0-9_-]{20,}|CF-Access-Client-Secret\s*[:=]\s*[A-Za-z0-9_-]{20,})/;
if (sourceText.some((text) => suspiciousSecret.test(text))) {
  throw new Error("A value resembling a live secret was found in checked sources.");
}

console.log(`Source inspection passed: ${requiredFiles.length} required files.`);
