import { existsSync } from "node:fs";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import { ensureNasRoots, openSigmaDb } from "@sigmaos/db";
import { loadConfig } from "@sigmaos/shared";
import { buildServer } from "./server.js";

const config = loadConfig();
const db = openSigmaDb(config.databasePath);
ensureNasRoots(db, config.nasRoots);

const server = await buildServer({ config, db });
const webDist = resolveWebDist();

if (existsSync(webDist)) {
  await server.register(fastifyStatic, {
    root: webDist,
    prefix: "/",
    wildcard: true
  });

  server.setNotFoundHandler((_request, reply) => {
    reply.sendFile("index.html");
  });
}

await server.listen({ host: config.api.host, port: config.api.port });

function resolveWebDist(): string {
  if (process.env.SIGMAOS_WEB_DIST) {
    return process.env.SIGMAOS_WEB_DIST;
  }

  const candidates = [
    path.resolve(process.cwd(), "apps/web/dist"),
    path.resolve(process.cwd(), "../web/dist")
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}
