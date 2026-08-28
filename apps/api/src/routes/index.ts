import type { FastifyInstance } from "fastify";
import type { ApiRouteContext } from "../context.js";
import { registerApprovalRoutes } from "./approvals.js";
import { registerDockerRoutes } from "./docker.js";
import { registerFileRoutes } from "./files.js";
import { registerHealthRoutes } from "./health.js";
import { registerJobRoutes } from "./jobs.js";
import { registerOperationRoutes } from "./operations.js";
import { registerRootRoutes } from "./roots.js";
import { registerSessionRoutes } from "./sessions.js";
import { registerSettingsRoutes } from "./settings.js";
import { registerShareRoutes } from "./shares.js";
import { registerSystemRoutes } from "./system.js";

export function registerApiRoutes(server: FastifyInstance, context: ApiRouteContext): void {
  registerHealthRoutes(server, context);
  registerRootRoutes(server, context);
  registerSettingsRoutes(server, context);
  registerSystemRoutes(server, context);
  registerSessionRoutes(server, context);
  registerJobRoutes(server, context);
  registerFileRoutes(server, context);
  registerApprovalRoutes(server, context);
  registerOperationRoutes(server, context);
  registerDockerRoutes(server, context);
  registerShareRoutes(server, context);
}
