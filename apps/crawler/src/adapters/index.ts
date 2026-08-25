import type { AdapterKind } from "@remote-job-radar/contracts";
import type { JobSourceAdapter } from "../types";
import { AshbyAdapter } from "./ashby";
import { GreenhouseAdapter } from "./greenhouse";
import { JsonLdAdapter } from "./jsonld";
import { LeverAdapter } from "./lever";
import { PlaywrightAdapter } from "./playwright";
import { StaticHtmlAdapter } from "./static-html";

const adapters: Record<AdapterKind, JobSourceAdapter> = {
  greenhouse: new GreenhouseAdapter(),
  lever: new LeverAdapter(),
  ashby: new AshbyAdapter(),
  jsonld: new JsonLdAdapter(),
  "static-html": new StaticHtmlAdapter(),
  playwright: new PlaywrightAdapter(),
};

export function getAdapter(kind: AdapterKind): JobSourceAdapter {
  const adapter = adapters[kind];
  if (!adapter) throw new Error(`Unsupported adapter kind: ${kind}`);
  return adapter;
}
