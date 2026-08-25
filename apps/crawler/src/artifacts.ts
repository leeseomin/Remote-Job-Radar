import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180);
}

export async function writeJsonArtifact(directory: string, name: string, value: unknown): Promise<string> {
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${safeName(name)}.json`);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return path;
}
