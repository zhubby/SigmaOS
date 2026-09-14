import type { FastifyInstance } from "fastify";
import type { ApiRouteContext } from "../context.js";
import { unknownBuildInfo } from "../lib/build-info.js";
import { collectSystemNetwork, collectSystemNetworkTraffic, collectSystemStorage } from "../lib/system-management.js";

export function registerSystemRoutes(server: FastifyInstance, { buildInfo, system }: ApiRouteContext): void {
  server.get("/api/system/build-info", async () => ({
    build: buildInfo ?? unknownBuildInfo()
  }));

  server.get("/api/system/network", async () => ({
    network: await collectSystemNetwork(system)
  }));

  server.get("/api/system/network/traffic", async () => ({
    traffic: await collectSystemNetworkTraffic(system)
  }));

  server.get("/api/system/storage", async () => ({
    storage: await collectSystemStorage(system)
  }));
}
