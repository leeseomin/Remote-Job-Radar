import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { bearerMiddleware } from "../../middleware/bearer";
import { signedBodyMiddleware } from "../../middleware/hmac";
import { crawlPlanRoutes } from "./crawl-plan";
import { ingestRoutes } from "./ingest";
import { sourceCompleteRoutes } from "./source-complete";
import { runRoutes } from "./run";
import { maintenanceRoutes } from "./maintenance";

export const internalRoutes = new Hono<AppEnv>();

internalRoutes.use("*", bearerMiddleware);
internalRoutes.use("/ingest", signedBodyMiddleware);
internalRoutes.use("/source-complete", signedBodyMiddleware);
internalRoutes.use("/run-complete", signedBodyMiddleware);
internalRoutes.use("/run-failed", signedBodyMiddleware);
internalRoutes.use("/cleanup", signedBodyMiddleware);

internalRoutes.route("/", crawlPlanRoutes);
internalRoutes.route("/", ingestRoutes);
internalRoutes.route("/", sourceCompleteRoutes);
internalRoutes.route("/", runRoutes);
internalRoutes.route("/", maintenanceRoutes);
