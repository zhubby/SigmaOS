import cors from "@fastify/cors";
import fastifyWebsocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import type { ServerDependencies } from "./context.js";
import { registerErrorHandler } from "./errors.js";
import { registerApiRoutes } from "./routes/index.js";

export type { ServerDependencies } from "./context.js";

export async function buildServer({ config, db, docker, shares, system, terminal, videoTranscoder }: ServerDependencies): Promise<FastifyInstance> {
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
  await server.register(fastifyWebsocket);
  registerApiRoutes(server, {
    config,
    db,
    ...(docker ? { docker } : {}),
    ...(shares ? { shares } : {}),
    ...(system ? { system } : {}),
    ...(terminal ? { terminal } : {}),
    ...(videoTranscoder ? { videoTranscoder } : {})
  });

  return server;
}
