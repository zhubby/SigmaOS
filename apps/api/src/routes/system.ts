import type { FastifyInstance } from "fastify";
import type { ApiRouteContext } from "../context.js";
import { collectSystemNetwork, collectSystemStorage } from "../lib/system-management.js";

export function registerSystemRoutes(server: FastifyInstance, { system }: ApiRouteContext): void {
  server.get("/api/system/network", async () => ({
    network: await collectSystemNetwork(system)
  }));

  server.get("/api/system/storage", async () => ({
    storage: await collectSystemStorage(system)
  }));
}
