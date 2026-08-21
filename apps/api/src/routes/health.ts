import type { FastifyInstance } from "fastify";
import type { ApiRouteContext } from "../context.js";

export function registerHealthRoutes(server: FastifyInstance, { config }: ApiRouteContext): void {
  server.get("/health", async () => ({
    ok: true,
    service: "sigmaos-api",
    dataDir: config.dataDir
  }));
}
