import type { SigmaDatabase } from "@sigmaos/db";
import type { SigmaConfig } from "@sigmaos/shared";

export interface ApiRouteContext {
  config: SigmaConfig;
  db: SigmaDatabase;
}

export type ServerDependencies = ApiRouteContext;
