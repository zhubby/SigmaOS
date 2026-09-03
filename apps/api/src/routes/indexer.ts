import type { FastifyInstance } from "fastify";
import { getIndexRootStatus, getNasRoot, listIndexRootStatuses, listNasRoots, listHealthAlerts, listIndexRunHistory, listRootReadiness } from "@sigmaos/db";
import type { ApiRouteContext } from "../context.js";

export function registerIndexerRoutes(server: FastifyInstance, { db, config }: ApiRouteContext): void {
  server.get<{
    Querystring: { rootId?: string };
  }>("/api/indexer/status", async (request, reply) => {
    if (request.query.rootId) {
      const root = getNasRoot(db, request.query.rootId);
      if (!root) {
        reply.status(404).send({ error: "NAS root not found" });
        return;
      }
      reply.send({ roots: [serializeStatus(getIndexRootStatus(db, root.id), config.environment !== undefined, db)] });
      return;
    }

    const roots = listNasRoots(db);
    reply.send({ roots: listIndexRootStatuses(db, roots.map((root) => root.id)).map((status) => serializeStatus(status, config.environment !== undefined, db)) });
  });
}

function serializeStatus(status: ReturnType<typeof getIndexRootStatus>, extended: boolean, db: ApiRouteContext["db"]): ReturnType<typeof getIndexRootStatus> {
  if (extended) {
    const readiness = listRootReadiness(db, [status.rootId])[0];
    return {
      ...status,
      history: listIndexRunHistory(db, status.rootId, 30),
      readiness: readiness ?? { rootId: status.rootId, status: "unknown", checkedAt: null, reason: "never checked", source: null, uuid: null, fstype: null },
      alerts: listHealthAlerts(db, { limit: 100 }).filter((alert) => alert.rootId === status.rootId || alert.rootId === null)
    };
  }
  const { progress: _progress, metrics: _metrics, readiness: _readiness, alerts: _alerts, history: _history, ...legacy } = status;
  return legacy;
}
