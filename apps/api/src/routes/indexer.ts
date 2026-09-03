import type { FastifyInstance } from "fastify";
import { getIndexRootStatus, getNasRoot, listIndexRootStatuses, listNasRoots } from "@sigmaos/db";
import type { ApiRouteContext } from "../context.js";

export function registerIndexerRoutes(server: FastifyInstance, { db }: ApiRouteContext): void {
  server.get<{
    Querystring: { rootId?: string };
  }>("/api/indexer/status", async (request, reply) => {
    if (request.query.rootId) {
      const root = getNasRoot(db, request.query.rootId);
      if (!root) {
        reply.status(404).send({ error: "NAS root not found" });
        return;
      }
      reply.send({ roots: [getIndexRootStatus(db, root.id)] });
      return;
    }

    const roots = listNasRoots(db);
    reply.send({ roots: listIndexRootStatuses(db, roots.map((root) => root.id)) });
  });
}
