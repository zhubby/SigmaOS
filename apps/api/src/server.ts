import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import type { ServerDependencies } from "./context.js";
import { registerErrorHandler } from "./errors.js";
import { registerApiRoutes } from "./routes/index.js";

export type { ServerDependencies } from "./context.js";

export async function buildServer({ config, db }: ServerDependencies): Promise<FastifyInstance> {
  const server = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info"
    }
  });

  if (config.api.allowedOrigins?.length) {
    await server.register(cors, {
      origin: config.api.allowedOrigins
    });
  }

  registerErrorHandler(server);
  registerApiRoutes(server, { config, db });

  return server;
}
