import type { SigmaDatabase } from "@sigmaos/db";
import type { SigmaConfig } from "@sigmaos/shared";
import type { DockerComposeRuntime } from "./lib/docker-compose.js";
import type { DockerEngineRuntime } from "./lib/docker-client.js";
import type { ShareManagementDependencies } from "./lib/share-service.js";
import type { SystemManagementDependencies } from "./lib/system-management.js";
import type { VideoTranscoder } from "./lib/video-cache.js";

export interface ApiRouteContext {
  config: SigmaConfig;
  db: SigmaDatabase;
  docker?: {
    engine?: DockerEngineRuntime;
    compose?: DockerComposeRuntime;
  };
  shares?: ShareManagementDependencies;
  system?: SystemManagementDependencies;
  videoTranscoder?: VideoTranscoder;
}

export type ServerDependencies = ApiRouteContext;
