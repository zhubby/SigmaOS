import { loadConfig } from "@sigmaos/shared";
import { createPlayerController, PlayerHelperServer, probePlayer } from "./player.js";

const config = loadConfig();
if (!config.player.enabled) {
  console.error("sigmaos-player-helper: player is disabled");
  process.exit(0);
}

const probe = await probePlayer(config.player);
const controller = createPlayerController({
  config: config.player,
  allowedRoots: config.nasRoots.map((root) => root.path),
  probe
});
const server = new PlayerHelperServer({ socketPath: config.player.helperSocketPath, controller });
await server.listen();

const shutdown = () => {
  void server.close().finally(() => process.exit(0));
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
