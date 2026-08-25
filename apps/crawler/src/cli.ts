import { runCrawler } from "./runners/run";

const runner = process.argv[2];
if (runner !== "fast" && runner !== "browser") {
  console.error("Usage: tsx src/cli.ts <fast|browser>");
  process.exitCode = 2;
} else {
  runCrawler(runner).catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
