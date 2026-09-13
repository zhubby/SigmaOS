import { existsSync } from "node:fs";
import path from "node:path";
import { ensureNasRoots, openSigmaDb } from "@sigmaos/db";
import { loadConfig } from "@sigmaos/shared";
import { createSystemCommandRunner } from "./lib/system-management.js";
import { buildServer } from "./server.js";
import { registerWebApp } from "./web-static.js";

const config = loadConfig();
const db = openSigmaDb(config.databasePath);
ensureNasRoots(db, config.nasRoots);

const server = await buildServer({
  config,
  db,
  system: {
    commandRunner: createSystemCommandRunner(config.shares.helperSocketPath)
  }
});
const webDist = resolveWebDist();

if (existsSync(webDist)) {
  await registerWebApp(server, webDist);
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
