import { existsSync } from "node:fs";
import path from "node:path";
import { ensureNasRoots, openSigmaDb } from "@sigmaos/db";
import { loadConfig } from "@sigmaos/shared";
import { loadBuildInfo } from "./lib/build-info.js";
import { createSystemCommandRunner } from "./lib/system-management.js";
import { createTerminalRuntime } from "./lib/terminal-broker.js";
import { createPlayerRuntime } from "./lib/player.js";
import { buildServer } from "./server.js";
import { registerWebApp } from "./web-static.js";

const config = loadConfig();
const db = openSigmaDb(config.databasePath);
const buildInfo = await loadBuildInfo();
ensureNasRoots(db, config.nasRoots);

const server = await buildServer({
  config,
  db,
  buildInfo,
  system: {
    commandRunner: createSystemCommandRunner(config.hostd.socketPath)
  },
  terminal: createTerminalRuntime(config.terminal),
  player: createPlayerRuntime(config.player)
});
const webDist = resolveWebDist();
const docsDist = resolveDocsDist();

if (existsSync(webDist)) {
  await registerWebApp(server, webDist, docsDist);
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

function resolveDocsDist(): string | undefined {
  const configured = process.env.SIGMAOS_DOCS_DIST;
  const candidates = [
    configured,
    path.resolve(process.cwd(), "docs/dist"),
    path.resolve(process.cwd(), "../docs/dist"),
    "/usr/lib/sigmaos/docs/dist"
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => existsSync(candidate));
}
